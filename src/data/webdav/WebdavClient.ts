/**
 * 切片 28 阶段 1（AGENTS.md §7.42 D3/D5）：自写 WebDAV fetch 客户端。
 *
 * 方法集 PROPFIND / GET / PUT / MKCOL / DELETE + Basic Auth；每请求 15s
 * AbortController 超时（openAiCompatible 先例）；零新依赖；fetchImpl 构造注入
 * （openAiCompatible 同款），单测不触网。错误一律抛 WebdavError（kind 五类）。
 *
 * 兼容性口径（提案 §4.2/§7）：PROPFIND 解析以 href 为主、displayname 兜底、
 * 命名空间前缀宽容（D:/d:/无）；MKCOL 405 = 目录已存在容忍；DELETE 失败仅
 * 计入披露清单不重试不阻塞（滚动保留最近 10 份）。
 *
 * v0.35（切片 31，§7.43 D6）：快照文件名过滤方法级参数化（SnapshotFileNameFilter，
 * 缺省 isConfigSnapshotFileName 向后兼容）——数据快照 life-data-*.json 独立列表/
 * 上传/下载/删除，滚动保留 10 份与配置快照互不挤占。
 *
 * v0.39（切片 35，§7.47）：新增 uploadSyncSnapshot——同步快照固定名覆盖写，
 * 不走滚动裁剪（固定名文件无时间序，倒序裁剪会误删对端设备快照）。
 *
 * v0.43（切片 37，§7.49 Q5 附件上云）：新增附件三方法 uploadAttachment /
 * downloadAttachment / deleteAttachmentRemote——二进制体（Uint8Array）+ 每请求
 * 60s 超时（录音/图片大文件放宽，提案 D4）；附件统一放 basePath 之下的
 * life-attachments/ 子目录（WEBDAV_ATTACHMENTS_DIR），MKCOL 405 容忍先例沿用。
 */

import { isConfigSnapshotFileName } from '../../domain/configSnapshot';
import { isSyncSnapshotFileName } from '../../domain/syncSnapshot';
import { encodeBase64Utf8 } from '../../domain/webdav/base64';
import type { WebdavConfig } from '../../domain/webdav/config';
import { WebdavError } from '../../domain/webdav/WebdavError';
import {
  buildWebdavAttachmentDirUrl,
  buildWebdavAttachmentUrl,
  buildWebdavUrl,
  isWebdavAttachmentRemoteName,
} from '../../domain/webdav/url';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * 快照文件名过滤器（切片 31 v0.35 参数化，§7.43 D6）：CONFIG / DATA 快照各自
 * 传入自己的谓词；缺省 isConfigSnapshotFileName 向后兼容切片 28 调用面。
 */
export type SnapshotFileNameFilter = (fileName: string) => boolean;

export interface WebdavSnapshotFileInfo {
  /** 文件名（href basename 解码后），恒匹配传入的 fileNameFilter 谓词。 */
  name: string;
  /** getlastmodified 解析值；缺失/不可解析为 null。 */
  lastModified: Date | null;
}

export interface UploadSnapshotResult {
  fileName: string;
  /** 本次滚动删除成功的旧快照数。 */
  prunedCount: number;
  /** 滚动删除失败的文件名清单（仅披露，不阻塞备份成功，提案 §4.2）。 */
  pruneFailedNames: string[];
}

/** 每请求超时（§7.42 D3：15s，openAiCompatible 先例）。 */
const WEBDAV_TIMEOUT_MS = 15000;

/** 附件请求超时（切片 37 §7.49 D4：60s，录音/图片大文件放宽）。 */
const ATTACHMENT_TIMEOUT_MS = 60000;

/** 上传后保留的最近快照份数（§7.42 D5：10 份滚动）。 */
const KEEP_SNAPSHOT_COUNT = 10;

/** multistatus 单条目：href/displayname 二选一的原始值 + getlastmodified。 */
interface MultistatusEntry {
  name: string;
  lastModified: Date | null;
}

/** XML 实体解码（&amp; 最后防双重解码）。 */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&amp;/g, '&');
}

