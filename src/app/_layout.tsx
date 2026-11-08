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
import { initWidgetSnapshotBridge } from '../widget';

/** 切片 11：cold start 距上次对账超过该阈值才 forceRebuild（notifications.md v0.11）。 */
const FORCE_REBUILD_THRESHOLD_MS = 60_000;

/**
 * App 根布局（切片 5 接线，AGENTS.md §4.20 / §4.16 / §4.19；切片 6 §4.26 增加点击路由；
 * 切片 10 §7.16 增加小组件快照桥；切片 14 阶段 5 增加底部 Tab 布局 (tabs)）：
 * - 第一行导入 Hermes Intl polyfill（§4.21），必须早于一切 Intl 时间格式化；
 * - 启动时注册通知行为、显式申请 Android 13+ 通知权限（拒绝则降级为无通知）；
 * - 启动与每次回前台执行 reconcile()，幂等可重复调用；
 * - 切片 6（§4.26）：注册通知点击 → Item 详情页路由；冷启动时导航未就绪的
 *   响应先暂存，根导航就绪后冲刷（useRootNavigationState.key 出现即就绪）；
 * - 切片 10（§7.16）：挂载小组件快照桥（启动/回前台/数据变更三触发点写快照并
 *   requestWidgetUpdate；清理函数随 useEffect cleanup 退订，不影响通知逻辑）；
 * - 切片 14 阶段 5：主页 index 与设置 settings 移入 (tabs)（底部四 Tab：闪电/
 *   事项/计划/我的），根 Stack 以 (tabs) 单屏承载，headerShown:false（Tab 页
 *   自管顶部）；新增 item/new 全屏新建页（FAB 与 quick-add 落点）。
 */
export default function RootLayout() {
  const rootNavigationState = useRootNavigationState();

  useEffect(() => {
    initReminderNotifications();
    void ensureNotificationPermissions().catch((error: unknown) => {
      console.warn('[slice-05] 通知权限申请失败，降级为无通知', error);
    });

    const reconcileNow = (options?: { forceRebuild?: boolean }): void => {
      void reminderScheduler
        .reconcile(options)
        .then((result) => {
          recordAutoReconcileResult(result);
        })
        .catch((error: unknown) => {
          console.warn('[slice-05] reconcile 失败', error);
        });
    };
    // 切片 11（notifications.md v0.11）：仅 cold start 判断是否强制重建——
    // force-stop / install -r / pm clear 会清掉 AlarmManager 真实闹钟而
    // expo SharedPreferences 注册表残留（幽灵注册表），纯 diff 会误判一致、
    // 通知永不触发。距上次对账（DB lastReconciledAt，决议②）> 60s 或从无
    // 记录 → forceRebuild；前台恢复 / 数据变更路径走默认 diff。
    void reminderScheduler
      .getLastReconciledAt()
      .then((lastReconciledAt) => {
        const forceRebuild =
          lastReconciledAt === null ||
          Date.now() - lastReconciledAt > FORCE_REBUILD_THRESHOLD_MS;
        reconcileNow({ forceRebuild });
      })
      .catch((error: unknown) => {
        console.warn('[slice-11] getLastReconciledAt 失败，走默认 diff 对账', error);
        reconcileNow();
      });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        reconcileNow();
      }
    });

    // 切片 6（§4.26）：通知点击路由。返回退订函数，与上面 AppState 退订合并清理。
    const unsubscribeRouting = registerNotificationResponseRouting();

    // 切片 10（§7.16）：小组件快照桥（触发点 1/2/3；触发点 4 在 taskHandler）。
    const cleanupWidgetSnapshotBridge = initWidgetSnapshotBridge();

    return () => {
      subscription.remove();
      unsubscribeRouting();
      cleanupWidgetSnapshotBridge();
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
        {/* 切片 14 阶段 5：底部 Tab 布局（index/settings 移入 (tabs)，无导航头） */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="today" options={{ title: '今日' }} />
        <Stack.Screen name="week" options={{ title: '本周' }} />
        <Stack.Screen name="archived" options={{ title: '已归档' }} />
        {/* 切片 14 阶段 3：分类/标签视觉配置页（tasks/slice-14.md 阶段 3） */}
        <Stack.Screen name="settings/categories" options={{ title: '分类管理' }} />
        <Stack.Screen name="settings/tags" options={{ title: '标签管理' }} />
        <Stack.Screen name="import-result" options={{ title: '导入结果' }} />
        <Stack.Screen name="system-calendar-import" options={{ title: '导入系统日历' }} />
        <Stack.Screen name="export-success" options={{ title: '导出成功' }} />
        <Stack.Screen name="item/[id]" options={{ title: '详情' }} />
        <Stack.Screen name="item/[id]/edit" options={{ title: '编辑' }} />
        {/* 切片 14 阶段 5：全屏新建页（计划页 FAB 与 quick-add 落点） */}
        <Stack.Screen name="item/new" options={{ title: '新建' }} />
        {/* 切片 10：life://quick-add 落点（纯重定向，无头瞬跳） */}
        <Stack.Screen name="quick-add" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
