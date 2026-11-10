import { groupItemsForView } from '../grouping';
import type { GroupItemsForViewInput, ViewKind } from '../grouping';
import type { Item, ItemStatus, ItemType } from '../../item';
import type { ItemWithTags, Tag } from '../../tag';

/**
 * 分组/排序为纯数值比较，测试用抽象毫秒值即可：
 * 视图范围 [1000, 2000)，now=1500，今日范围 [0, 1000)。
 */

function makeItem(overrides: Partial<ItemWithTags> & { id: string }): ItemWithTags {
  const status: ItemStatus = overrides.status ?? 'active';
  const base: Omit<ItemWithTags, 'id'> = {
    type: 'task' as ItemType,
    title: overrides.id,
    content: '',
    status,
    startAt: null,
    endAt: null,
    allDay: false,
    // 切片 8 编译必需夹具补字段（§7.13）：分组逻辑不读来源字段，固定 local 值。
    sourceType: 'local',
    sourceUid: null,
    sourceReadOnly: false,
    // 切片 14 编译必需夹具补字段（§7.13）：分组逻辑不读分类/优先级，固定默认值。
    categoryId: 'other',
    priority: 0,
    createdAt: 0,
    updatedAt: 0,
    tags: [] as Tag[],
  };
  return { ...base, ...overrides };
}

function makeInput(
  overrides: Partial<GroupItemsForViewInput>,
): GroupItemsForViewInput {
  return {
    items: [],
    viewKind: 'today' as ViewKind,
    nowMs: 1500,
    rangeStartMs: 1000,
    rangeEndMs: 2000,
    todayRange: { startMs: 0, endMs: 1000 },
    ...overrides,
  };
}

describe('groupItemsForView：分组优先级（过期 > 已安排 > 今日创建）', () => {
  it('同项命中已安排与过期时只进过期组', () => {
    const item = makeItem({ id: 'a', startAt: 1100, endAt: 1300 });
    const grouped = groupItemsForView(makeInput({ items: [item] }));
    expect(grouped.overdue.map((it) => it.id)).toEqual(['a']);
    expect(grouped.scheduled).toEqual([]);
    expect(grouped.createdToday).toEqual([]);
  });

  it('范围内未过期进已安排组', () => {
    const item = makeItem({ id: 'a', startAt: 1200, endAt: 1600 });
    const grouped = groupItemsForView(makeInput({ items: [item] }));
    expect(grouped.scheduled.map((it) => it.id)).toEqual(['a']);
  });

  it('跨天项（startAt < rangeStart 且 endAt > rangeStart）进已安排组', () => {
    const item = makeItem({ id: 'a', startAt: 800, endAt: 1600 });
    const grouped = groupItemsForView(makeInput({ items: [item] }));
    expect(grouped.scheduled.map((it) => it.id)).toEqual(['a']);
  });

  it('跨天但 endAt 已过 now：按优先级进过期组而非已安排组', () => {
    const item = makeItem({ id: 'a', startAt: 800, endAt: 1100 });
    const grouped = groupItemsForView(makeInput({ items: [item] }));
    expect(grouped.overdue.map((it) => it.id)).toEqual(['a']);
    expect(grouped.scheduled).toEqual([]);
  });

  it('未安排且今日创建进今日创建组', () => {
    const item = makeItem({ id: 'a', startAt: null, createdAt: 600 });
    const grouped = groupItemsForView(makeInput({ items: [item] }));
    expect(grouped.createdToday.map((it) => it.id)).toEqual(['a']);
  });

  it('allDay 项按 startAt 参与已安排分组', () => {
    const item = makeItem({ id: 'a', startAt: 1000, allDay: true });
    const grouped = groupItemsForView(makeInput({ items: [item] }));
    expect(grouped.scheduled.map((it) => it.id)).toEqual(['a']);
  });
});

describe('groupItemsForView：状态规则', () => {
  it('done 项排已安排组末尾（即使时间更早）', () => {
    const doneEarly = makeItem({ id: 'done-early', status: 'done', startAt: 1100, endAt: 1200 });
    const activeLate = makeItem({ id: 'active-late', startAt: 1800, endAt: null });
    const grouped = groupItemsForView(makeInput({ items: [activeLate, doneEarly] }));
    expect(grouped.scheduled.map((it) => it.id)).toEqual(['active-late', 'done-early']);
  });

  it('done 且过期不进过期组（过期组仅 active），落已安排组', () => {
    const item = makeItem({ id: 'a', status: 'done', startAt: 1100, endAt: 1200 });
    const grouped = groupItemsForView(makeInput({ items: [item] }));
    expect(grouped.overdue).toEqual([]);
    expect(grouped.scheduled.map((it) => it.id)).toEqual(['a']);
  });

  it('done 的未安排项不进今日创建组（该组仅 active）', () => {
    const item = makeItem({ id: 'a', status: 'done', startAt: null, createdAt: 600 });
    const grouped = groupItemsForView(makeInput({ items: [item] }));
    expect(grouped.createdToday).toEqual([]);
    expect(grouped.scheduled).toEqual([]);
    expect(grouped.overdue).toEqual([]);
  });

  it('archived 项不进任何分组', () => {
    const item = makeItem({ id: 'a', status: 'archived', startAt: 1200, endAt: null });
    const grouped = groupItemsForView(makeInput({ items: [item] }));
    expect(grouped.overdue).toEqual([]);
    expect(grouped.scheduled).toEqual([]);
    expect(grouped.createdToday).toEqual([]);
  });
});

