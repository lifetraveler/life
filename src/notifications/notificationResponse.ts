/**
 * 切片 6（AGENTS.md §4.26）：通知点击 → Item 详情页路由桥接。
 *
 * 三种路径契约：
 * - 前台 / 后台（App 进程存活）：addNotificationResponseReceivedListener；
 * - 冷启动（进程被杀后点通知启动）：getLastNotificationResponse() 取启动响应；
 * - 冷启动时导航栈可能尚未就绪：先暂存 pending，待根导航就绪后由
 *   markNotificationNavigationReady() 冲刷（在 _layout.tsx 挂接）；冲刷若仍
 *   未就绪（useRootNavigationState.key 早于 router.isReady，实测存在）则保留
 *   pending 按固定间隔重试。
 *
 * 行为边界（§4.26）：只做导航；不得自动标记 Item 完成，不得自动 acknowledge missed。
 * 本文件在 src/notifications/ 下，允许 import expo-notifications；UI 层不感知。
 */

import * as Notifications from 'expo-notifications';
import type { NotificationResponse } from 'expo-notifications';
import { router } from 'expo-router';

/** 同一响应可能经“冷启动取回”与“listener 回放”两条路到达（设备差异），短窗去重。 */
const DEDUP_WINDOW_MS = 2000;
/**
 * 冷启动实测（MuMu，2026-11-03）：useRootNavigationState 首个 key 出现时
 * expo-router 内部 navigationRef 仍未 isReady，同步冲刷会抛
 * “Attempted to navigate before mounting the Root Layout component”。
 * 因此冲刷失败保留 pending，按固定间隔重试，就绪后自然成功。
 */
const NAVIGATE_RETRY_MS = 100;
const NAVIGATE_RETRY_MAX = 50;

let pendingItemId: string | null = null;
let navigationReady = false;
let lastHandled: { identifier: string; at: number } | null = null;
let navigateRetryTimer: ReturnType<typeof setTimeout> | null = null;
let navigateRetryCount = 0;

/** §4.26：通知 data 必须含 itemId（切片 5 写入）；取不到（非本 App 通知/契约缺失）则忽略。 */
function extractItemId(response: NotificationResponse): string | null {
  const data = response.notification.request.content.data;
  const itemId = data?.itemId;
  return typeof itemId === 'string' && itemId.length > 0 ? itemId : null;
}

/** 返回 true = 已跳转；false = 根导航容器尚未就绪（由重试机制兜底）。 */
function navigateToItem(itemId: string): boolean {
  try {
    router.navigate(`/item/${itemId}`);
    return true;
  } catch {
    // expo-router assertIsReady：Root Layout 尚未挂载完成。
    return false;
  }
}

function clearNavigateRetry(): void {
  if (navigateRetryTimer !== null) {
    clearTimeout(navigateRetryTimer);
    navigateRetryTimer = null;
  }
  navigateRetryCount = 0;
}

function schedulePendingFlush(): void {
  if (navigateRetryTimer !== null) {
    return;
  }
  if (navigateRetryCount >= NAVIGATE_RETRY_MAX) {
    console.warn('[slice-06] 通知点击导航重试超限，放弃冲刷', pendingItemId);
    pendingItemId = null;
    clearNavigateRetry();
    return;
  }
  navigateRetryCount += 1;
  navigateRetryTimer = setTimeout(() => {
    navigateRetryTimer = null;
    flushPending();
  }, NAVIGATE_RETRY_MS);
}

function flushPending(): void {
  if (pendingItemId === null) {
    return;
  }
  const itemId = pendingItemId;
  if (navigateToItem(itemId)) {
    pendingItemId = null;
    clearNavigateRetry();
  } else {
    schedulePendingFlush();
  }
}

function handleResponse(response: NotificationResponse): void {
  const itemId = extractItemId(response);
  if (itemId === null) {
    return;
  }

  const identifier = response.notification.request.identifier;
  const now = Date.now();
  if (lastHandled && lastHandled.identifier === identifier && now - lastHandled.at < DEDUP_WINDOW_MS) {
    return;
  }
  lastHandled = { identifier, at: now };

  if (navigationReady) {
    if (!navigateToItem(itemId)) {
      pendingItemId = itemId;
      schedulePendingFlush();
    }
  } else {
    // 冷启动且导航未就绪：暂存，等 markNotificationNavigationReady() 冲刷。
    pendingItemId = itemId;
  }
}

/**
 * 注册响应监听并取回冷启动启动响应；返回退订函数（挂进 _layout useEffect 即可）。
 * 本函数不要求导航已就绪——未就绪期间的响应会进入 pending 缓冲。
 */
export function registerNotificationResponseRouting(): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);

  // 冷启动：App 由通知点开时，响应不会重放给 listener（进程当时不存在），
  // 必须主动取回启动响应。同步 API（0.32），与旧 getLastNotificationResponseAsync 等价。
  const launchResponse = Notifications.getLastNotificationResponse();
  if (launchResponse) {
    handleResponse(launchResponse);
  }

  return (): void => {
    subscription.remove();
  };
}

/** 根导航就绪后由 _layout 调用（可多次调用，幂等）：置位并冲刷 pending。 */
export function markNotificationNavigationReady(): void {
  navigationReady = true;
  flushPending();
}
