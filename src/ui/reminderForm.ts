/**
 * 切片 6：Reminder 表单纯校验（不依赖 React Native，供详情页 ReminderForm 使用）。
 *
 * Repository（normalizeReminderRuleFields + normalizeReminderChannelFields + 时区白名单）
 * 仍是最终校验层；本模块负责表单侧的即时反馈，规则与之保持一致。
 *
 * 切片 16 阶段 3：once 频率（触发时刻 = onceAt 民用时间）与渠道选择
 * （AGENTS.md §7.26 / docs/proposals/slice-16-reminder-channels.md）。
 */

import type {
  CreateReminderInput,
  OnceCivilTime,
  Reminder,
  ReminderChannel,
  ReminderFrequency,
  UpdateReminderInput,
} from '../domain/reminder';
import { REMINDER_CHANNELS } from '../domain/reminder';
import { REMINDER_TZ_WHITELIST, isWhitelistedReminderTz } from '../data/reminderTzWhitelist';

/** 表单可编辑值：数值字段允许 null（未填），提交前必须通过 validateReminderForm */
export interface ReminderFormValues {
  frequency: ReminderFrequency;
  localTimeHour: number | null;
  localTimeMinute: number | null;
  weekdays: number[];
  dayOfMonth: number | null;
  /** 仅 frequency='once' 使用：一次性触发的民用时刻（date='YYYY-MM-DD' 文本 + 时/分） */
  onceAt: { date: string; hour: number | null; minute: number | null };
  tzid: string;
  /** 规则生效起点（绝对毫秒）；默认取创建表单时的当前时刻。once 下不参与触发计算（展示用） */
  startAt: number | null;
  enabled: boolean;
  /** 提醒渠道（切片 16 阶段 3）；缺省 system-notification 与升级前行为一致 */
  channel: ReminderChannel;
  /** webhook 渠道的 URL 原始输入（切渠道不清空，保留用户已输入内容） */
  channelConfigText: string;
  /** apprise 渠道的 BaseURL / Key 两个独立输入（stateful 简写；urls/stateless 不在 UI 暴露） */
  appriseBaseUrl: string;
  appriseKey: string;
}

