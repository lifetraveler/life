import '../polyfill';

import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import {
  ensureNotificationPermissions,
  initReminderNotifications,
  recordAutoReconcileResult,
  reminderScheduler,
} from '../notifications';
import {
  markNotificationNavigationReady,
  registerNotificationResponseRouting,
} from '../notifications/notificationResponse';

/**
 * App 根布局（切片 5 接线，AGENTS.md §4.20 / §4.16 / §4.19；切片 6 §4.26 增加点击路由）：
 * - 第一行导入 Hermes Intl polyfill（§4.21），必须早于一切 Intl 时间格式化；
 * - 启动时注册通知行为、显式申请 Android 13+ 通知权限（拒绝则降级为无通知）；
 * - 启动与每次回前台执行 reconcile()，幂等可重复调用；
 * - 切片 6（§4.26）：注册通知点击 → Item 详情页路由；冷启动时导航未就绪的
 *   响应先暂存，根导航就绪后冲刷（useRootNavigationState.key 出现即就绪）。
 */
export default function RootLayout() {
  const rootNavigationState = useRootNavigationState();

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

    // 切片 6（§4.26）：通知点击路由。返回退订函数，与上面 AppState 退订合并清理。
    const unsubscribeRouting = registerNotificationResponseRouting();

    return () => {
      subscription.remove();
      unsubscribeRouting();
    };
  }, []);

  // 导航就绪（首次挂载出 key）后允许点击跳转并冲刷冷启动 pending；幂等可重复调用。
  useEffect(() => {
    if (rootNavigationState?.key) {
      markNotificationNavigationReady();
    }
  }, [rootNavigationState?.key]);

  return (
    <>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="index" options={{ title: '生活' }} />
        <Stack.Screen name="today" options={{ title: '今日' }} />
        <Stack.Screen name="week" options={{ title: '本周' }} />
        <Stack.Screen name="archived" options={{ title: '已归档' }} />
        <Stack.Screen name="settings" options={{ title: '设置' }} />
        <Stack.Screen name="import-result" options={{ title: '导入结果' }} />
        <Stack.Screen name="export-success" options={{ title: '导出成功' }} />
        <Stack.Screen name="item/[id]" options={{ title: '详情' }} />
        <Stack.Screen name="item/[id]/edit" options={{ title: '编辑' }} />
      </Stack>
    </>
  );
}
