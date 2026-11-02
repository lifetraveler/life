import { TZDate, tzOffset } from '@date-fns/tz';

/**
 * 民用时间 ↔ 绝对时刻的纯函数工具（AGENTS.md §4.12–4.13）。
 *
 * 关键约束：
 * - 绝不使用 `new Date(y, m, d, h, min)` 这类依赖系统本地时区的构造方式；
 * - 民用时间解析必须显式接收 IANA tzid；
 * - 春季 gap 返回 null（由调用方跳过），秋季 fold 返回较早瞬间；
 * - 不硬编码任何时区的 DST 起止日期，全部交给运行时 IANA 数据库。
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export type CivilDate = {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
};

export type ZonedParts = CivilDate & {
  hour: number;
  minute: number;
  /** 1=周一 … 7=周日 */
  weekday: number;
};

/**
 * 校验 IANA 时区标识。
 *
 * 用运行时 Intl 校验（与 @date-fns/tz 使用同一份 IANA 数据），并显式拒绝
 * `+08:00` / `-2359` 一类固定偏移：固定偏移不参与 DST 规则，会破坏
 * §4.12 的“民用时间规则”模型。
 */
export function assertValidTimeZone(tzid: string): void {
  if (typeof tzid !== 'string' || tzid.length === 0 || tzid.trim() !== tzid) {
    throw new Error(
      `tzid must be a non-empty IANA time zone identifier, got: ${String(tzid)}`,
    );
  }

  if (/^[+-]/.test(tzid)) {
    throw new Error(
      `tzid must be an IANA time zone identifier, not a fixed UTC offset: ${tzid}`,
    );
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tzid });
  } catch {
    throw new Error(`Invalid IANA time zone: ${tzid}`);
  }
}

/** 取某个绝对时刻在 tzid 下的民用时间字段。 */
export function getZonedParts(instant: number, tzid: string): ZonedParts {
  const zoned = new TZDate(instant, tzid);
  const jsWeekday = zoned.getDay(); // 0=周日 … 6=周六

  return {
    year: zoned.getFullYear(),
    month: zoned.getMonth() + 1,
    day: zoned.getDate(),
    hour: zoned.getHours(),
    minute: zoned.getMinutes(),
    weekday: ((jsWeekday + 6) % 7) + 1,
  };
}

export function formatLocalDate(date: CivilDate): string {
  return `${String(date.year).padStart(4, '0')}-${pad2(date.month)}-${pad2(date.day)}`;
}

export function formatLocalTime(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }

  const days = DAYS_PER_MONTH[month - 1];
  if (days === undefined) {
    throw new Error(`month must be in 1–12, got: ${String(month)}`);
  }
  return days;
}

/** 纯日历加一天；跨月、跨年由 daysInMonth 决定，不经过系统时区。 */
export function addOneDay(date: CivilDate): CivilDate {
  let year = date.year;
  let month = date.month;
  let day = date.day + 1;

  if (day > daysInMonth(year, month)) {
    day = 1;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return { year, month, day };
}

/** 民用日期的星期（1=周一 … 7=周日）；用 UTC 日历计算，不受系统时区影响。 */
export function getCivilWeekday(date: CivilDate): number {
  const utc = new Date(0);
  utc.setUTCFullYear(date.year, date.month - 1, date.day);
  utc.setUTCHours(0, 0, 0, 0);
  return ((utc.getUTCDay() + 6) % 7) + 1;
}

/**
 * 民用时间 → 绝对毫秒时间戳。
 *
 * 返回 null 表示该民用时间在 tzid 下不存在（春季 gap），调用方应跳过该 occurrence。
 * 若同一民用时间出现两次（秋季 fold），返回较早的瞬间。
 *
 * 实现对 UTC 猜测值前后各一天的偏移进行采样，确保 DST 两侧的偏移都被看到，
 * 再反查候选瞬间的本地字段来判定 gap / fold；不依赖库对歧义时间的默认选择。
 */
export function resolveCivilTimeToInstant(
  tzid: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number | null {
  const utcGuess = civilTimeToUtcMilliseconds(year, month, day, hour, minute);
  const offsets = new Set<number>();

  for (const delta of [-MS_PER_DAY, 0, MS_PER_DAY]) {
    offsets.add(tzOffset(tzid, new Date(utcGuess + delta)));
  }

  let earliest: number | null = null;
  for (const offset of offsets) {
    const candidate = utcGuess - offset * MS_PER_MINUTE;
    const parts = getZonedParts(candidate, tzid);

    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute
    ) {
      earliest = earliest === null ? candidate : Math.min(earliest, candidate);
    }
  }

  return earliest;
}

/** 用 UTC 构造器做纯日历基准，避免 Date.UTC 对 0–99 年自动加 1900 的行为。 */
function civilTimeToUtcMilliseconds(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  utc.setUTCHours(hour, minute, 0, 0);
  return utc.getTime();
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
