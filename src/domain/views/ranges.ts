/**
 * 今日/本周视图的时间范围纯函数（ui.md「今日/本周视图（v0.7）」+ repository.md
 * 「视图查询接口（v0.7）·约束」）：
 * - 今日：tzid 时区当天 00:00 起，至次日 00:00（左闭右开）；
 * - 本周：tzid 时区周一 00:00 起，至下周一 00:00（左闭右开）；
 * - 必须显式传入 IANA tzid，不得读设备默认时区；UI 不得自行用 new Date(y,m,d) 构造边界。
 *
 * 民用时间解析复用 src/domain/recurrence/civilTime.ts 的只读导出（不修改 recurrence/），
 * 因此 DST 行为自动继承契约（recurrence.md）：春季 gap 跳过不平移、秋季 fold 取较早瞬间。
 */

import {
  addOneDay,
  assertValidTimeZone,
  daysInMonth,
  formatLocalDate,
  getZonedParts,
  resolveCivilTimeToInstant,
} from '../recurrence/civilTime';
import type { CivilDate } from '../recurrence/civilTime';

/** 左闭右开毫秒区间：[startMs, endMs) */
export interface ViewTimeRange {
  startMs: number;
  endMs: number;
}

/**
 * 求某民用日期在 tzid 下的「当天起点」。
 *
 * 常规时区 00:00 恒存在；少数时区（如 America/Havana）春令时跳变发生在午夜，
 * 民用 00:00 不存在——此时按 DST gap「跳过不平移」取当天最早存在的整点，
 * 保证范围起点仍是该民用日的合法瞬间。秋季 fold 时 resolveCivilTimeToInstant
 * 已返回较早瞬间。
 *
 * 切片 8 起导出复用：src/data/allDayNormalize.ts 归一化 allDay startAt 用
 * 同一「当天起点」语义，保证视图范围与全天项起点严格一致。
 */
export function resolveDayStart(tzid: string, date: CivilDate): number {
  const atMidnight = resolveCivilTimeToInstant(tzid, date.year, date.month, date.day, 0, 0);
  if (atMidnight !== null) {
    return atMidnight;
  }
  for (let hour = 1; hour <= 23; hour += 1) {
    const candidate = resolveCivilTimeToInstant(tzid, date.year, date.month, date.day, hour, 0);
    if (candidate !== null) {
      return candidate;
    }
  }
  throw new Error(
    `resolveDayStart: no existing civil instant on ${formatLocalDate(date)} in ${tzid}`,
  );
}

/** 纯日历减一天（civilTime.addOneDay 的镜像；跨月、跨年由 daysInMonth 决定）。 */
function subtractOneDay(date: CivilDate): CivilDate {
  if (date.day > 1) {
    return { year: date.year, month: date.month, day: date.day - 1 };
  }
  if (date.month > 1) {
    return { year: date.year, month: date.month - 1, day: daysInMonth(date.year, date.month - 1) };
  }
  return { year: date.year - 1, month: 12, day: 31 };
}

/** 纯日历加 n 天（n 次单日加法，跨月/跨年由 addOneDay 处理）。 */
function addDays(date: CivilDate, n: number): CivilDate {
  let current = date;
  for (let i = 0; i < n; i += 1) {
    current = addOneDay(current);
  }
  return current;
}

/** 纯日历减 n 天。 */
function subtractDays(date: CivilDate, n: number): CivilDate {
  let current = date;
  for (let i = 0; i < n; i += 1) {
    current = subtractOneDay(current);
  }
  return current;
}

/** 今日范围：tzid 时区当天 00:00 至次日 00:00（[startMs, endMs)）。 */
export function getTodayRange(nowMs: number, tzid: string): ViewTimeRange {
  assertValidTimeZone(tzid);
  const parts = getZonedParts(nowMs, tzid);
  const today: CivilDate = { year: parts.year, month: parts.month, day: parts.day };
  return {
    startMs: resolveDayStart(tzid, today),
    endMs: resolveDayStart(tzid, addOneDay(today)),
  };
}

/**
 * 本周范围：tzid 时区本周一 00:00 至下周一 00:00（[startMs, endMs)）。
 * 周一为一周起点（weekday: 1=周一 … 7=周日，见 civilTime.ZonedParts）。
 */
export function getWeekRange(nowMs: number, tzid: string): ViewTimeRange {
  assertValidTimeZone(tzid);
  const parts = getZonedParts(nowMs, tzid);
  const today: CivilDate = { year: parts.year, month: parts.month, day: parts.day };
  const monday = subtractDays(today, parts.weekday - 1);
  return {
    startMs: resolveDayStart(tzid, monday),
    endMs: resolveDayStart(tzid, addDays(monday, 7)),
  };
}

/**
 * 本月范围（切片 14 阶段 4，tasks/slice-14.md「本月视图数据范围必须是本月」）：
 * tzid 时区当月 1 日 00:00 至次月 1 日 00:00（[startMs, endMs)）。
 * 语义与 getTodayRange / getWeekRange 一致：显式 tzid、左闭右开、
 * 月界为纯日历推算（12 月 → 次年 1 月），DST 行为继承 resolveDayStart。
 */
export function getMonthRange(nowMs: number, tzid: string): ViewTimeRange {
  assertValidTimeZone(tzid);
  const parts = getZonedParts(nowMs, tzid);
  const monthStart: CivilDate = { year: parts.year, month: parts.month, day: 1 };
  const nextMonthStart: CivilDate =
    parts.month === 12
      ? { year: parts.year + 1, month: 1, day: 1 }
      : { year: parts.year, month: parts.month + 1, day: 1 };
  return {
    startMs: resolveDayStart(tzid, monthStart),
    endMs: resolveDayStart(tzid, nextMonthStart),
  };
}
