/**
 * 闪电录入认真模式的逐字段差异比较（切片 25 阶段 1，AGENTS.md §7.37）。
 *
 * 纯 TypeScript 领域函数（不依赖 React Native / WatermelonDB）：对比「上一张
 * 展示中卡片草稿」与「本轮解析结果」，产出逐字段变更标记。阶段 2 的 useFlashChat
 * 守卫消费 titleChanged / contentChanged 决定是否拦截确认（时间/提醒/渠道/标签等
 * 字段修改与全新建卡不拦）；「上一张卡是否存在」「是否编辑轮」等聊天状态谓词
 * 归 useFlashChat 层，本文件不关心。
 */

import type { RecurrenceRule } from '../recurrence/types';
import type { ParsedItemDraft } from './types';

/** 认真模式差异报告的字段粒度（§7.37 拦截范围只看 title/content，其余字段供确认摘要与测试） */
export type DraftDiffField =
  | 'title'
  | 'content'
  | 'type'
  | 'time'
  | 'category'
  | 'tags'
  | 'priority'
  | 'recurrence'
  | 'reminder';

/** diffDraftChanges 的输出：逐字段变更标记 + canonical 序变更字段列表 */
export interface DraftFieldChanges {
  titleChanged: boolean;
  contentChanged: boolean;
  typeChanged: boolean;
  /** startAt / endAt / allDay 任一变化 */
  timeChanged: boolean;
  categoryChanged: boolean;
  /** 集合比较：顺序与重复不影响判定 */
  tagsChanged: boolean;
  priorityChanged: boolean;
  recurrenceChanged: boolean;
  /** reminderOffsetMinutes / reminderDelayMinutes / reminderChannels 任一变化（channels 集合比较） */
  reminderChanged: boolean;
  /** 发生变化的字段（canonical 序），便于确认消息渲染「拟改字段摘要」 */
  changedFields: DraftDiffField[];
}

/** 集合相等：去重 + 排序后逐项比较（顺序与重复不影响判定）。 */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const normalize = (values: readonly string[]): string =>
    JSON.stringify([...new Set(values)].sort());
  return normalize(a) === normalize(b);
}

/** RecurrenceRule 判等：weekly weekdays 集合无序，其余字段按分支精确比较。 */
function normalizeRecurrenceRule(rule: RecurrenceRule): string {
  switch (rule.frequency) {
    case 'daily':
      return JSON.stringify({ frequency: rule.frequency, localTime: { ...rule.localTime } });
    case 'weekly':
      return JSON.stringify({
        frequency: rule.frequency,
        weekdays: [...rule.weekdays].sort((x, y) => x - y),
        localTime: { ...rule.localTime },
      });
    case 'monthly':
      return JSON.stringify({
        frequency: rule.frequency,
        dayOfMonth: rule.dayOfMonth,
        localTime: { ...rule.localTime },
      });
  }
}

function sameRecurrenceRule(a: RecurrenceRule | null, b: RecurrenceRule | null): boolean {
  if (a === null && b === null) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  return normalizeRecurrenceRule(a) === normalizeRecurrenceRule(b);
}

/**
 * 对比上一张展示中卡片草稿（previous）与本轮解析结果（next），返回逐字段变更标记。
 *
 * 语义约定：
 * - 字段缺省语义等价（如 reminderChannels undefined 与 [] 判等）；
 * - tags / reminderChannels 按集合比较（顺序与重复不影响）；
 * - recurrence 按规则语义判等（weekly weekdays 无序）；
 * - changedFields 恒按 title → content → type → time → category → tags →
 *   priority → recurrence → reminder 的 canonical 序排列。
 * 纯函数：不读全局状态、不抛错。
 */
export function diffDraftChanges(
  previous: ParsedItemDraft,
  next: ParsedItemDraft,
): DraftFieldChanges {
  const titleChanged = previous.title !== next.title;
  const contentChanged = previous.content !== next.content;
  const typeChanged = previous.type !== next.type;
  const timeChanged =
    previous.startAt !== next.startAt ||
    previous.endAt !== next.endAt ||
    previous.allDay !== next.allDay;
  const categoryChanged = previous.categoryId !== next.categoryId;
  const tagsChanged = !sameSet(previous.tags, next.tags);
  const priorityChanged = previous.priority !== next.priority;
  const recurrenceChanged = !sameRecurrenceRule(previous.recurrence, next.recurrence);
  const reminderChanged =
    previous.reminderOffsetMinutes !== next.reminderOffsetMinutes ||
    previous.reminderDelayMinutes !== next.reminderDelayMinutes ||
    !sameSet(previous.reminderChannels ?? [], next.reminderChannels ?? []);
  const changedFields: DraftDiffField[] = [];
  if (titleChanged) {
    changedFields.push('title');
  }
  if (contentChanged) {
    changedFields.push('content');
  }
  if (typeChanged) {
    changedFields.push('type');
  }
  if (timeChanged) {
    changedFields.push('time');
  }
  if (categoryChanged) {
    changedFields.push('category');
  }
  if (tagsChanged) {
    changedFields.push('tags');
  }
  if (priorityChanged) {
    changedFields.push('priority');
  }
  if (recurrenceChanged) {
    changedFields.push('recurrence');
  }
  if (reminderChanged) {
    changedFields.push('reminder');
  }
  return {
    titleChanged,
    contentChanged,
    typeChanged,
    timeChanged,
    categoryChanged,
    tagsChanged,
    priorityChanged,
    recurrenceChanged,
    reminderChanged,
    changedFields,
  };
}
