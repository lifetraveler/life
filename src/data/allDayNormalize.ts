/**
 * 切片 8（data-model.md v0.8 / AGENTS.md §4.23）：allDay 时刻归一化纯函数。
 *
 * 修复切片 7 遗留 #8：allDay=true 时 startAt 未必落在设备时区当天 00:00
 * （切片 7 编辑页的日期选择器直接产出当日 00:00，但导入等路径做不到）。
 *
 * 规则（handoff §2.2，用户确认）：allDay=true 且 startAt 非 null 时，取
 * startAt 在 tzid 下的民用日期，把 startAt 重写为「该民用日期在 tzid 的
 * 当天 00:00」绝对毫秒；null 不动；endAt 契约未约束、不改；非 allDay 不动。
 *
 * 「当天 00:00」复用 src/domain/views/ranges.ts 的 resolveDayStart（DST
 * gap 跳过不平移、取当天最早存在整点；fold 取较早瞬间），保证全天项起点
 * 与视图范围起点语义严格一致。tzid 显式传入（默认调用方传设备时区），
 * 本模块不读设备状态，便于单测。
 */

import { assertValidTimeZone, getZonedParts } from '../domain/recurrence/civilTime';
import { resolveDayStart } from '../domain/views/ranges';

export interface NormalizedItemTimestamps {
  startAt: number | null;
  endAt: number | null;
}

export function normalizeAllDayTimestamps(
  startAt: number | null,
  endAt: number | null,
  allDay: boolean,
  tzid: string,
): NormalizedItemTimestamps {
  if (!allDay || startAt === null) {
    return { startAt, endAt };
  }
  assertValidTimeZone(tzid);
  const parts = getZonedParts(startAt, tzid);
  const dayStart = resolveDayStart(tzid, { year: parts.year, month: parts.month, day: parts.day });
  return { startAt: dayStart, endAt };
}