export interface ReminderFormErrors {
  localTime?: string;
  weekdays?: string;
  dayOfMonth?: string;
  onceAt?: string;
  tzid?: string;
  startAt?: string;
  channelConfig?: string;
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

/** 渠道中文标签（阶段 3 唯一来源；timeFormat.formatReminderChannelLabel 与调试页复用） */
export const REMINDER_CHANNEL_LABELS: Record<ReminderChannel, string> = {
  'system-notification': '系统通知',
  alarm: '闹钟',
  webhook: 'Webhook',
  apprise: 'Apprise',
};

/** 渠道选择器选项（顺序 = REMINDER_CHANNELS 声明顺序） */
export const REMINDER_CHANNEL_OPTIONS: ReadonlyArray<{ value: ReminderChannel; label: string }> =
  REMINDER_CHANNELS.map((channel) => ({ value: channel, label: REMINDER_CHANNEL_LABELS[channel] }));

/** 网络渠道（webhook / apprise）：UI 必须注明「仅 App 进程存活时保证发送」（§7.26 约束 2） */
export function isNetworkReminderChannel(channel: ReminderChannel): boolean {
  return channel === 'webhook' || channel === 'apprise';
}

/** 网络渠道边界提示文案（§7.26：UI 必须注明，契约措辞） */
export const NETWORK_CHANNEL_BOUNDARY_NOTICE = '网络推送仅在 App 进程存活时保证发送';

/**
 * 工程内无 `new URL(` 先例（Hermes 环境差异，且 jest node 环境需一致可测）：
 * webhook / apprise URL 校验用手写正则纯函数——http/https 协议 + 协议后非空白（有 host）。
 */
export function isValidHttpUrl(raw: string): boolean {
  return /^https?:\/\/\S+$/i.test(raw);
}

/** 'YYYY-MM-DD' → { year, month, day }；格式或范围不符返回 null（月内日历有效性按契约留给调度侧换算判定） */
function parseOnceDate(
  date: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return { year, month, day };
}

/** 校验通过后由表单值构造 OnceCivilTime（失败字段兜底 0 值，不会越过 validateReminderForm 落库） */
function buildOnceCivilTime(once: ReminderFormValues['onceAt']): OnceCivilTime {
  const parsed = parseOnceDate(once.date);
  return {
    year: parsed?.year ?? 1970,
    month: parsed?.month ?? 1,
    day: parsed?.day ?? 1,
    hour: once.hour ?? 0,
    minute: once.minute ?? 0,
  };
}

/**
 * 从存量 channel_config（apprise stateful 简写 {baseUrl,key} JSON）回填表单两个输入框；
 * 解析失败或形态不符时返回空串（用户重新填写，交由校验拦截）。
 */
export function parseAppriseFormFields(config: string | null): { baseUrl: string; key: string } {
  if (config === null) {
    return { baseUrl: '', key: '' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(config);
  } catch {
    return { baseUrl: '', key: '' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { baseUrl: '', key: '' };
  }
  const baseUrl = 'baseUrl' in parsed && typeof parsed['baseUrl'] === 'string' ? parsed['baseUrl'] : '';
  const key = 'key' in parsed && typeof parsed['key'] === 'string' ? parsed['key'] : '';
  return { baseUrl, key };
}

/** 渠道 + 渠道配置（apprise 按 stateful 简写序列化为 {baseUrl,key} JSON） */
function buildChannelFields(
  values: ReminderFormValues,
): { channel: ReminderChannel; channelConfig: string | null } {
  if (values.channel === 'webhook') {
    return { channel: values.channel, channelConfig: values.channelConfigText.trim() };
  }
  if (values.channel === 'apprise') {
    return {
      channel: values.channel,
      channelConfig: JSON.stringify({
        baseUrl: values.appriseBaseUrl.trim(),
        key: values.appriseKey.trim(),
      }),
    };
  }
  // system-notification / alarm：渠道无关，config 恒 null（Repository 强制归一）
  return { channel: values.channel, channelConfig: null };
}

/** 全部字段合法时返回空对象 {}（无错误键） */
export function validateReminderForm(values: ReminderFormValues): ReminderFormErrors {
  const errors: ReminderFormErrors = {};

  if (values.frequency === 'once') {
    // once：localTime 是占位零值不校验；触发时刻由 onceAt 文本字段承载
    const parsed = parseOnceDate(values.onceAt.date);
    if (parsed === null) {
      errors.onceAt = '触发日期需为 YYYY-MM-DD（如 2026-11-12）';
    }
    const { hour, minute } = values.onceAt;
    if (hour === null || minute === null || !Number.isInteger(hour) || !Number.isInteger(minute)
      || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      errors.onceAt = '触发时刻需为 0–23 时 0–59 分';
    }
  } else {
    const hour = values.localTimeHour;
    const minute = values.localTimeMinute;
    if (hour === null || minute === null || !Number.isInteger(hour) || !Number.isInteger(minute)
      || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      errors.localTime = '时间需为 0–23 时 0–59 分';
    }
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

  if (values.channel === 'webhook') {
    const url = values.channelConfigText.trim();
    if (url.length === 0) {
      errors.channelConfig = 'Webhook URL 不能为空';
    } else if (!isValidHttpUrl(url)) {
      errors.channelConfig = 'URL 格式无效（需以 http:// 或 https:// 开头）';
    }
  }

  if (values.channel === 'apprise') {
    const baseUrl = values.appriseBaseUrl.trim();
    if (baseUrl.length === 0) {
      errors.channelConfig = 'Apprise BaseURL 不能为空';
    } else if (!isValidHttpUrl(baseUrl)) {
      errors.channelConfig = 'BaseURL 格式无效（需以 http:// 或 https:// 开头）';
    } else if (values.appriseKey.trim().length === 0) {
      errors.channelConfig = 'Apprise Key 不能为空';
    }
  }

  return errors;
}

/** 校验通过后构造 Repository 输入；weekdays/dayOfMonth 与切片 5 语义一致（非本 frequency 归零）。 */
export function buildCreateReminderInput(
  values: ReminderFormValues,
  itemId: string,
): CreateReminderInput {
  const isOnce = values.frequency === 'once';
  const { channel, channelConfig } = buildChannelFields(values);
  return {
    itemId,
    frequency: values.frequency,
    localTimeHour: isOnce ? 0 : (values.localTimeHour ?? 0),
    localTimeMinute: isOnce ? 0 : (values.localTimeMinute ?? 0),
    weekdays: values.frequency === 'weekly' ? values.weekdays : [],
    dayOfMonth: values.frequency === 'monthly' ? (values.dayOfMonth ?? 1) : 0,
    onceAt: isOnce ? buildOnceCivilTime(values.onceAt) : null,
    channel,
    channelConfig,
    tzid: values.tzid,
    startAt: values.startAt ?? 0,
    enabled: values.enabled,
  };
}

/**
 * 阶段 3：由表单值 + 现 Reminder 构造完整更新 patch（详情页 handleUpdateReminder 改调此纯函数，
 * 不再手工拼字段）。onceAt 恒显式携带：切回重复频率传 null，由 Repository 归一；
 * startAt 未填时保持 target 现值。
 */
export function buildUpdateReminderInput(
  values: ReminderFormValues,
  target: Reminder,
): UpdateReminderInput {
  const isOnce = values.frequency === 'once';
  const { channel, channelConfig } = buildChannelFields(values);
  return {
    frequency: values.frequency,
    localTimeHour: isOnce ? 0 : (values.localTimeHour ?? 0),
    localTimeMinute: isOnce ? 0 : (values.localTimeMinute ?? 0),
    weekdays: values.frequency === 'weekly' ? values.weekdays : [],
    dayOfMonth: values.frequency === 'monthly' ? (values.dayOfMonth ?? 1) : 0,
    onceAt: isOnce ? buildOnceCivilTime(values.onceAt) : null,
    channel,
    channelConfig,
    startAt: values.startAt ?? target.startAt,
    enabled: values.enabled,
    tzid: values.tzid,
  };
}
