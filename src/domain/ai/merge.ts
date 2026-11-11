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
  | 'reminderOffsetMinutes';

export function mergeDraftCorrection(
  previous: ParsedItemDraft,
  next: ParsedItemDraft,
  expressed: ReadonlySet<DraftField>,
): ParsedItemDraft {
  return {
    title: expressed.has('title') ? next.title : previous.title,
    content: expressed.has('content') ? next.content : previous.content,
    type: expressed.has('type') ? next.type : previous.type,
    startAt: expressed.has('startAt') ? next.startAt : previous.startAt,
    endAt: expressed.has('endAt') ? next.endAt : previous.endAt,
    allDay: expressed.has('allDay') ? next.allDay : previous.allDay,
    categoryId: expressed.has('categoryId') ? next.categoryId : previous.categoryId,
    tags: expressed.has('tags') ? [...next.tags] : [...previous.tags],
    priority: expressed.has('priority') ? next.priority : previous.priority,
    recurrence: expressed.has('recurrence') ? next.recurrence : previous.recurrence,
    reminderOffsetMinutes: expressed.has('reminderOffsetMinutes')
      ? next.reminderOffsetMinutes
      : previous.reminderOffsetMinutes,
  };
}
