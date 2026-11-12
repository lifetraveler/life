import * as Notifications from 'expo-notifications';

import { createReminderChannel, isNetworkReminderChannel } from '../channels';
import { AlarmChannel } from '../channels/AlarmChannel';
import { AppriseChannel } from '../channels/AppriseChannel';
import { SystemNotificationChannel } from '../channels/SystemNotificationChannel';
import { WebhookChannel } from '../channels/WebhookChannel';
import { noopRegistry, stubRepositoryWith, testItem, TEST_NOW } from './channelTestSupport';

jest.mock('react-native', () => ({
  Platform: {
    OS: 'android',
    select: (specifics: { ios?: unknown; android?: unknown; default?: unknown }) =>
      specifics.android ?? specifics.ios ?? specifics.default,
  },
}));

jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { MAX: 5 },
  setNotificationChannelAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'scheduled'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  setNotificationHandler: jest.fn(),
}));

const setNotificationChannelAsyncMock = Notifications.setNotificationChannelAsync as jest.Mock;
const scheduleNotificationAsyncMock = Notifications.scheduleNotificationAsync as jest.Mock;

describe('channelFactory 与 AlarmChannel（切片 16 阶段 2）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('工厂：system-notification → SystemNotificationChannel', () => {
    const channel = createReminderChannel('system-notification', {
      repository: stubRepositoryWith(null),
      registry: noopRegistry(),
    });
    expect(channel).toBeInstanceOf(SystemNotificationChannel);
    expect(channel.channel).toBe('system-notification');
  });

  it('工厂：alarm → AlarmChannel（继承 SystemNotificationChannel）', () => {
    const channel = createReminderChannel('alarm', {
      repository: stubRepositoryWith(null),
      registry: noopRegistry(),
    });
    expect(channel).toBeInstanceOf(AlarmChannel);
    expect(channel.channel).toBe('alarm');
  });

  it('工厂：webhook/apprise → 对应网络渠道（网络渠道标记守卫为真）', () => {
    const registry = noopRegistry();
    const webhook = createReminderChannel('webhook', { repository: stubRepositoryWith(null), registry });
    const apprise = createReminderChannel('apprise', { repository: stubRepositoryWith(null), registry });
    expect(webhook).toBeInstanceOf(WebhookChannel);
    expect(apprise).toBeInstanceOf(AppriseChannel);
    if (!isNetworkReminderChannel(webhook) || !isNetworkReminderChannel(apprise)) {
      throw new Error('expected network channels');
    }
    expect(typeof webhook.deliver).toBe('function');
    expect(typeof apprise.deliver).toBe('function');
  });

  it('工厂：fetchImpl 缺省时网络渠道可用 deliver（不在此触发真实请求）', async () => {
    const registry = noopRegistry();
    const channel = createReminderChannel('webhook', { repository: stubRepositoryWith(null), registry });
    if (!isNetworkReminderChannel(channel)) throw new Error('expected network channel');
    // item 缺失 → deliver 走失败分支，不触达网络 fetch。
    const reminder = testReminderFixture('rD', 'webhook', 'https://hook.example/x');
    const status = await channel.deliver(reminder, 'once:rD:1', TEST_NOW);
    expect(status).toBe('failed');
    registry.clearTimers();
  });

  it('AlarmChannel：Android 上先确保通知渠道，再以 channelId 调度', async () => {
    const repository = stubRepositoryWith(testItem('iA', '标题丙'));
    const channel = new AlarmChannel({ repository });
    const reminder = testReminderFixture('rA', 'alarm', null);

    await channel.schedule(reminder, 'once:rA:1', TEST_NOW + 1000);

    expect(setNotificationChannelAsyncMock).toHaveBeenCalledWith('reminder-alarm', {
      name: '提醒闹钟',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 600, 300, 600],
    });
    expect(scheduleNotificationAsyncMock).toHaveBeenCalledTimes(1);
    const request = scheduleNotificationAsyncMock.mock.calls[0][0];
    const trigger = request.trigger as { channelId?: string; type?: string; date?: Date };
    expect(trigger.channelId).toBe('reminder-alarm');
    expect(trigger.type).toBe('date');
  });

  it('AlarmChannel：ensure 通道失败时降级为无 channelId 继续调度', async () => {
    setNotificationChannelAsyncMock.mockRejectedValueOnce(new Error('channel setup failed'));
    const repository = stubRepositoryWith(testItem('iA', '标题丙'));
    const channel = new AlarmChannel({ repository });
    const reminder = testReminderFixture('rA', 'alarm', null);

    await channel.schedule(reminder, 'once:rA:2', TEST_NOW + 1000);

    expect(scheduleNotificationAsyncMock).toHaveBeenCalledTimes(1);
    const trigger = scheduleNotificationAsyncMock.mock.calls[0][0].trigger as { channelId?: string };
    expect(trigger.channelId).toBeUndefined();
  });
});

// 渠道测试不关心 frequency 展开：daily 夹具即可（schedule 直接消费 reminder）。
function testReminderFixture(
  id: string,
  channel: 'system-notification' | 'alarm' | 'webhook' | 'apprise',
  channelConfig: string | null,
) {
  return {
    id,
    itemId: 'iA',
    frequency: 'daily' as const,
    localTimeHour: 9,
    localTimeMinute: 0,
    weekdays: [],
    dayOfMonth: 0,
    onceAt: null,
    channel,
    channelConfig,
    tzid: 'UTC',
    startAt: TEST_NOW,
    enabled: true,
    lastFiredOccurrenceKey: null,
    lastReconciledAt: null,
    createdAt: TEST_NOW - 1,
    updatedAt: TEST_NOW - 1,
  };
}
