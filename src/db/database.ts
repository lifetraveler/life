import './polyfills';

import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';

import AppSettingsModel from './models/AppSettingsModel';
import CategoryModel from './models/CategoryModel';
import ItemModel from './models/ItemModel';
import ItemTagModel from './models/ItemTagModel';
import ReminderModel from './models/ReminderModel';
import TagModel from './models/TagModel';
import { schema } from './schema';
import migrations from './migrations';
import { seedPresetData } from './seed';

const adapter = new SQLiteAdapter({
  dbName: 'life',
  schema,
  migrations,
  jsi: true,
  onSetUpError: (error) => {
    console.error('WatermelonDB setup failed:', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [ItemModel, TagModel, ItemTagModel, ReminderModel, CategoryModel, AppSettingsModel],
});

// 切片 14（AGENTS.md §7.22）：全新安装的预置分类/设置行（升级安装由 migration v6 插入）。
// 模块加载即 kick；失败仅记录日志（Repository 的 ensureSeeded 会在写路径重试兜底）。
seedPresetData(database).catch((error) => {
  console.error('WatermelonDB preset seed failed:', error);
});
