/**
 * 今日待办小组件快照领域模块（切片 10；阶段 7b 增周快照与页状态）：
 * 纯 TypeScript，不依赖 React Native / WatermelonDB；
 * App 侧（WidgetSnapshotWriter）与单测共用此处类型与纯函数。
 */

export {
  WIDGET_SNAPSHOT_PREFS_KEY,
  WIDGET_SNAPSHOT_MAX_PER_GROUP,
  buildTodayWidgetSnapshot,
  narrowSnapshotEntry,
  toScheduledEntry,
} from './snapshot';
export type {
  WidgetSnapshot,
  WidgetSnapshotEntry,
  WidgetSnapshotTag,
  BuildTodayWidgetSnapshotInput,
} from './snapshot';
export {
  WIDGET_DISPLAY_DEFAULTS,
} from './display';
export type { WidgetDisplayOptions } from './display';
export {
  WIDGET_DEFAULT_CATEGORY_COLOR,
  resolveCategoryDotColor,
} from './categoryDot';
export {
  WIDGET_WEEK_SNAPSHOT_PREFS_KEY,
  WIDGET_WEEK_DAY_COUNT,
  WIDGET_WEEK_MAX_PER_DAY,
  buildWeekWidgetSnapshot,
  getWidgetWeekDayStarts,
  narrowWidgetWeekSnapshot,
} from './weekSnapshot';
export type {
  WidgetWeekSnapshot,
  WidgetWeekDayGroup,
  BuildWeekWidgetSnapshotInput,
} from './weekSnapshot';
export {
  WIDGET_PAGE_STATE_PREFS_KEY,
  WIDGET_PAGE_STATE_DEFAULT,
  isWidgetPageName,
  narrowWidgetPageState,
} from './pageState';
export type { WidgetPageName } from './pageState';

/**
 * 小组件模块头注释（阶段 7c 起含渲染显示选项）：
 * domain 只承载类型与纯函数；读取 app_settings 的实现在 src/widget/widgetDisplay.ts
 * （widget 层可依赖 data 层，domain 不依赖）。
 */
