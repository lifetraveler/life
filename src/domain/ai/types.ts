/**
 * 切片 15 阶段 1：闪电添加 AI 解析层的领域类型（纯 TypeScript，
 * 不依赖 React Native / WatermelonDB / expo-secure-store）。
 *
 * 契约来源：docs/contracts/ai.md（v0.15，含 v0.15.1 变更记录）与 AGENTS.md §7.24–7.25。
 * - ParsedItemDraft 是 AI 解析结果的内存契约，落库前必须经 Mapper 转成 CreateItemInput；
 * - RecurrenceRule 复用 src/domain/recurrence/types.ts（冻结的 daily/weekly/monthly 三种规则）；
 * - 本目录所有实现不得 import React Native 或任何 native 模块（domain 纯度纪律）。
 */

import type { RecurrenceRule } from '../recurrence/types';
import type { ItemType } from '../item';
import type { OnceCivilTime, ReminderChannel, ReminderFrequency } from '../reminder';

export type ChatRole = 'user' | 'assistant';

/**
 * 结果卡片分类快照（切片 22，AGENTS.md §7.34）。
 * 展示所需的最小子集：色条颜色 + Emoji 图标 + 名称；null 沿 Category 契约语义
 * （color null → UI 回退灰；emoji null → 不显示图标）。
 */
export interface FlashCardCategorySnapshot {
  id: string;
  name: string;
  color: string | null;
  emoji: string | null;
}

/**
 * 结果卡片提醒快照（切片 22）：formatReminderRuleSummary 的 Pick 形状超集，
 * 额外携带 id 与 onceAt（阶段 3 快捷推迟须联动顺延 once 提醒的 onceAt，§7.34）。
 */
export interface FlashCardReminderSnapshot {
  id: string;
  frequency: ReminderFrequency;
  localTimeHour: number;
  localTimeMinute: number;
  weekdays: number[];
  dayOfMonth: number;
  /** 仅 frequency='once' 非空（民用时间，once 触发时刻唯一来源）。 */
  onceAt: OnceCivilTime | null;
  tzid: string;
  /**
   * 渠道列表快照（切片 23 阶段 3 / ai.md）：结果卡提醒行按渠道展示
   * ⏰ 闹钟 / 🔔 通知。Reminder.channels 为必有字段，快照恒携带。
   */
  channels: ReminderChannel[];
}

/**
 * 闪电录入保存成功后的结果卡片载荷（切片 22，AGENTS.md §7.34）。
 * 结构化快照而非文案：卡片 UI 由 src/ui/FlashResultCard.tsx 现算展示文案，
 * 阶段 3 快捷推迟只更新 startAt / onceAt 即可原地上刷新。
 */
export interface FlashCardPayload {
  /** 点击卡片主体跳转 /item/[id]。 */
  itemId: string;
  title: string;
  /** 内容补充说明快照（v0.19 验收反馈修补：机构/医院等细节存 content，结果卡非空时显示内容行）。 */
  content: string;
  type: ItemType;
  /** 保存链落库后的最终时间（含切片 19 delay 锚定），取 plan.timePatch 而非 createItem 原始返回。 */
  startAt: number | null;
  endAt: number | null;
  allDay: boolean;
  /** categoryId 未命中分类列表时为 null → 色条回退灰、不渲染分类行。 */
  category: FlashCardCategorySnapshot | null;
  /**
   * 保存链落库的全部提醒快照（切片 32 / ai.md v0.23）：多计划（reminders 数组 /
   * offset / delay 各自落库）逐条携带，空数组 = 未创建提醒 → 卡片不渲染提醒行。
   * （v0.22 及以前为单数 reminder: FlashCardReminderSnapshot | null；卡片消息为
   * 内存态，形状变更无持久化迁移负担。）
   */
  reminders: FlashCardReminderSnapshot[];
}

/**
 * 对话消息（docs/contracts/ai.md 引用但未定义形状，v0.15.1 变更记录约定实现侧形状）。
 * 切片 22 扩展（ai.md v0.18 变更记录）：kind/cardPayload 为可选字段而非判别联合，
 * 既有构造点（runFlashTurn historyAppend 等）缺省即 'text'，零改动。
 */
