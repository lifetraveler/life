/**
 * 小组件 Headless 任务处理器（react-native-android-widget WidgetTaskHandler，切片 10）：
 * - 注册点在根 index.ts（先 import 'expo-router/entry' 注册 App，
 *   再 registerWidgetTaskHandler，库官方要求的顺序）；
 * - WIDGET_DELETED：无需渲染（库内 renderWidget 对 DELETED 是 no-op），直接返回；
 * - WIDGET_CLICK：按 clickAction 展开：
 *   OPEN_ITEM → life://item/<itemId>（复用切片 6 item/[id] 路由）；
 *   OPEN_QUICK_ADD → life://quick-add（快速记录）；
 *   SWITCH_PAGE → 写页状态（widget_page_state_v1，阶段 7b 页签切换）后走完整渲染，
 *   不拉起 App（组件内换页是纯组件状态，导航语义除外）；
 *   其余 → 兜底 life://（拉起 App 首页，不吞点击）；
 *   App 未运行时系统冷启动并按 deep link 导航（expo-router 原生 scheme 映射）；
 * - WIDGET_ADDED / WIDGET_UPDATE / WIDGET_RESIZED / SWITCH_PAGE 后的渲染：
 *   先写快照再渲染（契约冻结的数据桥接触发点 4：手动刷新小组件时 WIDGET_UPDATE
 *   action 内先写快照；阶段 7b 起今日+周两张快照都写，保证两页数据同源新鲜）。
 *   快照生产三级兜底（两页同构）：
 *   ① 查库重写成功 → 读回持久化值（渲染与 SharedPreferences 内容保持一致）；
 *   ② 写失败 / 读不到 → 直接读上次持久化值（旧数据优于空白）；
 *   ③ 仍无 → 空输入生成的空快照（保证渲染输入永远是合法形状，不信任存储；
 *      周页兜底快照由 getWidgetWeekDayStarts 供给真实 7 天窗，days 恒 7 组）。
 *   页状态读取失败回退 'today'（narrowWidgetPageState），不影响数据渲染。
 */
import { Linking } from 'react-native';
import type {
  WidgetRepresentation,
  WidgetTaskHandlerProps,
} from 'react-native-android-widget';
import { widgetSnapshotWriter } from '../data';
import {
  buildTodayWidgetSnapshot,
  buildWeekWidgetSnapshot,
  getWidgetWeekDayStarts,
  narrowWidgetPageState,
} from '../domain/widget';
import type { WidgetPageName, WidgetSnapshot, WidgetWeekSnapshot } from '../domain/widget';
import { getDeviceTzid } from '../ui/timeFormat';
import { TodayWidget } from './TodayWidget';

function renderRepresentation(
  page: WidgetPageName,
  snapshot: WidgetSnapshot,
  weekSnapshot: WidgetWeekSnapshot | null,
): WidgetRepresentation {
  return {
    light: <TodayWidget page={page} snapshot={snapshot} weekSnapshot={weekSnapshot} palette="light" />,
    dark: <TodayWidget page={page} snapshot={snapshot} weekSnapshot={weekSnapshot} palette="dark" />,
  };
}

async function produceSnapshotForWidget(nowMs: number, tzid: string): Promise<WidgetSnapshot> {
  try {
    const written = await widgetSnapshotWriter.writeSnapshotFromRepository(nowMs, tzid);
    if (written) {
      const persisted = widgetSnapshotWriter.readSnapshot();
      if (persisted !== null) {
        return persisted;
      }
    }
  } catch (error) {
    console.warn('[WidgetTaskHandler] snapshot write failed, fall back to persisted:', error);
  }
  const persisted = widgetSnapshotWriter.readSnapshot();
  if (persisted !== null) {
    return persisted;
  }
  return buildTodayWidgetSnapshot({ overdue: [], scheduled: [], todos: [], nowMs, tzid });
}

/** 周快照生产（阶段 7b，三级兜底同今日页；兜底空快照带真实 7 天窗）。 */
async function produceWeekSnapshotForWidget(
  nowMs: number,
  tzid: string,
): Promise<WidgetWeekSnapshot | null> {
  try {
    const written = await widgetSnapshotWriter.writeWeekSnapshotFromRepository(nowMs, tzid);
    if (written) {
      const persisted = widgetSnapshotWriter.readWeekSnapshot();
      if (persisted !== null) {
        return persisted;
      }
    }
  } catch (error) {
    console.warn('[WidgetTaskHandler] week snapshot write failed, fall back:', error);
  }
  const persisted = widgetSnapshotWriter.readWeekSnapshot();
  if (persisted !== null) {
    return persisted;
  }
  const { dayStartsMs } = getWidgetWeekDayStarts(nowMs, tzid);
  return buildWeekWidgetSnapshot({ items: [], dayStartsMs, nowMs, tzid });
}

async function openWidgetClickTarget(
  clickAction: string | undefined,
  clickActionData: Record<string, unknown> | undefined,
): Promise<void> {
  let url = 'life://';
  if (clickAction === 'OPEN_ITEM') {
    const itemId = clickActionData?.itemId;
    if (typeof itemId === 'string') {
      url = `life://item/${itemId}`;
    }
  } else if (clickAction === 'OPEN_QUICK_ADD') {
    url = 'life://quick-add';
  }
  try {
    await Linking.openURL(url);
  } catch (error) {
    console.warn('[WidgetTaskHandler] open url failed:', url, error);
  }
}

/** 写两张快照 + 读页状态 → 整体渲染（触发点 4 与 SWITCH_PAGE 共用渲染管线）。 */
async function renderCurrentWidget(
  renderWidget: WidgetTaskHandlerProps['renderWidget'],
): Promise<void> {
  const nowMs = Date.now();
  const tzid = getDeviceTzid();
  const [snapshot, weekSnapshot] = await Promise.all([
    produceSnapshotForWidget(nowMs, tzid),
    produceWeekSnapshotForWidget(nowMs, tzid),
  ]);
  const page = widgetSnapshotWriter.readPageState();
  renderWidget(renderRepresentation(page, snapshot, weekSnapshot));
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const { widgetAction, clickAction, clickActionData, renderWidget } = props;
  if (widgetAction === 'WIDGET_DELETED') {
    return;
  }
  if (widgetAction === 'WIDGET_CLICK') {
    if (clickAction === 'SWITCH_PAGE') {
      // 页签切换（阶段 7b）：持久化目标页（损坏数据 narrow 回 'today'）→ 完整渲染。
      // 写失败不阻断渲染：页状态只是偏好，读侧 narrow 同样兜底，最坏回今日页。
      widgetSnapshotWriter.writePageState(narrowWidgetPageState(clickActionData));
      await renderCurrentWidget(renderWidget);
      return;
    }
    await openWidgetClickTarget(clickAction, clickActionData);
    return;
  }
  // WIDGET_ADDED / WIDGET_UPDATE / WIDGET_RESIZED
  await renderCurrentWidget(renderWidget);
}
