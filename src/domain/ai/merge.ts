/**
 * 多轮纠正合并（tasks/slice-15.md 阶段 3，验收 7「改成后天」）。
 *
 * LocalFallbackProvider 是无状态槽位解析器：第二轮"改成后天"只会表达日期槽，
 * 其余字段（标题/分类/优先级等）是默认值而非用户意图。mergeDraftCorrection
 * 按 expressed 掩码逐字段合并：新解析"表达过"的字段用新值，未表达的沿用
 * 上一轮卡片值。Remote Provider（OpenAICompatibleProvider）靠 history 让模型
 * 重写完整草稿，不走本合并。
 *
 * 配对字段语义：startAt 表达而 endAt 未表达时保留旧 endAt；若产生
 * endAt < startAt，由 Mapper 按 repository.md §4.24 归一（endAt 置 null）。
 */

import type { ParsedItemDraft } from './types';

/** ParsedItemDraft 的可合并字段名。 */
export type DraftField =
  | 'title'
  | 'content'
  | 'type'
  | 'startAt'
  | 'endAt'
  | 'allDay'
  | 'categoryId'
  | 'tags'
  | 'priority'
  | 'recurrence'
  | 'reminderOffsetMinutes'
  | 'reminderDelayMinutes'
  | 'reminderChannels';

/** mergeDraftCorrection 的可选行为开关。 */
export interface MergeCorrectionOptions {
  /**
   * tags 是否允许继承上一轮。缺省 true（掩码合并）；false = 全新意图轮，
   * tags 恒取本轮解析值（未表达即为 []），不沾上一轮标签。
   */
  inheritTags?: boolean;
}

export function mergeDraftCorrection(
  previous: ParsedItemDraft,
  next: ParsedItemDraft,
  expressed: ReadonlySet<DraftField>,
  options: MergeCorrectionOptions = {},
): ParsedItemDraft {
  // 切片 24（§7.36 / slice-23 遗留 2）：全新意图（非编辑词、非澄清续答）的
  // 新输入不继承上一轮 tags——调用方把 inheritTags 置 false，tags 恒取本轮
  // 解析值，避免「叫醒卡带上一条散步/心情标签」的跨条目污染。缺省 true
  // 保持既有掩码合并行为（既有测试与编辑词轮不受影响）。
  const tags = options.inheritTags === false || expressed.has('tags')
    ? [...next.tags]
    : [...previous.tags];
  return {
    title: expressed.has('title') ? next.title : previous.title,
    content: expressed.has('content') ? next.content : previous.content,
    type: expressed.has('type') ? next.type : previous.type,
    startAt: expressed.has('startAt') ? next.startAt : previous.startAt,
    endAt: expressed.has('endAt') ? next.endAt : previous.endAt,
    allDay: expressed.has('allDay') ? next.allDay : previous.allDay,
    categoryId: expressed.has('categoryId') ? next.categoryId : previous.categoryId,
    tags,
    priority: expressed.has('priority') ? next.priority : previous.priority,
    recurrence: expressed.has('recurrence') ? next.recurrence : previous.recurrence,
    reminderOffsetMinutes: expressed.has('reminderOffsetMinutes')
      ? next.reminderOffsetMinutes
      : previous.reminderOffsetMinutes,
    reminderDelayMinutes: expressed.has('reminderDelayMinutes')
      ? next.reminderDelayMinutes
      : previous.reminderDelayMinutes,
    // 渠道推荐按掩码合并（切片 23）：本轮表达（如“叫我起床”判出 alarm）→ 采用；
    // 未表达 → 沿用上一轮，跨轮保留 alarm 推荐（澄清续答“明早7点”不丢渠道）。
    reminderChannels: expressed.has('reminderChannels')
      ? next.reminderChannels === undefined
        ? undefined
        : [...next.reminderChannels]
      : previous.reminderChannels === undefined
        ? undefined
        : [...previous.reminderChannels],
    // 澄清信号不粘滞（切片 23）：恒取新一轮——澄清轮（needsClarification=true +
    // 反问文案）之后，用户的续答轮（如“明早7点”）解析结果不再声明澄清，
    // 信号自动归位，出卡落库。
    needsClarification: next.needsClarification === true ? true : undefined,
    clarificationPrompt: next.clarificationPrompt,
  };
}
