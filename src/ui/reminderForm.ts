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
import { isExpoReminderChannel } from '../domain/reminder';
import { REMINDER_TZ_WHITELIST, isWhitelistedReminderTz } from '../data/reminderTzWhitelist';
import { parseWebhookChannelConfig } from '../notifications/channels/webhookConfig';
import type { ChannelPreset } from '../domain/channelPreset';

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
  /**
   * 选中渠道集合（切片 18 阶段 3 多选，提案 §8）：至少 1 项、expo 家族
   * （system-notification / alarm）至多一项——互斥切换由 toggleReminderChannel 保证。
   */
  channels: ReminderChannel[];
  /** webhook 渠道的 URL 原始输入（切渠道不清空，保留用户已输入内容） */
  channelConfigText: string;
  /** apprise 渠道的 BaseURL / Key 两个独立输入（stateful 简写；urls/stateless 不在 UI 暴露） */
  appriseBaseUrl: string;
  appriseKey: string;
  /**
   * 切片 17 阶段 2：当前选中渠道预设的 id（纯 UI 状态，不进入 Repository 输入）。
   * 选中预设 = 整串值复制进 channelConfigText / apprise 字段，此后与预设无关联
   * （删除预设不影响已保存提醒，§7.27）；null 表示未选或为「当前配置（未关联预设）」。
   */
  channelPresetId: string | null;
}

export interface ReminderFormErrors {
  localTime?: string;
  weekdays?: string;
  dayOfMonth?: string;
  onceAt?: string;
  tzid?: string;
  startAt?: string;
  channels?: string;
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
 * 渠道多选切换纯函数（切片 18 阶段 3，提案 §5 渠道约束的 UI 侧镜像）：
 * - 选中 expo 渠道（system-notification / alarm）时替换另一 expo 渠道（家族互斥），
 *   网络渠道保留；
 * - 任一渠道取消选中后至少保留 1 项（channels ≥ 1，提案已确认决策 ②），
 *   试图取消最后一项时返回原数组不变；
 * - 返回值恒为 canonical 序（REMINDER_CHANNELS 声明顺序）。
 */
export function toggleReminderChannel(
  channels: ReminderChannel[],
  channel: ReminderChannel,
): ReminderChannel[] {
  if (channels.includes(channel)) {
    if (channels.length <= 1) {
      return channels;
    }
    return REMINDER_CHANNELS.filter((existing) => existing !== channel && channels.includes(existing));
  }
  const next = isExpoReminderChannel(channel)
    ? [...channels.filter((existing) => !isExpoReminderChannel(existing)), channel]
    : [...channels, channel];
  return REMINDER_CHANNELS.filter((candidate) => next.includes(candidate));
}

/**
 * 工程内无 `new URL(` 先例（Hermes 环境差异，且 jest node 环境需一致可测）：
 * webhook / apprise URL 校验用手写正则纯函数——http/https 协议 + 协议后非空白（有 host）。
 */
export function isValidHttpUrl(raw: string): boolean {
  return /^https?:\/\/\S+$/i.test(raw);
}

/**
 * Webhook 配置 JSON 形态守卫（切片 17 阶段 2）：渠道预设的 configJson 是
 * 含 url + mode + payloadTemplate 的完整配置 JSON（§7.27），选预设=整串复制进
 * channelConfigText 后不能按纯 URL 校验。守卫入口 parseWebhookChannelConfig
 * 只收 string|null（内部 JSON.parse，非 JSON 串会被当 URL 放行），故此处先验
 * 「JSON 对象形态」再复用守卫的对象分支校验（url 必填 http(s)、payloadTemplate
 * 与 mode 配套）。纯 TS 无 expo 依赖，UI 层引用合规（ChannelPresetEditor 同先例）。
 */
export function isWebhookConfigJson(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return false;
    }
    parseWebhookChannelConfig(JSON.stringify(parsed));
    return true;
  } catch {
    return false;
  }
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

/**
 * 选中渠道集合 + 各渠道配置输入 → 多渠道形状（切片 18 阶段 3，提案 §5/§8）：
 * channels 原样取表单选中集（toggle 已保证 ≥1 与 expo 互斥，Repository 归一化兜底）；
 * channelConfigs 仅为「选中且为网络渠道」的条目产出（webhook = URL/配置 JSON 原文，
 * apprise = stateful 简写 {baseUrl,key} JSON），expo 渠道无配置条目。
 * 写路径最终归一化仍由 Repository 负责。
 */
