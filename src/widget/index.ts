/**
 * 小组件模块出口（切片 10）：
 * - WIDGET_NAME / TodayWidget / refreshTodayWidgets：App 进程渲染与刷新；
 * - initWidgetSnapshotBridge：_layout 挂载的快照桥（触发点 1/2/3）；
 * - widgetTaskHandler：根 index.ts 注册的 Headless 任务处理器（触发点 4 + 点击展开）。
 */
export { WIDGET_NAME } from './widgetName';
export { TodayWidget } from './TodayWidget';
export type { TodayWidgetPaletteName } from './TodayWidget';
export { refreshTodayWidgets } from './requestWidgetUpdate';
export { initWidgetSnapshotBridge } from './snapshotBridge';
export { widgetTaskHandler } from './taskHandler';
