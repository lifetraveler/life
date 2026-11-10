/**
 * 小组件页状态（切片 14 阶段 7b，docs/proposals/slice-14-widget-phase7.md 已确认）：
 * - 左右滑切页在 react-native-android-widget 平台不可行（全库仅 ClickableView，
 *   无 swipe/onTouch，7a 前已实锤）；替代方案 = 组件内「今日 | 周」页签，点击切换；
 * - 页状态持久化在 SharedPreferences（键 WIDGET_PAGE_STATE_PREFS_KEY，提案新增），
 *   Headless 任务进程（taskHandler）与 App 进程（写入器）读写同一份；
 * - JSON schema：{ page: 'today' | 'week' }；缺失/损坏回退 'today'（默认页）。
 */

/** SharedPreferences 页状态键（阶段 7b 提案新增）。 */
export const WIDGET_PAGE_STATE_PREFS_KEY = 'widget_page_state_v1';

/** 小组件页名：today = 今日页（三段式），week = 周页（今天起 7 天）。 */
export type WidgetPageName = 'today' | 'week';

/** 页状态默认值：缺失/损坏时回退今日页。 */
export const WIDGET_PAGE_STATE_DEFAULT: WidgetPageName = 'today';

/** 类型守卫（渲染层/收窄共用）。 */
export function isWidgetPageName(value: unknown): value is WidgetPageName {
  return value === 'today' || value === 'week';
}

/**
 * 最小形状收窄：{ page: 'today' | 'week' } 才认；其余（含裸字符串、损坏 JSON）
 * 回退默认页 'today'——页状态丢失只影响展示页，不影响数据。
 */
export function narrowWidgetPageState(value: unknown): WidgetPageName {
  if (typeof value !== 'object' || value === null) {
    return WIDGET_PAGE_STATE_DEFAULT;
  }
  const root = value as Record<string, unknown>;
  return isWidgetPageName(root.page) ? root.page : WIDGET_PAGE_STATE_DEFAULT;
}
