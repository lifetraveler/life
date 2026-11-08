import { DAY_TOTAL_MIN, layoutDayEvents } from '../dayTimeline';
import type { ItemWithRelations } from '../../relations/itemWithRelations';

/**
 * dayStartMs = 2026-11-07 00:00+08（Asia/Shanghai，恒 +8）。
 * 块坐标一律用「相对 dayStartMs 的分钟」直接构造（函数内部同为绝对时刻差，
 * 与 tzid 无关）；startAt 等时间戳用 Date.UTC 显式构造，不依赖测试机时区。
 */
const DAY_START = Date.UTC(2026, 10, 6, 16, 0); // 2026-11-07 00:00+08

const atMin = (min: number): number => DAY_START + min * 60_000;

function makeItem(overrides: Partial<ItemWithRelations> & { id: string }): ItemWithRelations {
  const base: Omit<ItemWithRelations, 'id'> = {
    type: 'event',
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

/** 便捷构造：当日 startMin..endMin 的事件。 */
const ev = (id: string, startMin: number, endMin: number, extra: Partial<ItemWithRelations> = {}) =>
  makeItem({ id, startAt: atMin(startMin), endAt: atMin(endMin), ...extra });

describe('layoutDayEvents：单块与平分', () => {
  it('单事件占满横宽（widthRatio=1）', () => {
    const layout = layoutDayEvents([ev('a', 540, 600)], DAY_START);
    expect(layout.timedBlocks).toEqual([
      { item: expect.objectContaining({ id: 'a' }), topMin: 540, heightMin: 60, leftRatio: 0, widthRatio: 1 },
    ]);
  });

  it('两个重叠事件各占半宽、不同 lane', () => {
    const layout = layoutDayEvents([ev('a', 540, 600), ev('b', 570, 630)], DAY_START);
    expect(layout.timedBlocks.map((b) => [b.item.id, b.topMin, b.leftRatio, b.widthRatio])).toEqual([
      ['a', 540, 0, 0.5],
      ['b', 570, 0.5, 0.5],
    ]);
  });

  it('链式重叠 A(9-10) B(9:30-10:30) C(10-11)：峰值并发 2 → 各半宽，C 复用 A 释放的通道', () => {
    const layout = layoutDayEvents([ev('a', 540, 600), ev('b', 570, 630), ev('c', 600, 660)], DAY_START);
    expect(layout.timedBlocks.map((b) => [b.item.id, b.leftRatio, b.widthRatio])).toEqual([
      ['a', 0, 0.5],
      ['b', 0.5, 0.5],
      ['c', 0, 0.5], // start=600 与 A end=600 相接不重叠 → 复用 lane 0；B end=630 > 600 → 与 C 同簇
    ]);
  });

  it('不重叠的两簇各自占满横宽', () => {
    const layout = layoutDayEvents([ev('a', 540, 600), ev('b', 600, 660)], DAY_START);
    // A end=600 = B start=600：相接不重叠 → B 独立成簇（满宽）
    expect(layout.timedBlocks.map((b) => [b.item.id, b.widthRatio])).toEqual([
      ['a', 1],
      ['b', 1],
    ]);
  });
});

describe('layoutDayEvents：裁剪与默认时长', () => {
  it('跨午夜事件裁剪到 [0, 1440]（前一天 23:00 → 次日 02:00）', () => {
    const cross = makeItem({
      id: 'x',
      startAt: atMin(-60), // 前一天 23:00（相对当天为 -60）
      endAt: atMin(DAY_TOTAL_MIN + 120), // 次日 02:00
    });
    const layout = layoutDayEvents([cross], DAY_START);
    expect(layout.timedBlocks).toEqual([
      { item: expect.objectContaining({ id: 'x' }), topMin: 0, heightMin: DAY_TOTAL_MIN, leftRatio: 0, widthRatio: 1 },
    ]);
  });

  it('无 endAt 的事件按 60 分钟呈现', () => {
    const layout = layoutDayEvents([makeItem({ id: 'a', startAt: atMin(540), endAt: null })], DAY_START);
    expect(layout.timedBlocks[0]).toMatchObject({ topMin: 540, heightMin: 60 });
  });

  it('不足 30 分钟的事件拉到 30 分钟（且不越过 1440）', () => {
    const layout = layoutDayEvents([ev('a', 1420, 1425)], DAY_START);
    expect(layout.timedBlocks[0]).toMatchObject({ topMin: 1420, heightMin: 20 });
  });
});

describe('layoutDayEvents：allDay 分离与防御', () => {
  it('allDay=true 进 allDayItems，不参与 lane；startAt=null 跳过；archived 排除', () => {
    const allDay = makeItem({ id: 'allday', startAt: DAY_START, endAt: atMin(DAY_TOTAL_MIN), allDay: true });
    const timed = ev('t', 540, 600);
    const unscheduled = makeItem({ id: 'u', startAt: null });
    const archived = ev('r', 600, 660, { status: 'archived' });
    const layout = layoutDayEvents([allDay, timed, unscheduled, archived], DAY_START);
    expect(layout.allDayItems.map((it) => it.id)).toEqual(['allday']);
    expect(layout.timedBlocks.map((b) => b.item.id)).toEqual(['t']);
  });

  it('allDay 项按 startAt 升序排列', () => {
    const a2 = makeItem({ id: 'a2', startAt: atMin(600), endAt: null, allDay: true });
    const a1 = makeItem({ id: 'a1', startAt: DAY_START, endAt: null, allDay: true });
    const layout = layoutDayEvents([a2, a1], DAY_START);
    expect(layout.allDayItems.map((it) => it.id)).toEqual(['a1', 'a2']);
  });
});
