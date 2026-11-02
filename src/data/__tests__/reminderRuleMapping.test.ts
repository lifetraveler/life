import {
  fromRecurrenceRule,
  normalizeReminderRuleFields,
  normalizeStartAt,
  parseWeekdaysJson,
  serializeWeekdays,
  toRecurrenceRule,
} from '../reminderRuleMapping';

describe('serializeWeekdays', () => {
  it('空数组序列化为空字符串（§4.17：非 weekly 恒为空字符串）', () => {
    expect(serializeWeekdays([])).toBe('');
  });

  it('非空数组序列化为 JSON 字符串', () => {
    expect(serializeWeekdays([1, 3])).toBe('[1,3]');
  });
});

describe('parseWeekdaysJson', () => {
  it('空字符串解析为空数组', () => {
    expect(parseWeekdaysJson('')).toEqual([]);
  });

  it('合法 JSON 数组解析为 weekdays', () => {
    expect(parseWeekdaysJson('[1,3]')).toEqual([1, 3]);
    expect(parseWeekdaysJson('[7]')).toEqual([7]);
  });

  it('非法 JSON 抛明确错误，不静默', () => {
    expect(() => parseWeekdaysJson('1,3')).toThrow(
      'reminders.weekdays must be a JSON array of integers 1–7, got invalid JSON: 1,3',
    );
  });

  it('非数组 JSON（如对象/数字）抛明确错误，不静默', () => {
    expect(() => parseWeekdaysJson('{"a":1}')).toThrow(
      'reminders.weekdays must be a JSON array of integers 1–7, got: {"a":1}',
    );
    expect(() => parseWeekdaysJson('3')).toThrow(
      'reminders.weekdays must be a JSON array of integers 1–7, got: 3',
    );
  });

  it('元素越界或非整数抛明确错误，不静默', () => {
    expect(() => parseWeekdaysJson('[0]')).toThrow(
      'reminders.weekdays elements must be integers 1–7, got: 0',
    );
    expect(() => parseWeekdaysJson('[8]')).toThrow(
      'reminders.weekdays elements must be integers 1–7, got: 8',
    );
    expect(() => parseWeekdaysJson('[1.5]')).toThrow(
      'reminders.weekdays elements must be integers 1–7, got: 1.5',
    );
  });

  it('拒绝逗号分隔格式（§4.17 冻结决定：只能是 JSON 数组）', () => {
    expect(() => parseWeekdaysJson('1,3')).toThrow();
  });
});

describe('normalizeReminderRuleFields', () => {
  it('daily：weekdays 归空、dayOfMonth 归 0', () => {
    expect(
      normalizeReminderRuleFields({
        frequency: 'daily',
        localTimeHour: 9,
        localTimeMinute: 30,
        weekdays: [1, 2],
        dayOfMonth: 5,
      }),
    ).toEqual({
      frequency: 'daily',
      localTimeHour: 9,
      localTimeMinute: 30,
      weekdays: [],
      dayOfMonth: 0,
    });
  });

  it('weekly：weekdays 必填，去重并升序', () => {
    expect(
      normalizeReminderRuleFields({
        frequency: 'weekly',
        localTimeHour: 8,
        localTimeMinute: 0,
        weekdays: [7, 1, 3, 1],
      }),
    ).toEqual({
      frequency: 'weekly',
      localTimeHour: 8,
      localTimeMinute: 0,
      weekdays: [1, 3, 7],
      dayOfMonth: 0,
    });
  });

  it('weekly：weekdays 为空抛明确错误', () => {
    expect(() =>
      normalizeReminderRuleFields({
        frequency: 'weekly',
        localTimeHour: 8,
        localTimeMinute: 0,
        weekdays: [],
      }),
    ).toThrow('weekly reminder requires at least one weekday in 1–7');
  });

  it('monthly：dayOfMonth 必须在 1–31，weekdays 归空', () => {
    expect(
      normalizeReminderRuleFields({
        frequency: 'monthly',
        localTimeHour: 20,
        localTimeMinute: 15,
        dayOfMonth: 31,
        weekdays: [1],
      }),
    ).toEqual({
      frequency: 'monthly',
      localTimeHour: 20,
      localTimeMinute: 15,
      weekdays: [],
      dayOfMonth: 31,
    });
  });

  it('monthly：dayOfMonth 缺省或为 0 抛明确错误', () => {
    expect(() =>
      normalizeReminderRuleFields({
        frequency: 'monthly',
        localTimeHour: 20,
        localTimeMinute: 15,
      }),
    ).toThrow('dayOfMonth must be an integer in 1–31, got: 0');
  });

  it('hour 越界抛明确错误', () => {
    expect(() =>
      normalizeReminderRuleFields({
        frequency: 'daily',
        localTimeHour: 24,
        localTimeMinute: 0,
      }),
    ).toThrow('localTimeHour must be an integer in 0–23, got: 24');
    expect(() =>
      normalizeReminderRuleFields({
        frequency: 'daily',
        localTimeHour: -1,
        localTimeMinute: 0,
      }),
    ).toThrow('localTimeHour must be an integer in 0–23, got: -1');
  });

  it('minute 越界抛明确错误', () => {
    expect(() =>
      normalizeReminderRuleFields({
        frequency: 'daily',
        localTimeHour: 0,
        localTimeMinute: 60,
      }),
    ).toThrow('localTimeMinute must be an integer in 0–59, got: 60');
  });

  it('weekly 元素越界抛明确错误', () => {
    expect(() =>
      normalizeReminderRuleFields({
        frequency: 'weekly',
        localTimeHour: 8,
        localTimeMinute: 0,
        weekdays: [8],
      }),
    ).toThrow('weekdays element must be an integer in 1–7, got: 8');
  });
});