export interface ChatMessage {
  role: ChatRole;
  text: string;
  /** 消息呈现形态：'text' 纯文本（缺省）；'card' 结果卡片（cardPayload 必有）。 */
  kind?: 'text' | 'card';
  /** kind='card' 时的展示载荷；仅保存成功后的 assistant 消息携带，不进入 LLM history。 */
  cardPayload?: FlashCardPayload;
}

/** AI 解析上下文：now/tzid 必须由调用方显式传入，Provider 内部禁止读系统时钟/时区。 */
export interface AiParseContext {
  /** 当前绝对毫秒时间戳 */
  now: number;
  /** 设备 IANA 时区标识 */
  tzid: string;
  /** 之前的对话上下文（多轮纠错），Provider 按需消费 */
  history: ChatMessage[];
}

export type ParsedItemType = 'note' | 'task' | 'event';

/**
 * AI 解析草稿（docs/contracts/ai.md v0.15.1）。
 * tags / priority 为 v0.15.1 变更加入的字段（阶段 4 验收 6 要求卡片含标签）。
 */
export interface ParsedItemDraft {
  title: string;
  content: string;
  type: ParsedItemType;
  /** 绝对毫秒时间戳；null 表示未表达时间 */
  startAt: number | null;
  /** 绝对毫秒时间戳；null 表示无结束时间 */
  endAt: number | null;
  /** 仅表达了日期、未表达时刻时为 true（startAt = 该日 00:00） */
  allDay: boolean;
  /** 预置分类 id（'work'|'personal'|'study'|'health'|'other'）；null=无法判断 */
  categoryId: string | null;
  /** 从输入提取的标签（v0.15.1）；LocalFallback 恒为 [] */
  tags: string[];
  /** 0=无 1=低 2=中 3=高；null=用户未表达（v0.15.1） */
  priority: number | null;
  /** 重复规则（daily/weekly/monthly）；null=非重复 */
  recurrence: RecurrenceRule | null;
  /** “提前X分钟提醒”换算后的正整数分钟；null=未表达 */
  reminderOffsetMinutes: number | null;
  /**
   * “X分钟/小时后提醒我”（相对当前时刻的延迟，切片 19 / AGENTS.md §7.30）换算后的
   * 正整数分钟；null=未表达。落库语义（阶段 2）：非空且 recurrence 为空时，
   * 以 now + reminderDelayMinutes*60000 为触发时刻创建 once 提醒（无需 startAt）。
   */
  reminderDelayMinutes: number | null;
  /**
   * 绝对时刻提醒（切片 32 / ai.md v0.23）：用户指定「在某绝对民用时刻提醒我」
   * （如「明天8点、10点提醒我吃药」）时的逐条触发时刻（epoch 毫秒，升序去重）。
   * undefined=未表达（wire 键缺省宽容，旧响应兼容）。与 startAt 语义独立、可同现；
   * 落库为逐条 once 提醒（无需 startAt）。epoch 换算在 provider 本地完成（v0.16
   * 纪律），DST gap 条目丢弃、不炸整体。
   */
  reminders?: number[];
  /**
   * 强提醒场景的渠道推荐（切片 23 / AGENTS.md §7.35 / ai.md v0.19）：
   * 解析器识别出“起床/叫我/吃药/响铃”等强提醒场景且用户未指定提前量时，推荐
   * ['alarm']（闹钟语义：几点叫就几点响）。undefined=未表达（普通提醒不出此字段，
   * 落库渠道走用户全局默认渠道 defaultChannels，§7.30）；显式渠道落库时优先于默认渠道。
   * 数组元素仅限 ReminderChannel 四值且 expo 家族（system-notification/alarm）互斥。
   */
  reminderChannels?: ReminderChannel[];
  /**
   * 主动澄清（切片 23 / ai.md v0.19）：缺关键信息（如“提醒我吃药”没有时间）时为
   * true，解析层不急于落库，Chat 侧展示 clarificationPrompt 并等待用户续答。
   * undefined/false=信息完整，直接出卡。多轮合并语义：该信号不粘滞（merge.ts），
   * 下一轮解析结果未声明即视为不再澄清。
   */
  needsClarification?: boolean;
  /** needsClarification=true 时的单句反问（复用用户原词，只问缺失属性）。 */
  clarificationPrompt?: string;
}

/** AI 解析器接口（§7.24 冻结语义）：LocalFallbackProvider 与 OpenAICompatibleProvider 均实现它。 */
export interface AiParser {
  parse(input: string, context: AiParseContext): Promise<ParsedItemDraft>;
}
