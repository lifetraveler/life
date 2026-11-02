/**
 * 通知权限（AGENTS.md §4.20）：
 * Android 13+ 的 POST_NOTIFICATIONS 必须显式申请；拒绝后降级为「无通知」而不是崩溃。
 * 本文件位于 src/notifications/ 内，是少数允许直接 import expo-notifications 的模块。
 */
import * as Notifications from 'expo-notifications';

export type NotificationPermissionState = 'granted' | 'denied' | 'undetermined';

/** 读取当前权限状态，不弹任何对话框。 */
export async function getNotificationPermissionState(): Promise<NotificationPermissionState> {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) {
    return 'granted';
  }
  return settings.status;
}

/**
 * 显式申请通知权限：
 * - 已授权 → 直接返回 granted；
 * - 未决定且系统允许再次询问 → 弹出系统权限对话框；
 * - 已拒绝且不可再询问 → 返回 denied（调用方自行降级，不得崩溃）。
 */
export async function ensureNotificationPermissions(): Promise<NotificationPermissionState> {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) {
    return 'granted';
  }
  if (!settings.canAskAgain) {
    return 'denied';
  }
  const requested = await Notifications.requestPermissionsAsync();
  if (requested.granted) {
    return 'granted';
  }
  return requested.status;
}
