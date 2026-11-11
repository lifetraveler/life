/**
 * 确认落库计划测试（tasks/slice-15.md 阶段 3，验收 9）：
 * 时间字段剥离（§4.24 链）、标签、提醒白名单与一次性提醒降级说明。
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

  it('一次性提醒（无重复规则）→ 附"暂不支持"说明，卡片意图保留', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ reminderOffsetMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlan).toBeNull();
    expect(plan.reminderNotice).toContain('一次性提醒');
  });
});
