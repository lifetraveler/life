import type { SourceUidStrategy, SystemCalendarEvent } from './types';

/**
 * 切片 9：系统日历 sourceUid 生成（AGENTS.md §7.15 / 任务卡实现要求 3）。
 * 领域层不依赖 expo-crypto：SHA-256 经 Sha256Hex 端口由调用方注入
 * （data 层提供 expo-crypto 实现，单测注入确定性 stub）。
 */

/** SHA-256 十六进制摘要端口（输入 UTF-8 字符串，输出小写 hex）。 */
export type Sha256Hex = (input: string) => Promise<string>;

/**
 * 内容哈希输入组合：`${calendarId}|${title}|${startAt}|${endAt}`（任务卡实现要求 3 原文）。
 * title 为 null 时以空串占位、endAt 为 null 时以空串占位——保持分隔符结构确定性，
 * 同一事件多次计算结果恒定。
 */
export function buildContentHashInput(
  event: Pick<SystemCalendarEvent, 'calendarId' | 'title' | 'startDate' | 'endDate'>,
): string {
  return `${event.calendarId}|${event.title ?? ''}|${event.startDate ?? ''}|${event.endDate ?? ''}`;
}

/**
 * 单个系统事件的 sourceUid 解析：
 * - event.id 非空（trim 后）→ 直接使用 event.id（AGENTS.md §7.15「sourceUid 优先使用
 *   expo-calendar 返回的 event.id」）；
 * - 否则 → 内容哈希（SHA-256 前 16 位十六进制），策略标记 content-hash，
 *   结果页据此提示「基于内容去重，系统事件修改后可能产生重复」。
 */
export async function resolveSystemEventSourceUid(
  event: Pick<SystemCalendarEvent, 'externalId' | 'calendarId' | 'title' | 'startDate' | 'endDate'>,
  sha256: Sha256Hex,
): Promise<{ sourceUid: string; strategy: SourceUidStrategy }> {
  const externalId = event.externalId;
  if (typeof externalId === 'string' && externalId.trim().length > 0) {
    return { sourceUid: externalId, strategy: 'event-id' };
  }
  const digest = await sha256(buildContentHashInput(event));
  return { sourceUid: digest.slice(0, 16), strategy: 'content-hash' };
}
