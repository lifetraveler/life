/**
 * buildTodayWidgetSnapshot 单测（切片 10 六类用例 + 切片 14 阶段 5/7a）：
 * 1) 空输入；2) 恰好 5 条；3) 超护栏截断（阶段 7a：top5→50，三段各自截断）；
 * 4) allDay → '全天'；5) done 在 scheduled（含 done，位置沿用输入序）；
 * 6) overdue 仅 active（done/archived 被过滤）；7) categoryColor 透传（v0.14 阶段 5）；
 * 8) todos 组（阶段 7a：'待办' 标签、仅 active、categoryColor 透传、输入序保留）。
 * 期望值独立构造，timeLabel 断言统一用 tzid 'UTC'（jest 与真机运行时下行为一致，确定性最高）。
 */

import { buildTodayWidgetSnapshot, WIDGET_SNAPSHOT_PREFS_KEY } from '../snapshot';
import type { WidgetSnapshotEntry } from '../snapshot';
import type { Category } from '../../category';
import type { ItemWithRelations } from '../../relations/itemWithRelations';
import type { ItemStatus, ItemType } from '../../item';

const NOW = Date.UTC(2026, 2, 15, 6, 0); // UTC 2026-03-15 06:00

/** 测试夹具分类（§7.22 Category 结构子集全字段） */
function makeCategory(overrides: {
  id: string;
  name?: string;
  color?: string | null;
  emoji?: string | null;
}): Category {
  return {
    id: overrides.id,
    name: overrides.name ?? `分类${overrides.id}`,
    color: overrides.color ?? null,
    emoji: overrides.emoji ?? null,
    priority: 0,
  };
}

/** 测试夹具：必填字段给确定值，按参数覆盖 */
function makeItem(overrides: {
  id: string;
  title?: string;
  type?: ItemType;
  status?: ItemStatus;
  startAt?: number | null;
  endAt?: number | null;
  allDay?: boolean;
  createdAt?: number;
  category?: Category | null;
}): ItemWithRelations {
  return {
    id: overrides.id,
    type: overrides.type ?? 'task',
    title: overrides.title ?? `标题${overrides.id}`,
    content: '不应出现在快照',
    status: overrides.status ?? 'active',
    startAt: overrides.startAt ?? null,
    endAt: overrides.endAt ?? null,
    allDay: overrides.allDay ?? false,
    sourceType: 'local',
    sourceUid: null,
    sourceReadOnly: false,
    // 切片 14 编译必需夹具补字段（§7.13）：快照不含优先级，固定默认值。
    categoryId: overrides.category?.id ?? 'other',
    priority: 0,
    createdAt: overrides.createdAt ?? 1000,
    updatedAt: 1000,
    tags: [],
    category: overrides.category ?? null,
  };
}

describe('WIDGET_SNAPSHOT_PREFS_KEY', () => {
  it('冻结键名 widget_today_snapshot_v1', () => {
    expect(WIDGET_SNAPSHOT_PREFS_KEY).toBe('widget_today_snapshot_v1');
  });
});

describe('buildTodayWidgetSnapshot · 用例 1：空输入', () => {
  it('三组均为空数组，generatedAt/tzid 原样写入', () => {
    const snapshot = buildTodayWidgetSnapshot({
      overdue: [],
      scheduled: [],
      todos: [],
      nowMs: NOW,
      tzid: 'UTC',
    });
    expect(snapshot).toEqual({
      generatedAt: NOW,
      tzid: 'UTC',
      groups: { overdue: [], scheduled: [], todos: [] },
    });
  });
});

