/**
 * 切片 6：Reminder 表单纯校验（不依赖 React Native，供详情页 ReminderForm 使用）。
 *
 * Repository（normalizeReminderRuleFields + 时区白名单）仍是最终校验层；
 * 本模块负责表单侧的即时反馈，规则与之保持一致。
 */

import type { CreateReminderInput, ReminderFrequency } from '../domain/reminder';
import { REMINDER_TZ_WHITELIST, isWhitelistedReminderTz } from '../data/reminderTzWhitelist';

/** 表单可编辑值：数值字段允许 null（未填），提交前必须通过 validateReminderForm */
export interface ReminderFormValues {
  frequency: ReminderFrequency;
  localTimeHour: number | null;
  localTimeMinute: number | null;
  weekdays: number[];
  dayOfMonth: number | null;
  tzid: string;
  /** 规则生效起点（绝对毫秒）；默认取创建表单时的当前时刻 */
  startAt: number | null;
  enabled: boolean;
}

export interface ReminderFormErrors {
  localTime?: string;
  weekdays?: string;
  dayOfMonth?: string;
  tzid?: string;
  startAt?: string;
}

/** 时区选择器固定只展示白名单两项（§4.25），供 UI 直接渲染 */
export const REMINDER_TZ_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  REMINDER_TZ_WHITELIST.map((tzid) => ({ value: tzid, label: tzid }));

export const WEEKDAY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 7, label: '日' },
];

/** 全部字段合法时返回空对象 {}（无错误键） */
export function validateReminderForm(values: ReminderFormValues): ReminderFormErrors {
  const errors: ReminderFormErrors = {};

  const hour = values.localTimeHour;
  const minute = values.localTimeMinute;
  if (hour === null || minute === null || !Number.isInteger(hour) || !Number.isInteger(minute)
    || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    errors.localTime = '时间需为 0–23 时 0–59 分';
  }

  if (values.frequency === 'weekly') {
    const selected = values.weekdays;
    if (selected.length === 0) {
      errors.weekdays = '请至少选择一个星期';
    } else if (selected.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
      errors.weekdays = '星期需在周一至周日之间';
    }
  }

  if (values.frequency === 'monthly') {
    const day = values.dayOfMonth;
    if (day === null || !Number.isInteger(day) || day < 1 || day > 31) {
      errors.dayOfMonth = '日期需为 1–31（超出当月天数时自动回退到当月最后一天）';
    }
  }

  if (!isWhitelistedReminderTz(values.tzid)) {
    errors.tzid = `时区仅支持 ${REMINDER_TZ_WHITELIST.join(' / ')}`;
  }

  if (values.startAt === null || !Number.isFinite(values.startAt)) {
    errors.startAt = '生效起点无效';
  }

  return errors;
}

/** 校验通过后构造 Repository 输入；weekdays/dayOfMonth 与切片 5 语义一致（非本 frequency 归零）。 */
export function buildCreateReminderInput(
  values: ReminderFormValues,
  itemId: string,
): CreateReminderInput {
  return {
    itemId,
    frequency: values.frequency,
    localTimeHour: values.localTimeHour ?? 0,
    localTimeMinute: values.localTimeMinute ?? 0,
    weekdays: values.frequency === 'weekly' ? values.weekdays : [],
    dayOfMonth: values.frequency === 'monthly' ? (values.dayOfMonth ?? 1) : 0,
    tzid: values.tzid,
    startAt: values.startAt ?? 0,
    enabled: values.enabled,
  };
}
