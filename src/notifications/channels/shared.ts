/**
 * 切片 16 阶段 2：渠道实现共享工具（从 ReminderScheduler 迁移，行为不变）。
 */

import type { Item } from '../../domain/item';

/** Item.content 为空时通知正文按类型给文案（tasks/slice-05.md 实现要求 4）。 */
const ITEM_TYPE_FALLBACK_BODY: Record<Item['type'], string> = {
  note: '你有一条笔记提醒',
  task: '你有一条任务提醒',
  event: '你有一个日程提醒',
};

/** 通知正文：content 前 60 字符（截断时补省略号），空白内容用类型文案。 */
export function notificationBody(item: Item): string {
  const content = item.content.trim();
  if (content.length === 0) {
    return ITEM_TYPE_FALLBACK_BODY[item.type];
  }
  return content.length > 60 ? `${content.slice(0, 60)}…` : content;
}

/** 错误 → 可读字符串（日志用；unknown 不可用 instanceof 时兜底 String）。 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 网络渠道单次投递超时（毫秒）。到点 fetch 若远端挂死，不能让定时器/
 * 对账补发无限等待；超时按 'failed' 处理（attempt 记录，下轮 reconcile 可补发）。
 */
export const NETWORK_DELIVER_TIMEOUT_MS = 10_000;

/**
 * 带超时的 fetch：用 AbortController 在 NETWORK_DELIVER_TIMEOUT_MS 后中止。
 * 注入的 fetchImpl 保留 RequestInfo | URL 形参签名，与全局 fetch 等价可替换。
 */
export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, NETWORK_DELIVER_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
