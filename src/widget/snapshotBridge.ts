/**
 * 快照桥（AGENTS §7.16 数据桥接触发点 1/2/3；触发点 4 在 taskHandler）：
 * - 触发点 1 启动后：挂载时立即刷新一次；
 * - 触发点 2 App 回前台：重订数据变更订阅（today 时间窗随日期/跨天漂移，必须按当下
 *   重取 nowMs 重算范围），再做一次前台刷新；
 * - 触发点 3 Item/Reminder 数据变更：订阅切片 7 观察者 observeOverdueItems /
 *   observeScheduledItemsInRange（WatermelonDB 响应式查询，不新增轮询，契约要求），
 *   500ms trailing 去抖后刷新（连续变更只刷一次）；
 * - 刷新 = 查库生成快照写 SharedPreferences（契约冻结键）→ 读回 → requestWidgetUpdate；
 * - 返回清理函数：退订 AppState、观察者、清掉未触发的去抖计时器（_layout 卸载时调用）；
 * - 所有失败仅 warn 不上抛：小组件刷新失败不影响 App 主流程。
 */
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { itemRepository, widgetSnapshotWriter } from '../data';
import { getTodayRange } from '../domain/views/ranges';
import { getDeviceTzid } from '../ui/timeFormat';
import { refreshTodayWidgets } from './requestWidgetUpdate';

const DATA_CHANGE_DEBOUNCE_MS = 500;

export function initWidgetSnapshotBridge(): () => void {
  let disposed = false;
  let unsubscribeDataChanges: (() => void) | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const refreshNow = async (reason: string): Promise<void> => {
    if (disposed) {
      return;
    }
    try {
      const nowMs = Date.now();
      const tzid = getDeviceTzid();
      const written = await widgetSnapshotWriter.writeSnapshotFromRepository(nowMs, tzid);
      if (!written) {
        return;
      }
      const snapshot = widgetSnapshotWriter.readSnapshot();
      if (snapshot !== null) {
        await refreshTodayWidgets(snapshot);
      }
    } catch (error) {
      console.warn(`[WidgetSnapshotBridge] refreshNow(${reason}) failed:`, error);
    }
  };

  const scheduleDataChangeRefresh = (): void => {
    if (disposed) {
      return;
    }
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void refreshNow('data-change');
    }, DATA_CHANGE_DEBOUNCE_MS);
  };

  const subscribeToDataChanges = (): void => {
    unsubscribeDataChanges?.();
    unsubscribeDataChanges = null;
    if (disposed) {
      return;
    }
    const nowMs = Date.now();
    const tzid = getDeviceTzid();
    const todayRange = getTodayRange(nowMs, tzid);
    const unsubscribeOverdue = itemRepository.observeOverdueItems(
      nowMs,
      scheduleDataChangeRefresh,
    );
    const unsubscribeScheduled = itemRepository.observeScheduledItemsInRange(
      todayRange.startMs,
      todayRange.endMs,
      scheduleDataChangeRefresh,
    );
    unsubscribeDataChanges = () => {
      unsubscribeOverdue();
      unsubscribeScheduled();
    };
  };

  const handleAppStateChange = (state: AppStateStatus): void => {
    if (state === 'active') {
      // 先重订（窗口漂移），再前台刷新
      subscribeToDataChanges();
      void refreshNow('foreground');
    }
  };

  subscribeToDataChanges();
  void refreshNow('launch');
  const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

  return () => {
    disposed = true;
    appStateSubscription.remove();
    unsubscribeDataChanges?.();
    unsubscribeDataChanges = null;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };
}
