import {
  getMonthRange,
  getTodayRange,
  getWeekRange,
  getWeekStart,
  nthMondayDateOfMonth,
  weekIndexInMonth,
} from '../ranges';
import { getZonedParts, resolveCivilTimeToInstant } from '../../recurrence/civilTime';

/**
 * 期望值全部用 Date.UTC + 固定偏移独立构造（Asia/Shanghai 恒 +8；
 * America/New_York 冬 -5 / 夏 -4，DST 2026-03-08 开始、2026-11-01 结束），
 * 不经被测函数、不读系统时区；另用 resolveCivilTimeToInstant 做交叉校验。
 */

/** UTC+8 固定偏移：当地 00:00 的绝对时刻 */
const shanghaiMidnightUtc = (y: number, m: number, d: number): number =>
  Date.UTC(y, m - 1, d) - 8 * 3_600_000;

/** NY 当地 00:00：冬季(EST)偏移 -5 */
const nyMidnightEstUtc = (y: number, m: number, d: number): number =>
  Date.UTC(y, m - 1, d) + 5 * 3_600_000;

/** NY 当地 00:00：夏季(EDT)偏移 -4 */
const nyMidnightEdtUtc = (y: number, m: number, d: number): number =>
  Date.UTC(y, m - 1, d) + 4 * 3_600_000;

describe('getTodayRange（Asia/Shanghai，恒定 +8）', () => {
  it('当天 00:00–次日 00:00', () => {
    const now = Date.UTC(2026, 2, 15, 12, 0) - 8 * 3_600_000; // 当地 2026-03-15 12:00
    expect(getTodayRange(now, 'Asia/Shanghai')).toEqual({
      startMs: shanghaiMidnightUtc(2026, 3, 15),
      endMs: shanghaiMidnightUtc(2026, 3, 16),
    });
  });

  it('跨月边界', () => {
    const now = Date.UTC(2026, 2, 31, 23, 59) - 8 * 3_600_000;
    expect(getTodayRange(now, 'Asia/Shanghai')).toEqual({
      startMs: shanghaiMidnightUtc(2026, 3, 31),
      endMs: shanghaiMidnightUtc(2026, 4, 1),
    });
  });

  it('跨年边界', () => {
    const now = Date.UTC(2025, 11, 31, 23, 0) - 8 * 3_600_000;
    expect(getTodayRange(now, 'Asia/Shanghai')).toEqual({
      startMs: shanghaiMidnightUtc(2025, 12, 31),
      endMs: shanghaiMidnightUtc(2026, 1, 1),
    });
  });

  it('与 resolveCivilTimeToInstant 交叉一致', () => {
    const now = Date.UTC(2026, 6, 20, 8, 0) - 8 * 3_600_000;
    const range = getTodayRange(now, 'Asia/Shanghai');
    expect(range.startMs).toBe(resolveCivilTimeToInstant('Asia/Shanghai', 2026, 7, 20, 0, 0));
    expect(range.endMs).toBe(resolveCivilTimeToInstant('Asia/Shanghai', 2026, 7, 21, 0, 0));
  });
});

describe('getTodayRange（America/New_York，DST）', () => {
  it('冬季按 EST（UTC-5）取当天 00:00', () => {
    const now = Date.UTC(2026, 0, 20, 17, 0); // 当地 2026-01-20 12:00 EST
    expect(getTodayRange(now, 'America/New_York')).toEqual({
      startMs: nyMidnightEstUtc(2026, 1, 20),
      endMs: nyMidnightEstUtc(2026, 1, 21),
    });
  });

  it('夏季按 EDT（UTC-4）取当天 00:00', () => {
    const now = Date.UTC(2026, 6, 10, 16, 0); // 当地 2026-07-10 12:00 EDT
    expect(getTodayRange(now, 'America/New_York')).toEqual({
      startMs: nyMidnightEdtUtc(2026, 7, 10),
      endMs: nyMidnightEdtUtc(2026, 7, 11),
    });
  });

  it('春令时当天范围长 23 小时（2026-03-08）', () => {
    const now = Date.UTC(2026, 2, 8, 16, 0); // 当地 2026-03-08 12:00 EDT（02:00 已跳变）
    const range = getTodayRange(now, 'America/New_York');
    expect(range.startMs).toBe(nyMidnightEstUtc(2026, 3, 8)); // 跳变前 00:00 仍是 EST
    expect(range.endMs).toBe(nyMidnightEdtUtc(2026, 3, 9));
    expect(range.endMs - range.startMs).toBe(23 * 3_600_000);
  });

  it('秋令时当天范围长 25 小时（2026-11-01）', () => {
    const now = Date.UTC(2026, 10, 1, 17, 0); // 当地 2026-11-01 12:00 EST（02:00 已回拨）
    const range = getTodayRange(now, 'America/New_York');
    expect(range.startMs).toBe(nyMidnightEdtUtc(2026, 11, 1)); // 回拨前 00:00 仍是 EDT
    expect(range.endMs).toBe(nyMidnightEstUtc(2026, 11, 2));
    expect(range.endMs - range.startMs).toBe(25 * 3_600_000);
  });
});

