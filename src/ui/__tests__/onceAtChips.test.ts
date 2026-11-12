import {
  onceAtPlusOneHour,
  onceAtPlusTenMinutes,
  onceAtTomorrowMorningNine,
} from '../onceAtChips';
import { getZonedParts, resolveCivilTimeToInstant } from '../../domain/recurrence/civilTime';

const SHANGHAI = 'Asia/Shanghai';
const NEW_YORK = 'America/New_York';

describe('onceAtChips（切片 17 阶段 2 快捷 Chips）', () => {
  describe('onceAtPlusTenMinutes', () => {
    it('普通时刻：+10 分钟仅在分钟位进位', () => {
      // 2026-03-10 09:52 +08:00
      const now = resolveCivilTimeToInstant(SHANGHAI, 2026, 3, 10, 9, 52) as number;
      const onceAt = onceAtPlusTenMinutes(now, SHANGHAI);
      expect(onceAt).toEqual({ year: 2026, month: 3, day: 10, hour: 10, minute: 2 });
    });

    it('跨日：23:55 +10 分钟得到次日 00:05', () => {
      const now = resolveCivilTimeToInstant(SHANGHAI, 2026, 3, 10, 23, 55) as number;
      const onceAt = onceAtPlusTenMinutes(now, SHANGHAI);
      expect(onceAt).toEqual({ year: 2026, month: 3, day: 11, hour: 0, minute: 5 });
    });

    it('月末 rollover：1月31日 23:55 +10 分钟得到 2月1日 00:05（02-30 不可能出现）', () => {
      const now = resolveCivilTimeToInstant(SHANGHAI, 2026, 1, 31, 23, 55) as number;
      const onceAt = onceAtPlusTenMinutes(now, SHANGHAI);
      expect(onceAt).toEqual({ year: 2026, month: 2, day: 1, hour: 0, minute: 5 });
    });
  });

  describe('onceAtPlusOneHour', () => {
    it('跨小时且跨日：23:30 +1 小时得到次日 00:30', () => {
      const now = resolveCivilTimeToInstant(NEW_YORK, 2026, 3, 10, 23, 30) as number;
      const onceAt = onceAtPlusOneHour(now, NEW_YORK);
      expect(onceAt).toEqual({ year: 2026, month: 3, day: 11, hour: 0, minute: 30 });
    });

    it('跨 DST 边界用绝对时长语义：纽约春季拨快日 01:30 EST +1 小时 → 03:30 EDT', () => {
      // 2026-03-08 01:30 EST（UTC-5）+1 小时 = 07:30 UTC = 03:30 EDT（UTC-4）
      const now = resolveCivilTimeToInstant(NEW_YORK, 2026, 3, 8, 1, 30) as number;
      const onceAt = onceAtPlusOneHour(now, NEW_YORK);
      expect(onceAt).toEqual({ year: 2026, month: 3, day: 8, hour: 3, minute: 30 });
    });
  });

  describe('onceAtTomorrowMorningNine', () => {
    it('普通日：今天 → 明天 09:00', () => {
      const now = resolveCivilTimeToInstant(SHANGHAI, 2026, 3, 10, 14, 23) as number;
      const onceAt = onceAtTomorrowMorningNine(now, SHANGHAI);
      expect(onceAt).toEqual({ year: 2026, month: 3, day: 11, hour: 9, minute: 0 });
    });

    it('月末 rollover：1月31日 → 2月1日 09:00', () => {
      const now = resolveCivilTimeToInstant(SHANGHAI, 2026, 1, 31, 23, 59) as number;
      const onceAt = onceAtTomorrowMorningNine(now, SHANGHAI);
      expect(onceAt).toEqual({ year: 2026, month: 2, day: 1, hour: 9, minute: 0 });
    });

    it('跨年：12月31日 → 次年1月1日 09:00', () => {
      const now = resolveCivilTimeToInstant(SHANGHAI, 2026, 12, 31, 8, 0) as number;
      const onceAt = onceAtTomorrowMorningNine(now, SHANGHAI);
      expect(onceAt).toEqual({ year: 2027, month: 1, day: 1, hour: 9, minute: 0 });
    });

    it('DST 切换日：纽约春季拨快日（2026-03-08）→ 03-09 09:00（民用日语义）', () => {
      const now = resolveCivilTimeToInstant(NEW_YORK, 2026, 3, 8, 12, 0) as number;
      const onceAt = onceAtTomorrowMorningNine(now, NEW_YORK);
      expect(onceAt).toEqual({ year: 2026, month: 3, day: 9, hour: 9, minute: 0 });
    });

    it('chips 产出的民用值经 resolveCivilTimeToInstant 必定可换算（非 gap）', () => {
      const now = resolveCivilTimeToInstant(NEW_YORK, 2026, 3, 7, 22, 0) as number;
      const onceAt = onceAtTomorrowMorningNine(now, NEW_YORK);
      const fireAt = resolveCivilTimeToInstant(
        NEW_YORK,
        onceAt.year,
        onceAt.month,
        onceAt.day,
        onceAt.hour,
        onceAt.minute,
      );
      expect(fireAt).not.toBeNull();
    });
  });

  describe('tzid 一致性', () => {
    it('同一 now 在不同 tzid 下得到各自正确的民用值', () => {
      // 2026-03-10 12:00 +08:00 = 04:00 UTC = 2026-03-10 00:00 纽约（EDT，3月8日已拨快）
      const now = resolveCivilTimeToInstant(SHANGHAI, 2026, 3, 10, 12, 0) as number;
      expect(onceAtPlusTenMinutes(now, SHANGHAI)).toEqual({
        year: 2026, month: 3, day: 10, hour: 12, minute: 10,
      });
      expect(onceAtPlusTenMinutes(now, NEW_YORK)).toEqual({
        year: 2026, month: 3, day: 10, hour: 0, minute: 10,
      });
      expect(getZonedParts(now, NEW_YORK).day).toBe(10);
    });
  });
});
