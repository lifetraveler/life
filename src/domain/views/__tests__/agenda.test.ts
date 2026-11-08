import { groupItemsForAgenda } from '../agenda';
import type { GroupItemsForAgendaInput } from '../agenda';
import type { ItemWithRelations } from '../../relations/itemWithRelations';

/**
 * 时区锚点（Asia/Shanghai = UTC+8 无夏令时；America/New_York 2026-11-01 起 EST = UTC-5）：
 * - now = 2026-11-07（周六）12:00+08 = Date.UTC(2026, 10, 7, 4, 0)
 *   （NY 侧 = 2026-11-06（周五）23:00 EST）
 * - 2026-11-06 周五、11-07 周六、11-08 周日、11-10 周二、11-13 周五
 * 全部时间用 Date.UTC 显式构造，不依赖测试机时区。
 */
const NOW = Date.UTC(2026, 10, 7, 4, 0); // 2026-11-07 12:00+08（NY: 2026-11-06 23:00 EST）
const TZ_SH = 'Asia/Shanghai';
const TZ_NY = 'America/New_York';

const NOV7_0000_SH = Date.UTC(2026, 10, 6, 16, 0); // 2026-11-07 00:00+08（allDay 锚点）
const NOV7_0900_SH = Date.UTC(2026, 10, 7, 1, 0); // 2026-11-07 09:00+08
const NOV7_1000_SH = Date.UTC(2026, 10, 7, 2, 0); // 2026-11-07 10:00+08（NY: 2026-11-06 21:00 EST）
const NOV7_1100_SH = Date.UTC(2026, 10, 7, 3, 0); // 2026-11-07 11:00+08
const NOV7_1200_SH = Date.UTC(2026, 10, 7, 4, 0); // 2026-11-07 12:00+08
const NOV8_1200_SH = Date.UTC(2026, 10, 8, 4, 0); // 2026-11-08 12:00+08
const NOV10_1200_SH = Date.UTC(2026, 10, 10, 4, 0); // 2026-11-10 12:00+08（周二）
const NOV13_1200_SH = Date.UTC(2026, 10, 13, 4, 0); // 2026-11-13 12:00+08（周五）
const JAN5_2027_1200_SH = Date.UTC(2027, 0, 5, 4, 0); // 2027-01-05 12:00+08（跨年）

function makeItem(overrides: Partial<ItemWithRelations> & { id: string }): ItemWithRelations {
  const base: Omit<ItemWithRelations, 'id'> = {
    type: 'task',
    title: overrides.id,
    content: '',
    status: 'active',
    startAt: null,
    endAt: null,
    allDay: false,
    sourceType: 'local',
    sourceUid: null,
    sourceReadOnly: false,
    categoryId: 'other',
    priority: 0,
    createdAt: 0,
    updatedAt: 0,
    tags: [],
    category: null,
  };
  return { ...base, ...overrides };
}

/** agenda 视图 + 上海时区 + 固定 now 的便捷入参。 */
function groupFor(
  items: ItemWithRelations[],
  overrides: Partial<GroupItemsForAgendaInput> = {},
) {
  return groupItemsForAgenda(items, {
    viewKind: 'agenda',
    nowMs: NOW,
    tzid: TZ_SH,
    ...overrides,
  });
}

