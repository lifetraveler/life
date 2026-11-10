/**
 * 领域类型定义：AppSettings（纯 TypeScript，不依赖 React Native / WatermelonDB）。
 *
 * AGENTS.md §7.22（v0.14，schema v6）：app_settings 为单行表（id 固定 'global'）。
 */

/** 标签展示模式（§7.22）：text=纯文字、emoji=仅图标、both=文字+图标 */
export type TagDisplayMode = 'text' | 'emoji' | 'both';

/** TagDisplayMode 全部合法值（用于防御性校验） */
export const TAG_DISPLAY_MODES: readonly TagDisplayMode[] = ['text', 'emoji', 'both'];

/** 类型守卫：库中读到非法枚举值时由 Repository 防御性回退默认值 */
export function isTagDisplayMode(value: unknown): value is TagDisplayMode {
  return typeof value === 'string' && (TAG_DISPLAY_MODES as readonly string[]).includes(value);
}

/**
 * 数据模型：AppSettings（§7.22；后续切片新增全局设置字段时在此扩展）。
 *
 * 小组件显示开关（切片 14 阶段 7a，docs/proposals/slice-14-widget-phase7.md，
 * app_settings schema v6→v7 新增 4 列）：仅控制「今日小组件」的展示口径，
 * 不影响 App 内任何视图。widgetShowCategoryEmoji / widgetShowTags 的渲染消费
 * 在阶段 7c 落地（本阶段只落存储与默认值）。
 */
export interface AppSettings {
  tagDisplayMode: TagDisplayMode;
  /** 小组件今日视图是否展示过期项（默认 true，保持升级前行为） */
  widgetShowOverdue: boolean;
  /** 小组件今日视图是否展示待办项（无时间纯待办，置底展示；默认 false） */
  widgetShowTodos: boolean;
  /** 小组件条目是否展示分类 emoji（阶段 7c 渲染；默认 false） */
  widgetShowCategoryEmoji: boolean;
  /** 小组件条目是否展示标签（阶段 7c 渲染，跟随 app tagDisplayMode；默认 false） */
  widgetShowTags: boolean;
}

/**
 * 默认设置（§7.22：tagDisplayMode 默认 'text'；阶段 7a：过期组默认展示、
 * 待办/分类 emoji/标签默认不展示；getSettings 无记录时的兜底返回值）。
 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  tagDisplayMode: 'text',
  widgetShowOverdue: true,
  widgetShowTodos: false,
  widgetShowCategoryEmoji: false,
  widgetShowTags: false,
};

/** app_settings 单行主键（§7.22） */
export const APP_SETTINGS_ROW_ID = 'global';
