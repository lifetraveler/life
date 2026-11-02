/**
 * notifications 模块出口（tasks/slice-05.md）。
 *
 * - App 代码统一从这里拿 reminderScheduler / 纯函数；
 *   本目录之外的文件不得 import expo-notifications（AGENTS.md §4.20）。
 */

import { itemRepository } from '../data';
import type { ReconcileResult } from '../domain/reminder';
import { WatermelonReminderScheduler, configureNotificationHandler } from './ReminderScheduler';

export { WatermelonReminderScheduler, configureNotificationHandler } from './ReminderScheduler';
export type {
  ReminderScheduler,
  ReminderSchedulerDeps,
} from './ReminderScheduler';
export {
  IDENTIFIER_ROOT_PREFIX,
  computeMissed,
  diffNotifications,
  reminderIdentifierPrefix,
} from './reconcileDiff';
export type { NotificationDiff } from './reconcileDiff';
export {
  ensureNotificationPermissions,
  getNotificationPermissionState,
} from './permissions';
export type { NotificationPermissionState } from './permissions';

/** App 级调度器单例：绑定 data 层仓库单例。 */
export const reminderScheduler = new WatermelonReminderScheduler({
  repository: itemRepository,
});

/** app 入口调用：注册前台通知展示行为（幂等）。 */
export function initReminderNotifications(): void {
  configureNotificationHandler();
}

/**
 * 最近一次「启动/回前台自动对账」的返回值（仅观测用，调试页展示）。
 * 写入方是 app/_layout 的 reconcileNow；手动对账不经过这里。
 */
let lastAutoReconcileResult: ReconcileResult | null = null;

export function recordAutoReconcileResult(result: ReconcileResult): void {
  lastAutoReconcileResult = result;
}

export function getLastAutoReconcileResult(): ReconcileResult | null {
  return lastAutoReconcileResult;
}
