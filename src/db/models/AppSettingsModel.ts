import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

import type { TagDisplayMode } from '../../domain/settings';

/**
 * app_settings 表的 WatermelonDB model（切片 14，AGENTS.md §7.22，schema v6；
 * v7 阶段 7a 扩展小组件显示开关 4 列，docs/proposals/slice-14-widget-phase7.md）。
 * 单行表：主键固定 'global'（domain/settings.ts APP_SETTINGS_ROW_ID）；
 * 无记录时 Repository 的 getSettings 兜底返回默认值（repository.md v0.14）。
 */
export default class AppSettingsModel extends Model {
  static table = 'app_settings';

  @text('tag_display_mode') tagDisplayMode!: TagDisplayMode;

  // —— 阶段 7a：小组件显示开关（非可选 boolean，默认值见 domain/settings.ts DEFAULT_APP_SETTINGS）——
  @field('widget_show_overdue') widgetShowOverdue!: boolean;
  @field('widget_show_todos') widgetShowTodos!: boolean;
  @field('widget_show_category_emoji') widgetShowCategoryEmoji!: boolean;
  @field('widget_show_tags') widgetShowTags!: boolean;
}