describe('buildTodayWidgetSnapshot · 用例 2：恰好 5 条', () => {
  it('overdue 与 scheduled 各 5 条全保留，字段映射正确', () => {
    const overdue = [1, 2, 3, 4, 5].map((n) =>
      makeItem({ id: `o${n}`, endAt: NOW - n * 60_000, createdAt: NOW - n * 60_000 }),
    );
    const scheduled = [1, 2, 3, 4, 5].map((n) =>
      makeItem({
        id: `s${n}`,
        type: 'event',
        startAt: Date.UTC(2026, 2, 15, n, 10),
        createdAt: NOW - n * 60_000,
      }),
    );
    const snapshot = buildTodayWidgetSnapshot({
      overdue,
      scheduled,
      todos: [],
      nowMs: NOW,
      tzid: 'UTC',
    });
    expect(snapshot.groups.overdue).toHaveLength(5);
    expect(snapshot.groups.scheduled).toHaveLength(5);
    expect(snapshot.groups.overdue[0]).toEqual({
      id: 'o1',
      title: '标题o1',
      type: 'task',
      timeLabel: '已过期',
      status: 'active',
      categoryColor: null,
    });
    expect(snapshot.groups.scheduled.map((e: WidgetSnapshotEntry) => e.timeLabel)).toEqual([
      '01:10',
      '02:10',
      '03:10',
      '04:10',
      '05:10',
    ]);
    expect(snapshot.groups.scheduled[0]).toEqual({
      id: 's1',
      title: '标题s1',
      type: 'event',
      timeLabel: '01:10',
      status: 'active',
      categoryColor: null,
    });
  });
});

describe('buildTodayWidgetSnapshot · 用例 3：超护栏截断（阶段 7a：50）', () => {
  it('overdue 51 条 / scheduled 52 条 / todos 53 条 → 各截前 50，顺序沿用输入序（不重排）', () => {
    const overdue = Array.from({ length: 51 }, (_, i) =>
      makeItem({ id: `o${i + 1}`, endAt: NOW - (i + 1) * 60_000 }),
    );
    const scheduled = Array.from({ length: 52 }, (_, i) =>
      makeItem({ id: `s${i + 1}`, startAt: Date.UTC(2026, 2, 15, 0, i + 1) }),
    );
    const todos = Array.from({ length: 53 }, (_, i) =>
      makeItem({ id: `t${i + 1}`, createdAt: 10_000 - i }),
    );
    const snapshot = buildTodayWidgetSnapshot({
      overdue,
      scheduled,
      todos,
      nowMs: NOW,
      tzid: 'UTC',
    });
    expect(snapshot.groups.overdue.map((e) => e.id)).toHaveLength(50);
    expect(snapshot.groups.overdue[0].id).toBe('o1');
    expect(snapshot.groups.overdue[49].id).toBe('o50');
    expect(snapshot.groups.scheduled.map((e) => e.id)).toHaveLength(50);
    expect(snapshot.groups.scheduled[0].id).toBe('s1');
    expect(snapshot.groups.scheduled[49].id).toBe('s50');
    expect(snapshot.groups.todos.map((e) => e.id)).toHaveLength(50);
    expect(snapshot.groups.todos[0].id).toBe('t1');
    expect(snapshot.groups.todos[49].id).toBe('t50');
  });
});

describe('buildTodayWidgetSnapshot · 用例 4：allDay', () => {
  it('scheduled allDay 项 timeLabel 为 全天', () => {
    const snapshot = buildTodayWidgetSnapshot({
      overdue: [],
      scheduled: [
        makeItem({ id: 'a1', type: 'event', allDay: true, startAt: Date.UTC(2026, 2, 15, 0, 0) }),
      ],
      todos: [],
      nowMs: NOW,
      tzid: 'UTC',
    });
    expect(snapshot.groups.scheduled).toEqual([
      {
        id: 'a1',
        title: '标题a1',
        type: 'event',
        timeLabel: '全天',
        status: 'active',
        categoryColor: null,
      },
    ]);
  });
});

describe('buildTodayWidgetSnapshot · 用例 5：done 在 scheduled', () => {
  it('done 项保留 status=done 与其 timeLabel，位置沿用输入序（done 末尾由切片 7 排序保证）', () => {
    const snapshot = buildTodayWidgetSnapshot({
      overdue: [],
      scheduled: [
        makeItem({ id: 's1', startAt: Date.UTC(2026, 2, 15, 9, 5) }),
        makeItem({ id: 'd1', status: 'done', startAt: Date.UTC(2026, 2, 15, 14, 45) }),
      ],
      todos: [],
      nowMs: NOW,
      tzid: 'UTC',
    });
    expect(snapshot.groups.scheduled.map((e) => e.id)).toEqual(['s1', 'd1']);
    expect(snapshot.groups.scheduled[1]).toEqual({
      id: 'd1',
      title: '标题d1',
      type: 'task',
      timeLabel: '14:45',
      status: 'done',
      categoryColor: null,
    });
  });
});

