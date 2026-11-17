/**
 * 切片 28 阶段 1（AGENTS.md §7.42）：WebDAV URL 组装纯函数（domain 无 IO）。
 *
 * baseUrl/basePath 均可能来自用户手输（多余斜杠/空格），组装时统一归一；
 * 路径段逐段 encodeURIComponent（空格/中文/保留字符安全，Nginx/Apache/
 * NextCloud 等 WebDAV 服务器通用）。
 */

import type { WebdavConfig } from './config';

/** 归一 baseUrl：trim + 去全部尾斜杠（'https://dav.example.com/' → 'https://dav.example.com'）。 */
export function normalizeWebdavBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/**
 * basePath → 路径段数组：trim 后按 '/' 切分、过滤空段。
 * ''、'/' → []（根目录）；'life-backup'、'/life-backup/'、'/a/b/' → ['life-backup'] / ['a','b']。
 */
export function webdavBasePathSegments(basePath: string): string[] {
  return basePath
    .trim()
    .split('/')
    .filter((segment) => segment.length > 0);
}

/**
 * 组装完整 URL：normalizeWebdavBaseUrl(baseUrl) + 归一路径段（逐段 encodeURIComponent）。
 * - fileName 传 undefined = 目录本身（PROPFIND/MKCOL 用），补尾随 '/'（集合语义）；
 * - fileName 传文件名 = 资源 URL，无尾随斜杠（PUT/GET/DELETE 用）；
 * - baseUrl 归一后为空 → throw（调用方在 UI 层先行校验，此处兜底）。
 */
export function buildWebdavUrl(
  config: Pick<WebdavConfig, 'baseUrl' | 'basePath'>,
  fileName?: string,
): string {
  const base = normalizeWebdavBaseUrl(config.baseUrl);
  if (base.length === 0) {
    throw new Error('buildWebdavUrl: baseUrl 不能为空');
  }
  const segments = [...webdavBasePathSegments(config.basePath)];
  if (fileName !== undefined) {
    segments.push(fileName);
  }
  const path = segments.map((segment) => encodeURIComponent(segment)).join('/');
  if (path.length === 0) {
    // 根目录集合 URL（仅 fileName === undefined 时 path 可为空）——避免 base//'/' 双斜杠。
    return `${base}/`;
  }
  if (fileName === undefined) {
    return `${base}/${path}/`;
  }
  return `${base}/${path}`;
}

/** http:// 明文前缀检测（UI 提示「建议 HTTPS」；允许 http 但提示，提案 §4.2）。 */
export function isInsecureHttpUrl(baseUrl: string): boolean {
  return baseUrl.trim().toLowerCase().startsWith('http://');
}
