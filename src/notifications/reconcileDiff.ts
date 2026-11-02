/**
 * 对账 diff 与错过判定的纯函数（tasks/slice-05.md 实现要求 3）。
 *
 * - 本模块为纯 TypeScript：不得 import WatermelonDB / expo-notifications / React。
 * - identifier 与 occurrenceKey 是同一个字符串（AGENTS.md §4.20），
 *   对账只比对 occurrenceKey 集合，不比对通知触发时间字段（§4.19）。
 */

import type { Occurrence } from '../domain/recurrence';

/**
 * 本 App 调度通知的 identifier 根前缀（AGENTS.md §4.16 冻结）。
 * 所有 notification identifier（= occurrenceKey）以 `recurrence:v1|` 开头；
 * cancelAll 只取消带该前缀的通知，不误伤其他来源。
 */
export const IDENTIFIER_ROOT_PREFIX = 'recurrence:v1|';

/** 单个 reminder 名下通知的 identifier 前缀（scheduleId 已 encodeURIComponent）。 */
export function reminderIdentifierPrefix(reminderId: string): string {
  return `recurrence:v1|${encodeURIComponent(reminderId)}|`;
}

export type NotificationDiff = {
  /** 期望存在但现网没有 → 需要调度。 */
  toSchedule: string[];
  /** 现网存在但不在期望内 → 需要取消。 */
  toCancel: string[];
};

/**
 * 以 occurrenceKey 集合做对账 diff（AGENTS.md §4.19：集合 diff，不比对触发时间字段）。
 * 返回顺序：toSchedule 按期望集合迭代序，toCancel 按现网集合迭代序。
 */
export function diffNotifications(
  expectedKeys: Set<string>,
  actualKeys: Set<string>,
): NotificationDiff {
  const toSchedule: string[] = [];
  for (const key of expectedKeys) {
    if (!actualKeys.has(key)) {
      toSchedule.push(key);
    }
  }

  const toCancel: string[] = [];
  for (const key of actualKeys) {
    if (!expectedKeys.has(key)) {
      toCancel.push(key);
    }
  }

  return { toSchedule, toCancel };
}

/**
 * 错过判定（AGENTS.md §4.19）：occurrences 按 instant 升序，
 * 取 lastFiredKey 之后且 instant <= now 的项。
 *
 * - lastFiredKey 为 null → 窗口内全部已过期 occurrence 都计入（首次对账）；
 * - lastFiredKey 在列表中 → 严格取其后（按 instant 升序位置）的项；
 * - lastFiredKey 不在列表中（如规则 startAt 被编辑后游标指向旧展开窗口）→
 *   视为游标早于当前窗口，全部已过期项计入；
 * - instant 严格大于 now 的未来 occurrence 不计入。
 *
 * 返回数组按 instant 升序；最后一个元素即 markReminderFired 的新游标。
 */
export function computeMissed(
  occurrences: Occurrence[],
  lastFiredKey: string | null,
  now: number,
): Occurrence[] {
  const sorted = [...occurrences].sort((a, b) => a.instant - b.instant);
  const startIndex =
    lastFiredKey === null ? 0 : sorted.findIndex((o) => o.occurrenceKey === lastFiredKey) + 1;
  return sorted.slice(startIndex).filter((o) => o.instant <= now);
}