/** 取 XML 标签文本值（命名空间前缀宽容：D:href / d:href / href）；缺失返回 null。 */
function matchTagValue(xml: string, tag: string): string | null {
  const pattern = new RegExp(
    `<(?:[\\w.]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.]+:)?${tag}>`,
    'i',
  );
  const match = xml.match(pattern);
  if (match === null) return null;
  const value = decodeXmlEntities(match[1]).trim();
  return value.length === 0 ? null : value;
}

/**
 * 宽容解析 multistatus XML：逐 <response> 块取 href（为主）/ displayname（兜底）
 * 与 getlastmodified。href 可能是绝对路径 / 相对路径 / 百分号编码，basename
 * 解析在 decodeHrefBasename。
 */
function parseMultistatusHrefs(body: string): MultistatusEntry[] {
  const entries: MultistatusEntry[] = [];
  const responseBlocks = body.matchAll(
    /<(?:[\w.]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w.]+:)?response>/g,
  );
  for (const block of responseBlocks) {
    const inner = block[1];
    const href = matchTagValue(inner, 'href');
    const displayName = matchTagValue(inner, 'displayname');
    const name = href ?? displayName;
    if (name === null) continue;
    const lastModifiedRaw = matchTagValue(inner, 'getlastmodified');
    entries.push({
      name,
      lastModified: lastModifiedRaw === null ? null : new Date(lastModifiedRaw),
    });
  }
  return entries;
}

/**
 * href → 文件名：XML 实体解码 → URL 解码（畸形百分号编码保留原样）→ 去尾斜杠
 * → 取最后一段；集合条目（末段为空）返回 null。
 */
function decodeHrefBasename(href: string): string | null {
  let value = href;
  try {
    value = decodeURIComponent(value);
  } catch {
    // 保留原样（畸形百分号编码）
  }
  const trimmed = value.replace(/\/+$/, '');
  if (trimmed.length === 0) return null;
  const segments = trimmed.split('/');
  const last = segments[segments.length - 1];
  return last.length === 0 ? null : last;
}

