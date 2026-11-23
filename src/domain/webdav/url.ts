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

/**
 * 附件远端目录名（切片 37，AGENTS.md §7.49 Q5）：basePath 之下的固定子目录。
 * spark_attachments.remote_path 只存本目录内的文件名（不含目录前缀），
 * URL 组装时拼接本常量——跨设备 basePath 迁移只需换目录名。
 */
export const WEBDAV_ATTACHMENTS_DIR = 'life-attachments';

/**
 * 附件远端文件名守卫（防路径穿越）：非空、不含 '/' 与 '\\'、非 '.' / '..'。
 * remote_name 由 buildAttachmentRemoteName（domain/spark）从 sha256 生成，
 * 此处仍做兜底守卫（PUT/GET/DELETE 前统一校验）。
 */
export function isWebdavAttachmentRemoteName(remoteName: string): boolean {
  if (remoteName.length === 0) return false;
  if (remoteName.includes('/') || remoteName.includes('\\')) return false;
  if (remoteName === '.' || remoteName === '..') return false;
  return true;
}

/** 附件目录集合 URL（MKCOL 用）：basePath 段 + 'life-attachments'，尾随斜杠集合语义。 */
export function buildWebdavAttachmentDirUrl(
  config: Pick<WebdavConfig, 'baseUrl' | 'basePath'>,
): string {
  const base = normalizeWebdavBaseUrl(config.baseUrl);
  if (base.length === 0) {
    throw new Error('buildWebdavAttachmentDirUrl: baseUrl 不能为空');
  }
  const segments = [...webdavBasePathSegments(config.basePath), WEBDAV_ATTACHMENTS_DIR];
  const path = segments.map((segment) => encodeURIComponent(segment)).join('/');
  return `${base}/${path}/`;
}

/** 附件资源 URL（PUT/GET/DELETE 用）：basePath 段 + 'life-attachments' + remoteName。 */
export function buildWebdavAttachmentUrl(
  config: Pick<WebdavConfig, 'baseUrl' | 'basePath'>,
  remoteName: string,
): string {
  if (!isWebdavAttachmentRemoteName(remoteName)) {
    throw new Error(`buildWebdavAttachmentUrl: 非法附件文件名：${remoteName}`);
  }
  const base = normalizeWebdavBaseUrl(config.baseUrl);
  if (base.length === 0) {
    throw new Error('buildWebdavAttachmentUrl: baseUrl 不能为空');
  }
  const segments = [
    ...webdavBasePathSegments(config.basePath),
    WEBDAV_ATTACHMENTS_DIR,
    remoteName,
  ];
  const path = segments.map((segment) => encodeURIComponent(segment)).join('/');
  return `${base}/${path}`;
}