function buildChannelFields(
  values: ReminderFormValues,
): { channels: ReminderChannel[]; channelConfigs: Partial<Record<ReminderChannel, string>> } {
  const channelConfigs: Partial<Record<ReminderChannel, string>> = {};
  if (values.channels.includes('webhook')) {
    channelConfigs['webhook'] = values.channelConfigText.trim();
  }
  if (values.channels.includes('apprise')) {
    channelConfigs['apprise'] = JSON.stringify({
      baseUrl: values.appriseBaseUrl.trim(),
      key: values.appriseKey.trim(),
    });
  }
  return { channels: [...values.channels], channelConfigs };
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

  if (values.channels.length === 0) {
    errors.channels = '请至少选择一个渠道';
  }

  if (values.channels.includes('webhook')) {
    const url = values.channelConfigText.trim();
    if (url.length === 0) {
      errors.channelConfig = 'Webhook URL 不能为空';
    } else if (!isValidHttpUrl(url) && !isWebhookConfigJson(url)) {
      // 切片 17 阶段 2：选预设=整串复制后 channelConfigText 可能是含
      // url + payloadTemplate 的完整配置 JSON（§7.27 模板适配），非纯 URL 也合法。
      errors.channelConfig =
        'URL 或配置 JSON 无效（需以 http:// 或 https:// 开头，或为含 url 的 Webhook 配置 JSON）';
    }
  }

  if (values.channels.includes('apprise')) {
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

/**
 * 切片 17 阶段 2：渠道预设的展示与匹配纯函数（预设下拉与设置页共用）。
 */

/** 预设摘要：webhook 显示目标 URL（整串 URL 形态原样展示），apprise 显示 BaseURL */
export function channelPresetSummary(preset: ChannelPreset): string {
  if (preset.type === 'webhook') {
    try {
      const parsed: unknown = JSON.parse(preset.configJson);
      if (
        typeof parsed === 'object'
        && parsed !== null
        && !Array.isArray(parsed)
        && 'url' in parsed
        && typeof parsed['url'] === 'string'
      ) {
        return parsed['url'];
      }
    } catch {
      // 非 JSON → 整串视为 URL 形态，原样展示
    }
    return preset.configJson;
  }
  return parseAppriseFormFields(preset.configJson).baseUrl;
}

/** 当前表单值是否与某预设的 configJson 一致（webhook 整串比对；apprise 比对回填字段） */
export function matchesChannelPreset(
  channel: 'webhook' | 'apprise',
  values: ReminderFormValues,
  preset: ChannelPreset,
): boolean {
  if (channel === 'webhook') {
    return preset.configJson === values.channelConfigText.trim();
  }
  const fields = parseAppriseFormFields(preset.configJson);
  return fields.baseUrl === values.appriseBaseUrl.trim() && fields.key === values.appriseKey.trim();
}

/** 校验通过后构造 Repository 输入；weekdays/dayOfMonth 与切片 5 语义一致（非本 frequency 归零）。 */
export function buildCreateReminderInput(
  values: ReminderFormValues,
  itemId: string,
): CreateReminderInput {
  const isOnce = values.frequency === 'once';
  const channelFields = buildChannelFields(values);
  return {
    itemId,
    frequency: values.frequency,
    localTimeHour: isOnce ? 0 : (values.localTimeHour ?? 0),
    localTimeMinute: isOnce ? 0 : (values.localTimeMinute ?? 0),
    weekdays: values.frequency === 'weekly' ? values.weekdays : [],
    dayOfMonth: values.frequency === 'monthly' ? (values.dayOfMonth ?? 1) : 0,
    onceAt: isOnce ? buildOnceCivilTime(values.onceAt) : null,
    channels: channelFields.channels,
    channelConfigs: channelFields.channelConfigs,
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
  const channelFields = buildChannelFields(values);
  return {
    frequency: values.frequency,
    localTimeHour: isOnce ? 0 : (values.localTimeHour ?? 0),
    localTimeMinute: isOnce ? 0 : (values.localTimeMinute ?? 0),
    weekdays: values.frequency === 'weekly' ? values.weekdays : [],
    dayOfMonth: values.frequency === 'monthly' ? (values.dayOfMonth ?? 1) : 0,
    onceAt: isOnce ? buildOnceCivilTime(values.onceAt) : null,
    channels: channelFields.channels,
    channelConfigs: channelFields.channelConfigs,
    startAt: values.startAt ?? target.startAt,
    enabled: values.enabled,
    tzid: values.tzid,
  };
}