describe('getWeekRange（周一起点）', () => {
  it('Asia/Shanghai：周中取本周一', () => {
    const now = Date.UTC(2026, 2, 18, 12, 0) - 8 * 3_600_000; // 当地 2026-03-18 周三
    expect(getWeekRange(now, 'Asia/Shanghai')).toEqual({
      startMs: shanghaiMidnightUtc(2026, 3, 16),
      endMs: shanghaiMidnightUtc(2026, 3, 23),
    });
  });

  it('Asia/Shanghai：当天即周一', () => {
    const now = Date.UTC(2026, 2, 16, 12, 0) - 8 * 3_600_000; // 2026-03-16 周一
    expect(getWeekRange(now, 'Asia/Shanghai')).toEqual({
      startMs: shanghaiMidnightUtc(2026, 3, 16),
      endMs: shanghaiMidnightUtc(2026, 3, 23),
    });
  });

  it('Asia/Shanghai：周日回退 6 天到本周一', () => {
    const now = Date.UTC(2026, 2, 15, 12, 0) - 8 * 3_600_000; // 2026-03-15 周日
    expect(getWeekRange(now, 'Asia/Shanghai')).toEqual({
      startMs: shanghaiMidnightUtc(2026, 3, 9),
      endMs: shanghaiMidnightUtc(2026, 3, 16),
    });
  });

  it('跨月周（3-30 周一 → 4-6 下周一）', () => {
    const now = Date.UTC(2026, 2, 31, 12, 0) - 8 * 3_600_000; // 2026-03-31 周二
    expect(getWeekRange(now, 'Asia/Shanghai')).toEqual({
      startMs: shanghaiMidnightUtc(2026, 3, 30),
      endMs: shanghaiMidnightUtc(2026, 4, 6),
    });
  });

  it('跨年周（2026-01-01 周四 → 2025-12-29 周一起）', () => {
    const now = Date.UTC(2026, 0, 1, 17, 0); // 当地 2026-01-01 12:00 EST
    expect(getWeekRange(now, 'America/New_York')).toEqual({
      startMs: nyMidnightEstUtc(2025, 12, 29),
      endMs: nyMidnightEstUtc(2026, 1, 5),
    });
  });

  it('DST 落在周内（3-02 周一 EST 起，3-09 周一 EDT 止）', () => {
    const now = Date.UTC(2026, 2, 5, 17, 0); // 当地 2026-03-05 12:00 EST（周四）
    expect(getWeekRange(now, 'America/New_York')).toEqual({
      startMs: nyMidnightEstUtc(2026, 3, 2),
      endMs: nyMidnightEdtUtc(2026, 3, 9),
    });
  });

  it('范围起点民用日期确实是周一', () => {
    const now = Date.UTC(2026, 8, 23, 12, 0) - 8 * 3_600_000; // 2026-09-23 周三
    const range = getWeekRange(now, 'Asia/Shanghai');
    expect(getZonedParts(range.startMs, 'Asia/Shanghai').weekday).toBe(1);
    expect(getZonedParts(range.endMs, 'Asia/Shanghai').weekday).toBe(1);
  });
});

