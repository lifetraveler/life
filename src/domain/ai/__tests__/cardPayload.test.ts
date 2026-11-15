/**
 * 结果卡片载荷组装测试（tasks/slice-22.md 阶段 1，AGENTS.md §7.34）：
 * 快照组装、落库终值透传、分类/提醒缺席回退与防御性拷贝。
 */

import { buildFlashCardPayload } from '../cardPayload';
import type { Category } from '../../category';
import type { Item } from '../../item';
import type { Reminder } from '../../reminder';

const CATEGORIES: Category[] = [
  { id: 'work', name: '工作', color: '#E57373', emoji: '💼', priority: 1 },
  { id: 'other', name: '其他', color: '#9E9E9E', emoji: '📌', priority: 5 },
];

function baseItem(overrides: Partial<Item>): Item {
  return {
    id: 'item-1',
    type: 'event',
    title: '开周会',
    content: '',
    status: 'active',
    startAt: null,
    endAt: null,
    allDay: false,
    sourceType: 'local',
    sourceUid: null,
    sourceReadOnly: false,
    categoryId: 'work',
    priority: 0,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function baseReminder(overrides: Partial<Reminder>): Reminder {
  return {
    id: 'rem-1',
    itemId: 'item-1',
    frequency: 'once',
    localTimeHour: 9,
    localTimeMinute: 0,
    weekdays: [],
    dayOfMonth: 1,
    onceAt: { year: 2026, month: 11, day: 16, hour: 8, minute: 50 },
    tzid: 'Asia/Shanghai',
    startAt: new Date('2026-11-16T08:50:00+08:00').getTime(),
    enabled: true,
    channels: ['system-notification'],
    channelConfigs: {},
    lastFiredOccurrenceKey: null,
    lastReconciledAt: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

const TIME_PATCH = {
  startAt: new Date('2026-11-16T09:00:00+08:00').getTime(),
  endAt: null,
  allDay: false,
};

describe('buildFlashCardPayload（切片 22 阶段 1）', () => {
  it('组装完整快照：分类 + once 提醒 + timePatch 落库终值', () => {
    const created = baseItem({});
    const reminder = baseReminder({});
    const payload = buildFlashCardPayload(created, TIME_PATCH, reminder, CATEGORIES);

    expect(payload).toEqual({
      itemId: 'item-1',
      title: '开周会',
      type: 'event',
      startAt: TIME_PATCH.startAt,
      endAt: null,
      allDay: false,
      category: { id: 'work', name: '工作', color: '#E57373', emoji: '💼' },
      reminder: {
        id: 'rem-1',
        frequency: 'once',
        localTimeHour: 9,
        localTimeMinute: 0,
        weekdays: [],
        dayOfMonth: 1,
        onceAt: { year: 2026, month: 11, day: 16, hour: 8, minute: 50 },
        tzid: 'Asia/Shanghai',
      },
    });
  });

  it('载荷 startAt/allDay 取 timePatch（落库终值），忽略 created 上的原始时间字段', () => {
    // createItem 返回的时间字段恒为 null（§4.24 链：时间只走 updateItemTime）。
    const created = baseItem({ startAt: null, allDay: true });
    const patch = {
      startAt: new Date('2026-11-16T09:00:00+08:00').getTime(),
      endAt: null,
      allDay: false,
    };
    const payload = buildFlashCardPayload(created, patch, null, CATEGORIES);
    expect(payload.startAt).toBe(patch.startAt);
    expect(payload.allDay).toBe(false);
  });

  it('categoryId 未命中分类列表 → category null（UI 回退灰）', () => {
    const created = baseItem({ categoryId: 'unknown' });
    const payload = buildFlashCardPayload(created, TIME_PATCH, null, CATEGORIES);
    expect(payload.category).toBeNull();
  });

  it('未创建提醒（reminder null）→ reminder null（卡片不渲染提醒行）', () => {
    const payload = buildFlashCardPayload(baseItem({}), TIME_PATCH, null, CATEGORIES);
    expect(payload.reminder).toBeNull();
  });

  it('weekly 提醒快照保留 weekdays/dayOfMonth 展示子集', () => {
    const reminder = baseReminder({
      frequency: 'weekly',
      onceAt: null,
      weekdays: [1, 3],
      dayOfMonth: 15,
    });
    const payload = buildFlashCardPayload(baseItem({}), TIME_PATCH, reminder, CATEGORIES);
    expect(payload.reminder).toEqual({
      id: 'rem-1',
      frequency: 'weekly',
      localTimeHour: 9,
      localTimeMinute: 0,
      weekdays: [1, 3],
      dayOfMonth: 15,
      onceAt: null,
      tzid: 'Asia/Shanghai',
    });
  });

  it('快照防御性拷贝：载荷 weekdays/onceAt 与 Reminder 对象互不串扰', () => {
    const reminder = baseReminder({ weekdays: [1, 3] });
    const payload = buildFlashCardPayload(baseItem({}), TIME_PATCH, reminder, CATEGORIES);

    // 改载荷不得影响原 Reminder。
    const snapshot = payload.reminder;
    if (snapshot === null) {
      throw new Error('本用例构造了非空 reminder，快照不应为 null');
    }
    snapshot.weekdays.push(5);
    snapshot.onceAt = { year: 2030, month: 1, day: 1, hour: 0, minute: 0 };
    expect(reminder.weekdays).toEqual([1, 3]);
    expect(reminder.onceAt).toEqual({ year: 2026, month: 11, day: 16, hour: 8, minute: 50 });

    // 改原 Reminder 不得影响载荷。
    const payload2 = buildFlashCardPayload(baseItem({}), TIME_PATCH, reminder, CATEGORIES);
    reminder.weekdays.push(6);
    reminder.onceAt = { year: 2031, month: 2, day: 2, hour: 1, minute: 1 };
    expect(payload2.reminder?.weekdays).toEqual([1, 3]);
    expect(payload2.reminder?.onceAt).toEqual({ year: 2026, month: 11, day: 16, hour: 8, minute: 50 });
  });
});
