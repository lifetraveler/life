import '../polyfill';

import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import {
  ensureNotificationPermissions,
  initReminderNotifications,
  recordAutoReconcileResult,
  reminderScheduler,
} from '../notifications';

/**
 * App 根布局（切片 5 接线，AGENTS.md §4.20 / §4.16 / §4.19）：
 * - 第一行导入 Hermes Intl polyfill（§4.21），必须早于一切 Intl 时间格式化；
 * - 启动时注册通知行为、显式申请 Android 13+ 通知权限（拒绝则降级为无通知）；
 * - 启动与每次回前台执行 reconcile()，幂等可重复调用。
 */
export default function RootLayout() {
  useEffect(() => {
    initReminderNotifications();
    void ensureNotificationPermissions().catch((error: unknown) => {
      console.warn('[slice-05] 通知权限申请失败，降级为无通知', error);
    });

    const reconcileNow = (): void => {
      void reminderScheduler
        .reconcile()
        .then((result) => {
          recordAutoReconcileResult(result);
        })
        .catch((error: unknown) => {
          console.warn('[slice-05] reconcile 失败', error);
        });
    };
    reconcileNow();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        reconcileNow();
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="index" options={{ title: '生活' }} />
        <Stack.Screen name="archived" options={{ title: '已归档' }} />
      </Stack>
    </>
  );
}