describe('getMonthRange（切片 14 阶段 4：本月视图）', () => {
  it('Asia/Shanghai：月中取当月 1 日至次月 1 日', () => {
    const now = Date.UTC(2026, 2, 18, 12, 0) - 8 * 3_600_000; // 当地 2026-03-18 12:00
    expect(getMonthRange(now, 'Asia/Shanghai')).toEqual({
      startMs: shanghaiMidnightUtc(2026, 3, 1),
      endMs: shanghaiMidnightUtc(2026, 4, 1),
    });
  });

  it('Asia/Shanghai：当天即 1 日', () => {
    const now = Date.UTC(2026, 2, 1, 4, 0) - 8 * 3_600_000; // 当地 2026-03-01 04:00
    expect(getMonthRange(now, 'Asia/Shanghai')).toEqual({
      startMs: shanghaiMidnightUtc(2026, 3, 1),
      endMs: shanghaiMidnightUtc(2026, 4, 1),
    });
  });

  it('跨年：12 月 → 次年 1 月', () => {
    const now = Date.UTC(2025, 11, 31, 15, 0) - 8 * 3_600_000; // 当地 2025-12-31 23:00
    expect(getMonthRange(now, 'Asia/Shanghai')).toEqual({
      startMs: shanghaiMidnightUtc(2025, 12, 1),
      endMs: shanghaiMidnightUtc(2026, 1, 1),
    });
  });

  it('2 月（平年 28 天）边界', () => {
    const now = Date.UTC(2026, 1, 15, 12, 0) - 8 * 3_600_000; // 当地 2026-02-15（2026 平年）
    expect(getMonthRange(now, 'Asia/Shanghai')).toEqual({
      startMs: shanghaiMidnightUtc(2026, 2, 1),
      endMs: shanghaiMidnightUtc(2026, 3, 1),
    });
  });

  it('America/New_York：DST 月（3 月）起点 EST、终点 EDT，范围短 1 小时', () => {
    const now = Date.UTC(2026, 2, 20, 16, 0); // 当地 2026-03-20 12:00 EDT
    const range = getMonthRange(now, 'America/New_York');
    expect(range).toEqual({
      startMs: nyMidnightEstUtc(2026, 3, 1), // 3-01 仍在 EST（2026 DST 3-08 起）
      endMs: nyMidnightEdtUtc(2026, 4, 1),
    });
    expect(range.endMs - range.startMs).toBe(31 * 24 * 3_600_000 - 3_600_000);
  });

  it('与 resolveCivilTimeToInstant 交叉一致', () => {
    const now = Date.UTC(2026, 10, 8, 2, 0) - 8 * 3_600_000; // 当地 2026-11-08 10:00
    const range = getMonthRange(now, 'Asia/Shanghai');
    expect(range.startMs).toBe(resolveCivilTimeToInstant('Asia/Shanghai', 2026, 11, 1, 0, 0));
    expect(range.endMs).toBe(resolveCivilTimeToInstant('Asia/Shanghai', 2026, 12, 1, 0, 0));
  });
});

describe('非法 tzid', () => {
  it('非 IANA 或固定偏移抛错', () => {
    expect(() => getTodayRange(0, 'Not/AZone')).toThrow(/time zone/i);
    expect(() => getWeekRange(0, '+08:00')).toThrow(/IANA/);
    expect(() => getMonthRange(0, 'Not/AZone')).toThrow(/time zone/i);
  });
});

describe('午夜 gap 时区（America/Havana，春令时跳过民用 00:00）', () => {
  it('当天起点取当天最早存在的整点（01:00），范围长 23 小时', () => {
    // 2026-03-08（3 月第二个周日）Havana 00:00 → 01:00 跳变，民用 00:00 不存在。
    const now = Date.UTC(2026, 2, 8, 17, 0); // 当地 2026-03-08 12:00（DST，UTC-4）
    const range = getTodayRange(now, 'America/Havana');
    const startParts = getZonedParts(range.startMs, 'America/Havana');
    expect(startParts).toMatchObject({ year: 2026, month: 3, day: 8, hour: 1, minute: 0 });
    expect(range.endMs - range.startMs).toBe(23 * 3_600_000);
  });
});

