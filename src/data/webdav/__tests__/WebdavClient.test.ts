/**
 * WebdavClient 单测（切片 28 阶段 1，AGENTS.md §7.42 D3/D5）：
 * fetchImpl 注入 + 真实 Response（Node undici，openAiCompatible.test.ts 先例）；
 * 覆盖 testConnection / listSnapshots / uploadSnapshot / downloadSnapshot /
 * deleteSnapshot、错误五分类、Basic Auth、15s 超时（20ms 注入）。
 */

import { WebdavClient, type FetchLike, type SnapshotFileNameFilter } from '../WebdavClient';
import { WebdavError } from '../../../domain/webdav/WebdavError';
import type { WebdavConfig } from '../../../domain/webdav/config';
import { isDataSnapshotFileName } from '../../../domain/dataSnapshot';
import { isConfigSnapshotFileName } from '../../../domain/configSnapshot';

const CONFIG: WebdavConfig = {
  baseUrl: 'https://dav.example.com',
  basePath: '/life-backup/',
  username: 'user',
  password: 'pass',
};

const DIR_URL = 'https://dav.example.com/life-backup/';
const SNAPSHOT_PATTERN = /^life-config-\d{8}-\d{6}\.json$/;

type FakeCall = { url: string; init?: RequestInit };

function makeClient(
  routes: (call: FakeCall, index: number) => Response | Promise<Response>,
  timeoutMs?: number,
): { client: WebdavClient; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url: String(url), init });
    return routes({ url: String(url), init }, calls.length - 1);
  };
  const client =
    timeoutMs === undefined ? new WebdavClient(fetchImpl) : new WebdavClient(fetchImpl, timeoutMs);
  return { client, calls };
}

