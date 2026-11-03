import {
  formatItemDate,
  formatItemEnd,
  formatItemStart,
  formatItemTime,
  formatReminderRuleSummary,
  getDeviceTzid,
} from '../timeFormat';

// 固定时刻（UTC 毫秒），民用结果按显式 tzid 断言，不依赖测试机时区。
const TS_2025_06_10_01Z = Date.UTC(2025, 5, 10, 1, 0); // Asia/Shanghai(+08): 2025-06-10 09:00；NY(EDT -4): 2025-06-09 21:00
const TS_2025_01_15_05Z = Date.UTC(2025, 0, 15, 5, 0); // NY(EST -5): 2025-01-15 00:00；Asia/Shanghai: 2025-01-15 13:00
const TS_2025_06_10_04Z = Date.UTC(2025, 5, 10, 4, 0); // NY(EDT -4): 2025-06-10 00:00

describe('timeFormat（切片 6 展示格式化，显式 tzid）', () => {
  it('getDeviceTzid 返回非空字符串', () => {
    const tzid = getDeviceTzid();
    expect(typeof tzid).toBe('string');
    expect(tzid.length).toBeGreaterThan(0);
  });

  it('formatItemTime：Asia/Shanghai (+08)', () => {
    expect(formatItemTime(TS_2025_06_10_01Z, 'Asia/Shanghai')).toBe('2025-06-10 09:00');
  });

  it('formatItemTime：America/New_York 夏令时（EDT -4）与冬令时（EST -5）', () => {
    expect(formatItemTime(TS_2025_06_10_04Z, 'America/New_York')).toBe('2025-06-10 00:00');
    expect(formatItemTime(TS_2025_01_15_05Z, 'America/New_York')).toBe('2025-01-15 00:00');
  });

  it('formatItemDate：只取日期部分', () => {
    expect(formatItemDate(TS_2025_06_10_01Z, 'America/New_York')).toBe('2025-06-09');
  });

  describe('formatItemStart / formatItemEnd（§4.23 allDay 语义）', () => {
    it('startAt null → 未安排', () => {
      expect(formatItemStart(null, false, 'UTC')).toBe('未安排');
    });

    it('allDay → 全天 + 日期（忽略时分）', () => {
      expect(formatItemStart(TS_2025_06_10_01Z, true, 'Asia/Shanghai')).toBe('全天 2025-06-10');
    });

    it('非 allDay → 完整日期时间', () => {
      expect(formatItemStart(TS_2025_06_10_01Z, false, 'Asia/Shanghai')).toBe('2025-06-10 09:00');
    });

    it('endAt null → 未设置；allDay → 全天；否则完整时间', () => {
      expect(formatItemEnd(null, false, 'UTC')).toBe('未设置');
      expect(formatItemEnd(null, true, 'UTC')).toBe('未设置');
      expect(formatItemEnd(TS_2025_06_10_01Z, true, 'Asia/Shanghai')).toBe('全天');
      expect(formatItemEnd(TS_2025_06_10_01Z, false, 'Asia/Shanghai')).toBe('2025-06-10 09:00');
    });
  });

  describe('formatReminderRuleSummary', () => {
    const base = {
      localTimeHour: 9,
      localTimeMinute: 5,
      tzid: 'Asia/Shanghai',
    };

    it('daily → 每天 HH:mm（tzid）', () => {
      expect(formatReminderRuleSummary({ ...base, frequency: 'daily', weekdays: [], dayOfMonth: 0 }))
        .toBe('每天 09:05（Asia/Shanghai）');
    });

    it('weekly → 按周一至周日顺序拼接（短标签）', () => {
      expect(
        formatReminderRuleSummary({ ...base, frequency: 'weekly', weekdays: [3, 1, 7], dayOfMonth: 0 }),
      ).toBe('每周一、三、日 09:05（Asia/Shanghai）');
    });

    it('monthly → 每月 N 日 HH:mm（tzid）', () => {
      expect(formatReminderRuleSummary({ ...base, frequency: 'monthly', weekdays: [], dayOfMonth: 31 }))
        .toBe('每月 31 日 09:05（Asia/Shanghai）');
    });
  });
});