describe('测试时区隔离（结果与 process.env.TZ 无关）', () => {
  const originalTz = process.env.TZ;

  const nowShanghai = Date.UTC(2026, 2, 18, 12, 0) - 8 * 3_600_000;
  const nowNy = Date.UTC(2026, 0, 1, 17, 0);
  const todayShanghai = getTodayRange(nowShanghai, 'Asia/Shanghai');
  const weekNy = getWeekRange(nowNy, 'America/New_York');

  const restore = (): void => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  };

  afterAll(restore);

  it('切换系统 TZ 后范围函数结果不变', () => {
    try {
      process.env.TZ = 'Pacific/Kiritimati';
      const firstToday = getTodayRange(nowShanghai, 'Asia/Shanghai');
      const firstWeek = getWeekRange(nowNy, 'America/New_York');

      process.env.TZ = 'America/Los_Angeles';
      const secondToday = getTodayRange(nowShanghai, 'Asia/Shanghai');
      const secondWeek = getWeekRange(nowNy, 'America/New_York');

      expect(firstToday).toEqual(todayShanghai);
      expect(firstWeek).toEqual(weekNy);
      expect(secondToday).toEqual(todayShanghai);
      expect(secondWeek).toEqual(weekNy);
    } finally {
      restore();
    }
  });
});

/* ===== 切片 14 阶段 5b：getSevenDayWindow / getDayRange / getMonthRangeForCivil / shiftCivilMonth ===== */

import {
  getDayRange,
  getMonthRangeForCivil,
  getSevenDayWindow,
  shiftAnchorDay,
  shiftCivilMonth,
} from '../ranges';

describe('getSevenDayWindow（Asia/Shanghai，恒定 +8）', () => {
  it('锚点当日 00:00 起，恰含 7 个民用日（6 天后 00:00 结束）', () => {
    // 当地 2026-11-07 12:00+08
    const anchor = Date.UTC(2026, 10, 7, 4, 0);
    expect(getSevenDayWindow(anchor, 'Asia/Shanghai')).toEqual({
      startMs: shanghaiMidnightUtc(2026, 11, 7),
      endMs: shanghaiMidnightUtc(2026, 11, 14),
    });
  });

  it('跨月边界（11-28 起 7 天 → 12-05）', () => {
    const anchor = Date.UTC(2026, 10, 28, 10, 0) - 8 * 3_600_000;
    expect(getSevenDayWindow(anchor, 'Asia/Shanghai')).toEqual({
      startMs: shanghaiMidnightUtc(2026, 11, 28),
      endMs: shanghaiMidnightUtc(2026, 12, 5),
    });
  });

  it('跨年边界（12-29 起 7 天 → 次年 1-05）', () => {
    const anchor = Date.UTC(2026, 11, 29, 8, 0) - 8 * 3_600_000;
    expect(getSevenDayWindow(anchor, 'Asia/Shanghai')).toEqual({
      startMs: shanghaiMidnightUtc(2026, 12, 29),
      endMs: shanghaiMidnightUtc(2027, 1, 5),
    });
  });

  it('与 resolveDayStart 交叉一致：startMs = 当日 00:00', () => {
    const anchor = Date.UTC(2026, 10, 7, 4, 0);
    const range = getSevenDayWindow(anchor, 'Asia/Shanghai');
    expect(range.startMs).toBe(resolveCivilTimeToInstant('Asia/Shanghai', 2026, 11, 7, 0, 0));
  });
});

describe('getSevenDayWindow（America/New_York，DST）', () => {
  it('DST 切换日所在窗：窗内恰 7 个民用日但绝对时长 167 小时（11-01 EDT→EST）', () => {
    // 窗口 2026-10-29 ~ 11-05 含 DST 结束（11-01 02:00 回拨 1 小时），
    // 各日 00:00 仍由 resolveDayStart 取民用日界，10-29 为 EDT（-4），11-01 起为 EST（-5）。
    const anchor = Date.UTC(2026, 9, 29, 12, 0) + 4 * 3_600_000; // 当地 10-29 12:00 EDT
    expect(getSevenDayWindow(anchor, 'America/New_York')).toEqual({
      startMs: nyMidnightEdtUtc(2026, 10, 29),
      endMs: nyMidnightEstUtc(2026, 11, 5),
    });
  });
});

