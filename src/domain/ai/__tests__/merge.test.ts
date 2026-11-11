/**
 * 多轮纠正合并测试（tasks/slice-15.md 阶段 3，验收 7）。
 */

import { mergeDraftCorrection } from '../merge';
import type { DraftField } from '../merge';
import type { ParsedItemDraft } from '../types';

describe('mergeDraftCorrection（阶段 3 多轮合并）', () => {
  const previous: ParsedItemDraft = {
    title: '开周会',
    content: '',
    type: 'event',
    startAt: 1000,
    endAt: 2000,
    allDay: false,
    categoryId: 'work',
    tags: ['工作'],
    priority: 3,
    recurrence: null,
    reminderOffsetMinutes: 10,
  };

  const next: ParsedItemDraft = {
    title: '改成后天', // fallback 兜底标题（未表达时应被忽略）
    content: '',
    type: 'note',
    startAt: 5000,
    endAt: null,
    allDay: true,
    categoryId: null,
    tags: [],
    priority: null,
    recurrence: null,
    reminderOffsetMinutes: null,
  };

  it('只覆盖 expressed 字段，其余沿用上一轮卡片', () => {
    const merged = mergeDraftCorrection(previous, next, new Set(['startAt', 'allDay']));
    expect(merged.title).toBe('开周会');
    expect(merged.type).toBe('event');
    expect(merged.startAt).toBe(5000);
    expect(merged.allDay).toBe(true);
    expect(merged.endAt).toBe(2000); // 未表达 → 保留（endAt<startAt 由 Mapper 归一）
    expect(merged.categoryId).toBe('work');
    expect(merged.priority).toBe(3);
    expect(merged.reminderOffsetMinutes).toBe(10);
    expect(merged.recurrence).toBeNull();
  });

  it('全量表达时整体替换', () => {
    const all = new Set<DraftField>([
      'title',
      'content',
      'type',
      'startAt',
      'endAt',
      'allDay',
      'categoryId',
      'tags',
      'priority',
      'recurrence',
      'reminderOffsetMinutes',
    ]);
    const merged = mergeDraftCorrection(previous, next, all);
    expect(merged).toEqual(next);
  });

  it('tags 数组不与上一轮/本轮共享引用', () => {
    const merged = mergeDraftCorrection(previous, next, new Set(['title']));
    merged.tags.push('污染');
    expect(previous.tags).toEqual(['工作']);
    expect(next.tags).toEqual([]);
  });
});
