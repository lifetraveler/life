/**
 * 切片 15 阶段 1：AI 解析层的统一错误类型。
 *
 * 分类原则（§7.24 结构约束 + 任务卡“拦截残缺 JSON”）：
 * - invalid-json：AI 返回内容（或 HTTP 响应体）根本不是合法 JSON——直接拦截，不做任何补救；
 * - schema-mismatch：JSON 合法但未通过 isParsedItemDraft 结构校验（字符串数字、缺字段、
 *   规则越界等都算）——同样拦截；
 * - network / timeout / http-status：传输层失败，由阶段 3 的编排层决定是否降级到
 *   LocalFallbackProvider；
 * - empty-input：调用方传了空输入（编程约定，UI 层应提前拦住）。
 *
 * 错误消息不得包含 apiKey（本文件与所有抛错点都要遵守）。
 */

export type AiParseErrorKind =
  | 'network'
  | 'http-status'
  | 'invalid-json'
  | 'schema-mismatch'
  | 'timeout'
  | 'empty-input';

export class AiParseError extends Error {
  readonly kind: AiParseErrorKind;
  /** 仅 http-status 时非 null */
  readonly status: number | null;

  constructor(kind: AiParseErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'AiParseError';
    this.kind = kind;
    this.status = status;
  }
}
