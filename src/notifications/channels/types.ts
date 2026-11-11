/**
 * 切片 16 阶段 2：提醒渠道抽象（提案 docs/proposals/slice-16-reminder-channels.md §2.4）。
 *
 * 设计要点（notifications.md v0.16 增补）：
 * - ReminderChannel 是调度器与具体投递实现之间的统一接口；ReminderScheduler 按
 *   reminder.channel 分发，UI / domain 层不得直接触达 expo-notifications（AGENTS.md §4.3）。
 * - SystemNotificationChannel / AlarmChannel 走 expo-notifications（受 §4.20 500 条
 *   预算与 identifier 必须为 occurrenceKey 的约束）；
 * - WebhookChannel / AppriseChannel 为网络渠道：不向 OS 注册，App 进程内以内存定时器
 *   到点直接 fetch，可靠性边界（at-least-once、仅进程存活时保证）见 notifications.md。
 * - 类型层面不依赖 expo-notifications / react-native，便于纯逻辑单测。
 */
import type { ItemRepository } from '../../data/ItemRepository';
import type { Reminder } from '../../domain/reminder';
import type { NetworkTimerRegistry } from './networkTimers';

/**
 * 提醒渠道 id（domain ReminderChannel 的别名）。
 * 起别名是为了与本文件的核心接口 ReminderChannel（渠道实例）区分。
 */
export type ReminderChannelId = Reminder['channel'];

/**
 * 渠道投递结果：'ok' = 远端确认接收（2xx），'failed' = 投递失败。
 * 失败详情由实现以 console.warn 记录，deliver 本身绝不抛出（吞错返回）。
 */
export type NetworkDeliverStatus = 'ok' | 'failed';

/**
 * 提醒渠道统一接口（提案 §2.4 确认稿）。
 *
 * - schedule：为单个 occurrence 安排投递。fireAt 为该 occurrence 的绝对毫秒触发时刻。
 * - cancel：取消投递。occurrenceKey 给定时取消单个；缺省时取消该 reminder 名下全部。
 */
export interface ReminderChannel {
  readonly channel: ReminderChannelId;
  schedule(reminder: Reminder, occurrenceKey: string, fireAt: number): Promise<void>;
  cancel(reminderId: string, occurrenceKey?: string): Promise<void>;
}

/**
 * 网络渠道扩展接口（webhook / apprise）：
 * - schedule 不向 OS 注册，只登记内存定时器（NetworkTimerRegistry.replace）；
 * - deliver 在到点（定时器触发）或对账补发（reconcile missed）时被调用，
 *   必须吞错返回状态，绝不抛出——调用方无法捕获异步定时器内的异常。
 */
export interface NetworkReminderChannel extends ReminderChannel {
  deliver(
    reminder: Reminder,
    occurrenceKey: string,
    fireAt: number,
  ): Promise<NetworkDeliverStatus>;
}

/** 渠道实例守卫：判断是否为网络渠道（不向 OS 注册、由内存定时器驱动）。 */
export function isNetworkReminderChannel(
  channel: ReminderChannel,
): channel is NetworkReminderChannel {
  return channel.channel === 'webhook' || channel.channel === 'apprise';
}

/** 网络渠道共享依赖（由 channelFactory 组装）。 */
export type NetworkChannelDeps = {
  repository: ItemRepository;
  registry: NetworkTimerRegistry;
  /** 注入点（单测用）；生产由 createReminderChannel 落默认 globalThis.fetch。 */
  fetchImpl: typeof fetch;
  now: () => number;
};
