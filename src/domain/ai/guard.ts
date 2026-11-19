/**
 * 切片 15 阶段 1：手写运行时类型守卫。
 *
 * §7.24 结构约束：AI 返回的 JSON 必须经过严格校验，通过后才允许转成内部模型，
 * 严禁直接 `as` 强转。本守卫刻意从紧：
 * - 字符串数字（"15"、"2.5"）、缺字段、多余无关字段不拦（多余字段忽略）；
 *   但 startAt/endAt 必须是有限数或 null，priority 必须是 0..3 整数或 null；
 *   reminderOffsetMinutes / reminderDelayMinutes（切片 19，§7.30）必须是 ≥1 整数
 *   或 null——键缺失（undefined）与非法值同样整体拒绝（draft 形状纪律）。
 * - 切片 23（§7.35 / ai.md v0.19）：needsClarification 出现时必须是 boolean、
 *   clarificationPrompt 出现时必须是 string、reminderChannels 出现时必须是
 *   非空且元素合法（REMINDER_CHANNELS）并满足 expo 家族互斥（system-notification
 *   与 alarm 不同现）的数组——三者与 offset/delay 的“键必填”纪律刻意不同：它们是
 *   建议性/澄清性信息而非结构性字段，键缺省（旧版响应）合法、值出现即从严，
 *   避免把整个解析炸成降级（ai.md v0.19 变更记录）。
 * - 切片 32（§7.44 / ai.md v0.23）：reminders（绝对时刻提醒 epoch 数组）与上述
 *   建议性字段同纪律——键可缺省、值出现即从严（数组、每项有限正整数）。
 * - tags 数组元素必须是 string；
 * - recurrence 必须完整匹配 daily/weekly/monthly 三种形状之一（weekdays 1..7、
 *   dayOfMonth 1..31、localTime.hour 0..23、localTime.minute 0..59，均为整数）；
 *   残缺/未知形状整体判校验失败（schema-mismatch），不做静默降级——把真实重复
 *   意图悄悄改成单次比报错更危险，与“残缺 JSON 直接拦截、不补救”同一原则。
 */

import type { LocalTime, RecurrenceRule } from '../recurrence/types';
import { REMINDER_CHANNELS } from '../reminder';
import type { ReminderChannel } from '../reminder';
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
export function isRecurrenceRule(value: unknown): RecurrenceRule | null {
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
 * 渠道数组校验（切片 23 / ai.md v0.19）：非空、元素 ∈ REMINDER_CHANNELS、
 * expo 家族互斥（system-notification 与 alarm 不同现，与 Repository 写路径
 * normalizeReminderChannelFields 的约束一致）。校验通过返回 true，调用方
 * 自行拷贝数组（守卫不产出引用）。
 */
export function isReminderChannelArray(value: unknown): value is ReminderChannel[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every((c) => REMINDER_CHANNELS.includes(c as ReminderChannel))) return false;
  const hasSystem = value.includes('system-notification');
  const hasAlarm = value.includes('alarm');
  if (hasSystem && hasAlarm) return false;
  return true;
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

  // 切片 19（§7.30）：reminderDelayMinutes 同 reminderOffsetMinutes 纪律——
  // 键必填（缺失时 undefined !== null → 整体拒绝），值须为 ≥1 的安全整数或 null。
  const reminderDelayMinutes = value.reminderDelayMinutes;
  if (
    reminderDelayMinutes !== null &&
    (!isIntegerIn(reminderDelayMinutes, 1, Number.MAX_SAFE_INTEGER))
  ) {
    return null;
  }

  // 切片 23（§7.35 / ai.md v0.19）：澄清与渠道推荐三字段——键可缺省（旧版响应
  // 向前兼容，非结构性字段不炸整体解析），值出现即从严（见文件头注释）。
  const needsClarification = value.needsClarification;
  if (needsClarification !== undefined && typeof needsClarification !== 'boolean') {
    return null;
  }
  const clarificationPrompt = value.clarificationPrompt;
  if (clarificationPrompt !== undefined && typeof clarificationPrompt !== 'string') {
    return null;
  }
  const reminderChannelsRaw = value.reminderChannels;
  let reminderChannels: ReminderChannel[] | undefined;
  if (reminderChannelsRaw !== undefined) {
    if (!isReminderChannelArray(reminderChannelsRaw)) return null;
    reminderChannels = [...reminderChannelsRaw];
  }

  // 切片 32（§7.44 / ai.md v0.23）：绝对时刻提醒数组——与 needsClarification/
  // clarificationPrompt/reminderChannels 同纪律：键可缺省（旧版响应向前兼容），
  // 值出现即从严（数组、每项为有限正整数 epoch ms）。epoch 由 provider 本地
  // 民用换算产生（v0.16 纪律），wire 侧对应 reminders 民用数组另有整包校验。
  const remindersRaw = value.reminders;
  let reminders: number[] | undefined;
  if (remindersRaw !== undefined) {
    // 空数组同样拒绝（reminderChannels 先例）：「无提醒」由缺省表达，
    // 自身管道 wire 层已把 [] 丢弃为 undefined，draft 守卫不会合法见到 []。
    if (
      !Array.isArray(remindersRaw) ||
      remindersRaw.length === 0 ||
      !remindersRaw.every(
        (r) => typeof r === 'number' && Number.isFinite(r) && r > 0 && Number.isInteger(r),
      )
    ) {
      return null;
    }
    reminders = [...remindersRaw];
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
    reminderDelayMinutes,
    reminders,
    needsClarification,
    clarificationPrompt,
    reminderChannels,
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
