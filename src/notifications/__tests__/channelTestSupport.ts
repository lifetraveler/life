import type { Item } from '../../domain/item';
import type { ItemRepository } from '../../data/ItemRepository';
import type { Reminder } from '../../domain/reminder';
import { scopeReminderToChannel } from '../channels';
import type { ScopedReminder } from '../channels';
import { NetworkTimerRegistry } from '../channels/networkTimers';

/**
 * 渠道单测共用夹具（切片 16 阶段 2）。
 * 与 ReminderScheduler.test.ts 的 FakeRepository 分开：渠道测试只依赖 getItem，
 * 其余方法经 Proxy 桩抛错，意外调用会让测试失败（测试卫生）。
 */

// 与 ReminderScheduler.test.ts 相同的固定时钟锚点：2025-06-10T08:00:00Z。
export const TEST_NOW = 1749542400000;

export function testItem(id: string, title: string): Item {
  return {
    id,
    type: 'note',
    title,
    content: '测试内容',
    status: 'active',
    startAt: null,
    endAt: null,
    allDay: false,
    sourceType: 'local',
    sourceUid: null,
    sourceReadOnly: false,
    categoryId: 'other',
    priority: 0,
    createdAt: TEST_NOW - 1,
    updatedAt: TEST_NOW - 1,
  };
}

/**
 * 单渠道夹具（切片 18 适配）：按多渠道域模型构造单渠道 Reminder，
 * 再经 scopeReminderToChannel 收敛为渠道实现消费的单渠道视角投影。
 * 返回 ScopedReminder（Reminder 超集），deliver/schedule 直接消费。
 */
export function testReminder(
  id: string,
  itemId: string,
  channel: Reminder['channels'][number],
  channelConfig: string | null,
): ScopedReminder {
  const reminder: Reminder = {
    id,
    itemId,
    frequency: 'daily',
    localTimeHour: 9,
    localTimeMinute: 0,
    weekdays: [],
    dayOfMonth: 0,
    onceAt: null,
    channels: [channel],
    channelConfigs: channelConfig !== null ? { [channel]: channelConfig } : {},
    tzid: 'UTC',
    startAt: TEST_NOW,
    enabled: true,
    lastFiredOccurrenceKey: null,
    lastReconciledAt: null,
    createdAt: TEST_NOW - 1,
    updatedAt: TEST_NOW - 1,
  };
  return scopeReminderToChannel(reminder, channel);
}

/**
 * 只实现 getItem 的仓库桩：通过 Proxy 使其余 ItemRepository 方法在调用时抛错。
 * 空对象到 ItemRepository 的 cast 合法（ItemRepository 可赋值给 {}），不经过 any。
 */
export function stubRepositoryWith(item: Item | null): ItemRepository {
  const base = {};
  return new Proxy(base, {
    get(_target, prop) {
      if (prop === 'getItem') {
        return async () => item;
      }
      throw new Error(`unexpected repository call: ${String(prop)}`);
    },
  }) as ItemRepository;
}

export function noopRegistry(now: () => number = () => TEST_NOW): NetworkTimerRegistry {
  return new NetworkTimerRegistry({ now, onFire: () => undefined });
}
