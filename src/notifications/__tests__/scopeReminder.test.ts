import { scopeReminderToChannel } from '../channels';
import type { Reminder } from '../../domain/reminder';

/**
 * scopeReminderToChannel 单元测试（切片 18，提案 §6.2）：
 * 多渠道域模型 → 渠道实现消费的单渠道视角投影（channel/channelConfig 注入）。
 */

const BASE: Reminder = {
  id: 'r1',
  itemId: 'i1',
  frequency: 'daily',
  localTimeHour: 9,
  localTimeMinute: 0,
  weekdays: [],
  dayOfMonth: 0,
  onceAt: null,
  channels: ['system-notification', 'webhook'],
  channelConfigs: { webhook: 'https://example.com/hook' },
  tzid: 'UTC',
  startAt: 1749542400000,
  enabled: true,
  lastFiredOccurrenceKey: null,
  lastReconciledAt: null,
  createdAt: 1749542399999,
  updatedAt: 1749542399999,
};

describe('scopeReminderToChannel（切片 18 多渠道投影）', () => {
  it('注入 channel/channelConfig，其余字段原样共享', () => {
    const scoped = scopeReminderToChannel(BASE, 'webhook');
    expect(scoped.channel).toBe('webhook');
    expect(scoped.channelConfig).toBe('https://example.com/hook');
    expect(scoped.id).toBe('r1');
    expect(scoped.channels).toEqual(['system-notification', 'webhook']);
    expect(scoped.channelConfigs).toEqual({ webhook: 'https://example.com/hook' });
  });

  it('未配置渠道 / expo 渠道 → channelConfig null', () => {
    expect(scopeReminderToChannel(BASE, 'system-notification').channelConfig).toBeNull();
    expect(scopeReminderToChannel({ ...BASE, channelConfigs: {} }, 'webhook').channelConfig).toBeNull();
  });
});
