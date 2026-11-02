import { expandOccurrences } from '..';
import type { ExpandOccurrencesInput, RecurrenceRule } from '..';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function utcWeekday(localDate: string): number {
  return new Date(`${localDate}T00:00:00Z`).getUTCDay();
}

describe('daily', () => {
  it('Asia/Shanghai 从 startAt 展开 3 天：localTime 正确、instant 严格递增', () => {
    const result = expandOccurrences({
      scheduleId: 'daily-shanghai',
      rule: { frequency: 'daily', localTime: { hour: 9, minute: 0 } },
      // 2025-06-01 00:00 +08:00
      startAt: Date.UTC(2025, 4, 31, 16, 0),
      tzid: 'Asia/Shanghai',
      count: 3,
    });

    expect(result.map((o) => o.localDate)).toEqual([
      '2025-06-01',
      '2025-06-02',
      '2025-06-03',
    ]);
    expect(result.map((o) => o.localTime)).toEqual(['09:00', '09:00', '09:00']);
    expect(result.map((o) => o.instant)).toEqual([
      Date.UTC(2025, 5, 1, 1, 0),
      Date.UTC(2025, 5, 2, 1, 0),
      Date.UTC(2025, 5, 3, 1, 0),
    ]);
    expect(result[1].instant - result[0].instant).toBe(DAY);
    expect(result[2].instant - result[1].instant).toBe(DAY);
    expect(result[0].occurrenceKey).toBe(
      'recurrence:v1|daily-shanghai|2025-06-01|09:00|Asia/Shanghai',
    );
  });
});

describe('weekly', () => {
  it('America/New_York 的周一/三/五：跨春季 DST 后星期仍正确', () => {
    const result = expandOccurrences({
      scheduleId: 'weekly-ny',
      rule: {
        frequency: 'weekly',
        weekdays: [1, 3, 5],
        localTime: { hour: 9, minute: 0 },
      },
      // 2025-02-28 00:00 EST（周五）
      startAt: Date.UTC(2025, 1, 28, 5, 0),
      tzid: 'America/New_York',
      count: 6,
    });

    expect(result.map((o) => o.localDate)).toEqual([
      '2025-02-28',
      '2025-03-03',
      '2025-03-05',
      '2025-03-07',
      '2025-03-10',
      '2025-03-12',
    ]);
    // JS getUTCDay：0=周日；期望依次为周五、周一、周三、周五、周一、周三。
    expect(result.map((o) => utcWeekday(o.localDate))).toEqual([5, 1, 3, 5, 1, 3]);
    expect(result.every((o) => o.localTime === '09:00')).toBe(true);
    // 3/7 09:00 EST → 3/10 09:00 EDT 跨过春季前拨，间隔 71 小时而非 72。
    expect(result[4].instant - result[3].instant).toBe(71 * HOUR);
  });
});

describe('monthly 短月回退', () => {
  const rule: RecurrenceRule = {
    frequency: 'monthly',
    dayOfMonth: 31,
    localTime: { hour: 12, minute: 0 },
  };

  it('非闰年：2 月回退到 28 日，4/6 月回退到 30 日', () => {
    const result = expandOccurrences({
      scheduleId: 'monthly-nonleap',
      rule,
      // 2025-01-01 00:00 +08:00
      startAt: Date.UTC(2024, 11, 31, 16, 0),
      tzid: 'Asia/Shanghai',
      count: 6,
    });

    expect(result.map((o) => o.localDate)).toEqual([
      '2025-01-31',
      '2025-02-28',
      '2025-03-31',
      '2025-04-30',
      '2025-05-31',
      '2025-06-30',
    ]);
  });

  it('闰年：2 月回退到 29 日', () => {
    const result = expandOccurrences({
      scheduleId: 'monthly-leap',
      rule,
      // 2024-01-01 00:00 +08:00
      startAt: Date.UTC(2023, 11, 31, 16, 0),
      tzid: 'Asia/Shanghai',
      count: 3,
    });

    expect(result.map((o) => o.localDate)).toEqual([
      '2024-01-31',
      '2024-02-29',
      '2024-03-31',
    ]);
  });
});

