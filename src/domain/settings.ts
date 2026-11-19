/**
 * 领域类型定义：AppSettings（纯 TypeScript，不依赖 React Native / WatermelonDB）。
 *
 * AGENTS.md §7.22（v0.14，schema v6）：app_settings 为单行表（id 固定 'global'）。
 */

import {
  DEFAULT_REMINDER_CHANNELS,
  REMINDER_CHANNELS,
  isExpoReminderChannel,
  isReminderChannel,
  type ReminderChannel,
} from './reminder';

/** 标签展示模式（§7.22）：text=纯文字、emoji=仅图标、both=文字+图标 */
export type TagDisplayMode = 'text' | 'emoji' | 'both';

/** TagDisplayMode 全部合法值（用于防御性校验） */
export const TAG_DISPLAY_MODES: readonly TagDisplayMode[] = ['text', 'emoji', 'both'];

/** 类型守卫：库中读到非法枚举值时由 Repository 防御性回退默认值 */
export function isTagDisplayMode(value: unknown): value is TagDisplayMode {
  return typeof value === 'string' && (TAG_DISPLAY_MODES as readonly string[]).includes(value);
}

/**
 * 数据模型：AppSettings（§7.22；后续切片新增全局设置字段时在此扩展）。
 *
 * 小组件显示开关（切片 14 阶段 7a，docs/proposals/slice-14-widget-phase7.md，
 * app_settings schema v6→v7 新增 4 列）：仅控制「今日小组件」的展示口径，
 * 不影响 App 内任何视图。widgetShowCategoryEmoji / widgetShowTags 的渲染消费
 * 在阶段 7c 落地（本阶段只落存储与默认值）。
 */
export interface AppSettings {
  tagDisplayMode: TagDisplayMode;
  /** 小组件今日视图是否展示过期项（默认 true，保持升级前行为） */
  widgetShowOverdue: boolean;
  /** 小组件今日视图是否展示待办项（无时间纯待办，置底展示；默认 false） */
  widgetShowTodos: boolean;
  /** 小组件条目是否展示分类 emoji（阶段 7c 渲染；默认 false） */
  widgetShowCategoryEmoji: boolean;
  /** 小组件条目是否展示标签（阶段 7c 渲染，跟随 app tagDisplayMode；默认 false） */
  widgetShowTags: boolean;
  /**
   * once 快捷 Chips 增量（分钟，切片 18，AGENTS.md §7.29）：详情页「+10 分钟/+1 小时」
   * 一排快捷按钮的取值。默认 [10,60]；读取层防御归一（parseChipsIncrements），
   * 写路径校验（validateChipsIncrements）：1–4 项、每项 1–10080 整数（提案 §7，已确认）。
   */
  chipsIncrements: number[];
  /**
   * 新建提醒表单的默认渠道集合（切片 19，AGENTS.md §7.30）：JSON 存 default_channels_json。
   * 默认 ["system-notification"]（复用 DEFAULT_REMINDER_CHANNELS）；读取层防御归一
   * （parseDefaultChannels），写路径校验（validateDefaultChannels）——必须遵守 expo 家族
   * 互斥（system-notification 与 alarm 至多一个，与提醒写路径同一纪律）。
   */
  defaultChannels: ReminderChannel[];
  /**
   * 闪电录入认真模式（切片 25，AGENTS.md §7.37）：开启后，闪电录入的
   * 「编辑意图导致 title 或 content 变化」的轮次先追加确认消息，由用户选择
   * 应用/放弃修改后才出卡；时间/提醒/渠道/标签等字段修改与全新建卡不拦。
   * 默认 false = 默认模式（行为与切片 24 完全一致）。非可选 boolean 存
   * careful_mode 列；读层防御归一（非 boolean 回退 false），boolean 无枚举
   * 语义、无独立 parse/validate 函数。
   */
  carefulMode: boolean;
  /**
   * AI 用量展示开关（切片 26，AGENTS.md §7.38）：开启后，远端解析轮在 AI
   * 回复消息尾追加一行用量摘要（输入/输出 tokens、缓存命中数、按配置单价
   * 估算费用）；本地降级轮无 usage 不展示。默认 false = 不显示。非可选
   * boolean 存 show_ai_usage 列；读层防御归一（非 boolean 回退 false），
   * boolean 无枚举语义、无独立 parse/validate 函数（carefulMode 同款）。
   */
  showAiUsage: boolean;
  /**
   * 系统日历 live 直读显示开关（切片 27，AGENTS.md §7.39）：选中显示的系统日历
   * id 集合，JSON 存 display_calendar_ids_json。默认 []（= 功能关闭，合法状态
   * 而非缺省回退——与 defaultChannels 的「空非法」语义不同）；读取层防御归一
   * （parseDisplayCalendarIds：坏 JSON/非串/空串剔除，不抛错回退 []），写路径
   * 校验（validateDisplayCalendarIds：仅非空字符串、去重；空数组 = 关闭）。
   */
  displayCalendarIds: string[];
  /**
   * AI 服务重试次数（切片 30，AGENTS.md §7.41）：远端 provider 传输层对网络错误/
   * 超时/5xx/429/响应 JSON 解析失败自动重试的次数。0–5 整数，0=关闭（即现状），
   * 默认 3；固定间隔 1000ms、不做指数退避。存 ai_retry_max 列（number isOptional，
   * 既有行回填 null——非可选 number 会回填 0 与「关闭」语义混淆）；读层归一
   * （parseAiRetryMax：null/越界/非整数 → 默认 3），写路径校验（validateAiRetryMax
   * 否则抛错，tagDisplayMode 同款纪律）。
   */
  aiRetryMax: number;
  /**
   * 已删除条目在聊天结果卡中的显示方式（切片 30，AGENTS.md §7.41）：
   * 'mark' = 原地置灰 + 「已删除」角标 + 点击禁用 + chips 隐藏（默认）；
   * 'remove' = 从对话中直接移除该卡消息（card 消息为内存态，重启清空，
   * 无需持久化迁移之外的持久化逻辑）。存 flash_deleted_card_display 列
   * （string isOptional，既有行回填 null）；读层归一（非枚举值 → 'mark'），
   * 写路径校验（isFlashDeletedCardDisplay 否则抛错）。
   */
  flashDeletedCardDisplay: FlashDeletedCardDisplay;
  /**
   * AI 调试查看器——请求体展示开关（切片 32，AGENTS.md §7.44）：开启后，聊天
   * 中的「🔍 AI 调试」入口弹层展示本轮远端请求体 JSON（system prompt + history
   * + user 输入；不含 Authorization 头——provider 副通道不采集 headers）。默认
   * false。非可选 boolean 存 show_ai_request 列；读层防御归一（非 boolean 回退
   * false），boolean 无枚举语义、无独立 parse/validate 函数（carefulMode 同款）。
   */
  showAiRequest: boolean;
  /**
   * AI 调试查看器——响应体展示开关（切片 32，AGENTS.md §7.44）：开启后，调试
   * 弹层展示本轮远端响应体（成功轮 = chat-completions 信封；失败轮 = 错误响应
   * 文本，重试取最后一次）与解析草稿 JSON。默认 false。非可选 boolean 存
   * show_ai_response 列；读层防御归一同上。
   */
  showAiResponse: boolean;
}

