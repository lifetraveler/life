import {
  addOneDay,
  assertValidTimeZone,
  daysInMonth,
  formatLocalDate,
  formatLocalTime,
  getCivilWeekday,
  getZonedParts,
  resolveCivilTimeToInstant,
  type CivilDate,
} from './civilTime';
import { buildOccurrenceKey } from './occurrenceKey';
import type {
  ExpandOccurrencesInput,
  LocalTime,
  Occurrence,
  RecurrenceRule,
} from './types';

const DEFAULT_COUNT = 30;
const MAX_COUNT = 30;

/**
 * 安全上限：30 个 monthly occurrence 最坏约跨 2.6 年，5 年足够覆盖；
 * 仅用于防止逻辑 bug 导致无限循环，正常输入不会触发。
 */
const MAX_SEARCH_DAYS = 366 * 5;

/**
 * 按民用时间规则展开未来 N 个 occurrence（AGENTS.md §4.12–4.14）。
 *
 * - 从 startAt 在 tzid 下的本地日期开始逐日查找；
 * - 只保留 instant >= startAt 的 occurrence；
 * - 春季 gap 的候选被跳过且不占用 count；
 * - count 默认 30，超过 30 截断到 30；返回按时间升序。
 */
export function expandOccurrences(input: ExpandOccurrencesInput): Occurrence[] {
  const { scheduleId, rule, startAt, tzid } = input;
  const count = normalizeCount(input.count);

  assertValidRule(rule);
  if (!Number.isFinite(startAt)) {
    throw new Error(
      `startAt must be a finite millisecond timestamp, got: ${String(startAt)}`,
    );
  }
  assertValidTimeZone(tzid);

  if (count === 0 || (rule.frequency === 'weekly' && rule.weekdays.length === 0)) {
    return [];
  }

  const startParts = getZonedParts(startAt, tzid);
  let cursor: CivilDate = {
    year: startParts.year,
    month: startParts.month,
    day: startParts.day,
  };

  const occurrences: Occurrence[] = [];

  for (let dayOffset = 0; dayOffset < MAX_SEARCH_DAYS; dayOffset += 1) {
    if (matchesRule(rule, cursor)) {
      const instant = resolveCivilTimeToInstant(
        tzid,
        cursor.year,
        cursor.month,
        cursor.day,
        rule.localTime.hour,
        rule.localTime.minute,
      );

      if (instant !== null && instant >= startAt) {
        const localDate = formatLocalDate(cursor);
        const localTime = formatLocalTime(rule.localTime.hour, rule.localTime.minute);

        occurrences.push({
          occurrenceKey: buildOccurrenceKey({ scheduleId, localDate, localTime, tzid }),
          localDate,
          localTime,
          tzid,
          instant,
        });

        if (occurrences.length === count) {
          break;
        }
      }
    }

    cursor = addOneDay(cursor);
  }

  if (occurrences.length < count) {
    throw new Error(
      `Could not expand ${count} occurrences within ${MAX_SEARCH_DAYS} days ` +
        `(got ${occurrences.length})`,
    );
  }

  return occurrences;
}

function matchesRule(rule: RecurrenceRule, date: CivilDate): boolean {
  switch (rule.frequency) {
    case 'daily':
      return true;
    case 'weekly':
      return rule.weekdays.includes(getCivilWeekday(date));
    case 'monthly': {
      const effectiveDay = Math.min(rule.dayOfMonth, daysInMonth(date.year, date.month));
      return date.day === effectiveDay;
    }
  }
}

function normalizeCount(count: number | undefined): number {
  if (count === undefined) {
    return DEFAULT_COUNT;
  }

  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`count must be a non-negative integer, got: ${String(count)}`);
  }

  // 任务卡允许“拒绝或截断到 30”，这里选择截断：count > 30 不抛错。
  return Math.min(count, MAX_COUNT);
}

function assertValidRule(rule: RecurrenceRule): void {
  assertValidLocalTime(rule.localTime);

  switch (rule.frequency) {
    case 'daily':
      return;
    case 'weekly':
      if (!Array.isArray(rule.weekdays)) {
        throw new Error('weekly rule requires a weekdays array');
      }
      for (const weekday of rule.weekdays) {
        if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
          throw new Error(
            `weekdays must contain integers in 1–7, got: ${String(weekday)}`,
          );
        }
      }
      return;
    case 'monthly':
      if (
        !Number.isInteger(rule.dayOfMonth) ||
        rule.dayOfMonth < 1 ||
        rule.dayOfMonth > 31
      ) {
        throw new Error(
          `dayOfMonth must be an integer in 1–31, got: ${String(rule.dayOfMonth)}`,
        );
      }
      return;
    default:
      throw new Error('Unsupported recurrence frequency');
  }
}

function assertValidLocalTime(localTime: LocalTime): void {
  if (
    !localTime ||
    !Number.isInteger(localTime.hour) ||
    localTime.hour < 0 ||
    localTime.hour > 23
  ) {
    throw new Error(
      `localTime.hour must be an integer in 0–23, got: ${String(localTime?.hour)}`,
    );
  }

  if (!Number.isInteger(localTime.minute) || localTime.minute < 0 || localTime.minute > 59) {
    throw new Error(
      `localTime.minute must be an integer in 0–59, got: ${String(localTime.minute)}`,
    );
  }
}
