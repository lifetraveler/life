import { overlapsRange } from '../overlaps';
import type { Item } from '../../item';

/** 最小夹具：overlapsRange 只依赖 startAt/endAt。 */
function makeTimeFields(startAt: number | null, endAt: number | null): Pick<Item, 'startAt' | 'endAt'> {
  return { startAt, endAt };
}

describe('overlapsRange（范围 [1000, 2000)，左闭右开）', () => {
  const rs = 1000;
  const re = 2000;

  it('startAt 为 null 恒 false（未安排不进时间范围）', () => {
    expect(overlapsRange(makeTimeFields(null, null), rs, re)).toBe(false);
    expect(overlapsRange(makeTimeFields(null, 1500), rs, re)).toBe(false);
  });

  it('startAt === rangeStart 命中（含下界）', () => {
    expect(overlapsRange(makeTimeFields(rs, null), rs, re)).toBe(true);
  });

  it('startAt === rangeEnd 不命中（不含上界）', () => {
    expect(overlapsRange(makeTimeFields(re, null), rs, re)).toBe(false);
  });

  it('startAt 在范围内命中', () => {
    expect(overlapsRange(makeTimeFields(1500, 1600), rs, re)).toBe(true);
  });

  it('跨天：startAt < rs 且 endAt > rs 命中', () => {
    expect(overlapsRange(makeTimeFields(500, 1500), rs, re)).toBe(true);
  });

  it('跨天完全覆盖范围：startAt < rs 且 endAt >= re 命中', () => {
    expect(overlapsRange(makeTimeFields(500, re), rs, re)).toBe(true);
    expect(overlapsRange(makeTimeFields(500, 9000), rs, re)).toBe(true);
  });

  it('在范围开始前已结束不命中（endAt === rs 不含）', () => {
    expect(overlapsRange(makeTimeFields(500, rs), rs, re)).toBe(false);
    expect(overlapsRange(makeTimeFields(500, 999), rs, re)).toBe(false);
  });

  it('跨天但 endAt 为 null 不命中（无结束时间不外推）', () => {
    expect(overlapsRange(makeTimeFields(500, null), rs, re)).toBe(false);
  });

  it('startAt 在范围之后不命中', () => {
    expect(overlapsRange(makeTimeFields(2001, null), rs, re)).toBe(false);
  });

  it('零时长 Item 落在 rangeStart 上命中（startAt ∈ [rs, re) 判定，repository.md 冻结条件）', () => {
    expect(overlapsRange(makeTimeFields(rs, rs), rs, re)).toBe(true);
  });
});