describe('buildTodayWidgetSnapshot · 用例 6：overdue 仅 active', () => {
  it('overdue 输入中的 done / archived 项被过滤，仅 active 进入快照（顺序保持）', () => {
    const overdue = [
      makeItem({ id: 'o1', endAt: NOW - 60_000, status: 'active' }),
      makeItem({ id: 'o2', endAt: NOW - 120_000, status: 'done' }),
      makeItem({ id: 'o3', endAt: NOW - 180_000, status: 'archived' }),
      makeItem({ id: 'o4', endAt: NOW - 240_000, status: 'active' }),
    ];
    const snapshot = buildTodayWidgetSnapshot({
      overdue,
      scheduled: [],
      todos: [],
      nowMs: NOW,
      tzid: 'UTC',
    });
    expect(snapshot.groups.overdue.map((e) => e.id)).toEqual(['o1', 'o4']);
  });
});

describe('buildTodayWidgetSnapshot · 用例 7：categoryColor 透传（v0.14 阶段 5）', () => {
  it('有分类时原样携带 category.color，无分类为 null', () => {
    const workCategory = makeCategory({ id: 'work', color: '#2E7D32', emoji: '💼' });
    const snapshot = buildTodayWidgetSnapshot({
      overdue: [
        makeItem({ id: 'o1', endAt: NOW - 60_000, category: workCategory }),
        makeItem({ id: 'o2', endAt: NOW - 120_000, category: null }),
      ],
      scheduled: [
        makeItem({ id: 's1', startAt: Date.UTC(2026, 2, 15, 9, 0), category: workCategory }),
      ],
      todos: [],
      nowMs: NOW,
      tzid: 'UTC',
    });
    expect(snapshot.groups.overdue[0].categoryColor).toBe('#2E7D32');
    expect(snapshot.groups.overdue[1].categoryColor).toBeNull();
    expect(snapshot.groups.scheduled[0].categoryColor).toBe('#2E7D32');
  });

  it('分类 color 为 null（未设置颜色）时透传 null，由 UI 层回退灰点', () => {
    const noColorCategory = makeCategory({ id: 'other' });
    const snapshot = buildTodayWidgetSnapshot({
      overdue: [],
      scheduled: [
        makeItem({ id: 's1', startAt: Date.UTC(2026, 2, 15, 9, 0), category: noColorCategory }),
      ],
      todos: [],
      nowMs: NOW,
      tzid: 'UTC',
    });
    expect(snapshot.groups.scheduled[0].categoryColor).toBeNull();
  });
});

describe('buildTodayWidgetSnapshot · 用例 8：todos 组（阶段 7a）', () => {
  it('无时间待办 timeLabel 为 待办，仅 active 进入，categoryColor 透传，顺序沿用输入序', () => {
    const workCategory = makeCategory({ id: 'work', color: '#2E7D32', emoji: '💼' });
    const snapshot = buildTodayWidgetSnapshot({
      overdue: [],
      scheduled: [],
      todos: [
        // todos 输入按 createdAt 降序（listUnscheduledItems 保证），此处沿用该序
        makeItem({ id: 't1', createdAt: 3000 }),
        makeItem({ id: 't2', status: 'done', createdAt: 2000 }),
        makeItem({ id: 't3', status: 'archived', createdAt: 1500 }),
        makeItem({ id: 't4', createdAt: 1000, category: workCategory }),
      ],
      nowMs: NOW,
      tzid: 'UTC',
    });
    expect(snapshot.groups.todos.map((e) => e.id)).toEqual(['t1', 't4']);
    expect(snapshot.groups.todos[0]).toEqual({
      id: 't1',
      title: '标题t1',
      type: 'task',
      timeLabel: '待办',
      status: 'active',
      categoryColor: null,
    });
    expect(snapshot.groups.todos[1].categoryColor).toBe('#2E7D32');
    expect(snapshot.groups.todos[1].timeLabel).toBe('待办');
  });
});
