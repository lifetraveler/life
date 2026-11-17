/**
 * WebDAV 域层纯函数单测（切片 28 阶段 1，AGENTS.md §7.42 D3/D4）：
 * URL 组装 / 连接配置守卫 / base64 UTF-8 编码 / 错误 kind 与文案表。
 */

import { encodeBase64Utf8 } from '../base64';
import {
  WEBDAV_BACKUP_CONFIG_STORE_KEY,
  isWebdavConfig,
  type WebdavConfig,
} from '../config';
import { WEBDAV_ERROR_KINDS, WEBDAV_ERROR_KIND_LABELS, WebdavError } from '../WebdavError';
import {
  buildWebdavUrl,
  isInsecureHttpUrl,
  normalizeWebdavBaseUrl,
  webdavBasePathSegments,
} from '../url';

describe('URL 组装（url.ts）', () => {
  it('normalizeWebdavBaseUrl：trim + 去全部尾斜杠', () => {
    expect(normalizeWebdavBaseUrl('https://dav.example.com')).toBe('https://dav.example.com');
    expect(normalizeWebdavBaseUrl('https://dav.example.com/')).toBe('https://dav.example.com');
    expect(normalizeWebdavBaseUrl('  https://dav.example.com/// ')).toBe('https://dav.example.com');
  });

  it('webdavBasePathSegments：过滤空段，根目录为 []', () => {
    expect(webdavBasePathSegments('')).toEqual([]);
    expect(webdavBasePathSegments('/')).toEqual([]);
    expect(webdavBasePathSegments('/life-backup/')).toEqual(['life-backup']);
    expect(webdavBasePathSegments('a/b')).toEqual(['a', 'b']);
    expect(webdavBasePathSegments(' /a//b/ ')).toEqual(['a', 'b']);
  });

  it('buildWebdavUrl：目录 URL 补尾斜杠、资源 URL 不补', () => {
    const config: Pick<WebdavConfig, 'baseUrl' | 'basePath'> = {
      baseUrl: 'https://dav.example.com/',
      basePath: '/life-backup/',
    };
    expect(buildWebdavUrl(config)).toBe('https://dav.example.com/life-backup/');
    expect(buildWebdavUrl(config, 'life-config-20261118-090503.json')).toBe(
      'https://dav.example.com/life-backup/life-config-20261118-090503.json',
    );
  });

  it('buildWebdavUrl：路径段逐段 encodeURIComponent（空格/中文安全）', () => {
    const config = { baseUrl: 'https://dav.example.com', basePath: '/my backups/生活' };
    expect(buildWebdavUrl(config)).toBe(
      `https://dav.example.com/${encodeURIComponent('my backups')}/${encodeURIComponent('生活')}/`,
    );
    expect(buildWebdavUrl(config, 'a b.json')).toBe(
      `https://dav.example.com/${encodeURIComponent('my backups')}/${encodeURIComponent('生活')}/${encodeURIComponent('a b.json')}`,
    );
  });

  it('buildWebdavUrl：根目录（basePath 空）= base + "/"', () => {
    expect(buildWebdavUrl({ baseUrl: 'https://dav.example.com', basePath: '' })).toBe(
      'https://dav.example.com/',
    );
  });

  it('buildWebdavUrl：baseUrl 空 throw（UI 层先行校验的兜底）', () => {
    expect(() => buildWebdavUrl({ baseUrl: '   ', basePath: '/x' })).toThrow(
      'buildWebdavUrl: baseUrl 不能为空',
    );
  });

  it('isInsecureHttpUrl：http:// 明文检测（https 不命中）', () => {
    expect(isInsecureHttpUrl('http://dav.example.com')).toBe(true);
    expect(isInsecureHttpUrl(' HTTP://dav.example.com ')).toBe(true);
    expect(isInsecureHttpUrl('https://dav.example.com')).toBe(false);
    expect(isInsecureHttpUrl('ftp://dav.example.com')).toBe(false);
  });
});