describe('getDayRange（Asia/Shanghai）', () => {
  it('锚点所在日 00:00–次日 00:00', () => {
    const anchor = Date.UTC(2026, 10, 7, 15, 0) - 8 * 3_600_000; // 当地 23:00
    expect(getDayRange(anchor, 'Asia/Shanghai')).toEqual({
      startMs: shanghaiMidnightUtc(2026, 11, 7),
      endMs: shanghaiMidnightUtc(2026, 11, 8),
    });
  });

  it('与 getTodayRange 同锚等价（today 语义由 getDayRange 参数化承接）', () => {
    const anchor = Date.UTC(2026, 10, 7, 4, 0);
    expect(getDayRange(anchor, 'Asia/Shanghai')).toEqual(getTodayRange(anchor, 'Asia/Shanghai'));
  });
});

describe('getMonthRangeForCivil / shiftCivilMonth', () => {
  it('getMonthRangeForCivil 与 getMonthRange 同月等价', () => {
    const now = Date.UTC(2026, 10, 7, 4, 0);
    expect(getMonthRangeForCivil('Asia/Shanghai', 2026, 11)).toEqual(getMonthRange(now, 'Asia/Shanghai'));
  });

  it('getMonthRangeForCivil：12 月跨年（2026-12 → 2027-01-01）', () => {
    expect(getMonthRangeForCivil('Asia/Shanghai', 2026, 12)).toEqual({
      startMs: shanghaiMidnightUtc(2026, 12, 1),
      endMs: shanghaiMidnightUtc(2027, 1, 1),
    });
  });

  it('shiftCivilMonth：同年内 ±1', () => {
    expect(shiftCivilMonth({ year: 2026, month: 3 }, 1)).toEqual({ year: 2026, month: 4 });
    expect(shiftCivilMonth({ year: 2026, month: 3 }, -1)).toEqual({ year: 2026, month: 2 });
  });

  it('shiftCivilMonth：跨年归一（2026-01 -1 → 2025-12；2025-12 +1 → 2026-01）', () => {
    expect(shiftCivilMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftCivilMonth({ year: 2025, month: 12 }, 1)).toEqual({ year: 2026, month: 1 });
  });

  it('shiftCivilMonth：跨 13 个月（2026-01 -13 → 2024-12；2026-06 +13 → 2027-07）', () => {
    expect(shiftCivilMonth({ year: 2026, month: 1 }, -13)).toEqual({ year: 2024, month: 12 });
    expect(shiftCivilMonth({ year: 2026, month: 6 }, 13)).toEqual({ year: 2027, month: 7 });
  });
});

describe('shiftAnchorDay（Asia/Shanghai，恒定 +8）', () => {
  it('±1 / ±7 天民用日精确步进（返回新日 00:00）', () => {
    const anchor = Date.UTC(2026, 10, 7, 4, 0); // 当地 2026-11-07 12:00
    expect(shiftAnchorDay(anchor, 'Asia/Shanghai', 1)).toBe(shanghaiMidnightUtc(2026, 11, 8));
    expect(shiftAnchorDay(anchor, 'Asia/Shanghai', -1)).toBe(shanghaiMidnightUtc(2026, 11, 6));
    expect(shiftAnchorDay(anchor, 'Asia/Shanghai', 7)).toBe(shanghaiMidnightUtc(2026, 11, 14));
    expect(shiftAnchorDay(anchor, 'Asia/Shanghai', -7)).toBe(shanghaiMidnightUtc(2026, 10, 31));
  });
});

describe('shiftAnchorDay（America/New_York，DST）', () => {
  it('25h 日（2026-03-08 春令时）±1 天不漂移：3-08 +1 → 3-09、3-08 -1 → 3-07', () => {
    // 当地 2026-03-08 14:00 EDT（那天只有 23 个民用小时，绝对时长 23h）
    const anchor = Date.UTC(2026, 2, 8, 18, 0);
    expect(shiftAnchorDay(anchor, 'America/New_York', 1)).toBe(nyMidnightEdtUtc(2026, 3, 9));
    expect(shiftAnchorDay(anchor, 'America/New_York', -1)).toBe(nyMidnightEstUtc(2026, 3, 7));
  });

  it('23h 日（2026-11-01 秋令时）±1 天不漂移：11-01 +1 → 11-02、11-02 -1 → 11-01', () => {
    const anchor = Date.UTC(2026, 10, 1, 17, 0); // 当地 2026-11-01 12:00 EST（那天民用 24 小时、绝对 25h）
    expect(shiftAnchorDay(anchor, 'America/New_York', 1)).toBe(nyMidnightEstUtc(2026, 11, 2));
    expect(shiftAnchorDay(anchor, 'America/New_York', -1)).toBe(nyMidnightEdtUtc(2026, 10, 31));
  });
});

