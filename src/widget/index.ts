/**
 * 小组件模块出口（切片 10；阶段 7b 更名 refreshWidgetViews + 新增 refreshWidgetDataNow）：
 * - WIDGET_NAME / TodayWidget / refreshWidgetViews：App 进程渲染与刷新；
 * - initWidgetSnapshotBridge：_layout 挂载的快照桥（触发点 1/2/3）；
 * - refreshWidgetDataNow：立即重写两张快照并按页状态渲染（设置页开关等手动触发）；
 * - widgetTaskHandler：根 index.ts 注册的 Headless 任务处理器（触发点 4 + 点击展开 +
 *   阶段 7b SWITCH_PAGE 页签切换）。
 */
export { WIDGET_NAME } from './widgetName';
export { TodayWidget } from './TodayWidget';
export type { TodayWidgetPaletteName } from './TodayWidget';
export { refreshWidgetViews } from './requestWidgetUpdate';
export type { WidgetViews } from './requestWidgetUpdate';
export { initWidgetSnapshotBridge, refreshWidgetDataNow } from './snapshotBridge';
export { widgetTaskHandler } from './taskHandler';
