import {
  assertValidItemTimePatch,
  assertValidItemTimeRange,
  assertValidItemTimestamp,
} from '../itemTimeRules';

describe('itemTimeRules（AGENTS.md §4.24）', () => {
  describe('assertValidItemTimestamp', () => {
    it('有限数字与 null/undefined 均通过', () => {
      expect(() => assertValidItemTimestamp(0, 'startAt')).not.toThrow();
      expect(() => assertValidItemTimestamp(1749427200000, 'startAt')).not.toThrow();
      expect(() => assertValidItemTimestamp(null, 'startAt')).not.toThrow();
      expect(() => assertValidItemTimestamp(undefined, 'startAt')).not.toThrow();
      expect(() => assertValidItemTimestamp(-1, 'endAt')).not.toThrow();
    });

    it('NaN / Infinity 抛含字段名的明确错误', () => {
      expect(() => assertValidItemTimestamp(Number.NaN, 'startAt')).toThrow(
        'updateItemTime: startAt must be a finite number or null',
      );
      expect(() => assertValidItemTimestamp(Number.POSITIVE_INFINITY, 'endAt')).toThrow(
        'updateItemTime: endAt must be a finite number or null',
      );
      expect(() => assertValidItemTimestamp(Number.NEGATIVE_INFINITY, 'startAt')).toThrow(
        'updateItemTime: startAt must be a finite number or null',
      );
    });
  });

  describe('assertValidItemTimeRange（endAt >= startAt）', () => {
    it('任一为 null/undefined 时不校验', () => {
      expect(() => assertValidItemTimeRange(null, 100)).not.toThrow();
      expect(() => assertValidItemTimeRange(100, null)).not.toThrow();
      expect(() => assertValidItemTimeRange(null, null)).not.toThrow();
      expect(() => assertValidItemTimeRange(undefined, 100)).not.toThrow();
    });

    it('endAt > startAt 与 endAt == startAt 均合法', () => {
      expect(() => assertValidItemTimeRange(1000, 2000)).not.toThrow();
      expect(() => assertValidItemTimeRange(1000, 1000)).not.toThrow();
    });

    it('endAt < startAt 抛明确错误', () => {
      expect(() => assertValidItemTimeRange(2000, 1000)).toThrow(
        'updateItemTime: endAt (1000) must be >= startAt (2000) when both are set',
      );
    });
  });

  describe('assertValidItemTimePatch', () => {
    it('patch 内出现且非法的字段抛错；未出现的字段不参与', () => {
      expect(() => assertValidItemTimePatch({})).not.toThrow();
      expect(() => assertValidItemTimePatch({ startAt: null })).not.toThrow();
      expect(() => assertValidItemTimePatch({ startAt: Number.NaN })).toThrow(/startAt/);
      expect(() => assertValidItemTimePatch({ endAt: Number.NaN })).toThrow(/endAt/);
      // patch 本身不做区间校验（startAt/endAt 合法但区间矛盾）——区间校验在合并既有值后进行
      expect(() => assertValidItemTimePatch({ startAt: 2000, endAt: 1000 })).not.toThrow();
    });
  });
});
