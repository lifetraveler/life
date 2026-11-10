import type { ItemWithTags } from '../tag';
import type { Item, ItemSourceType, ItemType, ItemStatus } from '../item';
import type { Reminder } from '../reminder';
import { serializeExportData } from '../export';

/**
 * 切片 12 数据导出序列化纯函数单测（tasks/slice-12.md 实现要求 3 / 验收 8）：
 * 空列表、含 tags + reminders、可 JSON.parse 反解析、字段集合按决策 D
 * （无调度器内部字段 lastFiredOccurrenceKey / lastReconciledAt、无 reminder
 * id/itemId）、输出确定性。
 */

let idCounter = 0;

function makeItem(overrides: Partial<ItemWithTags> = {}): ItemWithTags {
  idCounter += 1;
  return {
    id: `item-${idCounter}`,
    type: 'task' as ItemType,
    title: `条目 ${idCounter}`,
    content: '',
    status: 'active' as ItemStatus,
    startAt: null,
    endAt: null,
    allDay: false,
    sourceType: 'local' as ItemSourceType,
    sourceUid: null,
    sourceReadOnly: false,
    // 切片 14 编译必需夹具补字段（§7.13）：导出序列化不含分类/优先级，固定默认值。
    categoryId: 'other',
    priority: 0,
    createdAt: 1000,
    updatedAt: 2000,
    tags: [],
    ...overrides,
  };
}

function makeReminder(itemId: string, overrides: Partial<Reminder> = {}): Reminder {
  idCounter += 1;
  return {
    id: `reminder-${idCounter}`,
    itemId,
    frequency: 'daily',
    localTimeHour: 9,
    localTimeMinute: 5,
    weekdays: [],
    dayOfMonth: 0,
    tzid: 'Asia/Shanghai',
    startAt: 1767225600000,
    enabled: true,
    // 调度器内部字段有值，验证导出时被剔除：
    lastFiredOccurrenceKey: '2026-01-01T09:05:00[Asia/Shanghai]',
    lastReconciledAt: 1767225700000,
    createdAt: 3000,
    updatedAt: 4000,
    ...overrides,
  };
}

describe('serializeExportData（切片 12 数据导出纯函数）', () => {
  it('空列表与空提醒 → {"version":1,"items":[]}', () => {
    expect(serializeExportData([], [])).toBe('{\n  "version": 1,\n  "items": []\n}');
  });

  it('含 tags 与 reminders：字段集合精确等于决策 D（toEqual 全量校验，多字段即失败）', () => {
    const item = makeItem({
      title: '体检',
      content: '年度体检',
      startAt: 1767225600000,
      allDay: true,
      tags: [
        // 切片 14 编译必需夹具补字段（§7.13）：Tag 新增 color/emoji，导出只取 name。
        { id: 'tag-1', name: '健康', color: null, emoji: null, createdAt: 500 },
        { id: 'tag-2', name: '重要', color: null, emoji: null, createdAt: 600 },
      ],
    });
    const reminder = makeReminder(item.id, {
      frequency: 'weekly',
      localTimeHour: 20,
      localTimeMinute: 30,
      weekdays: [1, 3],
      enabled: false,
    });
    const parsed = JSON.parse(
      serializeExportData([item], [reminder]),
    ) as { version: number; items: Array<Record<string, unknown>> };

    expect(parsed.version).toBe(1);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toEqual({
      id: item.id,
      type: 'task',
      title: '体检',
      content: '年度体检',
      status: 'active',
      startAt: 1767225600000,
      endAt: null,
      allDay: true,
      sourceType: 'local',
      sourceUid: null,
      sourceReadOnly: false,
      createdAt: 1000,
      updatedAt: 2000,
      tags: ['健康', '重要'],
      reminders: [
        {
          frequency: 'weekly',
          localTime: '20:30',
          weekdays: [1, 3],
          dayOfMonth: 0,
          tzid: 'Asia/Shanghai',
          startAt: 1767225600000,
          enabled: false,
        },
      ],
    });
  });

  it('提醒按 itemId 挂到对应条目；无提醒条目 reminders 为 []；孤儿提醒忽略', () => {
    const itemA = makeItem({ title: 'A' });
    const itemB = makeItem({ title: 'B' });
    const reminderOfB = makeReminder(itemB.id, { frequency: 'monthly', dayOfMonth: 15 });
    const orphan = makeReminder('nonexistent-item');

    const parsed = JSON.parse(
      serializeExportData([itemA, itemB], [reminderOfB, orphan]),
    ) as { items: Array<{ title: string; reminders: Array<Record<string, unknown>> }> };

    expect(parsed.items.map((entry) => entry.title)).toEqual(['A', 'B']);
    expect(parsed.items[0]?.reminders).toEqual([]);
    expect(parsed.items[1]?.reminders).toHaveLength(1);
    expect(parsed.items[1]?.reminders[0]).toEqual({
      frequency: 'monthly',
      localTime: '09:05',
      weekdays: [],
      dayOfMonth: 15,
      tzid: 'Asia/Shanghai',
      startAt: 1767225600000,
      enabled: true,
    });
  });

  it('输出可 JSON.parse 反解析且确定性（同输入同输出、不含时间戳副作用）', () => {
    const item = makeItem();
    const reminder = makeReminder(item.id);
    const once = serializeExportData([item], [reminder]);
    const twice = serializeExportData([item], [reminder]);
    expect(once).toBe(twice);
    expect(() => JSON.parse(once)).not.toThrow();
  });

  it('不修改输入对象（纯函数）', () => {
    const item = makeItem();
    const reminder = makeReminder(item.id);
    const reminderSnapshot = JSON.stringify(reminder);
    const itemSnapshot = JSON.stringify(item);
    serializeExportData([item], [reminder]);
    expect(JSON.stringify(reminder)).toBe(reminderSnapshot);
    expect(JSON.stringify(item)).toBe(itemSnapshot);
  });

  it('archived/done 状态原样导出（决策 B：范围含 archived/done，由调用方并集传入）', () => {
    const archived = makeItem({ status: 'archived' });
    const done = makeItem({ status: 'done' });
    const parsed = JSON.parse(
      serializeExportData([archived, done], []),
    ) as { items: Array<{ status: string }> };
    expect(parsed.items.map((entry) => entry.status)).toEqual(['archived', 'done']);
  });
});