describe('DST 春季 gap', () => {
  it('America/New_York 02:30 在 2025-03-09 被跳过，前后 occurrence 正常', () => {
    const result = expandOccurrences({
      scheduleId: 'gap-ny',
      rule: { frequency: 'daily', localTime: { hour: 2, minute: 30 } },
      // 2025-03-06 19:00 EST
      startAt: Date.UTC(2025, 2, 7, 0, 0),
      tzid: 'America/New_York',
      count: 4,
    });

    expect(result.map((o) => o.localDate)).toEqual([
      '2025-03-07',
      '2025-03-08',
      '2025-03-10',
      '2025-03-11',
    ]);
    expect(result.map((o) => o.localTime)).toEqual([
      '02:30',
      '02:30',
      '02:30',
      '02:30',
    ]);
    expect(result.map((o) => o.instant)).toEqual([
      Date.UTC(2025, 2, 7, 7, 30),
      Date.UTC(2025, 2, 8, 7, 30),
      Date.UTC(2025, 2, 10, 6, 30),
      Date.UTC(2025, 2, 11, 6, 30),
    ]);
    expect(result.some((o) => o.localDate === '2025-03-09')).toBe(false);
    // gap 被跳过后仍然凑满 4 个 occurrence。
    expect(result).toHaveLength(4);
  });
});

describe('DST 秋季 fold', () => {
  it('America/New_York 01:30 在 2025-11-02 只产生一次且取较早瞬间', () => {
    const result = expandOccurrences({
      scheduleId: 'fold-ny',
      rule: { frequency: 'daily', localTime: { hour: 1, minute: 30 } },
      // 2025-10-31 20:00 EDT
      startAt: Date.UTC(2025, 10, 1, 0, 0),
      tzid: 'America/New_York',
      count: 3,
    });

    expect(result.map((o) => o.localDate)).toEqual([
      '2025-11-01',
      '2025-11-02',
      '2025-11-03',
    ]);
    expect(result.filter((o) => o.localDate === '2025-11-02')).toHaveLength(1);
    // 2025-11-02 01:30 第一次出现（EDT，UTC-4），而不是第二次出现（EST，UTC-5）。
    expect(result[1].instant).toBe(Date.UTC(2025, 10, 2, 5, 30));
    expect(result[2].instant).toBe(Date.UTC(2025, 10, 3, 6, 30));
  });
});

describe('startAt 边界', () => {
  const dailyRule: RecurrenceRule = {
    frequency: 'daily',
    localTime: { hour: 9, minute: 0 },
  };

  it('startAt 恰好等于当天 occurrence 时包含当天', () => {
    const result = expandOccurrences({
      scheduleId: 'start-equal',
      rule: dailyRule,
      // 2025-01-01 09:00 +08:00
      startAt: Date.UTC(2025, 0, 1, 1, 0),
      tzid: 'Asia/Shanghai',
      count: 1,
    });

    expect(result[0].localDate).toBe('2025-01-01');
  });

  it('startAt 比当天 localTime 多 1ms 时从下一天开始', () => {
    const result = expandOccurrences({
      scheduleId: 'start-after',
      rule: dailyRule,
      startAt: Date.UTC(2025, 0, 1, 1, 0, 0, 1),
      tzid: 'Asia/Shanghai',
      count: 1,
    });

    expect(result[0].localDate).toBe('2025-01-02');
  });

  it('monthly 生效日已过时跳到下一周期', () => {
    const result = expandOccurrences({
      scheduleId: 'monthly-after',
      rule: {
        frequency: 'monthly',
        dayOfMonth: 31,
        localTime: { hour: 9, minute: 0 },
      },
      // 2025-02-28 10:00 +08:00，当天 09:00 已过
      startAt: Date.UTC(2025, 1, 28, 2, 0),
      tzid: 'Asia/Shanghai',
      count: 1,
    });

    expect(result[0].localDate).toBe('2025-03-31');
  });
});