/** 已删除卡显示方式枚举（切片 30，AGENTS.md §7.41） */
export type FlashDeletedCardDisplay = 'mark' | 'remove';

/** FlashDeletedCardDisplay 全部合法值（用于防御性校验） */
export const FLASH_DELETED_CARD_DISPLAYS: readonly FlashDeletedCardDisplay[] = ['mark', 'remove'];

/** 类型守卫：库中读到非法枚举值时由 Repository 防御性回退 'mark' */
export function isFlashDeletedCardDisplay(value: unknown): value is FlashDeletedCardDisplay {
  return (
    typeof value === 'string' &&
    (FLASH_DELETED_CARD_DISPLAYS as readonly string[]).includes(value)
  );
}

/** ai_retry_max 约束（切片 30）：0–5 整数；0 = 关闭重试 */
export const AI_RETRY_MIN = 0;
export const AI_RETRY_MAX_LIMIT = 5;
export const DEFAULT_AI_RETRY_MAX = 3;

/** chips_increments 约束（提案 §7，已确认）：最少 1 项、最多 4 项、每项 1–10080 分钟（7 天） */
export const CHIPS_MIN_ITEMS = 1;
export const CHIPS_MAX_ITEMS = 4;
export const CHIPS_MIN_MINUTES = 1;
export const CHIPS_MAX_MINUTES = 10080;

/**
 * 默认设置（§7.22：tagDisplayMode 默认 'text'；阶段 7a：过期组默认展示、
 * 待办/分类 emoji/标签默认不展示；切片 18：chips 默认 [10,60] 与切片 16 硬编码一致；
 * 切片 25：carefulMode 默认 false = 默认模式（AGENTS.md §7.37）；
 * 切片 26：showAiUsage 默认 false = 不显示（AGENTS.md §7.38）；
 * 切片 27：displayCalendarIds 默认 [] = 功能关闭（AGENTS.md §7.39）；
 * 切片 32：showAiRequest/showAiResponse 默认 false（AGENTS.md §7.44）；
 * getSettings 无记录时的兜底返回值）。
 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  tagDisplayMode: 'text',
  widgetShowOverdue: true,
  widgetShowTodos: false,
  widgetShowCategoryEmoji: false,
  widgetShowTags: false,
  chipsIncrements: [10, 60],
  defaultChannels: [...DEFAULT_REMINDER_CHANNELS],
  carefulMode: false,
  showAiUsage: false,
  displayCalendarIds: [],
  aiRetryMax: DEFAULT_AI_RETRY_MAX,
  flashDeletedCardDisplay: 'mark',
  showAiRequest: false,
  showAiResponse: false,
};

/** app_settings 单行主键（§7.22） */
export const APP_SETTINGS_ROW_ID = 'global';