describe('getWeekStart（Asia/Shanghai，自然周周一 00:00）', () => {
  it('周中/周末锚点都归到同一周一；周日归上一周（2026-11-09 为周一）', () => {
    const monday = Date.UTC(2026, 10, 9, 4, 0); // 当地 2026-11-09（周一）12:00
    const friday = Date.UTC(2026, 10, 13, 4, 0); // 2026-11-13（周五）
    const sunday = Date.UTC(2026, 10, 8, 4, 0); // 2026-11-08（周日）
    expect(getWeekStart(monday, 'Asia/Shanghai')).toBe(shanghaiMidnightUtc(2026, 11, 9));
    expect(getWeekStart(friday, 'Asia/Shanghai')).toBe(shanghaiMidnightUtc(2026, 11, 9));
    expect(getWeekStart(sunday, 'Asia/Shanghai')).toBe(shanghaiMidnightUtc(2026, 11, 2));
  });

  it('getWeekStart ≡ getWeekRange.startMs', () => {
    const anchor = Date.UTC(2026, 10, 11, 2, 0);
    expect(getWeekStart(anchor, 'Asia/Shanghai')).toBe(getWeekRange(anchor, 'Asia/Shanghai').startMs);
  });
});

describe('weekIndexInMonth / nthMondayDateOfMonth（年月选择器周联动，2026-11-01 为周日、首个周一 11-02）', () => {
  it('周序：周一与周日同周；第二个周一 → 2', () => {
    const firstMonday = Date.UTC(2026, 10, 2, 4, 0); // 2026-11-02 周一（11 月第一个周一）
    const firstSunday = Date.UTC(2026, 10, 8, 4, 0); // 2026-11-08 周日（同一自然周）
    const secondMonday = Date.UTC(2026, 10, 9, 4, 0); // 2026-11-09 周一
    expect(weekIndexInMonth(firstMonday, 'Asia/Shanghai')).toBe(1);
    expect(weekIndexInMonth(firstSunday, 'Asia/Shanghai')).toBe(1);
    expect(weekIndexInMonth(secondMonday, 'Asia/Shanghai')).toBe(2);
  });

  it('周一落在上月时按周一所在月计序（2026-08-01 周六 → 周一 07-27，7 月第 4 周）', () => {
    const anchor = Date.UTC(2026, 7, 1, 4, 0); // 当地 2026-08-01（周六）
    expect(weekIndexInMonth(anchor, 'Asia/Shanghai')).toBe(4);
  });

  it('nthMondayDateOfMonth：11 月第 1/2 周 → 11-02 / 11-09', () => {
    expect(nthMondayDateOfMonth('Asia/Shanghai', 2026, 11, 1)).toEqual({
      year: 2026,
      month: 11,
      day: 2,
    });
    expect(nthMondayDateOfMonth('Asia/Shanghai', 2026, 11, 2)).toEqual({
      year: 2026,
      month: 11,
      day: 9,
    });
  });

  it('nthMondayDateOfMonth：2 月只有 4 个周一，weekIndex=5 回退到最后一周（2026-02-23）', () => {
    expect(nthMondayDateOfMonth('Asia/Shanghai', 2026, 2, 5)).toEqual({
      year: 2026,
      month: 2,
      day: 23,
    });
  });

  it('nthMondayDateOfMonth：12 月第 4 周跨年（2026-12-28）', () => {
    expect(nthMondayDateOfMonth('Asia/Shanghai', 2026, 12, 4)).toEqual({
      year: 2026,
      month: 12,
      day: 28,
    });
  });

  it('roundtrip：11 月第 2 周锚点选 12 月 → 12 月第 2 周周一（12-14）', () => {
    const anchor = Date.UTC(2026, 10, 10, 4, 0); // 2026-11-10（周二，所在周周一 11-09 = 11 月第 2 周）
    const index = weekIndexInMonth(anchor, 'Asia/Shanghai');
    expect(index).toBe(2);
    const target = nthMondayDateOfMonth('Asia/Shanghai', 2026, 12, index);
    expect(target).toEqual({ year: 2026, month: 12, day: 14 });
  });
});
