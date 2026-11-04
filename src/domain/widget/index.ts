/**
 * 今日待办小组件快照领域模块（切片 10）：
 * 纯 TypeScript，不依赖 React Native / WatermelonDB；
 * App 侧（WidgetSnapshotWriter）与单测共用此处类型与纯函数。
 */

export {
  WIDGET_SNAPSHOT_PREFS_KEY,
  WIDGET_SNAPSHOT_MAX_PER_GROUP,
  buildTodayWidgetSnapshot,
} from './snapshot';
export type {
  WidgetSnapshot,
  WidgetSnapshotEntry,
  BuildTodayWidgetSnapshotInput,
} from './snapshot';
