/**
 * Reminder ↔ RecurrenceRule 互转与 reminders 表标量字段归一化
 * （AGENTS.md §4.17：互转职责收敛在 data 层；纯函数，可单测）。
 *
 * - weekdays 在存储层是 JSON 数组字符串（§4.17 冻结决定，不得改为逗号分隔等格式）：
 *   serializeWeekdays / parseWeekdaysJson 是唯一出入；解析失败必须抛明确错误。
 * - 本模块为纯 TypeScript：不得 import WatermelonDB / expo-notifications / React。
 */

import type { LocalTime, RecurrenceRule } from '../domain/recurrence';
import type { ReminderFrequency } from '../domain/reminder';

/** Reminder 中直接映射为 RecurrenceRule 的字段子集（不依赖数据库模型）。 */
export type ReminderRuleFields = {
  frequency: ReminderFrequency;
  /** 0–23 */
  localTimeHour: number;
  /** 0–59 */
  localTimeMinute: number;
  /** 仅 weekly 非空（1–7，升序去重）；其他 frequency 恒为 [] */
  weekdays: number[];
  /** 仅 monthly 为 1–31；其他 frequency 恒为 0 */
  dayOfMonth: number;
};

function assertIntInRange(value: number, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer in ${min}–${max}, got: ${String(value)}`);
  }
  return value;
}

function truncateForMessage(raw: string): string {
  return raw.length <= 50 ? raw : `${raw.slice(0, 50)}…`;
}

/** weekdays → 存储字符串：空数组存空字符串（§4.17：非 weekly 恒为空字符串）。 */
export function serializeWeekdays(weekdays: number[]): string {
  return weekdays.length === 0 ? '' : JSON.stringify(weekdays);
}

/** 存储字符串 → weekdays：空字符串 → []；非法 JSON / 非法元素抛明确错误，不得静默。 */
export function parseWeekdaysJson(raw: string): number[] {
  if (raw === '') {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `reminders.weekdays must be a JSON array of integers 1–7, got invalid JSON: ${truncateForMessage(raw)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `reminders.weekdays must be a JSON array of integers 1–7, got: ${truncateForMessage(raw)}`,
    );
  }

  const weekdays: number[] = [];
  for (const value of parsed as unknown[]) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 7) {
      throw new Error(
        `reminders.weekdays elements must be integers 1–7, got: ${String(value)}`,
      );
    }
    weekdays.push(value);
  }
  return weekdays;
}

/**
 * 规则字段归一化：按 frequency 校验并收敛非本 frequency 的字段
 * （daily/monthly → weekdays=[]、dayOfMonth=0；weekly → dayOfMonth=0 且 weekdays 必填）。
 * 非法取值抛明确错误，供 createReminder / updateReminder 写路径共用。
 */
export function normalizeReminderRuleFields(input: {
  frequency: ReminderFrequency;
  localTimeHour: number;
  localTimeMinute: number;
  weekdays?: number[];
  dayOfMonth?: number;
}): ReminderRuleFields {
  const hour = assertIntInRange(input.localTimeHour, 'localTimeHour', 0, 23);
  const minute = assertIntInRange(input.localTimeMinute, 'localTimeMinute', 0, 59);

  switch (input.frequency) {
    case 'daily':
      return {
        frequency: 'daily',
        localTimeHour: hour,
        localTimeMinute: minute,
        weekdays: [],
        dayOfMonth: 0,
      };
    case 'weekly': {
      const weekdays = input.weekdays ?? [];
      if (weekdays.length === 0) {
        throw new Error('weekly reminder requires at least one weekday in 1–7');
      }
      for (const weekday of weekdays) {
        assertIntInRange(weekday, 'weekdays element', 1, 7);
      }
      const deduped = [...new Set(weekdays)].sort((a, b) => a - b);
      return {
        frequency: 'weekly',
        localTimeHour: hour,
        localTimeMinute: minute,
        weekdays: deduped,
        dayOfMonth: 0,
      };
    }
    case 'monthly': {
      // dayOfMonth 仅 monthly 使用；缺省按 0 处理并在断言中报错（必须显式指定 1–31）。
      const dayOfMonth = assertIntInRange(input.dayOfMonth ?? 0, 'dayOfMonth', 1, 31);
      return {
        frequency: 'monthly',
        localTimeHour: hour,
        localTimeMinute: minute,
        weekdays: [],
        dayOfMonth,
      };
    }
  }
}

/** startAt 校验：必须是有限的毫秒时间戳。 */
export function normalizeStartAt(startAt: number): number {
  if (typeof startAt !== 'number' || !Number.isFinite(startAt)) {
    throw new Error(`startAt must be a finite millisecond timestamp, got: ${String(startAt)}`);
  }
  return startAt;
}

/** Reminder 规则字段 → RecurrenceRule（§4.17 一一映射）。 */
export function toRecurrenceRule(reminder: ReminderRuleFields): RecurrenceRule {
  const localTime: LocalTime = {
    hour: reminder.localTimeHour,
    minute: reminder.localTimeMinute,
  };
  switch (reminder.frequency) {
    case 'daily':
      return { frequency: 'daily', localTime };
    case 'weekly':
      return { frequency: 'weekly', weekdays: [...reminder.weekdays], localTime };
    case 'monthly':
      return { frequency: 'monthly', dayOfMonth: reminder.dayOfMonth, localTime };
  }
}

/** RecurrenceRule → Reminder 规则字段（§4.17 一一映射，非本 frequency 字段归零）。 */
export function fromRecurrenceRule(rule: RecurrenceRule): ReminderRuleFields {
  switch (rule.frequency) {
    case 'daily':
      return {
        frequency: 'daily',
        localTimeHour: rule.localTime.hour,
        localTimeMinute: rule.localTime.minute,
        weekdays: [],
        dayOfMonth: 0,
      };
    case 'weekly':
      return {
        frequency: 'weekly',
        localTimeHour: rule.localTime.hour,
        localTimeMinute: rule.localTime.minute,
        weekdays: [...rule.weekdays],
        dayOfMonth: 0,
      };
    case 'monthly':
      return {
        frequency: 'monthly',
        localTimeHour: rule.localTime.hour,
        localTimeMinute: rule.localTime.minute,
        weekdays: [],
        dayOfMonth: rule.dayOfMonth,
      };
  }
}