export class WebdavClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(fetchImpl: FetchLike = fetch, timeoutMs: number = WEBDAV_TIMEOUT_MS) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  /** 测试连接（§7.42 D7）：PROPFIND basePath（Depth:1）。2xx = 可达且凭据可用。 */
  async testConnection(config: WebdavConfig): Promise<void> {
    const response = await this.request(config, {
      method: 'PROPFIND',
      url: buildWebdavUrl(config),
      depth: '1',
    });
    this.requireSuccess(response, '测试连接');
  }

  /**
   * 快照列表（§7.42 D5；v0.35 文件名过滤参数化）：PROPFIND 解析 href 为主，仅保留
   * 匹配 fileNameFilter（缺省 CONFIG pattern）的条目，按名倒序 = 时间倒序（文件名内嵌
   * 定宽时间戳，字典序即时间序）。空 body / 无 <response> 块 → invalid-response。
   */
  async listSnapshots(
    config: WebdavConfig,
    fileNameFilter: SnapshotFileNameFilter = isConfigSnapshotFileName,
  ): Promise<WebdavSnapshotFileInfo[]> {
    const response = await this.request(config, {
      method: 'PROPFIND',
      url: buildWebdavUrl(config),
      depth: '1',
    });
    this.requireSuccess(response, '读取快照列表');
    const body = await response.text();
    const entries = parseMultistatusHrefs(body);
    if (entries.length === 0) {
      throw new WebdavError(
        'invalid-response',
        'PROPFIND 响应不含任何条目（服务器可能不是 WebDAV）',
      );
    }
    const files: WebdavSnapshotFileInfo[] = [];
    for (const entry of entries) {
      const name = decodeHrefBasename(entry.name);
      if (name === null || !fileNameFilter(name)) continue;
      const lastModified =
        entry.lastModified !== null && !Number.isNaN(entry.lastModified.getTime())
          ? entry.lastModified
          : null;
      files.push({ name, lastModified });
    }
    files.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
    return files;
  }

  /**
   * 上传快照（§7.42 D5；v0.35 文件名过滤参数化）：MKCOL 建目录（405 容忍 = 已存在）→ PUT
   * application/json → PROPFIND 倒序保留最近 KEEP_SNAPSHOT_COUNT 份（仅按同一
   * fileNameFilter 圈定裁剪对象——CONFIG/DATA 独立计数互不挤占），其余逐个
   * DELETE（2xx/404 计成功；其余失败推 pruneFailedNames 仅披露，不重试不阻塞）。
   */
  async uploadSnapshot(
    config: WebdavConfig,
    fileName: string,
    content: string,
    fileNameFilter: SnapshotFileNameFilter = isConfigSnapshotFileName,
  ): Promise<UploadSnapshotResult> {
    if (!fileNameFilter(fileName)) {
      throw new WebdavError('invalid-response', `非法快照文件名：${fileName}`);
    }
    const mkcol = await this.request(config, { method: 'MKCOL', url: buildWebdavUrl(config) });
    if (mkcol.status !== 405) {
      this.requireSuccess(mkcol, '创建目录');
    }
    const put = await this.request(config, {
      method: 'PUT',
      url: buildWebdavUrl(config, fileName),
      body: content,
      contentType: 'application/json',
    });
    this.requireSuccess(put, '上传快照');

    const files = await this.listSnapshots(config, fileNameFilter);
    const stale = files.slice(KEEP_SNAPSHOT_COUNT);
    let prunedCount = 0;
    const pruneFailedNames: string[] = [];
    for (const file of stale) {
      try {
        const deleted = await this.deleteSnapshot(config, file.name, fileNameFilter);
        if (deleted) prunedCount += 1;
      } catch {
        pruneFailedNames.push(file.name);
      }
    }
    return { fileName, prunedCount, pruneFailedNames };
  }

  /**
   * 上传同步快照（切片 35 v0.39，§7.47）：每设备固定名 life-sync-<deviceId>.json
   * 覆盖写——MKCOL（405 容忍 = 目录已存在）→ PUT，**不做滚动裁剪**：固定名文件
   * 按文件名（uuid）排序无时间语义，uploadSnapshot 的 KEEP_SNAPSHOT_COUNT 倒序
   * 裁剪会误删对端设备的快照，故本方法不调 listSnapshots、不 DELETE。
   */
  async uploadSyncSnapshot(
    config: WebdavConfig,
    fileName: string,
    content: string,
  ): Promise<void> {
    if (!isSyncSnapshotFileName(fileName)) {
      throw new WebdavError('invalid-response', `非法同步快照文件名：${fileName}`);
    }
    const mkcol = await this.request(config, { method: 'MKCOL', url: buildWebdavUrl(config) });
    if (mkcol.status !== 405) {
      this.requireSuccess(mkcol, '创建目录');
    }
    const put = await this.request(config, {
      method: 'PUT',
      url: buildWebdavUrl(config, fileName),
      body: content,
      contentType: 'application/json',
    });
    this.requireSuccess(put, '上传同步快照');
  }

  /** 下载快照文本（GET）。文件名先过 fileNameFilter（缺省 CONFIG，防构造任意路径）。 */
  async downloadSnapshot(
    config: WebdavConfig,
    fileName: string,
    fileNameFilter: SnapshotFileNameFilter = isConfigSnapshotFileName,
  ): Promise<string> {
    if (!fileNameFilter(fileName)) {
      throw new WebdavError('invalid-response', `非法快照文件名：${fileName}`);
    }
    const response = await this.request(config, {
      method: 'GET',
      url: buildWebdavUrl(config, fileName),
    });
    this.requireSuccess(response, '下载快照');
    return await response.text();
  }

  /** 删除单份快照（DELETE）。404 = 已不存在返回 false；2xx 返回 true；其余抛错。 */
  async deleteSnapshot(
    config: WebdavConfig,
    fileName: string,
    fileNameFilter: SnapshotFileNameFilter = isConfigSnapshotFileName,
  ): Promise<boolean> {
    if (!fileNameFilter(fileName)) {
      throw new WebdavError('invalid-response', `非法快照文件名：${fileName}`);
    }
    const response = await this.request(config, {
      method: 'DELETE',
      url: buildWebdavUrl(config, fileName),
    });
    if (response.status === 404) return false;
    this.requireSuccess(response, '删除快照');
    return true;
  }

  /**
   * 上传附件二进制（切片 37 §7.49 D4，60s 超时）：MKCOL life-attachments 目录
   * （405 容忍 = 已存在）→ PUT application/octet-stream。remoteName 先过守卫
   * （防路径穿越）；MKCOL 其他失败视为目录创建失败抛错（与快照上传同策略）。
   */
  async uploadAttachment(
    config: WebdavConfig,
    remoteName: string,
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<void> {
    if (!isWebdavAttachmentRemoteName(remoteName)) {
      throw new WebdavError('invalid-response', `非法附件文件名：${remoteName}`);
    }
    const mkcol = await this.request(config, {
      method: 'MKCOL',
      url: buildWebdavAttachmentDirUrl(config),
      timeoutMs: ATTACHMENT_TIMEOUT_MS,
    });
    if (mkcol.status !== 405) {
      this.requireSuccess(mkcol, '创建附件目录');
    }
    const put = await this.request(config, {
      method: 'PUT',
      url: buildWebdavAttachmentUrl(config, remoteName),
      body: bytes,
      contentType: 'application/octet-stream',
      timeoutMs: ATTACHMENT_TIMEOUT_MS,
    });
    this.requireSuccess(put, '上传附件');
  }

  /** 下载附件二进制（GET，60s 超时）。404 属异常（行内 remote_path 应存在）→ 抛错。 */
  async downloadAttachment(config: WebdavConfig, remoteName: string): Promise<Uint8Array<ArrayBuffer>> {
    if (!isWebdavAttachmentRemoteName(remoteName)) {
      throw new WebdavError('invalid-response', `非法附件文件名：${remoteName}`);
    }
    const response = await this.request(config, {
      method: 'GET',
      url: buildWebdavAttachmentUrl(config, remoteName),
      timeoutMs: ATTACHMENT_TIMEOUT_MS,
    });
    this.requireSuccess(response, '下载附件');
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * 删除远端附件（DELETE，60s 超时）。404 = 远端已不存在 → false（调用方视为
   * 成功披露；删除联动允许孤儿文件，提案 D4「失败仅披露」）。
   */
  async deleteAttachmentRemote(config: WebdavConfig, remoteName: string): Promise<boolean> {
    if (!isWebdavAttachmentRemoteName(remoteName)) {
      throw new WebdavError('invalid-response', `非法附件文件名：${remoteName}`);
    }
    const response = await this.request(config, {
      method: 'DELETE',
      url: buildWebdavAttachmentUrl(config, remoteName),
      timeoutMs: ATTACHMENT_TIMEOUT_MS,
    });
    if (response.status === 404) return false;
    this.requireSuccess(response, '删除远端附件');
    return true;
  }

  /** 401/403 → auth（带 status）；其余非 2xx → http-status（带 status）。 */
  private requireSuccess(response: Response, action: string): void {
    if (response.status === 401 || response.status === 403) {
      throw new WebdavError(
        'auth',
        `${action}：认证失败（HTTP ${response.status}，请检查用户名/密码）`,
        response.status,
      );
    }
    if (!response.ok) {
      throw new WebdavError('http-status', `${action}：服务返回 HTTP ${response.status}`, response.status);
    }
  }

  /**
   * 单请求：Basic Auth 头（username/password 均空 = 匿名不发 Authorization）+
   * 可选 Depth/Content-Type + AbortController 超时（timeoutMs 覆盖缺省 15s，
   * 切片 37 附件 60s 用）；body 支持 string | Uint8Array<ArrayBuffer>（二进制
   * 附件 PUT；<ArrayBuffer> 泛型满足 DOM BodyInit 的 BufferSource 分支）；
   * AbortError → timeout、其余 fetch 拒绝 → network；finally 清定时器。
   */
  private async request(
    config: WebdavConfig,
    options: {
      method: string;
      url: string;
      body?: string | Uint8Array<ArrayBuffer>;
      contentType?: string;
      depth?: string;
      timeoutMs?: number;
    },
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (config.username.length > 0 || config.password.length > 0) {
      headers.Authorization = `Basic ${encodeBase64Utf8(`${config.username}:${config.password}`)}`;
    }
    if (options.depth !== undefined) {
      headers.Depth = options.depth;
    }
    if (options.contentType !== undefined) {
      headers['Content-Type'] = options.contentType;
    }
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(options.url, {
        method: options.method,
        headers,
        body: options.body,
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new WebdavError('timeout', `WebDAV 请求超时（${timeoutMs}ms）`);
      }
      throw new WebdavError(
        'network',
        `WebDAV 网络错误：${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