describe('normalizeStartAt', () => {
  it('有限时间戳原样返回', () => {
    expect(normalizeStartAt(1735689600000)).toBe(1735689600000);
    expect(normalizeStartAt(0)).toBe(0);
  });

  it('非有限数值抛明确错误', () => {
    expect(() => normalizeStartAt(Number.NaN)).toThrow(
      'startAt must be a finite millisecond timestamp, got: NaN',
    );
    expect(() => normalizeStartAt(Number.POSITIVE_INFINITY)).toThrow(
      'startAt must be a finite millisecond timestamp, got: Infinity',
    );
  });
});

describe('toRecurrenceRule / fromRecurrenceRule 互转', () => {
  it('daily：一一映射', () => {
    const fields = {
      frequency: 'daily' as const,
      localTimeHour: 9,
      localTimeMinute: 30,
      weekdays: [],
      dayOfMonth: 0,
    };
    expect(toRecurrenceRule(fields)).toEqual({
      frequency: 'daily',
      localTime: { hour: 9, minute: 30 },
    });
    expect(fromRecurrenceRule({ frequency: 'daily', localTime: { hour: 9, minute: 30 } })).toEqual(
      fields,
    );
  });

  it('weekly：一一映射', () => {
    const fields = {
      frequency: 'weekly' as const,
      localTimeHour: 8,
      localTimeMinute: 0,
      weekdays: [1, 3],
      dayOfMonth: 0,
    };
    expect(toRecurrenceRule(fields)).toEqual({
      frequency: 'weekly',
      weekdays: [1, 3],
      localTime: { hour: 8, minute: 0 },
    });
    expect(
      fromRecurrenceRule({
        frequency: 'weekly',
        weekdays: [1, 3],
        localTime: { hour: 8, minute: 0 },
      }),
    ).toEqual(fields);
  });

  it('monthly：一一映射', () => {
    const fields = {
      frequency: 'monthly' as const,
      localTimeHour: 20,
      localTimeMinute: 15,
      weekdays: [],
      dayOfMonth: 31,
    };
    expect(toRecurrenceRule(fields)).toEqual({
      frequency: 'monthly',
      dayOfMonth: 31,
      localTime: { hour: 20, minute: 15 },
    });
    expect(
      fromRecurrenceRule({
        frequency: 'monthly',
        dayOfMonth: 31,
        localTime: { hour: 20, minute: 15 },
      }),
    ).toEqual(fields);
  });

  it('roundtrip：三种 frequency 经 to→from 后与原字段一致', () => {
    const dailies = normalizeReminderRuleFields({
      frequency: 'daily',
      localTimeHour: 7,
      localTimeMinute: 45,
    });
    const weeklies = normalizeReminderRuleFields({
      frequency: 'weekly',
      localTimeHour: 8,
      localTimeMinute: 0,
      weekdays: [6, 2],
    });
    const monthlies = normalizeReminderRuleFields({
      frequency: 'monthly',
      localTimeHour: 21,
      localTimeMinute: 5,
      dayOfMonth: 15,
    });

    for (const fields of [dailies, weeklies, monthlies]) {
      expect(fromRecurrenceRule(toRecurrenceRule(fields))).toEqual(fields);
    }
  });
});
