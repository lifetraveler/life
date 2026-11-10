import { itemsByDay } from '../itemsByDay';
import type { ItemWithRelations } from '../../relations/itemWithRelations';

/**
 * 时区锚点（Asia/Shanghai = UTC+8；America/New_York 2026-11-01 起 EST = UTC-5）。
 * 全部时间用 Date.UTC 显式构造，不依赖测试机时区。
 */
const TZ_SH = 'Asia/Shanghai';
const TZ_NY = 'America/New_York';

const NOV7_0900_SH = Date.UTC(2026, 10, 7, 1, 0); // 2026-11-07 09:00+08
const NOV7_1000_SH = Date.UTC(2026, 10, 7, 2, 0); // 2026-11-07 10:00+08
const NOV8_1200_SH = Date.UTC(2026, 10, 8, 4, 0); // 2026-11-08 12:00+08
const NOV6_2100_NY = Date.UTC(2026, 10, 7, 2, 0); // 2026-11-06 21:00 EST（同一瞬间）

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

describe('itemsByDay：分桶与排序', () => {
  it('按 startAt 民用日分桶，桶内 startAt 升序', () => {
    const a = makeItem({ id: 'a', startAt: NOV8_1200_SH, endAt: null });
    const b = makeItem({ id: 'b', startAt: NOV7_1000_SH, endAt: null });
    const c = makeItem({ id: 'c', startAt: NOV7_0900_SH, endAt: null });
    const buckets = itemsByDay([a, b, c], TZ_SH);
    expect([...buckets.keys()]).toEqual(['2026-11-07', '2026-11-08']);
    expect(buckets.get('2026-11-07')?.map((it) => it.id)).toEqual(['c', 'b']);
    expect(buckets.get('2026-11-08')?.map((it) => it.id)).toEqual(['a']);
  });

  it('并列 startAt 按 createdAt 升序，再按 id 确定化', () => {
    const x = makeItem({ id: 'x', startAt: NOV7_0900_SH, endAt: null, createdAt: 20 });
    const y = makeItem({ id: 'y', startAt: NOV7_0900_SH, endAt: null, createdAt: 10 });
    const z = makeItem({ id: 'z', startAt: NOV7_0900_SH, endAt: null, createdAt: 10 });
    const buckets = itemsByDay([x, y, z], TZ_SH);
    expect(buckets.get('2026-11-07')?.map((it) => it.id)).toEqual(['y', 'z', 'x']);
  });

  it('startAt=null 的待办不进日历格子', () => {
    const buckets = itemsByDay([makeItem({ id: 'u', startAt: null })], TZ_SH);
    expect(buckets.size).toBe(0);
  });

  it('archived 排除；同 id 只收首见', () => {
    const dup = makeItem({ id: 'd', startAt: NOV7_0900_SH, endAt: null });
    const buckets = itemsByDay(
      [dup, { ...dup, title: 'dup2' }, makeItem({ id: 'r', startAt: NOV7_0900_SH, endAt: null, status: 'archived' })],
      TZ_SH,
    );
    expect(buckets.get('2026-11-07')).toHaveLength(1);
    expect(buckets.get('2026-11-07')?.[0]?.title).toBe('d');
  });
});

describe('itemsByDay：tzid 生效', () => {
  it('同一瞬间：上海归 11-07、纽约归 11-06', () => {
    const item = makeItem({ id: 'a', startAt: NOV6_2100_NY, endAt: null });
    expect([...itemsByDay([item], TZ_SH).keys()]).toEqual(['2026-11-07']);
    expect([...itemsByDay([item], TZ_NY).keys()]).toEqual(['2026-11-06']);
  });
});
