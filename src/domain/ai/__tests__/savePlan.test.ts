/**
 * 确认落库计划测试（tasks/slice-15.md 阶段 3，验收 9；切片 16 阶段 3 扩 once 落库）：
 * 时间字段剥离（§4.24 链）、标签、提醒白名单、once 计划构造与各降级说明。
 */

import { buildFlashSavePlan } from '../savePlan';
import type { ParsedItemDraft } from '../types';

describe('buildFlashSavePlan（阶段 3 落库计划）', () => {
  const NOW = new Date('2026-11-10T10:00:00+08:00').getTime();

  function baseDraft(overrides: Partial<ParsedItemDraft>): ParsedItemDraft {
    return {
      title: '买菜',
      content: '',
      type: 'task',
      startAt: new Date('2026-11-11T15:00:00+08:00').getTime(),
      endAt: new Date('2026-11-11T16:00:00+08:00').getTime(),
      allDay: false,
      categoryId: 'work',
      tags: ['生活'],
      priority: 2,
      recurrence: null,
      reminderOffsetMinutes: null,
      reminderDelayMinutes: null,
      ...overrides,
    };
  }

  it('时间字段从 itemInput 剥离，进 timePatch（§4.24：时间只走 updateItemTime）', () => {
    const plan = buildFlashSavePlan(baseDraft({}), 'Asia/Shanghai', NOW);
    expect(plan.itemInput).toEqual({
      type: 'task',
      title: '买菜',
      content: undefined,
      categoryId: 'work',
      priority: 2,
    });
    expect(plan.timePatch).toEqual({
      startAt: new Date('2026-11-11T15:00:00+08:00').getTime(),
      endAt: new Date('2026-11-11T16:00:00+08:00').getTime(),
      allDay: false,
    });
    expect(plan.tagNames).toEqual(['生活']);
    expect(plan.reminderPlan).toBeNull();
    expect(plan.reminderNotice).toBeNull();
  });

  it('重复规则 + 白名单时区 → reminderPlan 保留', () => {
    const plan = buildFlashSavePlan(
      baseDraft({
        startAt: null,
        endAt: null,
        recurrence: {
          frequency: 'weekly',
          weekdays: [3],
          localTime: { hour: 20, minute: 0 },
        },
      }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlan).toEqual({
      frequency: 'weekly',
      localTimeHour: 20,
      localTimeMinute: 0,
      weekdays: [3],
      dayOfMonth: undefined,
      tzid: 'Asia/Shanghai',
      startAt: expect.any(Number),
      enabled: true,
    });
    expect(plan.reminderNotice).toBeNull();
  });

  it('重复规则 + 白名单外时区 → reminderPlan 置空并附说明', () => {
    const plan = buildFlashSavePlan(
      baseDraft({
        recurrence: {
          frequency: 'daily',
          localTime: { hour: 9, minute: 0 },
        },
      }),
      'Europe/Paris',
      NOW,
    );
    expect(plan.reminderPlan).toBeNull();
    expect(plan.reminderNotice).toContain('Europe/Paris');
    expect(plan.reminderNotice).toContain('暂不支持');
  });

  it('切片 16：有 startAt + 提前量 → once 计划（触发时刻 = startAt - offset，民用分解按 tzid）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ reminderOffsetMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlan).toEqual({
      frequency: 'once',
      localTimeHour: 0,
      localTimeMinute: 0,
      onceAt: { year: 2026, month: 11, day: 11, hour: 14, minute: 50 },
      channels: ['system-notification'],
      channelConfigs: {},
      tzid: 'Asia/Shanghai',
      startAt: new Date('2026-11-11T14:50:00+08:00').getTime(),
      enabled: true,
    });
    expect(plan.reminderNotice).toBeNull();
  });

  it('切片 16：无 startAt + 提前量 → 不落库，提示「需设定时间才能提前提醒」', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminderOffsetMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlan).toBeNull();
    expect(plan.reminderNotice).toBe('需设定时间才能提前提醒');
  });

  it('切片 16：白名单外时区 + 提前量 → 不落库并附说明', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ reminderOffsetMinutes: 10 }),
      'Europe/Paris',
      NOW,
    );
    expect(plan.reminderPlan).toBeNull();
    expect(plan.reminderNotice).toContain('Europe/Paris');
    expect(plan.reminderNotice).toContain('暂不支持');
  });

  it('切片 16：触发时刻已过去（startAt - offset <= now）→ 不落库，避免 reconcile 记 missed', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: NOW + 5 * 60000, endAt: null, reminderOffsetMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlan).toBeNull();
    expect(plan.reminderNotice).toBe('提醒时刻已过去，未创建一次性提醒');
  });

  it('切片 16：重复规则与提前量同时存在 → 重复计划优先（offset 保留在卡片意图，行为不变）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({
        startAt: null,
        endAt: null,
        recurrence: {
          frequency: 'weekly',
          weekdays: [3],
          localTime: { hour: 20, minute: 0 },
        },
        reminderOffsetMinutes: 10,
      }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlan).not.toBeNull();
    expect(plan.reminderPlan?.frequency).toBe('weekly');
    expect(plan.reminderNotice).toBeNull();
  });
});
