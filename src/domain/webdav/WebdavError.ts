/**
 * 切片 28 阶段 1（AGENTS.md §7.42 D3）：WebDAV 客户端错误分类。
 *
 * kind 五类（提案 §4.2）：network / http-status / auth(401/403) /
 * invalid-response / timeout；UI 阶段 2 按 kind 出文案
 * （ai KIND_LABELS 先例，src/domain/ai/chat.ts）。
 */

export type WebdavErrorKind =
  | 'network'
  | 'http-status'
  | 'auth'
  | 'invalid-response'
  | 'timeout';

/** kind 全部合法值（防御性校验/测试遍历用）。 */
export const WEBDAV_ERROR_KINDS: readonly WebdavErrorKind[] = [
  'network',
  'http-status',
  'auth',
  'invalid-response',
  'timeout',
];

/** UI 文案标签（阶段 2 src/app/settings/backup.tsx 消费）。 */
export const WEBDAV_ERROR_KIND_LABELS: Record<WebdavErrorKind, string> = {
  network: '网络错误',
  'http-status': '服务返回错误',
  auth: '认证失败',
  'invalid-response': '响应格式异常',
  timeout: '连接超时',
};

export class WebdavError extends Error {
  readonly kind: WebdavErrorKind;
  /** http-status / auth 时的 HTTP 状态码；其余 null。 */
  readonly status: number | null;

  constructor(kind: WebdavErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'WebdavError';
    this.kind = kind;
    this.status = status;
  }
}
