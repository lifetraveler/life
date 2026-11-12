import type { OnceCivilTime, ReminderChannel } from '../../domain/reminder';
import {
  fromRecurrenceRule,
  normalizeReminderChannelFields,
  normalizeReminderRuleFields,
  normalizeStartAt,
  parseOnceCivilJson,
  parseWeekdaysJson,
  resolveOnceAt,
  serializeOnceCivilJson,
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

  it('once：无 RecurrenceRule，抛明确错误（调度器必须在展开前按 frequency 分支）', () => {
    const onceFields = normalizeReminderRuleFields({
      frequency: 'once',
      localTimeHour: 0,
      localTimeMinute: 0,
    });
    expect(() => toRecurrenceRule(onceFields)).toThrow(
      /once reminders have no RecurrenceRule/,
    );
  });
});

describe('normalizeReminderRuleFields：once（切片 16）', () => {
  it('once：localTime/weekdays/dayOfMonth 全部落零值，忽略传入的非本频字段', () => {
    expect(
      normalizeReminderRuleFields({
        frequency: 'once',
        localTimeHour: 9,
        localTimeMinute: 30,
        weekdays: [1, 2],
        dayOfMonth: 15,
      }),
    ).toEqual({
      frequency: 'once',
      localTimeHour: 0,
      localTimeMinute: 0,
      weekdays: [],
      dayOfMonth: 0,
    });
  });

  it('once：跳过 localTime 校验（列 NOT NULL 落零值，调用方无需凑合法占位值）', () => {
    expect(
      normalizeReminderRuleFields({
        frequency: 'once',
        localTimeHour: 99,
        localTimeMinute: 61,
      }),
    ).toEqual({
      frequency: 'once',
      localTimeHour: 0,
      localTimeMinute: 0,
      weekdays: [],
      dayOfMonth: 0,
    });
  });
});

describe('serializeOnceCivilJson / parseOnceCivilJson（切片 16，once_civil_json 唯一出入）', () => {
  const onceAt: OnceCivilTime = { year: 2026, month: 11, day: 12, hour: 9, minute: 0 };

  it('serialize：固定键序 {year,month,day,hour,minute}', () => {
    expect(serializeOnceCivilJson(onceAt)).toBe(
      '{"year":2026,"month":11,"day":12,"hour":9,"minute":0}',
    );
  });

  it('parse：合法 JSON 往返一致', () => {
    expect(parseOnceCivilJson(serializeOnceCivilJson(onceAt))).toEqual(onceAt);
    expect(parseOnceCivilJson('{"year":2026,"month":1,"day":31,"hour":23,"minute":59}')).toEqual({
      year: 2026,
      month: 1,
      day: 31,
      hour: 23,
      minute: 59,
    });
  });

  it('parse：非法 JSON 抛明确错误，不静默', () => {
    expect(() => parseOnceCivilJson('not-json')).toThrow(/invalid JSON/);
  });

  it('parse：非对象（数组/标量）抛明确错误', () => {
    expect(() => parseOnceCivilJson('[2026,11,12,9,0]')).toThrow(/got non-object/);
    expect(() => parseOnceCivilJson('42')).toThrow(/got non-object/);
  });

  it('parse：缺键/多键抛明确错误（严格 5 键）', () => {
    expect(() => parseOnceCivilJson('{"year":2026}')).toThrow(/got keys: \[year\]/);
    expect(() =>
      parseOnceCivilJson('{"year":2026,"month":11,"day":12,"hour":9,"minute":0,"tz":"SH"}'),
    ).toThrow(/got keys:/);
  });

  it('parse：字段非整数/越界抛明确错误（year 1–9999、month 1–12、day 1–31、hour 0–23、minute 0–59）', () => {
    const base = '{"year":2026,"month":11,"day":12,"hour":9,"minute":0}';
    const withField = (key: string, value: string) =>
      base.replace(new RegExp(`"${key}":[0-9]+`), `"${key}":${value}`);

    expect(() => parseOnceCivilJson(withField('year', '0'))).toThrow(/got year: 0/);
    expect(() => parseOnceCivilJson(withField('year', '10000'))).toThrow(/got year: 10000/);
    expect(() => parseOnceCivilJson(withField('month', '13'))).toThrow(/got month: 13/);
    expect(() => parseOnceCivilJson(withField('day', '0'))).toThrow(/got day: 0/);
    expect(() => parseOnceCivilJson(withField('hour', '24'))).toThrow(/got hour: 24/);
    expect(() => parseOnceCivilJson(withField('minute', '60'))).toThrow(/got minute: 60/);
    expect(() => parseOnceCivilJson(withField('day', '1.5'))).toThrow(/got day: 1\.5/);
    expect(() =>
      parseOnceCivilJson(base.replace('"year":2026', '"year":"2026"')),
    ).toThrow(/got year: 2026/); // assertField 用 String(raw) 格式化，字符串 "2026" 显示不带引号
  });
});

