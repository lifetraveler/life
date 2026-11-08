/**
 * 按民用日分桶（切片 14 阶段 5b，tasks/slice-14.md 阶段 5b-5 月历/周条 chip 用）：
 * - 键为 tzid 下的民用日期 'YYYY-MM-DD'（复用 civilTime 只读导出，DST 行为继承契约）；
 * - 仅收入 startAt !== null 的项（无 startAt 的待办不进日历格子，与 agenda 分组的
 *   「待办」组语义互补）；跨天事件归 startAt 所在民用日（与 groupItemsForAgenda 一致）；
 * - archived 项排除；按 id 去重（首见保留）；
 * - 桶内排序：startAt 升序 → createdAt 升序 → id 确定化。
 *
 * 纯函数：不读设备时区、不依赖 new Date 本地行为，调用方显式传 tzid。
 */

import { formatLocalDate, getZonedParts } from '../recurrence/civilTime';
import type { ItemWithRelations } from '../relations/itemWithRelations';

function compareByStart(a: ItemWithRelations, b: ItemWithRelations): number {
  // 仅对 startAt !== null 的项调用（分桶前已过滤）；?? 0 仅为类型收窄
  const startA = a.startAt ?? 0;
  const startB = b.startAt ?? 0;
  if (startA !== startB) {
    return startA - startB;
  }
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 把（已按范围过滤的）水合条目按 startAt 的民用日分桶。
 * 范围过滤由调用方完成（月历传月范围、周条传 7 天窗）；本函数不再裁剪边界。
 */
export function itemsByDay(
  items: ItemWithRelations[],
  tzid: string,
): Map<string, ItemWithRelations[]> {
  const buckets = new Map<string, ItemWithRelations[]>();
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    if (item.status === 'archived' || item.startAt === null) {
      continue;
    }
    const parts = getZonedParts(item.startAt, tzid);
    const key = formatLocalDate(parts);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(key, [item]);
    }
  }
  for (const bucket of buckets.values()) {
    bucket.sort(compareByStart);
  }
  // 键按民用日期升序（'YYYY-MM-DD' 字典序 = 时间序），与 groupItemsForAgenda 的
  // dayKeys 排序语义一致，消费方可预测遍历。
  return new Map([...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
