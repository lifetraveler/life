import {
  addOneDay,
  daysInMonth,
  formatLocalDate,
  formatLocalTime,
  getCivilWeekday,
  getZonedParts,
  resolveCivilTimeToInstant,
} from '../civilTime';

describe('civilTime：民用时间解析', () => {
  it('普通民用时间按显式 tzid 解析为绝对时刻', () => {
    expect(resolveCivilTimeToInstant('Asia/Shanghai', 2025, 6, 1, 9, 0)).toBe(
      Date.UTC(2025, 5, 1, 1, 0),
    );
  });

  it('春季 gap：不存在的本地时间返回 null', () => {
    expect(
      resolveCivilTimeToInstant('America/New_York', 2025, 3, 9, 2, 30),
    ).toBeNull();
  });

  it('秋季 fold：重复本地时间取较早的瞬间', () => {
    expect(
      resolveCivilTimeToInstant('America/New_York', 2025, 11, 2, 1, 30),
    ).toBe(Date.UTC(2025, 10, 2, 5, 30));
  });
});

describe('civilTime：纯日历工具', () => {
  it('daysInMonth 正确处理闰年与非闰年', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2025, 4)).toBe(30);
    expect(daysInMonth(2025, 12)).toBe(31);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
  });

  it('addOneDay 正确跨月、跨年', () => {
    expect(addOneDay({ year: 2025, month: 2, day: 28 })).toEqual({
      year: 2025,
      month: 3,
      day: 1,
    });
    expect(addOneDay({ year: 2024, month: 2, day: 28 })).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
    expect(addOneDay({ year: 2025, month: 12, day: 31 })).toEqual({
      year: 2026,
      month: 1,
      day: 1,
    });
  });

  it('formatLocalDate / formatLocalTime 补零', () => {
    expect(formatLocalDate({ year: 2025, month: 3, day: 9 })).toBe('2025-03-09');
    expect(formatLocalTime(2, 5)).toBe('02:05');
    expect(formatLocalTime(23, 59)).toBe('23:59');
  });

  it('getCivilWeekday 使用 1=周一 … 7=周日', () => {
    expect(getCivilWeekday({ year: 2025, month: 3, day: 9 })).toBe(7);
    expect(getCivilWeekday({ year: 2025, month: 3, day: 10 })).toBe(1);
  });

  it('getZonedParts 返回指定 tzid 的民用字段与星期', () => {
    const parts = getZonedParts(Date.UTC(2025, 10, 2, 5, 30), 'America/New_York');
    expect(parts).toEqual({
      year: 2025,
      month: 11,
      day: 2,
      hour: 1,
      minute: 30,
      weekday: 7,
    });
  });
});
