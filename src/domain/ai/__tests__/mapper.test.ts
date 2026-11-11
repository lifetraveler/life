/**
 * mapDraftToCreateInputs 测试。
 * 期望时间一律用 resolveCivilTimeToInstant 构造，不做本地时区换算（§4.15）。
 */

import { mapDraftToCreateInputs } from '../mapper';
import type { ParsedItemDraft } from '../types';
import { resolveCivilTimeToInstant } from '../../recurrence/civilTime';

const TZID = 'Asia/Shanghai';
const mustAt = (y: number, m: number, d: number, h: number, min: number): number => {
  const instant = resolveCivilTimeToInstant(TZID, y, m, d, h, min);
  if (instant === null) throw new Error('测试期望时间落进 DST gap，请换基准时间');
  return instant;
};
const NOW = mustAt(2026, 11, 10, 10, 0);

function draft(overrides: Partial<ParsedItemDraft> = {}): ParsedItemDraft {
  return {
    title: '买菜',
    content: '',
    type: 'task',
    startAt: null,
    endAt: null,
    allDay: false,
    categoryId: null,
    tags: [],
    priority: null,
    recurrence: null,
    reminderOffsetMinutes: null,
    ...overrides,
  };
}

describe('mapDraftToCreateInputs', () => {
  it('最小草稿映射为默认值：categoryId 归 other、content/priority 不传', () => {
    const { item, reminderPlan } = mapDraftToCreateInputs(draft(), TZID, NOW);
    expect(reminderPlan).toBeNull();
    expect(item.type).toBe('task');
    expect(item.title).toBe('买菜');
    expect(item.categoryId).toBe('other');
    expect(item.content).toBeUndefined();
    expect(item.priority).toBeUndefined();
    expect(item.startAt).toBeNull();
    expect(item.endAt).toBeNull();
    expect(item.allDay).toBe(false);
    // tags / reminderOffsetMinutes 不进入 CreateItemInput（阶段3议题）。
    expect('tags' in item).toBe(false);
    expect('reminderOffsetMinutes' in item).toBe(false);
  });

  it('endAt 早于 startAt 时归一为 null（§4.24 预防）', () => {
    const startAt = mustAt(2026, 11, 11, 15, 0);
    const endAt = mustAt(2026, 11, 11, 14, 0);
    const { item } = mapDraftToCreateInputs(
      draft({ startAt, endAt }),
      TZID,
      NOW,
    );
    expect(item.startAt).toBe(startAt);
    expect(item.endAt).toBeNull();
  });

  it('content 非空才透传；categoryId 在预置白名单内则保留', () => {
    const { item } = mapDraftToCreateInputs(
      draft({ content: '牛奶和鸡蛋', categoryId: 'health' }),
      TZID,
      NOW,
    );
    expect(item.content).toBe('牛奶和鸡蛋');
    expect(item.categoryId).toBe('health');
  });

  it('未知 categoryId 归 other；priority 非法（4）不传', () => {
    const { item } = mapDraftToCreateInputs(
      draft({ categoryId: 'shopping', priority: 4 }),
      TZID,
      NOW,
    );
    expect(item.categoryId).toBe('other');
    expect(item.priority).toBeUndefined();
  });

  it('priority 合法（1..3）透传', () => {
    const { item } = mapDraftToCreateInputs(
      draft({ priority: 3 }),
      TZID,
      NOW,
    );
    expect(item.priority).toBe(3);
  });

  it('daily 重复产出 reminderPlan，startAt 用草稿值、tzid 透传、enabled=true', () => {
    const startAt = mustAt(2026, 11, 11, 9, 0);
    const { item, reminderPlan } = mapDraftToCreateInputs(
      draft({
        recurrence: {
          frequency: 'daily',
          localTime: { hour: 9, minute: 0 },
        },
        startAt,
      }),
      TZID,
      NOW,
    );
    expect(item.startAt).toBe(startAt);
    expect(reminderPlan).not.toBeNull();
    if (reminderPlan === null) return;
    expect(reminderPlan.frequency).toBe('daily');
    expect(reminderPlan.localTimeHour).toBe(9);
    expect(reminderPlan.localTimeMinute).toBe(0);
    expect(reminderPlan.tzid).toBe(TZID);
    expect(reminderPlan.startAt).toBe(startAt);
    expect(reminderPlan.enabled).toBe(true);
    expect(reminderPlan.weekdays).toBeUndefined();
    expect(reminderPlan.dayOfMonth).toBeUndefined();
  });

  it('草稿无 startAt 时 reminderPlan.startAt 兜底为下一次 occurrence', () => {
    const { reminderPlan } = mapDraftToCreateInputs(
      draft({
        recurrence: {
          frequency: 'daily',
          localTime: { hour: 9, minute: 0 },
        },
      }),
      TZID,
      NOW,
    );
    expect(reminderPlan).not.toBeNull();
    if (reminderPlan === null) return;
    // now 是 2026-11-10 10:00，daily 09:00 已过 → 下一次是明天 09:00。
    expect(reminderPlan.startAt).toBe(
      mustAt(2026, 11, 11, 9, 0),
    );
  });

  it('weekly 只传 weekdays，monthly 只传 dayOfMonth', () => {
    const weekly = mapDraftToCreateInputs(
      draft({
        recurrence: {
          frequency: 'weekly',
          weekdays: [1, 3],
          localTime: { hour: 8, minute: 0 },
        },
      }),
      TZID,
      NOW,
    );
    expect(weekly.reminderPlan?.weekdays).toEqual([1, 3]);
    expect(weekly.reminderPlan?.dayOfMonth).toBeUndefined();

    const monthly = mapDraftToCreateInputs(
      draft({
        recurrence: {
          frequency: 'monthly',
          dayOfMonth: 15,
          localTime: { hour: 8, minute: 0 },
        },
      }),
      TZID,
      NOW,
    );
    expect(monthly.reminderPlan?.dayOfMonth).toBe(15);
    expect(monthly.reminderPlan?.weekdays).toBeUndefined();
  });

  it('reminderOffsetMinutes 不映射（open item：冻结 Reminder 模型无一次性提醒）', () => {
    const { reminderPlan } = mapDraftToCreateInputs(
      draft({ reminderOffsetMinutes: 30 }),
      TZID,
      NOW,
    );
    expect(reminderPlan).toBeNull();
  });
});
