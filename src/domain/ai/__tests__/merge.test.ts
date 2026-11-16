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
    reminderDelayMinutes: null,
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
    reminderDelayMinutes: null,
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
      'reminderDelayMinutes',
    ]);
    const merged = mergeDraftCorrection(previous, next, all);
    expect(merged).toEqual(next);
  });

  it('reminderDelayMinutes 只在 expressed 时覆盖（切片 19 §7.30）', () => {
    const expressed = mergeDraftCorrection(previous, next, new Set(['reminderDelayMinutes']));
    expect(expressed.reminderDelayMinutes).toBeNull(); // next 值
    const kept = mergeDraftCorrection(previous, next, new Set(['title']));
    expect(kept.reminderDelayMinutes).toBeNull(); // previous 也是 null：null 是合法延续值
    // 非 null 情形：新一轮表达 delay → 采用；未表达 → 保留上一轮。
    const later: ParsedItemDraft = { ...next, reminderDelayMinutes: 30 };
    expect(mergeDraftCorrection(previous, later, new Set(['reminderDelayMinutes'])).reminderDelayMinutes).toBe(30);
    expect(mergeDraftCorrection(previous, later, new Set(['title'])).reminderDelayMinutes).toBeNull();
  });

  it('tags 数组不与上一轮/本轮共享引用', () => {
    const merged = mergeDraftCorrection(previous, next, new Set(['title']));
    merged.tags.push('污染');
    expect(previous.tags).toEqual(['工作']);
    expect(next.tags).toEqual([]);
  });

  it('reminderChannels 按 expressed 掩码合并（切片 23 §7.35）', () => {
    // 新一轮表达 → 采用新渠道（拷贝）
    const alarmNext: ParsedItemDraft = { ...next, reminderChannels: ['alarm'] };
    const taken = mergeDraftCorrection(previous, alarmNext, new Set(['reminderChannels']));
    expect(taken.reminderChannels).toEqual(['alarm']);
    // 未表达 → 保留上一轮（跨轮保留 alarm 推荐）
    const alarmPrev: ParsedItemDraft = { ...previous, reminderChannels: ['alarm'] };
    const kept = mergeDraftCorrection(alarmPrev, next, new Set(['title']));
    expect(kept.reminderChannels).toEqual(['alarm']);
    // 两轮都未表达 → undefined（落库走 defaultChannels，§7.30 不变）
    expect(
      mergeDraftCorrection(previous, next, new Set(['title'])).reminderChannels,
    ).toBeUndefined();
  });

  it('needsClarification / clarificationPrompt 恒取新一轮（信号不粘滞）', () => {
    const clarifying: ParsedItemDraft = {
      ...next,
      needsClarification: true,
      clarificationPrompt: '你要在什么时间提醒你吃药？',
    };
    const merged = mergeDraftCorrection(previous, clarifying, new Set(['title']));
    expect(merged.needsClarification).toBe(true);
    expect(merged.clarificationPrompt).toBe('你要在什么时间提醒你吃药？');
    // 续答轮（新一轮不再澄清）→ 归位 undefined，恢复正常出卡路径
    const answered = mergeDraftCorrection(clarifying, next, new Set(['startAt']));
    expect(answered.needsClarification).toBeUndefined();
    expect(answered.clarificationPrompt).toBeUndefined();
  });
});

describe('mergeDraftCorrection inheritTags（切片 24 §7.36 / slice-23 遗留 2）', () => {
  const previous: ParsedItemDraft = {
    title: '下午散步',
    content: '',
    type: 'event',
    startAt: 1000,
    endAt: null,
    allDay: false,
    categoryId: 'personal',
    tags: ['心情'],
    priority: null,
    recurrence: null,
    reminderOffsetMinutes: null,
    reminderDelayMinutes: null,
  };

  const next: ParsedItemDraft = {
    title: '叫我起床',
    content: '',
    type: 'task',
    startAt: 5000,
    endAt: null,
    allDay: false,
    categoryId: null,
    tags: [],
    priority: null,
    recurrence: null,
    reminderOffsetMinutes: null,
    reminderDelayMinutes: null,
  };

  it('inheritTags=false 且本轮未表达 tags → 恒取本轮（不沾上一轮标签）', () => {
    const merged = mergeDraftCorrection(previous, next, new Set(['startAt']), {
      inheritTags: false,
    });
    expect(merged.tags).toEqual([]);
  });

  it('inheritTags=false 且本轮表达 tags → 取本轮 tags（拷贝不共享引用）', () => {
    const tagged: ParsedItemDraft = { ...next, tags: ['叫醒'] };
    const merged = mergeDraftCorrection(previous, tagged, new Set(['startAt', 'tags']), {
      inheritTags: false,
    });
    expect(merged.tags).toEqual(['叫醒']);
    merged.tags.push('污染');
    expect(tagged.tags).toEqual(['叫醒']);
  });

  it('缺省 / inheritTags=true 保持既有掩码行为（未表达沿用上一轮）', () => {
    const defaulted = mergeDraftCorrection(previous, next, new Set(['startAt']));
    expect(defaulted.tags).toEqual(['心情']);
    const explicit = mergeDraftCorrection(previous, next, new Set(['startAt']), {
      inheritTags: true,
    });
    expect(explicit.tags).toEqual(['心情']);
  });
});
