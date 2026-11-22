/**
 * 切片 36（§7.48 / 提案 D2）：查询窗口轻守卫 + 民用窗口解析。
 *
 * 独立函数——不触碰 RemoteDraftWire / isRemoteDraftWire / ai.md 契约
 * （查询轮不走 parse/wire）。第一段模型输出轻 JSON，本文件做两件事：
 * 1. isQueryWindowWire：形状守卫（键与类型从严，日期语义后置）；
 * 2. resolveQueryWindow：民用日期 → 本地时区 epoch 窗口；end < start /
 *    非法日期 / 解析失败 → 回退默认「今天起 7 天」并标记 usedFallback
 *    （由 scheduleQuery 在回答后确定性追加披露，不依赖模型复述）。
 */

import {
  addOneDay,
  daysInMonth,
  formatLocalDate,
  getZonedParts,
  resolveCivilTimeToInstant,
} from '../recurrence/civilTime';
import type { CivilDate } from '../recurrence/civilTime';

/** 第一段轻 JSON 的域形状（键可缺省宽容、值出现即从严——reminders 先例纪律）。 */
export interface QueryWindowWire {
  start: { date: string };
  end: { date: string };
}

const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** 默认窗口天数（今天起 7 天，含今天）。 */
const DEFAULT_WINDOW_DAYS = 7;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 解析民用日期字符串（YYYY-MM-DD）为 CivilDate，含日历有效性校验
 * （月份 1–12、日不超过当月天数；闰年由 daysInMonth 覆盖）。
 * 非法返回 null（resolveQueryWindow 层回退默认窗口）。
 */
export function parseCivilDateString(value: unknown): CivilDate | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = CIVIL_DATE_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    return null;
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

/**
 * 第一段输出形状守卫：start/end 均为 {date: string} 且日期串形合法
 * （日历语义校验在 resolveQueryWindow）。任何键缺失/类型不符 → null
 * （调用方回退默认窗口）。
 */
export function isQueryWindowWire(value: unknown): QueryWindowWire | null {
  if (!isRecord(value)) {
    return null;
  }
  const start = value.start;
  const end = value.end;
  if (!isRecord(start) || !isRecord(end)) {
    return null;
  }
  if (typeof start.date !== 'string' || typeof end.date !== 'string') {
    return null;
  }
  if (parseCivilDateString(start.date) === null || parseCivilDateString(end.date) === null) {
    return null;
  }
  return { start: { date: start.date }, end: { date: end.date } };
}

/** 解析后的查询窗口（本地时区 epoch ms，闭区间两端）。 */
export interface ResolvedQueryWindow {
  /** 窗口起点（start 当日 00:00:00.000 本地时区）。 */
  startMs: number;
  /** 窗口终点（end 当日 23:59:59.999 本地时区）。 */
  endMs: number;
  /** 窗口展示文本（如「2026-11-23 至 2026-11-29」）。 */
  windowText: string;
  /** true = 模型窗口不可用（守卫失败/end<start），已回退默认今天起 7 天。 */
  usedFallback: boolean;
}

function civilDateOrdinal(date: CivilDate): number {
  return date.year * 10000 + date.month * 100 + date.day;
}

/**
 * 民用日起点 epoch：DST 午夜 gap 时逐小时顺延（最多 4 小时，覆盖全部
 * 真实时区 gap 宽度）；理论不可达路径兜底 UTC 猜测值。
 */
function civilDayStartMs(date: CivilDate, tzid: string): number {
  for (const hour of [0, 1, 2, 3]) {
    const instant = resolveCivilTimeToInstant(tzid, date.year, date.month, date.day, hour, 0);
    if (instant !== null) {
      return instant;
    }
  }
  return Date.UTC(date.year, date.month - 1, date.day);
}

/** 民用日终点 epoch：次日日起点 - 1ms（fold 取较早瞬间，语义正确）。 */
function civilDayEndMs(date: CivilDate, tzid: string): number {
  return civilDayStartMs(addOneDay(date), tzid) - 1;
}

/**
 * 民用窗口 → 本地时区 epoch 窗口。
 * wire=null / start 或 end 非法日历日 / end < start → 回退默认
 * 「今天起 7 天」（usedFallback=true，由调用方追加披露）。
 */
export function resolveQueryWindow(
  wire: QueryWindowWire | null,
  now: number,
  tzid: string,
): ResolvedQueryWindow {
  let startCivil: CivilDate | null = null;
  let endCivil: CivilDate | null = null;
  if (wire !== null) {
    startCivil = parseCivilDateString(wire.start.date);
    endCivil = parseCivilDateString(wire.end.date);
    if (
      startCivil !== null &&
      endCivil !== null &&
      civilDateOrdinal(endCivil) < civilDateOrdinal(startCivil)
    ) {
      startCivil = null;
      endCivil = null;
    }
  }

  let usedFallback = startCivil === null || endCivil === null;
  if (startCivil === null || endCivil === null) {
    const today = getZonedParts(now, tzid);
    const start: CivilDate = { year: today.year, month: today.month, day: today.day };
    let end: CivilDate = start;
    for (let i = 1; i < DEFAULT_WINDOW_DAYS; i += 1) {
      end = addOneDay(end);
    }
    startCivil = start;
    endCivil = end;
    usedFallback = true;
  }

  const start = startCivil;
  const end = endCivil;
  return {
    startMs: civilDayStartMs(start, tzid),
    endMs: civilDayEndMs(end, tzid),
    windowText: `${formatLocalDate(start)} 至 ${formatLocalDate(end)}`,
    usedFallback,
  };
}