/**
 * chips_increments 读层防御归一（切片 18，提案 §7）：
 * - null/''/非 JSON 数组 → 整体回退默认 [10, 60]；
 * - 元素非 1–10080 的有限整数 → 丢弃该项（读层防御回退纪律，坏值不用）；
 * - 有效项超过 CHIPS_MAX_ITEMS 截断；结果为空 → 默认 [10, 60]。
 * 不抛错：读层永远返回可用数组。
 */
export function parseChipsIncrements(raw: string | null | undefined): number[] {
  const fallback = [...DEFAULT_APP_SETTINGS.chipsIncrements];
  if (raw === null || raw === undefined || raw === '') {
    return fallback;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!Array.isArray(parsed)) {
    return fallback;
  }
  const valid = parsed.filter(
    (item): item is number =>
      typeof item === 'number' && Number.isInteger(item) &&
      item >= CHIPS_MIN_MINUTES && item <= CHIPS_MAX_MINUTES,
  );
  if (valid.length === 0) {
    return fallback;
  }
  return valid.slice(0, CHIPS_MAX_ITEMS);
}

/**
 * chips_increments 写路径校验（切片 18）：违反约束抛错（写路径严格纪律，
 * 与 normalizeReminderChannelFields 同风格）；通过后返回 trim 后的标准化拷贝
 * （整数数组，顺序保留）。
 */
export function validateChipsIncrements(values: number[]): number[] {
  if (!Array.isArray(values)) {
    throw new Error('chipsIncrements 必须是数组');
  }
  if (values.length < CHIPS_MIN_ITEMS || values.length > CHIPS_MAX_ITEMS) {
    throw new Error(
      `chipsIncrements 需要 ${CHIPS_MIN_ITEMS}–${CHIPS_MAX_ITEMS} 项，收到 ${values.length} 项`,
    );
  }
  return values.map((item) => {
    if (typeof item !== 'number' || !Number.isInteger(item) ||
        item < CHIPS_MIN_MINUTES || item > CHIPS_MAX_MINUTES) {
      throw new Error(
        `chipsIncrements 每项必须是 ${CHIPS_MIN_MINUTES}–${CHIPS_MAX_MINUTES} 的整数分钟，收到 ${String(item)}`,
      );
    }
    return item;
  });
}

/** chips_increments → 存储字符串（切片 18）：写路径恒 JSON 数组；读层见 parseChipsIncrements。 */
export function serializeChipsIncrements(values: number[]): string {
  return JSON.stringify(validateChipsIncrements(values));
}

/**
 * default_channels_json 读层防御归一（切片 19，AGENTS.md §7.30）：
 * - null/''/坏 JSON/非数组 → 整体回退默认 ["system-notification"]；
 * - 元素非合法渠道 id → 丢弃该项（读层防御回退纪律，坏值不用）；
 * - 去重；按 REMINDER_CHANNELS canonical 序排列；
 * - expo 家族双开（system-notification + alarm 同时出现，只可能来自手工改库/旧 bug）：
 *   保留 canonical 序靠前的 expo 渠道、丢弃靠后的（读层不抛错，与提醒写路径抛错纪律不同）；
 * - 结果为空 → 回退默认。
 * 不抛错：读层永远返回可用数组。
 */
export function parseDefaultChannels(raw: string | null | undefined): ReminderChannel[] {
  const fallback = [...DEFAULT_APP_SETTINGS.defaultChannels];
  if (raw === null || raw === undefined || raw === '') {
    return fallback;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!Array.isArray(parsed)) {
    return fallback;
  }
  const valid = [...new Set(parsed.filter(isReminderChannel))];
  // expo 家族互斥（读层防御版）：保留 canonical 序靠前者，丢弃靠后者。
  const expoKept = [...valid]
    .filter(isExpoReminderChannel)
    .sort((a, b) => REMINDER_CHANNELS.indexOf(a) - REMINDER_CHANNELS.indexOf(b))
    .slice(0, 1);
  const filtered = valid.filter(
    (channel) => !isExpoReminderChannel(channel) || (expoKept.length > 0 && channel === expoKept[0]),
  );
  if (filtered.length === 0) {
    return fallback;
  }
  return [...filtered].sort(
    (a, b) => REMINDER_CHANNELS.indexOf(a) - REMINDER_CHANNELS.indexOf(b),
  );
}

