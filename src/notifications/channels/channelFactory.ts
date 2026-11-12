/**
 * 切片 16 阶段 2：渠道工厂（提案 §2.4）——ReminderScheduler 唯一的渠道实例来源。
 * 穷尽 switch：新增 ReminderChannel 枚举值时此处编译报错，防止漏实现。
 */
import type { ItemRepository } from '../../data/ItemRepository';
import type { ReminderChannel as ReminderChannelId } from '../../domain/reminder';
import { AppriseChannel } from './AppriseChannel';
import { AlarmChannel } from './AlarmChannel';
import { WebhookChannel } from './WebhookChannel';
import { SystemNotificationChannel } from './SystemNotificationChannel';
import type { NetworkTimerRegistry } from './networkTimers';
import type { NetworkChannelDeps, NetworkReminderChannel, ReminderChannel } from './types';

export type ReminderChannelFactoryDeps = {
  repository: ItemRepository;
  registry: NetworkTimerRegistry;
  /** 网络渠道 fetch 注入（测试用）；缺省 globalThis.fetch。 */
  fetchImpl?: typeof fetch;
  /** 网络渠道时钟注入（测试用）；缺省 Date.now。 */
  now?: () => number;
};

/** 按渠道 id 构造渠道实例（穷尽 switch）。 */
export function createReminderChannel(
  channel: ReminderChannelId,
  deps: ReminderChannelFactoryDeps,
): ReminderChannel {
  switch (channel) {
    case 'system-notification':
      return new SystemNotificationChannel({ repository: deps.repository });
    case 'alarm':
      return new AlarmChannel({ repository: deps.repository });
    case 'webhook':
    case 'apprise':
      return createNetworkChannel(channel, deps);
  }
}

function createNetworkChannel(
  channel: 'webhook' | 'apprise',
  deps: ReminderChannelFactoryDeps,
): NetworkReminderChannel {
  const networkDeps: NetworkChannelDeps = {
    repository: deps.repository,
    registry: deps.registry,
    fetchImpl: deps.fetchImpl ?? globalThis.fetch,
    now: deps.now ?? Date.now,
  };
  return channel === 'webhook' ? new WebhookChannel(networkDeps) : new AppriseChannel(networkDeps);
}
