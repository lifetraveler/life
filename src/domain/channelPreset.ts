/**
 * 渠道预设领域类型（切片 17 阶段 1，AGENTS.md §7.27 渠道配置中心）。
 *
 * 把 Webhook/Apprise 的常用渠道配置抽取为全局预设，存 channel_presets 表（schema v9）；
 * 详情页（阶段 2 UI）只做选择，选中预设的 configJson 整串复制进 reminders.channel_config。
 *
 * 纯类型与纯函数，不依赖 React Native / WatermelonDB / expo-notifications（AGENTS.md §4.3）。
 */

/**
 * 可预设的渠道类型：只给“有配置”的渠道建预设。
 * system-notification / alarm 无配置可预设，不进枚举（计划决策点，m00072 已确认）。
 */
export type ChannelPresetType = 'webhook' | 'apprise';

export const CHANNEL_PRESET_TYPES: readonly ChannelPresetType[] = ['webhook', 'apprise'];

export function isChannelPresetType(value: unknown): value is ChannelPresetType {
  return value === 'webhook' || value === 'apprise';
}

/** channel_presets 表行的领域投影（读取层从 WatermelonDB model 归一而来） */
export interface ChannelPreset {
  id: string;
  /** 显示名；Repository 写路径 trim 后非空，读取层不再归一 */
  name: string;
  type: ChannelPresetType;
  /**
   * 渠道配置 JSON 原文：webhook → WebhookChannelConfig（url/mode/headers/payloadTemplate，
   * notifications.md v0.17），apprise → AppriseChannelConfig（baseUrl+key/urls）。
   * 写路径经对应渠道守卫校验后才落库；读取层原样返回（阶段 2 选用时再 parse）。
   */
  configJson: string;
  /**
   * 默认预设标记（切片 18，schema v10，AGENTS.md §7.29）：详情页表单默认选中。
   * 「同 type 至多一个 true」由 Repository 写路径在同事务内保证（提案 §3.3）。
   */
  isDefault: boolean;
  /** 列表排序用（created_at 降序），毫秒时间戳 */
  createdAt: number;
}

/** createChannelPreset 输入：type 创建后不可变（改类型等于换配置语义，应删除重建） */
export interface CreateChannelPresetInput {
  name: string;
  type: ChannelPresetType;
  configJson: string;
  /** 切片 18：设 true 时同 type 其余预设自动取消默认（缺省 false，提案 §3.3） */
  isDefault?: boolean;
}

/** updateChannelPreset 输入：patch 合并语义（仅提供要改的字段），与 UpdateReminderInput 同纪律 */
export interface UpdateChannelPresetInput {
  name?: string;
  configJson?: string;
  /** 切片 18：patch 合并；设 true 时同 type 其余预设自动取消默认（提案 §3.3） */
  isDefault?: boolean;
}
