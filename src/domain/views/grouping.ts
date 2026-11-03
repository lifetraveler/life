/**
 * 视图分组纯函数（ui.md「今日/本周视图（v0.7）」的「分组 / 排序 / 状态与交互」节）：
 * - 同一 Item 只进一个分组，优先级：过期 > 已安排 > 今日创建；
 * - 过期：endAt 非 null 且 endAt < now 且 status='active'；
 * - 已安排：overlapsRange 命中（本函数与 Repository 共用同一语义，见 overlaps.ts）；
 * - 今日创建：startAt 为 null 且 createdAt ∈ 今日范围，且仅今日视图（viewKind='today'）；
 * - done 项排同组末尾（展示置灰由 UI 处理）；今日创建分组只收 active；
 * - archived 不进任何分组（查询层已排除，此处防御性再过滤）。
 */

import type { ItemWithTags } from '../tag';
import { overlapsRange } from './overlaps';
import type { ViewTimeRange } from './ranges';

export type ViewKind = 'today' | 'week';

export type ViewGroupId = 'overdue' | 'scheduled' | 'createdToday';

export interface GroupItemsForViewInput {
  /** 三个视图查询（listScheduledItemsInRange / listOverdueItems / listUnscheduledItemsCreatedInRange）结果的合并集 */
  items: ItemWithTags[];
  viewKind: ViewKind;
  nowMs: number;
  rangeStartMs: number;
  rangeEndMs: number;
  /** 今日视图传今日范围；本周视图必须传 null（createdToday 恒为空，见 ui.md「本周视图两个分组」） */
  todayRange: ViewTimeRange | null;
}

export interface GroupedViewItems {
  overdue: ItemWithTags[];
  scheduled: ItemWithTags[];
  createdToday: ItemWithTags[];
}

/** 归类：首中即停，null = 不属于任何分组（如归档项、范围外的未安排项）。 */
function classifyItem(item: ItemWithTags, input: GroupItemsForViewInput): ViewGroupId | null {
  if (item.status === 'archived') {
    return null;
  }
  if (item.status === 'active' && item.endAt !== null && item.endAt < input.nowMs) {
    return 'overdue';
  }
  if (overlapsRange(item, input.rangeStartMs, input.rangeEndMs)) {
    return 'scheduled';
  }
  if (
    input.viewKind === 'today'
    && input.todayRange !== null
    && item.status === 'active'
    && item.startAt === null
    && item.createdAt >= input.todayRange.startMs
    && item.createdAt < input.todayRange.endMs
  ) {
    return 'createdToday';
  }
  return null;
}

/** 已安排组排序：done 末尾；组内 startAt 升序、相同时 createdAt 升序。 */
function compareScheduled(a: ItemWithTags, b: ItemWithTags): number {
  const aDone = a.status === 'done' ? 1 : 0;
  const bDone = b.status === 'done' ? 1 : 0;
  if (aDone !== bDone) {
    return aDone - bDone;
  }
  const aStart = a.startAt ?? 0;
  const bStart = b.startAt ?? 0;
  if (aStart !== bStart) {
    return aStart - bStart;
  }
  return a.createdAt - b.createdAt;
}

/** 过期组排序：endAt 升序；相同时 createdAt 升序（契约未定的并列顺带确定化）。 */
function compareOverdue(a: ItemWithTags, b: ItemWithTags): number {
  if (a.endAt !== null && b.endAt !== null && a.endAt !== b.endAt) {
    return a.endAt - b.endAt;
  }
  return a.createdAt - b.createdAt;
}

/** 今日创建组排序：createdAt 降序；并列时按 id 升序确定化。 */
function compareCreatedToday(a: ItemWithTags, b: ItemWithTags): number {
  if (a.createdAt !== b.createdAt) {
    return b.createdAt - a.createdAt;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function groupItemsForView(input: GroupItemsForViewInput): GroupedViewItems {
  const overdue: ItemWithTags[] = [];
  const scheduled: ItemWithTags[] = [];
  const createdToday: ItemWithTags[] = [];

  // 防御性去重：同一 Item 可能同时出现在过期与已安排两个查询结果里（如昨天开始、
  // 今天上午结束的项），合并集按 id 首见保留；分类本身首中即停，单项仍只进一组。
  const seen = new Set<string>();
  for (const item of input.items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);

    const group = classifyItem(item, input);
    if (group === 'overdue') {
      overdue.push(item);
    } else if (group === 'scheduled') {
      scheduled.push(item);
    } else if (group === 'createdToday') {
      createdToday.push(item);
    }
  }

  overdue.sort(compareOverdue);
  scheduled.sort(compareScheduled);
  createdToday.sort(compareCreatedToday);

  return { overdue, scheduled, createdToday };
}
