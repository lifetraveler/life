import { Model } from '@nozbe/watermelondb';
import { text } from '@nozbe/watermelondb/decorators';

import type { TagDisplayMode } from '../../domain/settings';

/**
 * app_settings 表的 WatermelonDB model（切片 14，AGENTS.md §7.22，schema v6）。
 * 单行表：主键固定 'global'（domain/settings.ts APP_SETTINGS_ROW_ID）；
 * 无记录时 Repository 的 getSettings 兜底返回默认值（repository.md v0.14）。
 */
export default class AppSettingsModel extends Model {
  static table = 'app_settings';

  @text('tag_display_mode') tagDisplayMode!: TagDisplayMode;
}
