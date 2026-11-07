import * as Localization from 'expo-localization';

import {
  formatItemDate,
  formatItemEnd,
  formatItemStart,
  formatItemTime,
  formatReminderRuleSummary,
  getDeviceTzid,
} from '../timeFormat';

// 切片 14 阶段 2 追加（纯新增行，未改动既有用例与既有 import 行）：
import { formatAgendaTimeRange } from '../timeFormat';

// 切片 11 变更 A：getDeviceTzid 收口到 src/data/deviceTimezone（expo-localization 来源）。
// 这里 mock 掉原生依赖，验证委托行为与回退；格式化函数本身仍用显式 tzid 的纯函数断言。
jest.mock('expo-localization', () => ({
  getCalendars: jest.fn(() => [{ timeZone: 'Asia/Shanghai' }]),
}));

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

  it('getDeviceTzid 委托 expo-localization 日历时区（mock Asia/Shanghai）', () => {
    (Localization.getCalendars as jest.Mock).mockReturnValue([{ timeZone: 'Asia/Shanghai' }]);
    expect(getDeviceTzid()).toBe('Asia/Shanghai');
  });

  it('getDeviceTzid 无日历信息/异常时回退 UTC', () => {
    (Localization.getCalendars as jest.Mock).mockReturnValue([]);
    expect(getDeviceTzid()).toBe('UTC');
    (Localization.getCalendars as jest.Mock).mockImplementation(() => {
      throw new Error('native module unavailable');
    });
    expect(getDeviceTzid()).toBe('UTC');
    (Localization.getCalendars as jest.Mock).mockReturnValue([{ timeZone: 'Asia/Shanghai' }]);
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

// ─── 以下为切片 14 阶段 2 追加的测试块（既有用例保持原样） ───

describe('formatAgendaTimeRange（切片 14 阶段 2：Agenda 卡片时间段）', () => {
  const TZ = 'Asia/Shanghai';
  // 2026-11-07 09:00+08 / 11:00+08（同一民用日）
  const START_0900_SH = Date.UTC(2026, 10, 7, 1, 0);
  const END_1100_SH = Date.UTC(2026, 10, 7, 3, 0);
  // 2026-11-08 10:00+08（次日）
  const NEXT_DAY_1000_SH = Date.UTC(2026, 10, 8, 2, 0);

  it('startAt=null → null（卡片不渲染时间行）', () => {
    expect(formatAgendaTimeRange({ startAt: null, endAt: null, allDay: false }, TZ)).toBeNull();
    expect(formatAgendaTimeRange({ startAt: null, endAt: END_1100_SH, allDay: false }, TZ)).toBeNull();
  });

  it("allDay=true → '全天'（Asia/Shanghai）", () => {
    expect(formatAgendaTimeRange({ startAt: START_0900_SH, endAt: END_1100_SH, allDay: true }, TZ)).toBe('全天');
  });

  it('有 endAt 且同一民用日 → HH:mm - HH:mm', () => {
    expect(formatAgendaTimeRange({ startAt: START_0900_SH, endAt: END_1100_SH, allDay: false }, TZ)).toBe('09:00 - 11:00');
  });

  it('无 endAt → HH:mm', () => {
    expect(formatAgendaTimeRange({ startAt: START_0900_SH, endAt: null, allDay: false }, TZ)).toBe('09:00');
  });

  it('endAt 跨民用日 → HH:mm - YYYY-MM-DD HH:mm', () => {
    expect(
      formatAgendaTimeRange({ startAt: START_0900_SH, endAt: NEXT_DAY_1000_SH, allDay: false }, TZ),
    ).toBe('09:00 - 2026-11-08 10:00');
  });

  it("tzid='America/New_York' 生效：Date.UTC(2026,10,7,2,0) = 2026-11-06 21:00（EST，DST 已结束）→ '21:00'", () => {
    expect(
      formatAgendaTimeRange({ startAt: Date.UTC(2026, 10, 7, 2, 0), endAt: null, allDay: false }, 'America/New_York'),
    ).toBe('21:00');
  });
});