describe('isWebdavConfig（连接配置守卫，§7.42 D4）', () => {
  it('合法配置通过并返回归一拷贝（baseUrl 去尾斜杠、basePath trim）', () => {
    const config = isWebdavConfig({
      baseUrl: ' https://dav.example.com/ ',
      basePath: ' /life-backup/ ',
      username: 'user',
      password: 'pass',
    });
    expect(config).toEqual({
      baseUrl: 'https://dav.example.com',
      basePath: '/life-backup/',
      username: 'user',
      password: 'pass',
    });
  });

  it('匿名（username/password 空）合法', () => {
    expect(
      isWebdavConfig({ baseUrl: 'https://dav.example.com', basePath: '', username: '', password: '' }),
    ).toEqual({
      baseUrl: 'https://dav.example.com',
      basePath: '',
      username: '',
      password: '',
    });
  });

  it('拒绝：非对象 / 缺字段 / 非串字段 / baseUrl 非 http(s)', () => {
    expect(isWebdavConfig(null)).toBeNull();
    expect(isWebdavConfig([])).toBeNull();
    expect(isWebdavConfig('x')).toBeNull();
    expect(isWebdavConfig({ baseUrl: 'https://a.com' })).toBeNull();
    expect(
      isWebdavConfig({ baseUrl: 'https://a.com', basePath: '', username: 'u', password: 42 }),
    ).toBeNull();
    expect(
      isWebdavConfig({ baseUrl: 'ftp://a.com', basePath: '', username: 'u', password: 'p' }),
    ).toBeNull();
    expect(
      isWebdavConfig({ baseUrl: 'dav.example.com', basePath: '', username: 'u', password: 'p' }),
    ).toBeNull();
  });

  it('键常量 webdav_backup_config_v1（§7.42 D4 冻结）', () => {
    expect(WEBDAV_BACKUP_CONFIG_STORE_KEY).toBe('webdav_backup_config_v1');
  });
});

describe('encodeBase64Utf8（Basic Auth 编码，零新依赖）', () => {
  it('ASCII 向量：user:pass → dXNlcjpwYXNz', () => {
    expect(encodeBase64Utf8('user:pass')).toBe('dXNlcjpwYXNz');
  });

  it('padding 边界：长度 0/1/2/3 字节', () => {
    expect(encodeBase64Utf8('')).toBe('');
    expect(encodeBase64Utf8('a')).toBe('YQ==');
    expect(encodeBase64Utf8('ab')).toBe('YWI=');
    expect(encodeBase64Utf8('abc')).toBe('YWJj');
  });

  it('多字节 UTF-8 与 Node Buffer 交叉验证（中文/emoji 代理对）', () => {
    for (const sample of ['user:密码', 'user:😀🎉', '用户名:密码.123', 'ünïcodé']) {
      expect(encodeBase64Utf8(sample)).toBe(Buffer.from(sample, 'utf8').toString('base64'));
    }
  });
});

describe('WebdavError（kind 五类 + 文案表，提案 §4.2）', () => {
  it('kind 全集与文案表键一一对应', () => {
    expect(WEBDAV_ERROR_KINDS).toEqual([
      'network',
      'http-status',
      'auth',
      'invalid-response',
      'timeout',
    ]);
    for (const kind of WEBDAV_ERROR_KINDS) {
      expect(typeof WEBDAV_ERROR_KIND_LABELS[kind]).toBe('string');
    }
    expect(WEBDAV_ERROR_KIND_LABELS.auth).toBe('认证失败');
    expect(WEBDAV_ERROR_KIND_LABELS.timeout).toBe('连接超时');
  });

  it('WebdavError 携带 kind / status / name', () => {
    const auth = new WebdavError('auth', '认证失败（HTTP 401）', 401);
    expect(auth.kind).toBe('auth');
    expect(auth.status).toBe(401);
    expect(auth.name).toBe('WebdavError');
    expect(auth.message).toBe('认证失败（HTTP 401）');

    const network = new WebdavError('network', '网络错误');
    expect(network.kind).toBe('network');
    expect(network.status).toBeNull();
  });
});
