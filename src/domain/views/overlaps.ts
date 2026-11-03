import type { Item } from '../item';

/**
 * 已安排命中判定（repository.md「视图查询接口（v0.7）」的跨天判定纯函数）：
 * - startAt 非 null 且 startAt ∈ [rangeStartMs, rangeEndMs)；或
 * - 跨天：startAt < rangeStartMs 且 endAt 非 null 且 endAt > rangeStartMs。
 *
 * startAt 为 null 恒 false（未安排不进时间范围）。
 * 边界约定：[rangeStartMs, rangeEndMs) 左闭右开；endAt === rangeStartMs 视为
 * 在范围开始前已结束（不含）。零时长 Item（startAt === endAt === rangeStartMs）
 * 按「startAt ∈ 范围」命中——以 repository.md 冻结条件为准。
 *
 * Repository 的 SQL 条件与视图分组共用本语义，不得各写一份：
 * WatermelonItemRepository 的查询子句逐条镜像本函数，并由
 * src/data/__tests__/viewQueries.test.ts 以真实查询结果交叉验证。
 */
export function overlapsRange(
  item: Pick<Item, 'startAt' | 'endAt'>,
  rangeStartMs: number,
  rangeEndMs: number,
): boolean {
  if (item.startAt === null) {
    return false;
  }
  if (item.startAt >= rangeStartMs && item.startAt < rangeEndMs) {
    return true;
  }
  return item.startAt < rangeStartMs && item.endAt !== null && item.endAt > rangeStartMs;
}
