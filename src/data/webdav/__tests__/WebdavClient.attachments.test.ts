/**
 * WebdavClient 附件三方法单测（切片 37，AGENTS.md §7.49 D4/Q5）：
 * uploadAttachment / downloadAttachment / deleteAttachmentRemote——
 * fetchImpl 注入 + 真实 Response（WebdavClient.test.ts 同款先例）；
 * 覆盖 URL 组装（life-attachments 子目录分段）、MKCOL 405 容忍、二进制体
 * 回传、60s 超时覆盖（构造注入 20ms 不生效）、404 → false、remoteName 守卫。
 */

import { WebdavClient, type FetchLike } from '../WebdavClient';
import { WebdavError } from '../../../domain/webdav/WebdavError';
import type { WebdavConfig } from '../../../domain/webdav/config';

const CONFIG: WebdavConfig = {
  baseUrl: 'https://dav.example.com',
  basePath: '/life-backup/',
  username: 'user',
  password: 'pass',
};

const ATTACH_DIR_URL = 'https://dav.example.com/life-backup/life-attachments/';

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

function methodOf(call: FakeCall): string {
  return call.init?.method ?? '';
}

function headerOf(call: FakeCall): Record<string, string> {
  return (call.init?.headers ?? {}) as Record<string, string>;
}

describe('uploadAttachment（MKCOL 附件目录 + PUT 二进制）', () => {
  it('先 MKCOL 目录 URL（无 body）再 PUT 资源 URL（octet-stream + 字节原样）', async () => {
    const { client, calls } = makeClient((call) => {
      if (methodOf(call) === 'MKCOL') return new Response(null, { status: 201 });
      return new Response(null, { status: 201 });
    });
    const bytes = new Uint8Array([1, 2, 3, 250, 0]);
    await client.uploadAttachment(CONFIG, 'abcdef0123456789-rec.m4a', bytes);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(ATTACH_DIR_URL);
    expect(methodOf(calls[0])).toBe('MKCOL');
    expect(calls[1].url).toBe(`${ATTACH_DIR_URL}abcdef0123456789-rec.m4a`);
    expect(methodOf(calls[1])).toBe('PUT');
    expect(headerOf(calls[1])['Content-Type']).toBe('application/octet-stream');
    expect(headerOf(calls[1]).Authorization).toBe('Basic dXNlcjpwYXNz');
    expect(callBodyBytes(calls[1])).toEqual(bytes);
  });

  it('MKCOL 405（目录已存在）容忍 → PUT 照常', async () => {
    const { client, calls } = makeClient((call) => {
      if (methodOf(call) === 'MKCOL') return new Response(null, { status: 405 });
      return new Response(null, { status: 201 });
    });
    await client.uploadAttachment(CONFIG, 'abcdef0123456789-img.jpg', new Uint8Array([9]));
    expect(calls).toHaveLength(2);
    expect(methodOf(calls[1])).toBe('PUT');
  });

  it('MKCOL 500 → http-status 且不再 PUT；PUT 401 → auth', async () => {
    const mkcolFail = makeClient(() => new Response(null, { status: 500 }));
    await expect(
      mkcolFail.client.uploadAttachment(CONFIG, 'abcdef0123456789-a.jpg', new Uint8Array([1])),
    ).rejects.toMatchObject({ kind: 'http-status', status: 500 });
    expect(mkcolFail.calls).toHaveLength(1);

    const putAuth = makeClient((call) => {
      if (methodOf(call) === 'MKCOL') return new Response(null, { status: 405 });
      return new Response(null, { status: 401 });
    });
    await expect(
      putAuth.client.uploadAttachment(CONFIG, 'abcdef0123456789-a.jpg', new Uint8Array([1])),
    ).rejects.toMatchObject({ kind: 'auth', status: 401 });
  });

  it('附件请求 60s 超时覆盖构造注入 15s：注入 20ms 客户端 + 50ms 延迟响应仍成功', async () => {
    const slow: FetchLike = (url, init) =>
      new Promise<Response>((resolve, reject) => {
        // 监听 abort（模拟真实传输中断行为）：若 60s 覆盖失效（用构造 20ms），
        // 20ms 即 reject → 用例失败；覆盖生效时 50ms 回包照常成功。
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        });
        setTimeout(() => resolve(new Response(null, { status: 201 })), 50);
        void url;
      });
    const client = new WebdavClient(slow, 20);
    await expect(
      client.uploadAttachment(CONFIG, 'abcdef0123456789-a.jpg', new Uint8Array([1])),
    ).resolves.toBeUndefined();
  });
});

describe('downloadAttachment（GET 二进制回传）', () => {
  it('200 → 字节与远端一致；404 → http-status（附件下载无幂等 false 语义）', async () => {
    const payload = new Uint8Array([4, 5, 6, 255]);
    const ok = makeClient(() => new Response(payload, { status: 200 }));
    const bytes = await ok.client.downloadAttachment(CONFIG, 'abcdef0123456789-img.png');
    expect(callsCount(ok)).toBe(1);
    expect(ok.calls[0].url).toBe(`${ATTACH_DIR_URL}abcdef0123456789-img.png`);
    expect(methodOf(ok.calls[0])).toBe('GET');
    expect(bytes).toEqual(payload);

    const missing = makeClient(() => new Response(null, { status: 404 }));
    await expect(missing.client.downloadAttachment(CONFIG, 'abcdef0123456789-img.png')).rejects.toMatchObject(
      { kind: 'http-status', status: 404 },
    );
  });
});

describe('deleteAttachmentRemote（DELETE；404 → false）', () => {
  it('204 → true；404 → false；500 → http-status', async () => {
    const ok = makeClient(() => new Response(null, { status: 204 }));
    await expect(ok.client.deleteAttachmentRemote(CONFIG, 'abcdef0123456789-a.jpg')).resolves.toBe(true);
    expect(ok.calls[0].url).toBe(`${ATTACH_DIR_URL}abcdef0123456789-a.jpg`);
    expect(methodOf(ok.calls[0])).toBe('DELETE');

    const missing = makeClient(() => new Response(null, { status: 404 }));
    await expect(missing.client.deleteAttachmentRemote(CONFIG, 'abcdef0123456789-a.jpg')).resolves.toBe(false);

    const fail = makeClient(() => new Response(null, { status: 500 }));
    await expect(fail.client.deleteAttachmentRemote(CONFIG, 'abcdef0123456789-a.jpg')).rejects.toMatchObject(
      { kind: 'http-status', status: 500 },
    );
  });
});

describe('remoteName 守卫（防路径穿越，invalid-response 零网络调用）', () => {
  const badNames = ['', '../escape', 'a/b.jpg', 'a\\b.jpg', '.', '..'];
  it.each(badNames)('非法名 %j 三个方法均拒绝且不发起请求', async (badName) => {
    const { client, calls } = makeClient(() => new Response(null, { status: 200 }));
    await expect(
      client.uploadAttachment(CONFIG, badName, new Uint8Array([1])),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
    await expect(client.downloadAttachment(CONFIG, badName)).rejects.toMatchObject({
      kind: 'invalid-response',
    });
    await expect(client.deleteAttachmentRemote(CONFIG, badName)).rejects.toMatchObject({
      kind: 'invalid-response',
    });
    expect(calls).toHaveLength(0);
  });
});

function callBodyBytes(call: FakeCall): Uint8Array {
  const body = call.init?.body;
  if (body instanceof Uint8Array) return body;
  throw new Error(`测试断言前提失败：body 不是 Uint8Array（${typeof body}）`);
}

function callsCount(harness: { calls: FakeCall[] }): number {
  return harness.calls.length;
}
