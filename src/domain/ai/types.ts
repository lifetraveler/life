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

export type ChatRole = 'user' | 'assistant';

/**
 * 对话消息（docs/contracts/ai.md 引用但未定义形状，v0.15.1 变更记录约定实现侧形状）。
 */
export interface ChatMessage {
  role: ChatRole;
  text: string;
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
}

/** AI 解析器接口（§7.24 冻结语义）：LocalFallbackProvider 与 OpenAICompatibleProvider 均实现它。 */
export interface AiParser {
  parse(input: string, context: AiParseContext): Promise<ParsedItemDraft>;
}
