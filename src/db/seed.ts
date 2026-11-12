/**
 * 全新安装预置数据 seed（切片 14，AGENTS.md §7.22）。
 *
 * 升级安装的预置数据由 migration v6 的 unsafeExecuteSql 插入；全新安装不跑 migration，
 * 由此模块在数据库初始化后幂等写入同一条预置数据（数据源同为 src/domain/category.ts 的
 * PRESET_CATEGORIES 与 src/domain/settings.ts，多处共用常量防漂移）。
 *
 * 幂等性：db.write 事务内先查后插；WatermelonDB 写队列串行执行，模块加载 kick 与
 * Repository 内 ensureSeeded 并发调用安全（第二次调用先查已存在则跳过）。
 */
import { Database, Q } from '@nozbe/watermelondb';

import { PRESET_CATEGORIES } from '../domain/category';
import {
  APP_SETTINGS_ROW_ID,
  DEFAULT_APP_SETTINGS,
  serializeChipsIncrements,
} from '../domain/settings';
import AppSettingsModel from './models/AppSettingsModel';
import CategoryModel from './models/CategoryModel';

export async function seedPresetData(db: Database): Promise<void> {
  await db.write(async () => {
    for (const preset of PRESET_CATEGORIES) {
      const existing = await db
        .get<CategoryModel>('categories')
        .query(Q.where('id', preset.id))
        .fetchCount();
      if (existing === 0) {
        await db.get<CategoryModel>('categories').create((record) => {
          // 预置分类主键固定为契约 id（'work' 等，§7.22）；覆盖 _prepareCreate 生成的随机 id。
          record._raw.id = preset.id;
          record.name = preset.name;
          record.color = preset.color;
          record.emoji = preset.emoji;
          record.priority = preset.priority;
        });
      }
    }

    const settingsCount = await db.get<AppSettingsModel>('app_settings').query().fetchCount();
    if (settingsCount === 0) {
      await db.get<AppSettingsModel>('app_settings').create((record) => {
        record._raw.id = APP_SETTINGS_ROW_ID;
        record.tagDisplayMode = DEFAULT_APP_SETTINGS.tagDisplayMode;
        // 阶段 7a（schema v7）：小组件显示开关默认值（唯一数据源 DEFAULT_APP_SETTINGS，防漂移）。
        record.widgetShowOverdue = DEFAULT_APP_SETTINGS.widgetShowOverdue;
        record.widgetShowTodos = DEFAULT_APP_SETTINGS.widgetShowTodos;
        record.widgetShowCategoryEmoji = DEFAULT_APP_SETTINGS.widgetShowCategoryEmoji;
        record.widgetShowTags = DEFAULT_APP_SETTINGS.widgetShowTags;
        // 切片 18（schema v10）：chips 增量默认值（唯一数据源 DEFAULT_APP_SETTINGS，防漂移）。
        record.chipsIncrementsJson = serializeChipsIncrements(DEFAULT_APP_SETTINGS.chipsIncrements);
      });
    }
  });
}