describe('边界与非法输入', () => {
  const base: Omit<ExpandOccurrencesInput, 'count'> = {
    scheduleId: 'boundary',
    rule: { frequency: 'daily', localTime: { hour: 9, minute: 0 } },
    startAt: Date.UTC(2025, 0, 1, 0, 0),
    tzid: 'Asia/Shanghai',
  };

  it('count 缺省为 30', () => {
    expect(expandOccurrences({ ...base })).toHaveLength(30);
  });

  it('count=0 返回空数组', () => {
    expect(expandOccurrences({ ...base, count: 0 })).toEqual([]);
  });

  it('count=31 截断到 30（不抛错）', () => {
    expect(expandOccurrences({ ...base, count: 31 })).toHaveLength(30);
  });

  it('count 为负数或非整数时抛明确错误', () => {
    expect(() => expandOccurrences({ ...base, count: -1 })).toThrow(/count/);
    expect(() => expandOccurrences({ ...base, count: 1.5 })).toThrow(/count/);
  });

  it('weekdays=[] 返回空数组，不抛异常', () => {
    const result = expandOccurrences({
      ...base,
      rule: {
        frequency: 'weekly',
        weekdays: [],
        localTime: { hour: 9, minute: 0 },
      },
      count: 5,
    });

    expect(result).toEqual([]);
  });

  it('dayOfMonth 不在 1–31 时抛错', () => {
    expect(() =>
      expandOccurrences({
        ...base,
        rule: { frequency: 'monthly', dayOfMonth: 0, localTime: { hour: 9, minute: 0 } },
      }),
    ).toThrow(/dayOfMonth/);
    expect(() =>
      expandOccurrences({
        ...base,
        rule: { frequency: 'monthly', dayOfMonth: 32, localTime: { hour: 9, minute: 0 } },
      }),
    ).toThrow(/dayOfMonth/);
  });

  it('weekdays 越界时抛错', () => {
    expect(() =>
      expandOccurrences({
        ...base,
        rule: {
          frequency: 'weekly',
          weekdays: [0],
          localTime: { hour: 9, minute: 0 },
        },
      }),
    ).toThrow(/weekdays/);
    expect(() =>
      expandOccurrences({
        ...base,
        rule: {
          frequency: 'weekly',
          weekdays: [8],
          localTime: { hour: 9, minute: 0 },
        },
      }),
    ).toThrow(/weekdays/);
  });

  it('localTime 越界时抛错', () => {
    expect(() =>
      expandOccurrences({
        ...base,
        rule: { frequency: 'daily', localTime: { hour: 24, minute: 0 } },
      }),
    ).toThrow(/localTime\.hour/);
    expect(() =>
      expandOccurrences({
        ...base,
        rule: { frequency: 'daily', localTime: { hour: 9, minute: 60 } },
      }),
    ).toThrow(/localTime\.minute/);
  });

  it('非法 IANA tzid 或固定偏移 tzid 抛错', () => {
    expect(() =>
      expandOccurrences({ ...base, tzid: 'Not/AZone' }),
    ).toThrow(/time zone/i);
    expect(() => expandOccurrences({ ...base, tzid: '+08:00' })).toThrow(/IANA/);
  });
});

describe('测试时区隔离', () => {
  const originalTz = process.env.TZ;

  afterAll(() => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  it('显式 tzid 的结果不随系统 TZ 改变', () => {
    const input: ExpandOccurrencesInput = {
      scheduleId: 'tz-isolation',
      rule: { frequency: 'daily', localTime: { hour: 1, minute: 30 } },
      startAt: Date.UTC(2025, 9, 31, 0, 0),
      tzid: 'America/New_York',
      count: 5,
    };

    try {
      process.env.TZ = 'Pacific/Kiritimati';
      const first = expandOccurrences(input);

      process.env.TZ = 'America/Los_Angeles';
      const second = expandOccurrences(input);

      expect(first).toEqual(second);
    } finally {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    }
  });
});