describe('groupItemsForView：周视图无今日创建组', () => {
  it('viewKind=week 时未安排项不产生 createdToday', () => {
    const unscheduled = makeItem({ id: 'u', startAt: null, createdAt: 600 });
    const scheduled = makeItem({ id: 's', startAt: 1200, endAt: null });
    const grouped = groupItemsForView(
      makeInput({ items: [unscheduled, scheduled], viewKind: 'week', todayRange: null }),
    );
    expect(grouped.createdToday).toEqual([]);
    expect(grouped.scheduled.map((it) => it.id)).toEqual(['s']);
  });

  it('viewKind=week 且误传 todayRange 时 createdToday 仍为空（不变式由函数保证）', () => {
    const unscheduled = makeItem({ id: 'u', startAt: null, createdAt: 600 });
    const grouped = groupItemsForView(
      makeInput({ items: [unscheduled], viewKind: 'week', todayRange: { startMs: 0, endMs: 1000 } }),
    );
    expect(grouped.createdToday).toEqual([]);
  });
});

describe('groupItemsForView：今日范围边界', () => {
  it('createdAt 恰为 todayRange.startMs 命中（含下界）', () => {
    const item = makeItem({ id: 'a', startAt: null, createdAt: 0 });
    const grouped = groupItemsForView(makeInput({ items: [item] }));
    expect(grouped.createdToday.map((it) => it.id)).toEqual(['a']);
  });

  it('createdAt 恰为 todayRange.endMs 不命中（不含上界）', () => {
    const item = makeItem({ id: 'a', startAt: null, createdAt: 1000 });
    const grouped = groupItemsForView(makeInput({ items: [item] }));
    expect(grouped.createdToday).toEqual([]);
  });

  it('viewKind=today 但 todayRange=null 时 createdToday 为空（防御）', () => {
    const item = makeItem({ id: 'a', startAt: null, createdAt: 600 });
    const grouped = groupItemsForView(makeInput({ items: [item], todayRange: null }));
    expect(grouped.createdToday).toEqual([]);
  });

  it('未安排但创建于昨日不在今日创建组', () => {
    const item = makeItem({ id: 'a', startAt: null, createdAt: -500 });
    const grouped = groupItemsForView(makeInput({ items: [item] }));
    expect(grouped.createdToday).toEqual([]);
  });
});

describe('groupItemsForView：排序', () => {
  it('过期组按 endAt 升序', () => {
    const later = makeItem({ id: 'later', startAt: 1000, endAt: 1400 });
    const earlier = makeItem({ id: 'earlier', startAt: 1100, endAt: 1250 });
    const grouped = groupItemsForView(makeInput({ items: [later, earlier] }));
    expect(grouped.overdue.map((it) => it.id)).toEqual(['earlier', 'later']);
  });

  it('已安排组按 startAt 升序，相同时 createdAt 升序，done 殿后', () => {
    const b = makeItem({ id: 'b', startAt: 1200, endAt: null, createdAt: 700 });
    const a = makeItem({ id: 'a', startAt: 1200, endAt: null, createdAt: 500 });
    const c = makeItem({ id: 'c', startAt: 1300, endAt: null, createdAt: 100 });
    const done = makeItem({ id: 'done', status: 'done', startAt: 1100, endAt: null, createdAt: 100 });
    const grouped = groupItemsForView(makeInput({ items: [done, c, b, a] }));
    expect(grouped.scheduled.map((it) => it.id)).toEqual(['a', 'b', 'c', 'done']);
  });

  it('今日创建组按 createdAt 降序', () => {
    const old = makeItem({ id: 'old', startAt: null, createdAt: 100 });
    const newer = makeItem({ id: 'newer', startAt: null, createdAt: 800 });
    const grouped = groupItemsForView(makeInput({ items: [old, newer] }));
    expect(grouped.createdToday.map((it) => it.id)).toEqual(['newer', 'old']);
  });
});

describe('groupItemsForView：去重与空组', () => {
  it('同一 Item 出现在输入两次只保留一份', () => {
    const item = makeItem({ id: 'a', startAt: 1200, endAt: null });
    const grouped = groupItemsForView(makeInput({ items: [item, { ...item }] }));
    expect(grouped.scheduled).toHaveLength(1);
  });

  it('空输入返回三个空组', () => {
    const grouped = groupItemsForView(makeInput({}));
    expect(grouped).toEqual({ overdue: [], scheduled: [], createdToday: [] });
  });
});
