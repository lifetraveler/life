/**
 * 预览卡时间行纯函数测试（tasks/slice-24.md 阶段 1，slice-23 遗留 5）：
 * describeDraftTime 的日期重复修复与同日/跨日 endAt 范围语义。
 *
 * 修复前拼法 `${formatItemDate} ${formatItemTime}` 因 formatItemTime 本身
 * 已含日期，产出「2026-11-16 2026-11-16 07:30」；修复后 start 行单用
 * formatItemTime，endAt 同一民用日只补 'HH:mm'、跨日带完整日期
 * （与 formatAgendaTimeRange 的范围语义一致）。
 */

import * as Localization from 'expo-localization';

jest.mock('expo-localization', () => ({
  getCalendars: jest.fn(() => [{ timeZone: 'Asia/Shanghai' }]),
}));

import { describeDraftTime } from '../FlashPreviewCard';
import type { ParsedItemDraft } from '../../domain/ai/types';

const TZID = 'Asia/Shanghai';
const START = new Date('2026-11-16T07:30:00+08:00').getTime();
const SAME_DAY_END = new Date('2026-11-16T09:00:00+08:00').getTime();
const CROSS_DAY_END = new Date('2026-11-17T09:00:00+08:00').getTime();

function draft(overrides: Partial<ParsedItemDraft>): ParsedItemDraft {
  return {
    title: '晨会',
    content: '',
    type: 'event',
    startAt: null,
    endAt: null,
    allDay: false,
    categoryId: null,
    tags: [],
    priority: null,
    recurrence: null,
    reminderOffsetMinutes: null,
    reminderDelayMinutes: null,
    ...overrides,
  };
}

describe('describeDraftTime（切片 24 日期重复修复）', () => {
  it('有 startAt 无 endAt → 单一日期时刻，不再重复（遗留 5 回归）', () => {
    expect(describeDraftTime(draft({ startAt: START }), TZID)).toBe(
      '2026-11-16 07:30',
    );
  });

  it('endAt 与 startAt 同一民用日 → 「YYYY-MM-DD HH:mm ~ HH:mm」', () => {
    expect(
      describeDraftTime(draft({ startAt: START, endAt: SAME_DAY_END }), TZID),
    ).toBe('2026-11-16 07:30 ~ 09:00');
  });

  it('endAt 跨民用日 → 两端都带完整日期', () => {
    expect(
      describeDraftTime(draft({ startAt: START, endAt: CROSS_DAY_END }), TZID),
    ).toBe('2026-11-16 07:30 ~ 2026-11-17 09:00');
  });

  it('allDay → 「YYYY-MM-DD 全天」（既有语义不变）', () => {
    expect(
      describeDraftTime(draft({ startAt: START, allDay: true }), TZID),
    ).toBe('2026-11-16 全天');
  });

  it('startAt=null → 未设时间（既有语义不变）', () => {
    expect(describeDraftTime(draft({}), TZID)).toBe('未设时间');
  });
});
