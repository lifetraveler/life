/**
 * 快照桥（AGENTS §7.16 数据桥接触发点 1/2/3；触发点 4 在 taskHandler）：
 * - 触发点 1 启动后：挂载时立即刷新一次；
 * - 触发点 2 App 回前台：重订数据变更订阅（today 时间窗随日期/跨天漂移，必须按当下
 *   重取 nowMs 重算范围），再做一次前台刷新；
 * - 触发点 3 Item/Reminder 数据变更：订阅切片 7 观察者 observeOverdueItems /
 *   observeScheduledItemsInRange / observeUnscheduledItems（WatermelonDB 响应式查询，
 *   不新增轮询，契约要求），500ms trailing 去抖后刷新（连续变更只刷一次）；
 * - 刷新 = 查库生成快照写 SharedPreferences（契约冻结键；阶段 7b 起今日 + 周两张
 *   都写，页签两页数据同源新鲜）→ 读回 → 按页状态渲染（refreshWidgetViews）；
 * - 返回清理函数：退订 AppState、观察者、清掉未触发的去抖计时器（_layout 卸载时调用）；
 * - 所有失败仅 warn 不上抛：小组件刷新失败不影响 App 主流程；
 * - refreshWidgetDataNow 另行导出：设置页改小组件开关后手动触发同一管线
 *   （桥不订阅 app_settings，7a 起的约定）。
 */
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { itemRepository, widgetSnapshotWriter } from '../data';
import { buildTodayWidgetSnapshot } from '../domain/widget';
import type { WidgetSnapshot } from '../domain/widget';
import { getTodayRange } from '../domain/views/ranges';
import { getDeviceTzid } from '../ui/timeFormat';
import { refreshWidgetViews } from './requestWidgetUpdate';
import { readWidgetDisplayOptions } from './widgetDisplay';

const DATA_CHANGE_DEBOUNCE_MS = 500;

/**
 * 立即刷新两张快照并按当前页重绘（阶段 7b）：
 * 今日快照读取失败时兜底空快照（渲染输入恒合法形状）；周快照 null 由
 * TodayWidget 占位文案兜底；两张都读不到才跳过渲染（无可画数据）。
 */
export async function refreshWidgetDataNow(reason: string): Promise<void> {
  const nowMs = Date.now();
  const tzid = getDeviceTzid();
  try {
    const [writtenToday, writtenWeek] = await Promise.all([
      widgetSnapshotWriter.writeSnapshotFromRepository(nowMs, tzid),
      widgetSnapshotWriter.writeWeekSnapshotFromRepository(nowMs, tzid),
    ]);
    if (!writtenToday && !writtenWeek) {
      return;
    }
  } catch (error) {
    console.warn(`[WidgetSnapshotBridge] refreshWidgetDataNow(${reason}) write failed:`, error);
  }
  try {
    const snapshot: WidgetSnapshot | null = widgetSnapshotWriter.readSnapshot();
    const weekSnapshot = widgetSnapshotWriter.readWeekSnapshot();
    if (snapshot === null && weekSnapshot === null) {
      return;
    }
    const safeSnapshot: WidgetSnapshot =
      snapshot ?? buildTodayWidgetSnapshot({ overdue: [], scheduled: [], todos: [], nowMs, tzid });
    // 显示选项（阶段 7c）：每次渲染前读当下 app_settings，与快照解耦——
    // 设置页改开关后走本函数重写快照并重绘，渲染输入恒新鲜。
    const display = await readWidgetDisplayOptions();
    await refreshWidgetViews({
      page: widgetSnapshotWriter.readPageState(),
      snapshot: safeSnapshot,
      weekSnapshot,
      display,
    });
  } catch (error) {
    console.warn(`[WidgetSnapshotBridge] refreshWidgetDataNow(${reason}) render failed:`, error);
  }
}

export function initWidgetSnapshotBridge(): () => void {
  let disposed = false;
  let unsubscribeDataChanges: (() => void) | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const refreshNow = (reason: string): Promise<void> => {
    if (disposed) {
      return Promise.resolve();
    }
    return refreshWidgetDataNow(reason);
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
    // 阶段 7a：待办组数据源（widgetShowTodos 开启时进快照）。开关本身不入订阅
    // （桥不订阅 app_settings，设置页改完开关自行触发刷新）；这里恒订阅，
    // 待办增删/行内变更只在下次写快照时按当下配置消费。
    const unsubscribeUnscheduled = itemRepository.observeUnscheduledItems(
      scheduleDataChangeRefresh,
    );
    unsubscribeDataChanges = () => {
      unsubscribeOverdue();
      unsubscribeScheduled();
      unsubscribeUnscheduled();
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
