/**
 * 切片 5：Reminder 领域类型（AGENTS.md §4.17–4.19）。
 *
 * 纯 TypeScript，不依赖 React Native / WatermelonDB / expo-notifications。
 * 字段集合与 reminders 表一一对应（schema v3 冻结字段集合；v8 扩展见切片 16 节）；
 * Reminder ↔ RecurrenceRule 互转由 src/data/reminderRuleMapping.ts 负责（§4.17），
 * ReminderScheduler 不得自行解析存储格式。
 */

import type { Occurrence } from './recurrence';

/**
 * ReminderFrequency（§4.17 冻结三值 + 切片 16 扩展）：
 * v0.16 起（docs/proposals/slice-16-reminder-channels.md，AGENTS.md §7.26）新增 'once'：
 * 一次性提醒，触发时刻由 onceAt（民用时间）+ tzid 唯一决定，无重复展开。
 */
export type ReminderFrequency = 'daily' | 'weekly' | 'monthly' | 'once';

/**
 * 提醒渠道（切片 16，AGENTS.md §7.26 / 提案 §2.1）：
 * - system-notification：expo-notifications 本地通知（默认，与升级前行为一致）；
 * - alarm：expo-notifications 高优先级全屏通知模拟（阶段 2 落地，不引入原生 Schedule Exact Alarm）；
 * - webhook / apprise：前台直接 fetch（仅 App 进程存活时保证发送）。
 */
export type ReminderChannel = 'system-notification' | 'alarm' | 'webhook' | 'apprise';

export const REMINDER_CHANNELS: readonly ReminderChannel[] = [
  'system-notification',
  'alarm',
  'webhook',
  'apprise',
];

/** 缺省/存量渠道：v8 migration 将既有行回填为该值，行为与升级前一致（提案 §2.1）。 */
export const DEFAULT_REMINDER_CHANNEL: ReminderChannel = 'system-notification';

/**
 * create 输入缺省渠道集合（切片 18）：未传 channels 时的归一结果，
 * 与 DEFAULT_REMINDER_CHANNEL 语义一致（单元素数组，提案 §5）。
 */
export const DEFAULT_REMINDER_CHANNELS: readonly ReminderChannel[] = [DEFAULT_REMINDER_CHANNEL];

/** 渠道枚举守卫：读取层防御性归一（非法值回退 DEFAULT_REMINDER_CHANNEL）与写路径校验共用。 */
export function isReminderChannel(value: unknown): value is ReminderChannel {
  return REMINDER_CHANNELS.some((channel) => channel === value);
}

/**
 * expo 通知家族渠道（切片 18，提案 §6.3）：走 expo-notifications 调度、
 * identifier = occurrenceKey 的两个渠道。**至多选其一**（互斥）：
 * 两者的 identifier 同为 occurrenceKey，双开必然同 identifier 互踩；
 * 互斥由写路径强制（normalizeReminderChannelFields 抛错）+ UI 不提供该组合。
 */
export const EXPO_REMINDER_CHANNELS: readonly ReminderChannel[] = [
  'system-notification',
  'alarm',
];

export function isExpoReminderChannel(channel: ReminderChannel): boolean {
  return EXPO_REMINDER_CHANNELS.some((expo) => expo === channel);
}

/** 网络渠道（前台直接 fetch，仅 App 进程存活时保证发送）：配置字典里唯一合法的键集合。 */
export function isNetworkReminderChannel(channel: ReminderChannel): boolean {
  return !isExpoReminderChannel(channel);
}

/**
 * once 提醒的民用触发时刻（切片 16，提案 §2.1）：once_civil_json 单列 JSON 的形态。
 * 绝对触发时刻 = 该民用时刻在 reminder.tzid 下的换算结果（阶段 2 调度器实现）；
 * tzid 白名单对 once 同样生效（提案 §2.3）。与 localTime 家族同属民用时间，
 * 故意不用 epoch 毫秒存储（提案已拍板单列 JSON 方案）。
 */
export interface OnceCivilTime {
  /** 公元年（1–9999） */
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31（月内日历有效性由阶段 2 的 civil→epoch 换算判定，本层只做范围校验） */
  day: number;
  /** 0–23 */
  hour: number;
  /** 0–59 */
  minute: number;
}

