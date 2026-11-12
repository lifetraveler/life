/**
 * 切片 16 阶段 2：闹钟渠道（提案 §2.6 / AGENTS.md §7.26 渠道实现约束 1）。
 *
 * 采用 expo-notifications 的高优先级全屏通知模拟（Android IMPORTANCE_MAX 通知渠道），
 * 不引入原生 Schedule Exact Alarm 模块。iOS 无通知渠道概念，直接按系统通知调度。
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Reminder } from '../../domain/reminder';
import { describeError } from './shared';
import { SystemNotificationChannel } from './SystemNotificationChannel';
import type { NotificationDateTrigger } from './SystemNotificationChannel';
import type { ReminderChannelId } from './types';

/** 闹钟渠道专用 Android 通知通道 id（§7.26：高优先级全屏通知模拟）。 */
export const ALARM_NOTIFICATION_CHANNEL_ID = 'reminder-alarm';

/** 确保 Android 高优先级通知通道存在（幂等）；非 Android 为 no-op。 */
export async function ensureAlarmNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  await Notifications.setNotificationChannelAsync(ALARM_NOTIFICATION_CHANNEL_ID, {
    name: '提醒闹钟',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 600, 300, 600],
  });
}

export class AlarmChannel extends SystemNotificationChannel {
  readonly channel: ReminderChannelId = 'alarm';

  async schedule(reminder: Reminder, occurrenceKey: string, fireAt: number): Promise<void> {
    const trigger: NotificationDateTrigger = {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(fireAt),
    };
    if (Platform.OS === 'android') {
      try {
        await ensureAlarmNotificationChannel();
        trigger.channelId = ALARM_NOTIFICATION_CHANNEL_ID;
      } catch (error) {
        // 通道创建失败（极少数设备/权限问题）→ 降级为不带 channelId 的普通调度，
        // 不让闹钟提醒整体失败。
        console.warn(`[AlarmChannel] ensure notification channel failed: ${describeError(error)}`);
      }
    }
    await this.scheduleWithTrigger(reminder, occurrenceKey, trigger);
  }
}
