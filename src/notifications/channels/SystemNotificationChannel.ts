/**
 * 切片 16 阶段 2：系统通知渠道（默认渠道）——原 ReminderScheduler 的
 * expo-notifications 调度逻辑迁入渠道实现（行为不变，§4.20 约束原样生效：
 * identifier 必须为 occurrenceKey、500 条预算由调度器把关）。
 */
import * as Notifications from 'expo-notifications';
import type { Reminder } from '../../domain/reminder';
import type { ItemRepository } from '../../data/ItemRepository';
import { notificationBody } from './shared';
import type { ReminderChannel, ReminderChannelId } from './types';
import { onceReminderPrefix, reminderIdentifierPrefix } from '../reconcileDiff';

/** DATE 触发器形状（expo SDK 54：{ type: 'date', date, channelId? }）。 */
export type NotificationDateTrigger = {
  type: typeof Notifications.SchedulableTriggerInputTypes.DATE;
  date: Date;
  channelId?: string;
};

export type SystemNotificationChannelDeps = {
  repository: ItemRepository;
};

export class SystemNotificationChannel implements ReminderChannel {
  readonly channel: ReminderChannelId = 'system-notification';
  protected readonly deps: SystemNotificationChannelDeps;

  constructor(deps: SystemNotificationChannelDeps) {
    this.deps = deps;
  }

  async schedule(reminder: Reminder, occurrenceKey: string, fireAt: number): Promise<void> {
    await this.scheduleWithTrigger(reminder, occurrenceKey, {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(fireAt),
    });
  }

  /**
   * 实际的 expo 注册入口；AlarmChannel 覆写以注入高优先级 channelId。
   * item 内容在此取（与原 safeSchedule 一致）；item 缺失/失活必须抛错，
   * 由调度器的 try/catch 记录——静默跳过会让用户以为提醒已安排。
   */
  protected async scheduleWithTrigger(
    reminder: Reminder,
    occurrenceKey: string,
    trigger: NotificationDateTrigger,
  ): Promise<void> {
    const item = await this.deps.repository.getItem(reminder.itemId);
    if (!item || item.status !== 'active') {
      throw new Error(
        `SystemNotificationChannel: item ${reminder.itemId} missing or not active, cannot schedule ${occurrenceKey}`,
      );
    }
    await Notifications.scheduleNotificationAsync({
      identifier: occurrenceKey,
      content: {
        title: item.title,
        body: notificationBody(item),
        data: {
          occurrenceKey,
          reminderId: reminder.id,
          itemId: item.id,
        },
      },
      trigger,
    });
  }

  async cancel(reminderId: string, occurrenceKey?: string): Promise<void> {
    if (occurrenceKey !== undefined) {
      await Notifications.cancelScheduledNotificationAsync(occurrenceKey);
      return;
    }
    // 无 occurrenceKey：清该 reminder 名下全部 expo 通知（双族前缀）。
    const prefixes = [reminderIdentifierPrefix(reminderId), onceReminderPrefix(reminderId)];
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notification of scheduled) {
      const identifier = notification.identifier;
      if (prefixes.some((prefix) => identifier.startsWith(prefix))) {
        await Notifications.cancelScheduledNotificationAsync(identifier);
      }
    }
  }
}