/**
 * default_channels 写路径校验（切片 19，AGENTS.md §7.30）：违反约束抛错
 * （写路径严格纪律，与 normalizeReminderChannelFields 同风格）——
 * - 必须是非空数组，元素全部为合法渠道 id；
 * - expo 家族互斥：system-notification 与 alarm 至多一个（§7.30「必须遵守 expo 家族互斥校验」）；
 * - 通过后返回去重 + REMINDER_CHANNELS canonical 序排列的标准化拷贝。
 */
export function validateDefaultChannels(values: readonly ReminderChannel[]): ReminderChannel[] {
  if (!Array.isArray(values)) {
    throw new Error('defaultChannels 必须是数组');
  }
  if (values.length === 0) {
    throw new Error('defaultChannels 至少需要 1 个渠道');
  }
  for (const channel of values) {
    if (!isReminderChannel(channel)) {
      throw new Error(`defaultChannels 含非法渠道：${String(channel)}`);
    }
  }
  const expoCount = values.filter(isExpoReminderChannel).length;
  if (expoCount > 1) {
    throw new Error('defaultChannels 的 expo 家族渠道（system-notification/alarm）至多一个');
  }
  const unique = [...new Set(values)];
  return [...unique].sort(
    (a, b) => REMINDER_CHANNELS.indexOf(a) - REMINDER_CHANNELS.indexOf(b),
  );
}

/** default_channels → 存储字符串（切片 19）：写路径恒 JSON 数组；读层见 parseDefaultChannels。 */
export function serializeDefaultChannels(values: readonly ReminderChannel[]): string {
  return JSON.stringify(validateDefaultChannels(values));
}

/**
 * display_calendar_ids_json 读层防御归一（切片 27，AGENTS.md §7.39）：
 * - null/''/坏 JSON/非数组 → 回退 []（功能关闭，合法状态而非「非法回退默认」语义）；
 * - 元素非字符串 / trim 后为空串 → 丢弃该项（读层防御回退纪律，坏值不用）；
 * - 去重（保留首次出现顺序，不重排——日历 id 无 canonical 序概念）。
 * 不抛错：读层永远返回可用数组；结果允许为空（[] = 功能关闭）。
 */
export function parseDisplayCalendarIds(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined || raw === '') {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const valid = parsed.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );
  return [...new Set(valid)];
}

/**
 * display_calendar_ids 写路径校验（切片 27，AGENTS.md §7.39）：违反约束抛错
 * （写路径严格纪律，与 validateDefaultChannels 同风格）——
 * - 必须是数组（空数组合法 = 功能关闭，写 '[]'）；
 * - 每项必须是非空字符串（trim 判定，存储保留原值——日历 id 不含空白）；
 * - 通过后返回去重的标准化拷贝（顺序保留）。
 */
export function validateDisplayCalendarIds(values: readonly string[]): string[] {
  if (!Array.isArray(values)) {
    throw new Error('displayCalendarIds 必须是数组');
  }
  for (const id of values) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error(`displayCalendarIds 每项必须是非空字符串，收到 ${String(id)}`);
    }
  }
  return [...new Set(values)];
}

/** display_calendar_ids → 存储字符串（切片 27）：写路径恒 JSON 数组；读层见 parseDisplayCalendarIds。 */
export function serializeDisplayCalendarIds(values: readonly string[]): string {
  return JSON.stringify(validateDisplayCalendarIds(values));
}

/**
 * ai_retry_max 读层防御归一（切片 30，AGENTS.md §7.41）：null/undefined（既有行
 * isOptional 回填）/非有限数/非整数/越界（AI_RETRY_MIN–AI_RETRY_MAX_LIMIT 之外）
 * → 回退默认 DEFAULT_AI_RETRY_MAX；合法值原样返回。不抛错：读层永远返回可用数字。
 */
export function parseAiRetryMax(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) {
    return DEFAULT_AI_RETRY_MAX;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    return DEFAULT_AI_RETRY_MAX;
  }
  if (raw < AI_RETRY_MIN || raw > AI_RETRY_MAX_LIMIT) {
    return DEFAULT_AI_RETRY_MAX;
  }
  return raw;
}

/**
 * ai_retry_max 写路径校验（切片 30）：必须是 AI_RETRY_MIN–AI_RETRY_MAX_LIMIT
 * 的整数（0 = 关闭重试，合法写入），违反抛错（写路径严格纪律，
 * validateDisplayCalendarIds 同风格）。
 */
export function validateAiRetryMax(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`aiRetryMax 必须是整数，收到 ${String(value)}`);
  }
  if (value < AI_RETRY_MIN || value > AI_RETRY_MAX_LIMIT) {
    throw new Error(
      `aiRetryMax 必须在 ${AI_RETRY_MIN}–${AI_RETRY_MAX_LIMIT} 之间，收到 ${String(value)}`,
    );
  }
  return value;
}
