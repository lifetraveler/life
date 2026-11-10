/**
 * 切片 15 阶段 1：手写运行时类型守卫。
 *
 * §7.24 结构约束：AI 返回的 JSON 必须经过严格校验，通过后才允许转成内部模型，
 * 严禁直接 `as` 强转。本守卫刻意从紧：
 * - 字符串数字（"15"、"2.5"）、缺字段、多余无关字段不拦（多余字段忽略）；
 *   但 startAt/endAt 必须是有限数或 null，priority 必须是 0..3 整数或 null；
 * - tags 数组元素必须是 string；
 * - recurrence 必须完整匹配 daily/weekly/monthly 三种形状之一（weekdays 1..7、
 *   dayOfMonth 1..31、localTime.hour 0..23、localTime.minute 0..59，均为整数）；
 *   残缺/未知形状整体判校验失败（schema-mismatch），不做静默降级——把真实重复
 *   意图悄悄改成单次比报错更危险，与“残缺 JSON 直接拦截、不补救”同一原则。
 */

import type { LocalTime, RecurrenceRule } from '../recurrence/types';
import type {
  ChatMessage,
  ParsedItemDraft,
  ParsedItemType,
} from './types';

const PARSED_ITEM_TYPES: readonly ParsedItemType[] = ['note', 'task', 'event'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isLocalTime(value: unknown): value is LocalTime {
  return (
    isRecord(value) &&
    isIntegerIn(value.hour, 0, 23) &&
    isIntegerIn(value.minute, 0, 59) &&
    Object.keys(value).every(
      (k) => k === 'hour' || k === 'minute' || typeof value[k] === 'undefined',
    )
  );
}

/** 形状完整的 RecurrenceRule 才返回；残缺/未知形状返回 null（调用方必须整体拒绝该候选）。 */
function isRecurrenceRule(value: unknown): RecurrenceRule | null {
  if (!isRecord(value)) return null;
  const freq = value.frequency;
  const localTime = value.localTime;
  if (freq === 'daily') {
    return isLocalTime(localTime) ? { frequency: 'daily', localTime } : null;
  }
  if (freq === 'weekly') {
    const weekdays = value.weekdays;
    if (
      Array.isArray(weekdays) &&
      weekdays.length > 0 &&
      weekdays.every((d) => isIntegerIn(d, 1, 7)) &&
      isLocalTime(localTime)
    ) {
      return { frequency: 'weekly', weekdays: [...weekdays], localTime };
    }
    return null;
  }
  if (freq === 'monthly') {
    return isIntegerIn(value.dayOfMonth, 1, 31) && isLocalTime(localTime)
      ? { frequency: 'monthly', dayOfMonth: value.dayOfMonth, localTime }
      : null;
  }
  return null;
}

function isTagArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((t) => typeof t === 'string');
}

/**
 * 严格校验 AI 返回的候选对象。返回 null 表示校验失败（调用方抛 schema-mismatch）。
 */
export function isParsedItemDraft(value: unknown): ParsedItemDraft | null {
  if (!isRecord(value)) return null;

  const title = value.title;
  const content = value.content;
  const type = value.type;
  if (typeof title !== 'string' || title.length === 0) return null;
  if (typeof content !== 'string') return null;
  if (typeof type !== 'string' || !PARSED_ITEM_TYPES.includes(type as ParsedItemType)) {
    return null;
  }

  const startAt = value.startAt;
  if (startAt !== null && !isFiniteNumber(startAt)) return null;
  const endAt = value.endAt;
  if (endAt !== null && !isFiniteNumber(endAt)) return null;

  if (typeof value.allDay !== 'boolean') return null;

  const categoryId = value.categoryId;
  if (categoryId !== null && typeof categoryId !== 'string') return null;

  const tags = value.tags;
  if (!isTagArray(tags)) return null;

  const priority = value.priority;
  if (priority !== null && !isIntegerIn(priority, 0, 3)) return null;

  const recurrenceRaw = value.recurrence;
  if (recurrenceRaw !== null && isRecurrenceRule(recurrenceRaw) === null) return null;

  const reminderOffsetMinutes = value.reminderOffsetMinutes;
  if (
    reminderOffsetMinutes !== null &&
    (!isIntegerIn(reminderOffsetMinutes, 1, Number.MAX_SAFE_INTEGER))
  ) {
    return null;
  }

  return {
    title,
    content,
    type: type as ParsedItemType,
    startAt,
    endAt,
    allDay: value.allDay,
    categoryId,
    tags: [...tags],
    priority,
    recurrence: recurrenceRaw === null ? null : (recurrenceRaw as RecurrenceRule),
    reminderOffsetMinutes,
  };
}

/** 校验 ChatMessage 数组（构造 AiParseContext 时使用）。 */
export function isChatMessageList(value: unknown): value is ChatMessage[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (m) =>
      isRecord(m) &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.text === 'string',
  );
}
