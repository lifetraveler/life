/**
 * Reminder ↔ RecurrenceRule 互转与 reminders 表标量字段归一化
 * （AGENTS.md §4.17：互转职责收敛在 data 层；纯函数，可单测）。
 *
 * - weekdays 在存储层是 JSON 数组字符串（§4.17 冻结决定，不得改为逗号分隔等格式）：
 *   serializeWeekdays / parseWeekdaysJson 是唯一出入；解析失败必须抛明确错误。
 * - once_civil_json 在存储层是单列 JSON（切片 16，schema v8，提案 §2.1，键序固定
 *   {year,month,day,hour,minute}）：serializeOnceCivilJson / parseOnceCivilJson 是唯一出入；
 *   解析失败必须抛明确错误（与 weekdays 同纪律）。
 * - 本模块为纯 TypeScript：不得 import WatermelonDB / expo-notifications / React。
 */

import type { LocalTime, RecurrenceRule } from '../domain/recurrence';
import {
  DEFAULT_REMINDER_CHANNEL,
  REMINDER_CHANNELS,
  isReminderChannel,
} from '../domain/reminder';
import type { OnceCivilTime, ReminderChannel, ReminderFrequency } from '../domain/reminder';

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
 * once_civil_json 校验（切片 16，schema v8）：严格 5 个整数键 + 范围校验。
 * 范围与 OnceCivilTime 注释一致：year 1–9999、month 1–12、day 1–31、hour 0–23、minute 0–59；
 * day 的月内日历有效性（如 2 月 30 日）由阶段 2 调度侧 civil→epoch 换算判定，本层不做。
 * 读路径（parseOnceCivilJson）与写路径（resolveOnceAt）共用，解析/写入均不得静默放行坏数据。
 */
function assertOnceCivilTime(value: unknown, source: string): OnceCivilTime {
  const error = (reason: string): Error =>
    new Error(
      `${source} must be a JSON object with integer fields ` +
        `{year 1–9999, month 1–12, day 1–31, hour 0–23, minute 0–59}, ${reason}`,
    );

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw error(`got non-object: ${String(value)}`);
  }

  const entries = new Map<string, unknown>(Object.entries(value));
  const expectedKeys = ['year', 'month', 'day', 'hour', 'minute'];
  const actualKeys = [...entries.keys()].sort();
  if (
    entries.size !== expectedKeys.length ||
    expectedKeys.some((key) => !entries.has(key))
  ) {
    throw error(`got keys: [${actualKeys.join(', ')}]`);
  }

  const assertField = (key: string, min: number, max: number): number => {
    const raw = entries.get(key);
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
      throw error(`got ${key}: ${String(raw)}`);
    }
    return raw;
  };

  return {
    year: assertField('year', 1, 9999),
    month: assertField('month', 1, 12),
    day: assertField('day', 1, 31),
    hour: assertField('hour', 0, 23),
    minute: assertField('minute', 0, 59),
  };
}

/**
 * onceAt → once_civil_json 存储字符串（切片 16，提案 §2.1）：JSON.stringify 固定键序
 * {year,month,day,hour,minute}。调用方须先经 resolveOnceAt / assertOnceCivilTime 校验，
 * 本函数不做二次校验（仅映射）。
 */
export function serializeOnceCivilJson(onceAt: OnceCivilTime): string {
  return JSON.stringify({
    year: onceAt.year,
    month: onceAt.month,
    day: onceAt.day,
    hour: onceAt.hour,
    minute: onceAt.minute,
  });
}

/**
 * once_civil_json 存储字符串 → onceAt（切片 16）：坏 JSON / 坏形状 / 越界抛明确错误，
 * 不得静默（对齐 parseWeekdaysJson 纪律；调用方 toDomainReminder 解析失败即抛）。
 */
export function parseOnceCivilJson(raw: string): OnceCivilTime {
  const source = `reminders.once_civil_json (raw: ${truncateForMessage(raw)})`;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${source}: got invalid JSON`);
  }

  return assertOnceCivilTime(parsed, source);
}

/**
 * onceAt 写路径归一（切片 16）：frequency='once' 时 onceAt 必填且经完整校验
 * （CreateReminderInput.onceAt 为可选字段，编译期无法约束 once 必填，此处运行时强制）；
 * 其他 frequency 恒返回 null（传入值被丢弃）。
 */
export function resolveOnceAt(
  frequency: ReminderFrequency,
  onceAt: OnceCivilTime | null | undefined,
): OnceCivilTime | null {
  if (frequency !== 'once') {
    return null;
  }
  if (onceAt === null || onceAt === undefined) {
    throw new Error(
      "frequency 'once' requires onceAt (civil {year,month,day,hour,minute}), got none",
    );
  }
  return assertOnceCivilTime(onceAt, "frequency 'once' onceAt");
}

/**
 * 渠道字段归一化（切片 16，提案 §2.1）：channel 缺省 'system-notification'，枚举外抛错；
 * channelConfig——system-notification / alarm 渠道无关强制 null，webhook / apprise 接受
 * null/undefined 或非空白字符串（trim 后落库），纯空白抛错。供 createReminder /
 * updateReminder 写路径共用。
 */
export function normalizeReminderChannelFields(input: {
  channel?: ReminderChannel;
  channelConfig?: string | null;
}): { channel: ReminderChannel; channelConfig: string | null } {
  const channel = input.channel ?? DEFAULT_REMINDER_CHANNEL;
  if (!isReminderChannel(channel)) {
    throw new Error(
      `reminder channel must be one of ${REMINDER_CHANNELS.join(', ')}, got: ${String(channel)}`,
    );
  }

  const configFree = channel === 'system-notification' || channel === 'alarm';
  if (configFree) {
    return { channel, channelConfig: null };
  }

  const raw = input.channelConfig;
  if (raw === undefined || raw === null) {
    return { channel, channelConfig: null };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new Error(
      `reminder channelConfig for "${channel}" must be a non-empty string, got whitespace-only`,
    );
  }
  return { channel, channelConfig: trimmed };
}

/**
 * 规则字段归一化：按 frequency 校验并收敛非本 frequency 的字段
 * （daily/monthly → weekdays=[]、dayOfMonth=0；weekly → dayOfMonth=0 且 weekdays 必填；
 * once（切片 16）→ localTime/weekdays/dayOfMonth 全部落零值——列 NOT NULL 无语义，
 * 一次性触发时刻唯一来源是 onceAt）。非法取值抛明确错误，供 createReminder / updateReminder
 * 写路径共用。
 */
export function normalizeReminderRuleFields(input: {
  frequency: ReminderFrequency;
  localTimeHour: number;
  localTimeMinute: number;
  weekdays?: number[];
  dayOfMonth?: number;
}): ReminderRuleFields {
  // 切片 16：once 忽略并跳过 localTime 校验（列 NOT NULL 落零值；调用方无需凑合法占位值）。
  if (input.frequency === 'once') {
    return {
      frequency: 'once',
      localTimeHour: 0,
      localTimeMinute: 0,
      weekdays: [],
      dayOfMonth: 0,
    };
  }

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
    case 'once':
      // RecurrenceRule 为冻结三值枚举（§4.11），不含 once；一次性提醒不参与重复展开，
      // 调度器必须在展开前按 frequency 分支（切片 16 提案 §2.3）。
      throw new Error(
        'toRecurrenceRule: once reminders have no RecurrenceRule; ' +
          'the scheduler must branch on frequency before recurrence expansion (slice-16 proposal §2.3)',
      );
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