/** 数据模型：Reminder（§4.17 冻结字段集合；v0.16 追加 onceAt；v0.18 多渠道 channels/channelConfigs） */
export interface Reminder {
  id: string;
  itemId: string;
  frequency: ReminderFrequency;
  /** 0–23 */
  localTimeHour: number;
  /** 0–59 */
  localTimeMinute: number;
  /** 仅 weekly 使用（1=周一 … 7=周日）；其他 frequency 恒为 [] */
  weekdays: number[];
  /** 仅 monthly 使用（1–31）；其他 frequency 恒为 0 */
  dayOfMonth: number;
  /**
   * 仅 frequency='once' 非空：一次性触发的民用时刻（once_civil_json，切片 16）。
   * 其他 frequency 恒为 null（Repository 写路径归一保证）。
   */
  onceAt: OnceCivilTime | null;
  /** IANA 时区标识，创建时写入，不随后续系统时区变化自动改写 */
  tzid: string;
  /** 规则生效起点（绝对毫秒时间戳）；once 频率下不参与触发时刻计算（唯一来源 onceAt + tzid） */
  startAt: number;
  enabled: boolean;
  /**
   * 提醒渠道集合（切片 18 多渠道，schema v10，AGENTS.md §7.29）：
   * ≥1 个渠道；至多一个 expo 渠道（system-notification 与 alarm 互斥）；
   * 去重 + REMINDER_CHANNELS canonical 序（写路径归一保证）。
   * 存量行经 legacy bridge 归一为单元素数组（提案 §4）。
   */
  channels: ReminderChannel[];
  /**
   * 渠道配置字典（切片 18）：键为网络渠道 id（webhook / apprise），值为配置原文
   * （webhook URL / apprise 配置 JSON）；expo 渠道不得有条目（写路径强制）。
   * 仅网络渠道可能携带配置；config-free 条目在写路径被 prune。
   */
  channelConfigs: Partial<Record<ReminderChannel, string>>;
  /** 调度器内部状态：最后一个已计入触发/missed 的 occurrenceKey（AGENTS.md §4.19） */
  lastFiredOccurrenceKey: string | null;
  /** 调度器内部状态：上次对账完成时间 */
  lastReconciledAt: number | null;
  /** 毫秒时间戳 */
  createdAt: number;
  /** 毫秒时间戳 */
  updatedAt: number;
}

export interface CreateReminderInput {
  itemId: string;
  frequency: ReminderFrequency;
  localTimeHour: number;
  localTimeMinute: number;
  /** 仅 weekly 必填（1–7，至少一个）；其他 frequency 传了也会被归一化为 [] */
  weekdays?: number[];
  /** 仅 monthly 必填（1–31）；其他 frequency 传了也会被归一化为 0 */
  dayOfMonth?: number;
  /**
   * 仅 once 必填（切片 16）：一次性触发的民用时刻。Repository 写路径运行时强制——
   * frequency='once' 而缺省时抛明确错误；其他 frequency 传了也会被归一化为 null。
   */
  onceAt?: OnceCivilTime | null;
  /**
   * 提醒渠道集合（切片 18 多渠道）；缺省 ['system-notification']。
   * 归一规则（写路径强制）：每项过 isReminderChannel（非法抛错）、去重、
   * REMINDER_CHANNELS canonical 序；归一后为空抛错；
   * expo 渠道（system-notification / alarm）至多一个，双开抛错（提案 §5）。
   */
  channels?: ReminderChannel[];
  /**
   * 渠道配置字典（切片 18）：键为渠道 id，值为配置原文。
   * 写路径归一：expo 渠道条目静默丢弃；网络渠道值 trim 后必须非空（纯空白抛错）；
   * 不在 channels 内的条目被 prune。create 无「清除」语义（null 值仅 update 支持）。
   */
  channelConfigs?: Partial<Record<ReminderChannel, string>>;
  tzid: string;
  startAt: number;
  enabled: boolean;
  // lastFiredOccurrenceKey / lastReconciledAt 不在输入内：
  // 由 Repository 初始化为 null（AGENTS.md §4.18），仅调度器经 mark* 方法更新。
}

/**
 * 更新 Reminder 的输入（§4.18 updateReminder 的参数形状）：
 * 允许更新规则字段、enabled 与 tzid；不允许更新 id、itemId、createdAt。
 * tzid（切片 6）：允许在两个白名单值之间显式切换（任务卡实现要求 5，§4.25）；
 * §4.17 的“不随后续系统时区变化自动改写”仅禁止自动改写，不禁止用户显式编辑。
 * lastFiredOccurrenceKey / lastReconciledAt 不在此列——只经 mark* 方法写入。
 * 切片 16：onceAt 以「patch 合并后的最终 frequency」判定——切回重复频率自动置 null；
 * frequency='once' 而合并结果无时刻时抛明确错误（createReminder 同纪律）。
 */
export interface UpdateReminderInput {
  frequency?: ReminderFrequency;
  localTimeHour?: number;
  localTimeMinute?: number;
  weekdays?: number[];
  dayOfMonth?: number;
  /** 仅 frequency='once' 可为非空；其他 frequency 由 Repository 归一为 null */
  onceAt?: OnceCivilTime | null;
  /**
   * 提醒渠道集合（切片 18 多渠道）；未传保持现状。
   * 归一规则同 CreateReminderInput.channels（校验/去重/canonical 序/空抛错/expo 互斥）。
   */
  channels?: ReminderChannel[];
  /**
   * 渠道配置字典 patch（切片 18）：**per-key merge**——逐键合并进现有字典后
   * prune 到本次生效的 channels；传 null 表示清除该渠道条目（提案 §5，已确认）。
   * 网络渠道值 trim 后必须非空（纯空白抛错）；expo 渠道条目静默丢弃。
   */
  channelConfigs?: Partial<Record<ReminderChannel, string | null>>;
  startAt?: number;
  enabled?: boolean;
  /** 仅接受时区白名单值（§4.25）；Repository 对白名单外值抛错 */
  tzid?: string;
}

/** 对账结果（AGENTS.md §4.16）：missed 为本次新发现的错过 occurrence，不重复计入。 */
export interface ReconcileResult {
  newlyScheduled: string[];
  cancelled: string[];
  missed: Occurrence[];
}