describe('resolveOnceAt（切片 16，写路径 once 必填运行时强制）', () => {
  const onceAt: OnceCivilTime = { year: 2026, month: 11, day: 12, hour: 9, minute: 0 };

  it('frequency=once 且缺 onceAt（null/undefined）抛明确错误', () => {
    expect(() => resolveOnceAt('once', null)).toThrow(
      "frequency 'once' requires onceAt (civil {year,month,day,hour,minute}), got none",
    );
    expect(() => resolveOnceAt('once', undefined)).toThrow(/requires onceAt/);
  });

  it('frequency=once 且有值：校验后原样返回；范围越界经校验抛错', () => {
    expect(resolveOnceAt('once', onceAt)).toEqual(onceAt);
    expect(() => resolveOnceAt('once', { year: 2026, month: 0, day: 1, hour: 0, minute: 0 })).toThrow(
      /got month: 0/,
    );
  });

  it('frequency≠once：恒返回 null（传入的 onceAt 被丢弃，不做校验）', () => {
    expect(resolveOnceAt('daily', onceAt)).toBeNull();
    expect(resolveOnceAt('weekly', null)).toBeNull();
    expect(resolveOnceAt('monthly', undefined)).toBeNull();
  });
});

describe('normalizeReminderChannelFields（切片 16，写路径渠道归一化）', () => {
  it('channel 缺省 → system-notification + channelConfig null', () => {
    expect(normalizeReminderChannelFields({})).toEqual({
      channel: 'system-notification',
      channelConfig: null,
    });
    expect(normalizeReminderChannelFields({ channel: 'system-notification' })).toEqual({
      channel: 'system-notification',
      channelConfig: null,
    });
  });

  it('system-notification / alarm 渠道无关：channelConfig 强制 null（传入值被丢弃）', () => {
    expect(
      normalizeReminderChannelFields({ channel: 'alarm', channelConfig: 'should-drop' }),
    ).toEqual({ channel: 'alarm', channelConfig: null });
    expect(
      normalizeReminderChannelFields({ channel: 'system-notification', channelConfig: null }),
    ).toEqual({ channel: 'system-notification', channelConfig: null });
  });

  it('webhook / apprise：非空白字符串 trim 后落库', () => {
    expect(
      normalizeReminderChannelFields({ channel: 'webhook', channelConfig: '  https://example.com/hook  ' }),
    ).toEqual({ channel: 'webhook', channelConfig: 'https://example.com/hook' });
    expect(
      normalizeReminderChannelFields({ channel: 'apprise', channelConfig: 'apprise://srv/home' }),
    ).toEqual({ channel: 'apprise', channelConfig: 'apprise://srv/home' });
  });

  it('webhook / apprise：channelConfig 缺省/null 接受（落 null，阶段 3 UI 强制补齐前的宽松态）', () => {
    expect(normalizeReminderChannelFields({ channel: 'webhook' })).toEqual({
      channel: 'webhook',
      channelConfig: null,
    });
    expect(normalizeReminderChannelFields({ channel: 'apprise', channelConfig: null })).toEqual({
      channel: 'apprise',
      channelConfig: null,
    });
  });

  it('webhook / apprise：纯空白 channelConfig 抛明确错误', () => {
    expect(() =>
      normalizeReminderChannelFields({ channel: 'webhook', channelConfig: '   ' }),
    ).toThrow(/must be a non-empty string, got whitespace-only/);
    expect(() =>
      normalizeReminderChannelFields({ channel: 'apprise', channelConfig: '\t\n' }),
    ).toThrow(/whitespace-only/);
  });

  it('枚举外渠道抛明确错误（契约外运行时值经 JSON 反序列化构造，不用 as 断言）', () => {
    const bogusChannel: ReminderChannel = JSON.parse('"bogus-channel"');
    expect(() => normalizeReminderChannelFields({ channel: bogusChannel })).toThrow(
      /reminder channel must be one of system-notification, alarm, webhook, apprise, got: bogus-channel/,
    );
  });
});
