/**
 * editDiff 单测（切片 25 阶段 1，AGENTS.md §7.37）：
 * diffDraftChanges 逐字段比较的判定语义——阶段 2 useFlashChat 认真模式守卫
 * 依赖 titleChanged / contentChanged 决定拦截范围（时间/提醒/渠道/标签等字段
 * 修改与全新建卡不拦）；集合/规则判等与缺省等价语义在此钉死。
 */

import { diffDraftChanges } from '../editDiff';
import type { ParsedItemDraft } from '../types';

function makeDraft(overrides: Partial<ParsedItemDraft>): ParsedItemDraft {
  return {
    title: '交材料',
    content: '',
    type: 'task',
    startAt: new Date('2026-11-11T10:00:00+08:00').getTime(),
    endAt: null,
    allDay: false,
    categoryId: 'work',
    tags: ['工作'],
    priority: null,
    recurrence: null,
    reminderOffsetMinutes: null,
    reminderDelayMinutes: null,
    ...overrides,
  };
}

describe('diffDraftChanges：逐字段判定', () => {
  it('全等草稿 → 全 false，changedFields 为空', () => {
    const d = makeDraft({});
    const diff = diffDraftChanges(d, { ...d });
    expect(diff.titleChanged).toBe(false);
    expect(diff.contentChanged).toBe(false);
    expect(diff.typeChanged).toBe(false);
    expect(diff.timeChanged).toBe(false);
    expect(diff.categoryChanged).toBe(false);
    expect(diff.tagsChanged).toBe(false);
    expect(diff.priorityChanged).toBe(false);
    expect(diff.recurrenceChanged).toBe(false);
    expect(diff.reminderChanged).toBe(false);
    expect(diff.changedFields).toEqual([]);
  });

  it('title / content 变化各自命中（认真模式拦截范围）', () => {
    const prev = makeDraft({});
    expect(diffDraftChanges(prev, makeDraft({ title: '交年终材料' })).titleChanged).toBe(true);
    expect(
      diffDraftChanges(prev, makeDraft({ content: '补充：给王经理' })).contentChanged,
    ).toBe(true);
    const titleDiff = diffDraftChanges(prev, makeDraft({ title: '交年终材料' }));
    expect(titleDiff.changedFields).toEqual(['title']);
  });

  it('time 变化：startAt / endAt / allDay 任一变化即命中', () => {
    const prev = makeDraft({});
    expect(
      diffDraftChanges(prev, makeDraft({ startAt: new Date('2026-11-12T10:00:00+08:00').getTime() }))
        .timeChanged,
    ).toBe(true);
    expect(diffDraftChanges(prev, makeDraft({ endAt: 1700000000000 })).timeChanged).toBe(true);
    expect(diffDraftChanges(prev, makeDraft({ allDay: true })).timeChanged).toBe(true);
    expect(diffDraftChanges(prev, makeDraft({ allDay: true })).changedFields).toEqual(['time']);
  });

  it('category / priority / type 变化各自命中', () => {
    const prev = makeDraft({});
    expect(diffDraftChanges(prev, makeDraft({ categoryId: 'personal' })).categoryChanged).toBe(true);
    expect(diffDraftChanges(prev, makeDraft({ priority: 2 })).priorityChanged).toBe(true);
    expect(diffDraftChanges(prev, makeDraft({ type: 'note' })).typeChanged).toBe(true);
  });

  it('tags 集合比较：顺序与重复不影响判定；元素差才算变', () => {
    const prev = makeDraft({ tags: ['工作', '重要'] });
    expect(diffDraftChanges(prev, makeDraft({ tags: ['重要', '工作'] })).tagsChanged).toBe(false);
    expect(diffDraftChanges(prev, makeDraft({ tags: ['工作', '工作', '重要'] })).tagsChanged).toBe(
      false,
    );
    expect(diffDraftChanges(prev, makeDraft({ tags: ['工作'] })).tagsChanged).toBe(true);
  });
});

describe('diffDraftChanges：recurrence 与 reminder 判等', () => {
  it('recurrence：weekly weekdays 乱序等价；frequency/参数变化算变；null ↔ 规则算变', () => {
    const prev = makeDraft({
      recurrence: { frequency: 'weekly', weekdays: [1, 3], localTime: { hour: 8, minute: 0 } },
    });
    expect(
      diffDraftChanges(prev, makeDraft({
        recurrence: { frequency: 'weekly', weekdays: [3, 1], localTime: { hour: 8, minute: 0 } },
      })).recurrenceChanged,
    ).toBe(false);
    expect(
      diffDraftChanges(prev, makeDraft({
        recurrence: { frequency: 'weekly', weekdays: [1, 4], localTime: { hour: 8, minute: 0 } },
      })).recurrenceChanged,
    ).toBe(true);
    expect(
      diffDraftChanges(prev, makeDraft({
        recurrence: { frequency: 'weekly', weekdays: [1, 3], localTime: { hour: 9, minute: 0 } },
      })).recurrenceChanged,
    ).toBe(true);
    expect(diffDraftChanges(prev, makeDraft({ recurrence: null })).recurrenceChanged).toBe(true);
    expect(
      diffDraftChanges(makeDraft({ recurrence: null }), makeDraft({
        recurrence: { frequency: 'daily', localTime: { hour: 8, minute: 0 } },
      })).recurrenceChanged,
    ).toBe(true);
  });

  it('reminder：offset/delay 任一变化命中；channels 集合比较、缺省与空数组等价', () => {
    const prev = makeDraft({});
    expect(diffDraftChanges(prev, makeDraft({ reminderOffsetMinutes: 15 })).reminderChanged).toBe(
      true,
    );
    expect(diffDraftChanges(prev, makeDraft({ reminderDelayMinutes: 30 })).reminderChanged).toBe(
      true,
    );
    // undefined 与 [] 判等（字段缺省语义等价）
    expect(
      diffDraftChanges(makeDraft({ reminderChannels: undefined }), makeDraft({ reminderChannels: [] }))
        .reminderChanged,
    ).toBe(false);
    // 顺序不影响；元素差才算变
    expect(
      diffDraftChanges(
        makeDraft({ reminderChannels: ['webhook', 'apprise'] }),
        makeDraft({ reminderChannels: ['apprise', 'webhook'] }),
      ).reminderChanged,
    ).toBe(false);
    expect(
      diffDraftChanges(makeDraft({ reminderChannels: ['alarm'] }), makeDraft({})).reminderChanged,
    ).toBe(true);
  });

  it('多字段变化 → changedFields 按 canonical 序排列', () => {
    const prev = makeDraft({});
    const diff = diffDraftChanges(prev, makeDraft({
      title: '交年终材料',
      startAt: new Date('2026-11-12T10:00:00+08:00').getTime(),
      reminderOffsetMinutes: 15,
    }));
    expect(diff.changedFields).toEqual(['title', 'time', 'reminder']);
  });
});
