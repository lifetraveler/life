/**
 * 卡片渠道标识展示纯函数测试（tasks/slice-23.md 阶段 3，AGENTS.md §7.35）：
 * 预览卡 describeDraftChannelLine（reminderChannels → 渠道行文案）与
 * 结果卡 describeCardReminderLine（提醒快照 → 图标 + 「渠道 · 规则摘要」）。
 *
 * 渠道标识语义：alarm → ⏰ 优先；system-notification → 🔔；网络渠道按
 * REMINDER_CHANNEL_LABELS 列出；未表达/空 → 预览卡不渲染行（null）、
 * 结果卡兜底「通知」。规则摘要（formatReminderRuleSummary）恒保留。
 */

import * as Localization from 'expo-localization';

jest.mock('expo-localization', () => ({
  getCalendars: jest.fn(() => [{ timeZone: 'Asia/Shanghai' }]),
}));

import { describeDraftChannelLine } from '../FlashPreviewCard';
import { describeCardReminderLine } from '../FlashResultCard';
import { formatReminderRuleSummary } from '../timeFormat';
import type { FlashCardReminderSnapshot } from '../../domain/ai/types';

function snapshot(overrides: Partial<FlashCardReminderSnapshot>): FlashCardReminderSnapshot {
  return {
    id: 'rem-1',
    frequency: 'once',
    localTimeHour: 8,
    localTimeMinute: 0,
    weekdays: [],
    dayOfMonth: 1,
    onceAt: { year: 2026, month: 11, day: 16, hour: 8, minute: 0 },
    tzid: 'Asia/Shanghai',
    channels: ['system-notification'],
    ...overrides,
  };
}

describe('describeDraftChannelLine（预览卡渠道行）', () => {
  it('reminderChannels 未表达 → null（不渲染渠道行）', () => {
    expect(describeDraftChannelLine(undefined)).toBeNull();
  });

  it('空数组 → null（空数组是 null 的 wire 等价形）', () => {
    expect(describeDraftChannelLine([])).toBeNull();
  });

  it('alarm → ⏰ 闹钟（验收 2：叫醒类预览卡可见 ⏰）', () => {
    expect(describeDraftChannelLine(['alarm'])).toBe('⏰ 闹钟');
  });

  it('system-notification → 🔔 通知', () => {
    expect(describeDraftChannelLine(['system-notification'])).toBe('🔔 通知');
  });

  it('网络渠道按标签列出（webhook/apprise/组合）', () => {
    expect(describeDraftChannelLine(['webhook'])).toBe('Webhook');
    expect(describeDraftChannelLine(['apprise'])).toBe('Apprise');
    expect(describeDraftChannelLine(['webhook', 'apprise'])).toBe('Webhook、Apprise');
  });
});

describe('describeCardReminderLine（结果卡提醒行）', () => {
  it('reminder null → null（整行不渲染）', () => {
    expect(describeCardReminderLine(null)).toBeNull();
  });

  it('alarm → ⏰ + 「闹钟 · 规则摘要」', () => {
    const target = snapshot({ channels: ['alarm'] });
    expect(describeCardReminderLine(target)).toEqual({
      icon: '⏰',
      text: `闹钟 · ${formatReminderRuleSummary(target)}`,
    });
  });

  it('system-notification → 🔔 + 「通知 · 规则摘要」', () => {
    const target = snapshot({ channels: ['system-notification'] });
    expect(describeCardReminderLine(target)).toEqual({
      icon: '🔔',
      text: `通知 · ${formatReminderRuleSummary(target)}`,
    });
  });

  it('网络渠道 → 🔔 + 渠道标签 · 规则摘要', () => {
    const target = snapshot({ channels: ['webhook', 'apprise'] });
    expect(describeCardReminderLine(target)).toEqual({
      icon: '🔔',
      text: `Webhook、Apprise · ${formatReminderRuleSummary(target)}`,
    });
  });

  it('channels 空 → 「通知」兜底（快照恒携带渠道，空数组仅防御路径）', () => {
    const target = snapshot({ channels: [] });
    expect(describeCardReminderLine(target)).toEqual({
      icon: '🔔',
      text: `通知 · ${formatReminderRuleSummary(target)}`,
    });
  });
});