describe('groupItemsForAgenda：日期组标签', () => {
  it('今天 → key 2026-11-07，label 今天，kind day', () => {
    const groups = groupFor([makeItem({ id: 'a', startAt: NOV7_1200_SH, endAt: null })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('2026-11-07');
    expect(groups[0]?.kind).toBe('day');
    expect(groups[0]?.label).toBe('今天');
  });

  it('明天 → key 2026-11-08，label 明天', () => {
    const groups = groupFor([makeItem({ id: 'a', startAt: NOV8_1200_SH, endAt: null })]);
    expect(groups.map((g) => g.key)).toEqual(['2026-11-08']);
    expect(groups[0]?.label).toBe('明天');
  });

  it('同年非今明 → 周X D（2026-11-13 → 周五 13；2026-11-10 → 周二 10）', () => {
    expect(groupFor([makeItem({ id: 'a', startAt: NOV13_1200_SH, endAt: null })])[0]?.label).toBe('周五 13');
    expect(groupFor([makeItem({ id: 'a', startAt: NOV10_1200_SH, endAt: null })])[0]?.label).toBe('周二 10');
  });

  it('跨年 → 2027年1月5日（月/日不补零）', () => {
    const groups = groupFor([makeItem({ id: 'a', startAt: JAN5_2027_1200_SH, endAt: null })]);
    expect(groups.map((g) => g.key)).toEqual(['2027-01-05']);
    expect(groups[0]?.label).toBe('2027年1月5日');
  });

  it('组序：待办组最前，日期组按 key 字典序升序', () => {
    const groups = groupFor([
      makeItem({ id: 'jan5', startAt: JAN5_2027_1200_SH, endAt: null }),
      makeItem({ id: 'tomorrow', startAt: NOV8_1200_SH, endAt: null }),
      makeItem({ id: 'unscheduled', startAt: null, createdAt: 1 }),
      makeItem({ id: 'today', startAt: NOV7_1200_SH, endAt: null }),
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      'unscheduled',
      '2026-11-07',
      '2026-11-08',
      '2027-01-05',
    ]);
    expect(groups.map((g) => g.label)).toEqual(['待办', '今天', '明天', '2027年1月5日']);
    expect(groups[0]?.kind).toBe('unscheduled');
  });
});

describe('groupItemsForAgenda：组内排序', () => {
  it('同组有 startAt 的按 startAt 升序', () => {
    const groups = groupFor([
      makeItem({ id: 'late', startAt: NOV7_1100_SH, endAt: null }),
      makeItem({ id: 'early', startAt: NOV7_0900_SH, endAt: null }),
      makeItem({ id: 'mid', startAt: NOV7_1000_SH, endAt: null }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((it) => it.id)).toEqual(['early', 'mid', 'late']);
  });

  it('同 startAt 按 createdAt 升序，再按 id 确定化', () => {
    const groups = groupFor([
      makeItem({ id: 'b', startAt: NOV7_0900_SH, endAt: null, createdAt: 500 }),
      makeItem({ id: 'c', startAt: NOV7_0900_SH, endAt: null, createdAt: 300 }),
      makeItem({ id: 'a', startAt: NOV7_0900_SH, endAt: null, createdAt: 300 }),
    ]);
    expect(groups[0]?.items.map((it) => it.id)).toEqual(['a', 'c', 'b']);
  });

  it('allDay 项（startAt=当天 00:00+08）排当天最前', () => {
    const groups = groupFor([
      makeItem({ id: 'at9', startAt: NOV7_0900_SH, endAt: null }),
      makeItem({ id: 'allday', startAt: NOV7_0000_SH, endAt: null, allDay: true }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['2026-11-07']);
    expect(groups[0]?.items.map((it) => it.id)).toEqual(['allday', 'at9']);
  });
});

describe('groupItemsForAgenda：待办组（无 startAt，agenda/week/month 视图）', () => {
  it('待办组按 createdAt 降序', () => {
    const groups = groupFor([
      makeItem({ id: 'old', startAt: null, createdAt: 100 }),
      makeItem({ id: 'new', startAt: null, createdAt: 300 }),
      makeItem({ id: 'mid', startAt: null, createdAt: 200 }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['unscheduled']);
    expect(groups[0]?.label).toBe('待办');
    expect(groups[0]?.items.map((it) => it.id)).toEqual(['new', 'mid', 'old']);
  });

  it('待办组 createdAt 并列按 id 升序', () => {
    const groups = groupFor([
      makeItem({ id: 'b', startAt: null, createdAt: 100 }),
      makeItem({ id: 'a', startAt: null, createdAt: 100 }),
    ]);
    expect(groups[0]?.items.map((it) => it.id)).toEqual(['a', 'b']);
  });

  it('4 视图未安排项均进待办组（阶段 5b：today 并入行为随视图移除而失效）', () => {
    const unscheduled = makeItem({ id: 'u', startAt: null, createdAt: 1 });
    for (const viewKind of ['agenda', 'week', 'month', 'day'] as const) {
      const groups = groupFor([unscheduled], { viewKind });
      expect(groups.map((g) => g.key)).toEqual(['unscheduled']);
      expect(groups[0]?.kind).toBe('unscheduled');
      expect(groups[0]?.label).toBe('待办');
    }
  });
});

describe('groupItemsForAgenda：tzid 生效（同一 startAt、同一 now）', () => {
  // Date.UTC(2026, 10, 7, 2, 0) = 2026-11-07 10:00+08 = 2026-11-06 21:00 America/New_York（EST，DST 已于 2026-11-01 结束）
  const instant = NOV7_1000_SH;

  it("tzid='America/New_York' → 归入 2026-11-06（该时区今天）", () => {
    const groups = groupFor([makeItem({ id: 'a', startAt: instant, endAt: null })], { tzid: TZ_NY });
    expect(groups.map((g) => g.key)).toEqual(['2026-11-06']);
    expect(groups[0]?.label).toBe('今天');
  });

  it("tzid='Asia/Shanghai' → 归入 2026-11-07（该时区今天）", () => {
    const groups = groupFor([makeItem({ id: 'a', startAt: instant, endAt: null })], { tzid: TZ_SH });
    expect(groups.map((g) => g.key)).toEqual(['2026-11-07']);
    expect(groups[0]?.label).toBe('今天');
  });
});

describe('groupItemsForAgenda：排除、去重与空输入', () => {
  it("status='archived' 被排除", () => {
    const groups = groupFor([makeItem({ id: 'a', status: 'archived', startAt: NOV7_0900_SH, endAt: null })]);
    expect(groups).toEqual([]);
  });

  it('同一 id 重复出现只保留首见', () => {
    const first = makeItem({ id: 'a', startAt: NOV7_0900_SH, endAt: null, title: 'first' });
    const groups = groupFor([first, { ...first, title: 'dup' }]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(1);
    expect(groups[0]?.items[0]?.title).toBe('first');
  });

  it('空输入返回 []', () => {
    expect(groupFor([])).toEqual([]);
  });

  it('无 item 的日期不产生组', () => {
    const groups = groupFor([makeItem({ id: 'a', startAt: NOV13_1200_SH, endAt: null })]);
    expect(groups.map((g) => g.key)).toEqual(['2026-11-13']);
  });
});
