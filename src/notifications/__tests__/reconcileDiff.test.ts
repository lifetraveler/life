import {
  IDENTIFIER_ROOT_PREFIX,
  computeMissed,
  diffNotifications,
  reminderIdentifierPrefix,
} from '../reconcileDiff';
import { buildOccurrenceKey } from '../../domain/recurrence';
import type { Occurrence } from '../../domain/recurrence';

function occurrenceOf(
  scheduleId: string,
  localDate: string,
  localTime: string,
  instant: number,
  tzid = 'UTC',
): Occurrence {
  return {
    occurrenceKey: buildOccurrenceKey({ scheduleId, localDate, localTime, tzid }),
    localDate,
    localTime,
    tzid,
    instant,
  };
}

describe('diffNotifications', () => {
  it('期望与现网完全相同 → 无动作', () => {
    const expected = new Set(['a', 'b']);
    const actual = new Set(['b', 'a']);
    expect(diffNotifications(expected, actual)).toEqual({ toSchedule: [], toCancel: [] });
  });

  it('期望多出 → toSchedule 只含缺失项', () => {
    const expected = new Set(['a', 'b', 'c']);
    const actual = new Set(['b']);
    expect(diffNotifications(expected, actual)).toEqual({ toSchedule: ['a', 'c'], toCancel: [] });
  });

  it('现网多出 → toCancel 只含多余项', () => {
    const expected = new Set(['b']);
    const actual = new Set(['a', 'b', 'c']);
    expect(diffNotifications(expected, actual)).toEqual({ toSchedule: [], toCancel: ['a', 'c'] });
  });

  it('两侧互有差异 → 同时给出调度与取消', () => {
    const expected = new Set(['b', 'd']);
    const actual = new Set(['a', 'b']);
    expect(diffNotifications(expected, actual)).toEqual({ toSchedule: ['d'], toCancel: ['a'] });
  });

  it('空集合对空集合 → 无动作', () => {
    expect(diffNotifications(new Set(), new Set())).toEqual({ toSchedule: [], toCancel: [] });
  });
});

describe('computeMissed', () => {
  const past1 = occurrenceOf('r1', '2025-06-09', '08:00', 1749456000000);
  const past2 = occurrenceOf('r1', '2025-06-10', '08:00', 1749542400000);
  const future1 = occurrenceOf('r1', '2025-06-11', '08:00', 1749628800000);
  const future2 = occurrenceOf('r1', '2025-06-12', '08:00', 1749715200000);
  const now = 1749542400000; // == past2.instant

  it('lastFiredKey 为 null → 窗口内全部已过期项都计入', () => {
    expect(computeMissed([future1, past1, future2, past2], null, now)).toEqual([past1, past2]);
  });

  it('只取 lastFiredKey 之后的项', () => {
    expect(computeMissed([past1, past2, future1, future2], past1.occurrenceKey, now)).toEqual([
      past2,
    ]);
  });

  it('instant 严格大于 now 的项不进入 missed（now 本身计入）', () => {
    expect(computeMissed([past1, past2, future1], null, now)).toEqual([past1, past2]);
    expect(computeMissed([future1], null, now)).toEqual([]);
  });

  it('输入乱序时按 instant 升序返回', () => {
    const shuffled = [future1, past2, future2, past1];
    expect(computeMissed(shuffled, null, now).map((o) => o.occurrenceKey)).toEqual([
      past1.occurrenceKey,
      past2.occurrenceKey,
    ]);
  });

  it('lastFiredKey 不在列表中（游标指向旧窗口）→ 全部已过期项计入', () => {
    const staleKey = buildOccurrenceKey({
      scheduleId: 'r1',
      localDate: '2025-05-01',
      localTime: '08:00',
      tzid: 'UTC',
    });
    expect(computeMissed([past1, past2, future1], staleKey, now)).toEqual([past1, past2]);
  });

  it('lastFiredKey 已是最后一个过期项 → missed 为空', () => {
    expect(computeMissed([past1, past2, future1, future2], past2.occurrenceKey, now)).toEqual([]);
  });

  it('空 occurrence 列表 → missed 为空', () => {
    expect(computeMissed([], null, now)).toEqual([]);
  });
});

describe('identifier 前缀', () => {
  it('IDENTIFIER_ROOT_PREFIX 为冻结值 recurrence:v1|', () => {
    expect(IDENTIFIER_ROOT_PREFIX).toBe('recurrence:v1|');
  });

  it('reminderIdentifierPrefix 对 reminderId 做 encodeURIComponent', () => {
    expect(reminderIdentifierPrefix('r1')).toBe('recurrence:v1|r1|');
    expect(reminderIdentifierPrefix('r/1|a')).toBe(
      `recurrence:v1|${encodeURIComponent('r/1|a')}|`,
    );
  });

  it('occurrenceKey 与 identifier 前缀体系一致（同一字符串）', () => {
    const key = buildOccurrenceKey({
      scheduleId: 'r1',
      localDate: '2025-06-10',
      localTime: '09:00',
      tzid: 'UTC',
    });
    expect(key.startsWith(IDENTIFIER_ROOT_PREFIX)).toBe(true);
    expect(key.startsWith(reminderIdentifierPrefix('r1'))).toBe(true);
  });
});
