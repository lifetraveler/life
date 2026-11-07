/**
 * buildTodayWidgetSnapshot 单测（切片 10，任务卡 6 类用例）：
 * 1) 空输入；2) 恰好 5 条；3) 超 5 截断；4) allDay → '全天'；
 * 5) done 在 scheduled（含 done，位置沿用输入序）；6) overdue 仅 active（done/archived 被过滤）。
 * 期望值独立构造，timeLabel 断言统一用 tzid 'UTC'（jest 与真机运行时下行为一致，确定性最高）。
 */

import { buildTodayWidgetSnapshot, WIDGET_SNAPSHOT_PREFS_KEY } from '../snapshot';
import type { WidgetSnapshotEntry } from '../snapshot';
import type { ItemWithTags } from '../../tag';
import type { ItemStatus, ItemType } from '../../item';

const NOW = Date.UTC(2026, 2, 15, 6, 0); // UTC 2026-03-15 06:00

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
}): ItemWithTags {
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
    // 切片 14 编译必需夹具补字段（§7.13）：快照不含分类/优先级，固定默认值。
    categoryId: 'other',
    priority: 0,
    createdAt: overrides.createdAt ?? 1000,
    updatedAt: 1000,
    tags: [],
  };
}

describe('WIDGET_SNAPSHOT_PREFS_KEY', () => {
  it('冻结键名 widget_today_snapshot_v1', () => {
    expect(WIDGET_SNAPSHOT_PREFS_KEY).toBe('widget_today_snapshot_v1');
  });
});

describe('buildTodayWidgetSnapshot · 用例 1：空输入', () => {
  it('两组均为空数组，generatedAt/tzid 原样写入', () => {
    const snapshot = buildTodayWidgetSnapshot({
      overdue: [],
      scheduled: [],
      nowMs: NOW,
      tzid: 'UTC',
    });
    expect(snapshot).toEqual({
      generatedAt: NOW,
      tzid: 'UTC',
      groups: { overdue: [], scheduled: [] },
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
    });
  });
});

describe('buildTodayWidgetSnapshot · 用例 3：超 5 截断', () => {
  it('overdue 6 条 / scheduled 7 条 → 各截前 5，顺序沿用输入序（不重排）', () => {
    const overdue = [1, 2, 3, 4, 5, 6].map((n) =>
      makeItem({ id: `o${n}`, endAt: NOW - n * 60_000 }),
    );
    const scheduled = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      makeItem({ id: `s${n}`, startAt: Date.UTC(2026, 2, 15, n, 0) }),
    );
    const snapshot = buildTodayWidgetSnapshot({
      overdue,
      scheduled,
      nowMs: NOW,
      tzid: 'UTC',
    });
    expect(snapshot.groups.overdue.map((e) => e.id)).toEqual([
      'o1', 'o2', 'o3', 'o4', 'o5',
    ]);
    expect(snapshot.groups.scheduled.map((e) => e.id)).toEqual([
      's1', 's2', 's3', 's4', 's5',
    ]);
  });
});

describe('buildTodayWidgetSnapshot · 用例 4：allDay', () => {
  it('scheduled allDay 项 timeLabel 为 全天', () => {
    const snapshot = buildTodayWidgetSnapshot({
      overdue: [],
      scheduled: [
        makeItem({ id: 'a1', type: 'event', allDay: true, startAt: Date.UTC(2026, 2, 15, 0, 0) }),
      ],
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
      nowMs: NOW,
      tzid: 'UTC',
    });
    expect(snapshot.groups.overdue.map((e) => e.id)).toEqual(['o1', 'o4']);
  });
});
