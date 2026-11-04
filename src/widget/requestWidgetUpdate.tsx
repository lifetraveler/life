/**
 * App 进程内主动请求小组件重绘（AGENTS §7.16 刷新机制：App 写快照 + requestWidgetUpdate）：
 * - renderWidget 返回 { light, dark } 双色表示，库按系统深色模式选择渲染；
 * - 桌面无实例时 widgetNotFound 静默返回（requestWidgetUpdate 对空实例列表不抛错，
 *   这里显式 no-op 表达“不是错误”）；
 * - 本模块只负责“把给定快照画上去”；快照的生产在 snapshotBridge（触发点 1/2/3）
 *   与 taskHandler（触发点 4）。
 */
import { requestWidgetUpdate } from 'react-native-android-widget';
import type { WidgetSnapshot } from '../domain/widget';
import { TodayWidget } from './TodayWidget';
import { WIDGET_NAME } from './widgetName';

export async function refreshTodayWidgets(snapshot: WidgetSnapshot): Promise<void> {
  await requestWidgetUpdate({
    widgetName: WIDGET_NAME,
    renderWidget: () => ({
      light: <TodayWidget snapshot={snapshot} palette="light" />,
      dark: <TodayWidget snapshot={snapshot} palette="dark" />,
    }),
    widgetNotFound: () => {
      // 桌面尚无本小组件实例：无事可做，也不视为错误
    },
  });
}
