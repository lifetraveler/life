/**
 * 切片 16 阶段 2：渠道抽象出口。
 * 调度器只经此处 import 渠道；渠道实现文件（expo/react-native 相关）保持在
 * src/notifications/ 内，UI / domain 层不得越界 import（AGENTS.md §4.3）。
 */
export type {
  NetworkChannelDeps,
  NetworkDeliverStatus,
  NetworkReminderChannel,
  ReminderChannel,
  ReminderChannelId,
  ScopedReminder,
} from './types';
export { isNetworkReminderChannel, scopeReminderToChannel } from './types';
export { NetworkTimerRegistry, networkTimerKey } from './networkTimers';
export type { NetworkAttemptStatus, NetworkTimerEntry } from './networkTimers';
export { createReminderChannel } from './channelFactory';
export type { ReminderChannelFactoryDeps } from './channelFactory';
export { ensureAlarmNotificationChannel, ALARM_NOTIFICATION_CHANNEL_ID } from './AlarmChannel';
export { parseAppriseChannelConfig } from './appriseConfig';
export type { AppriseChannelConfig } from './appriseConfig';
