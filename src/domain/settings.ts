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

/** 数据模型：AppSettings（§7.22；后续切片新增全局设置字段时在此扩展） */
export interface AppSettings {
  tagDisplayMode: TagDisplayMode;
}

/** 默认设置（§7.22：tagDisplayMode 默认 'text'；getSettings 无记录时的兜底返回值） */
export const DEFAULT_APP_SETTINGS: AppSettings = { tagDisplayMode: 'text' };

/** app_settings 单行主键（§7.22） */
export const APP_SETTINGS_ROW_ID = 'global';