function multistatus(
  entries: Array<{ href?: string; displayname?: string; lastModified?: string }>,
): string {
  const body = entries
    .map((entry) => {
      const href = entry.href === undefined ? '' : `<D:href>${entry.href}</D:href>`;
      const name =
        entry.displayname === undefined
          ? ''
          : `<D:displayname>${entry.displayname}</D:displayname>`;
      const modified =
        entry.lastModified === undefined
          ? ''
          : `<D:getlastmodified>${entry.lastModified}</D:getlastmodified>`;
      return `<D:response>${href}${name}${modified}</D:response>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${body}</D:multistatus>`;
}

function snapshotEntries(names: string[]): Array<{ href: string }> {
  return names.map((name) => ({ href: `/dav/life-backup/${name}` }));
}

function methodOf(call: FakeCall): string {
  return call.init?.method ?? '';
}

function expectWebdavError(error: unknown, kind: WebdavError['kind'], status?: number): void {
  expect(error).toBeInstanceOf(WebdavError);
  const webdavError = error as WebdavError;
  expect(webdavError.kind).toBe(kind);
  if (status !== undefined) {
    expect(webdavError.status).toBe(status);
  }
}

describe('testConnection（PROPFIND 2xx 即成功）', () => {
  it('207 请求目录 URL、Depth 1、Basic Authorization、signal 注入', async () => {
    const { client, calls } = makeClient(() => new Response(null, { status: 207 }));
    await client.testConnection(CONFIG);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(DIR_URL);
    expect(methodOf(calls[0])).toBe('PROPFIND');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Basic dXNlcjpwYXNz');
    expect(headers.Depth).toBe('1');
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('401/403 → auth（带 status）；500 → http-status；fetch 拒绝 → network', async () => {
    const auth401 = makeClient(() => new Response(null, { status: 401 }));
    await expect(auth401.client.testConnection(CONFIG)).rejects.toThrow(WebdavError);
    await expect(auth401.client.testConnection(CONFIG)).rejects.toMatchObject({
      kind: 'auth',
      status: 401,
    });

    const auth403 = makeClient(() => new Response(null, { status: 403 }));
    await expect(auth403.client.testConnection(CONFIG)).rejects.toMatchObject({
      kind: 'auth',
      status: 403,
    });

    const http500 = makeClient(() => new Response(null, { status: 500 }));
    await expect(http500.client.testConnection(CONFIG)).rejects.toMatchObject({
      kind: 'http-status',
      status: 500,
    });

    const network = makeClient(() => {
      throw new TypeError('fetch failed');
    });
    await expect(network.client.testConnection(CONFIG)).rejects.toMatchObject({ kind: 'network' });
  });

  it('超时：AbortError → timeout（timeoutMs 注入 20ms）', async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    const client = new WebdavClient(fetchImpl, 20);
    await expect(client.testConnection(CONFIG)).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('匿名配置（username/password 均空 → 不发 Authorization）', () => {
  it('无 Authorization 头', async () => {
    const anon: WebdavConfig = { ...CONFIG, username: '', password: '' };
    const { client, calls } = makeClient(() => new Response(null, { status: 207 }));
    await client.testConnection(anon);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Depth).toBe('1');
  });

  it('username 有值、password 为空 → 仍发 Authorization（空串密码合法）', async () => {
    const half: WebdavConfig = { ...CONFIG, username: 'user', password: '' };
    const { client, calls } = makeClient(() => new Response(null, { status: 207 }));
    await client.testConnection(half);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Basic dXNlcjo=');
  });
});

describe('listSnapshots（href 为主 + displayname 兜底 + 正则过滤 + 倒序）', () => {
  it('过滤非快照文件、倒序排列、lastModified 解析（坏值 null）', async () => {
    const { client, calls } = makeClient(() =>
      new Response(
        multistatus([
          // 集合条目：尾斜杠 basename 空 → 跳过。
          { href: '/dav/life-backup/' },
          { href: '/dav/life-backup/life-config-20260301-080000.json', lastModified: 'Sun, 01 Mar 2026 08:00:00 GMT' },
          { href: '/dav/life-backup/life-config-20260101-120000.json', lastModified: 'garbage' },
          { href: '/dav/life-backup/life-config-20260215-090000.json' },
          { href: '/dav/life-backup/notes.txt' },
          // URL 编码中文名：解码后 basename 不匹配快照模式 → 过滤。
          { href: `/dav/life-backup/${encodeURIComponent('笔记')}.json` },
          // href 缺失 → displayname 兜底。
          { displayname: 'life-config-20260501-110000.json' },
        ]),
        { status: 207 },
      ),
    );
    const snapshots = await client.listSnapshots(CONFIG);
    expect(snapshots.map((s) => s.name)).toEqual([
      'life-config-20260501-110000.json',
      'life-config-20260301-080000.json',
      'life-config-20260215-090000.json',
      'life-config-20260101-120000.json',
    ]);
    expect(snapshots[1].lastModified).not.toBeNull();
    expect(snapshots[2].lastModified).toBeNull();
    expect(snapshots[3].lastModified).toBeNull();
    expect(methodOf(calls[0])).toBe('PROPFIND');
    for (const name of snapshots.map((s) => s.name)) {
      expect(SNAPSHOT_PATTERN.test(name)).toBe(true);
    }
  });

  it('XML 实体解码（&#45; → -）后命中快照模式', async () => {
    const { client } = makeClient(() =>
      new Response(multistatus([{ displayname: 'life&#45;config&#45;20260801&#45;090000.json' }]), {
        status: 207,
      }),
    );
    const snapshots = await client.listSnapshots(CONFIG);
    expect(snapshots.map((s) => s.name)).toEqual(['life-config-20260801-090000.json']);
  });

  it('空目录（仅集合条目）→ []', async () => {
    const { client } = makeClient(() => new Response(multistatus([{ href: '/dav/life-backup/' }]), { status: 207 }));
    await expect(client.listSnapshots(CONFIG)).resolves.toEqual([]);
  });

  it('无 <response> 块 → invalid-response', async () => {
    const { client } = makeClient(() => new Response('<html><body>404</body></html>', { status: 404 }));
    // 404 是 2xx 之外 → 先 requireSuccess 抛 http-status（列表不宽容 404）。
    await expect(client.listSnapshots(CONFIG)).rejects.toMatchObject({ kind: 'http-status' });

    const emptyMultistatus = makeClient(() => new Response(multistatus([]), { status: 207 }));
    await expect(emptyMultistatus.client.listSnapshots(CONFIG)).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });
});

describe('uploadSnapshot（MKCOL → PUT → PROPFIND → 滚动 DELETE 保留 10 份）', () => {
  function twelveNames(): string[] {
    const names: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      names.push(`life-config-20260101-1200${String(i).padStart(2, '0')}.json`);
    }
    return names;
  }

  it('上传成功 + 裁剪最旧 2 份（prunedCount=2）', async () => {
    const names = twelveNames();
    const { client, calls } = makeClient((call) => {
      const method = methodOf(call);
      if (method === 'MKCOL') return new Response(null, { status: 201 });
      if (method === 'PUT') return new Response(null, { status: 201 });
      if (method === 'PROPFIND') return new Response(multistatus(snapshotEntries(names)), { status: 207 });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error(`unexpected method ${method}`);
    });
    const result = await client.uploadSnapshot(CONFIG, 'life-config-20261118-090503.json', '{}');
    expect(result).toEqual({
      fileName: 'life-config-20261118-090503.json',
      prunedCount: 2,
      pruneFailedNames: [],
    });

    const methods = calls.map(methodOf);
    expect(methods).toEqual(['MKCOL', 'PUT', 'PROPFIND', 'DELETE', 'DELETE']);
    expect(calls[0].url).toBe(DIR_URL);
    expect(calls[1].url).toBe(`${DIR_URL}life-config-20261118-090503.json`);
    const putHeaders = calls[1].init?.headers as Record<string, string>;
    expect(putHeaders['Content-Type']).toBe('application/json');
    expect(calls[1].init?.body).toBe('{}');
    // 倒序 slice(10)：保留最新 10 份，DELETE 最旧 2 份（slice 内保持倒序 → 先删 120001）。
    expect(calls[3].url).toBe(`${DIR_URL}life-config-20260101-120001.json`);
    expect(calls[4].url).toBe(`${DIR_URL}life-config-20260101-120000.json`);
  });

  it('MKCOL 405（已存在）容忍，流程继续', async () => {
    const names = twelveNames();
    const { client } = makeClient((call) => {
      const method = methodOf(call);
      if (method === 'MKCOL') return new Response(null, { status: 405 });
      if (method === 'PUT') return new Response(null, { status: 201 });
      if (method === 'PROPFIND') return new Response(multistatus(snapshotEntries(names)), { status: 207 });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error(`unexpected method ${method}`);
    });
    const result = await client.uploadSnapshot(CONFIG, 'life-config-20261118-090504.json', '{}');
    expect(result.prunedCount).toBe(2);
    expect(result.pruneFailedNames).toEqual([]);
  });

  it('MKCOL 500 → http-status 且 PUT 未调用', async () => {
    const { client, calls } = makeClient((call) => {
      expect(methodOf(call)).toBe('MKCOL');
      return new Response(null, { status: 500 });
    });
    await expect(
      client.uploadSnapshot(CONFIG, 'life-config-20261118-090505.json', '{}'),
    ).rejects.toMatchObject({ kind: 'http-status', status: 500 });
    expect(calls).toHaveLength(1);
  });

  it('DELETE 失败仅披露（pruneFailedNames），不阻塞上传结果', async () => {
    const names = twelveNames();
    let deleteCount = 0;
    const { client } = makeClient((call) => {
      const method = methodOf(call);
      if (method === 'MKCOL') return new Response(null, { status: 201 });
      if (method === 'PUT') return new Response(null, { status: 201 });
      if (method === 'PROPFIND') return new Response(multistatus(snapshotEntries(names)), { status: 207 });
      if (method === 'DELETE') {
        deleteCount += 1;
        if (deleteCount === 1) return new Response(null, { status: 500 });
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected method ${method}`);
    });
    const result = await client.uploadSnapshot(CONFIG, 'life-config-20261118-090506.json', '{}');
    expect(result.prunedCount).toBe(1);
    // 第一个 DELETE 目标（倒序 slice(10) 首个最旧）= 120001。
    expect(result.pruneFailedNames).toEqual(['life-config-20260101-120001.json']);
  });

  it('非法文件名 → invalid-response，零网络调用', async () => {
    const { client, calls } = makeClient(() => {
      throw new Error('should not be called');
    });
    await expect(client.uploadSnapshot(CONFIG, 'evil.json', '{}')).rejects.toMatchObject({
      kind: 'invalid-response',
    });
    await expect(
      client.uploadSnapshot(CONFIG, 'life-config-20261118-0905.json', '{}'),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
    expect(calls).toHaveLength(0);
  });
});

describe('downloadSnapshot / deleteSnapshot', () => {
  it('downloadSnapshot：200 返回文本', async () => {
    const { client, calls } = makeClient(
      () => new Response('{"version":1,"kind":"config"}', { status: 200 }),
    );
    const body = await client.downloadSnapshot(CONFIG, 'life-config-20261118-090503.json');
    expect(body).toBe('{"version":1,"kind":"config"}');
    expect(calls[0].url).toBe(`${DIR_URL}life-config-20261118-090503.json`);
    expect(methodOf(calls[0])).toBe('GET');
  });

  it('downloadSnapshot：404 → http-status；非法名 → invalid-response', async () => {
    const { client } = makeClient(() => new Response(null, { status: 404 }));
    await expect(
      client.downloadSnapshot(CONFIG, 'life-config-20260101-120000.json'),
    ).rejects.toMatchObject({ kind: 'http-status', status: 404 });
    await expect(client.downloadSnapshot(CONFIG, 'nope.txt')).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('deleteSnapshot：204 → true；404 → false（不抛）；500 → http-status', async () => {
    const ok = makeClient(() => new Response(null, { status: 204 }));
    await expect(
      ok.client.deleteSnapshot(CONFIG, 'life-config-20260101-120000.json'),
    ).resolves.toBe(true);
    expect(methodOf(ok.calls[0])).toBe('DELETE');

    const missing = makeClient(() => new Response(null, { status: 404 }));
    await expect(
      missing.client.deleteSnapshot(CONFIG, 'life-config-20260101-120000.json'),
    ).resolves.toBe(false);

    const broken = makeClient(() => new Response(null, { status: 500 }));
    await expect(
      broken.client.deleteSnapshot(CONFIG, 'life-config-20260101-120000.json'),
    ).rejects.toMatchObject({ kind: 'http-status', status: 500 });
  });
});

describe('错误实例冒泡纪律', () => {
  it('抛出的是 WebdavError 实例（name/kind/message 完整）', async () => {
    const { client } = makeClient(() => new Response(null, { status: 403 }));
    let caught: unknown = null;
    try {
      await client.testConnection(CONFIG);
    } catch (error) {
      caught = error;
    }
    expectWebdavError(caught, 'auth', 403);
    const webdavError = caught as WebdavError;
    expect(webdavError.name).toBe('WebdavError');
    expect(typeof webdavError.message).toBe('string');
    expect(webdavError.message.length).toBeGreaterThan(0);
  });
});

describe('SnapshotFileNameFilter 参数化（切片 31 v0.35，§7.43 D6）', () => {
  function sixDataNames(): string[] {
    return [3, 2, 1].map(
      (i) => `life-data-20260101-1200${String(i).padStart(2, '0')}.json`,
    );
  }

  const dataFilter: SnapshotFileNameFilter = isDataSnapshotFileName;

  it('listSnapshots：data 谓词只返回 life-data-*.json（CONFIG 名与垃圾名被滤掉），倒序', async () => {
    const names = [...sixDataNames(), 'life-config-20260101-120001.json', 'README.md'];
    const { client } = makeClient(() =>
      new Response(multistatus(snapshotEntries(names)), { status: 207 }),
    );
    const files = await client.listSnapshots(CONFIG, dataFilter);
    expect(files.map((file) => file.name)).toEqual([
      'life-data-20260101-120003.json',
      'life-data-20260101-120002.json',
      'life-data-20260101-120001.json',
    ]);
  });

  it('listSnapshots：缺省谓词 = CONFIG（向后兼容切片 28 调用面，data 名被滤掉）', async () => {
    const names = [...sixDataNames(), 'life-config-20260101-120001.json'];
    const { client } = makeClient(() =>
      new Response(multistatus(snapshotEntries(names)), { status: 207 }),
    );
    const files = await client.listSnapshots(CONFIG);
    expect(files.map((file) => file.name)).toEqual(['life-config-20260101-120001.json']);
  });

  it('uploadSnapshot：data 谓词裁剪只圈 data 文件（CONFIG 名不挤占也不被删）', async () => {
    // 11 份 data + 2 份 config：data 倒序 slice(10) 应删最旧 1 份 data；config 全保留。
    const dataNames = [
      'life-data-20260101-120000.json',
      ...sixDataNames(),
      'life-data-20260101-120004.json',
      'life-data-20260101-120005.json',
      'life-data-20260101-120006.json',
      'life-data-20260101-120007.json',
      'life-data-20260101-120008.json',
      'life-data-20260101-120009.json',
      'life-data-20260101-120010.json',
    ];
    const configNames = ['life-config-20260101-120001.json', 'life-config-20260101-120002.json'];
    const { client, calls } = makeClient((call) => {
      const method = methodOf(call);
      if (method === 'MKCOL') return new Response(null, { status: 201 });
      if (method === 'PUT') return new Response(null, { status: 201 });
      if (method === 'PROPFIND') {
        return new Response(multistatus(snapshotEntries([...dataNames, ...configNames])), {
          status: 207,
        });
      }
      if (method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error(`unexpected method ${method}`);
    });
    const result = await client.uploadSnapshot(
      CONFIG,
      'life-data-20261118-090503.json',
      '{"kind":"data"}',
      dataFilter,
    );
    expect(result).toEqual({
      fileName: 'life-data-20261118-090503.json',
      prunedCount: 1,
      pruneFailedNames: [],
    });
    const deleteUrls = calls.filter((call) => methodOf(call) === 'DELETE').map((call) => call.url);
    expect(deleteUrls).toEqual([`${DIR_URL}life-data-20260101-120000.json`]); // 只删 data 最旧 1 份。
  });

  it('uploadSnapshot：data 谓词拒绝 CONFIG 文件名（invalid-response，零网络调用）', async () => {
    const { client, calls } = makeClient(() => new Response(null, { status: 201 }));
    await expect(
      client.uploadSnapshot(CONFIG, 'life-config-20260101-120001.json', '{}', dataFilter),
    ).rejects.toThrow(WebdavError);
    expect(calls).toHaveLength(0);
  });

  it('downloadSnapshot / deleteSnapshot：data 谓词收放（data 名放行、CONFIG 名拒绝）', async () => {
    const { client, calls } = makeClient((call) => {
      const method = methodOf(call);
      if (method === 'GET') return new Response('{"kind":"data"}', { status: 200 });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error(`unexpected method ${method}`);
    });
    await expect(client.downloadSnapshot(CONFIG, 'life-data-20260101-120001.json', dataFilter)).resolves.toBe(
      '{"kind":"data"}',
    );
    await expect(client.deleteSnapshot(CONFIG, 'life-data-20260101-120001.json', dataFilter)).resolves.toBe(
      true,
    );
    await expect(
      client.downloadSnapshot(CONFIG, 'life-config-20260101-120001.json', dataFilter),
    ).rejects.toThrow(WebdavError);
    await expect(client.deleteSnapshot(CONFIG, 'life-config-20260101-120001.json', dataFilter)).rejects.toThrow(
      WebdavError,
    );
    // 成功 GET+DELETE 各 1 次；两个非法名在客户端即拒（各 0 网络调用）。
    expect(calls.map(methodOf)).toEqual(['GET', 'DELETE']);
  });

  it('isConfigSnapshotFileName / isDataSnapshotFileName 互斥（同目录双正则不互相命中）', () => {
    const configName = 'life-config-20260101-120001.json';
    const dataName = 'life-data-20260101-120001.json';
    expect(isConfigSnapshotFileName(configName)).toBe(true);
    expect(isConfigSnapshotFileName(dataName)).toBe(false);
    expect(isDataSnapshotFileName(dataName)).toBe(true);
    expect(isDataSnapshotFileName(configName)).toBe(false);
  });
});
