import { normalizeAllDayTimestamps } from '../allDayNormalize';

/**
 * 切片 8：allDay 时刻归一化纯函数单测（handoff §2.2 / AGENTS.md §4.23）。
 * 期望值均以显式 UTC 毫秒表达，不依赖测试机时区。
 */
describe('normalizeAllDayTimestamps（切片 8）', () => {
  describe('不需要归一化的输入原样返回', () => {
    it('allDay=false 时 startAt/endAt 原样透传', () => {
      const result = normalizeAllDayTimestamps(1000, 2000, false, 'Asia/Shanghai');
      expect(result).toEqual({ startAt: 1000, endAt: 2000 });
    });

    it('allDay=true 但 startAt=null 时原样透传（null 不动）', () => {
      const result = normalizeAllDayTimestamps(null, null, true, 'Asia/Shanghai');
      expect(result).toEqual({ startAt: null, endAt: null });
    });

    it('endAt 契约未约束、任何情况下不改', () => {
      const result = normalizeAllDayTimestamps(
        Date.UTC(2026, 10, 10, 2, 30),
        Date.UTC(2026, 10, 10, 4, 0),
        true,
        'Asia/Shanghai',
      );
      expect(result.endAt).toBe(Date.UTC(2026, 10, 10, 4, 0));
    });
  });

  describe('allDay=true 时 startAt 归一为 tzid 当天 00:00', () => {
    it('Asia/Shanghai：10:30 +08 当天 → 当天 00:00 +08', () => {
      // 2026-11-10 10:30 +08:00
      const startAt = Date.UTC(2026, 10, 10, 2, 30);
      const result = normalizeAllDayTimestamps(startAt, null, true, 'Asia/Shanghai');
      // 2026-11-10 00:00 +08:00
      expect(result.startAt).toBe(Date.UTC(2026, 10, 9, 16, 0));
    });

    it('America/New_York 夏令时：14:00 EDT → 当天 00:00 EDT（04:00Z）', () => {
      // 2026-07-15 14:00 -04:00
      const startAt = Date.UTC(2026, 6, 15, 18, 0);
      const result = normalizeAllDayTimestamps(startAt, null, true, 'America/New_York');
      // 2026-07-15 00:00 -04:00
      expect(result.startAt).toBe(Date.UTC(2026, 6, 15, 4, 0));
    });

    it('America/New_York 冬令时：14:00 EST → 当天 00:00 EST（05:00Z）', () => {
      // 2026-01-15 14:00 -05:00
      const startAt = Date.UTC(2026, 0, 15, 19, 0);
      const result = normalizeAllDayTimestamps(startAt, null, true, 'America/New_York');
      // 2026-01-15 00:00 -05:00
      expect(result.startAt).toBe(Date.UTC(2026, 0, 15, 5, 0));
    });

    it('已是当天 00:00 的输入幂等（再归一化不变）', () => {
      const dayStart = Date.UTC(2026, 10, 9, 16, 0); // 2026-11-10 00:00 +08
      const first = normalizeAllDayTimestamps(dayStart, null, true, 'Asia/Shanghai');
      expect(first.startAt).toBe(dayStart);
      const second = normalizeAllDayTimestamps(first.startAt, null, true, 'Asia/Shanghai');
      expect(second.startAt).toBe(dayStart);
    });
  });

  it('非法 tzid 抛明确错误（tzid 显式传入，不静默回退）', () => {
    expect(() => normalizeAllDayTimestamps(1000, null, true, 'Not/AZone')).toThrow();
  });
});
