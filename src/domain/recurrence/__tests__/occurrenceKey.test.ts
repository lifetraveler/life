import { buildOccurrenceKey, expandOccurrences } from '..';
import type { ExpandOccurrencesInput } from '..';

describe('buildOccurrenceKey', () => {
  const base = {
    scheduleId: 'schedule-1',
    localDate: '2025-03-09',
    localTime: '02:30',
    tzid: 'America/New_York',
  };

  it('按 v1 格式确定性拼接四个字段', () => {
    expect(buildOccurrenceKey(base)).toBe(
      'recurrence:v1|schedule-1|2025-03-09|02:30|America/New_York',
    );
  });

  it('同一输入重复调用结果相同', () => {
    expect(buildOccurrenceKey(base)).toBe(buildOccurrenceKey({ ...base }));
  });

  it('任一字段变化都会改变 key', () => {
    const key = buildOccurrenceKey(base);
    expect(buildOccurrenceKey({ ...base, scheduleId: 'schedule-2' })).not.toBe(key);
    expect(buildOccurrenceKey({ ...base, localDate: '2025-03-10' })).not.toBe(key);
    expect(buildOccurrenceKey({ ...base, localTime: '02:31' })).not.toBe(key);
    expect(buildOccurrenceKey({ ...base, tzid: 'Asia/Shanghai' })).not.toBe(key);
  });

  it('scheduleId 中的分隔符被编码，不会与字段分隔符冲突', () => {
    expect(buildOccurrenceKey({ ...base, scheduleId: 'a|b' })).toBe(
      'recurrence:v1|a%7Cb|2025-03-09|02:30|America/New_York',
    );
  });
});

describe('expandOccurrences：occurrenceKey 稳定性', () => {
  it('同一输入展开两次 key 集合一致；修改 count 不改变已产生 occurrence 的 key', () => {
    const input: ExpandOccurrencesInput = {
      scheduleId: 's-stable',
      rule: { frequency: 'daily', localTime: { hour: 1, minute: 30 } },
      // 覆盖 2025-11-02 秋季 fold，key 仍只由民用时间字段决定。
      startAt: Date.UTC(2025, 9, 31, 0, 0),
      tzid: 'America/New_York',
    };

    const first = expandOccurrences({ ...input, count: 5 });
    const second = expandOccurrences({ ...input, count: 5 });
    const longer = expandOccurrences({ ...input, count: 10 });

    expect(first.map((o) => o.occurrenceKey)).toEqual(
      second.map((o) => o.occurrenceKey),
    );
    expect(longer.slice(0, 5).map((o) => o.occurrenceKey)).toEqual(
      first.map((o) => o.occurrenceKey),
    );
    expect(new Set(first.map((o) => o.occurrenceKey)).size).toBe(5);
  });
});
