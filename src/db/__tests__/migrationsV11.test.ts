/**
 * 切片 19 阶段 1（AGENTS.md §7.30）：schema v10→v11 迁移结构断言。
 *
 * 同 migrationsV8/V9 思路：LokiJS 忽略 'sql' 步骤且 SQLite 升级路径只能在真机验证，
 * 因此对 v11 migration step 做结构级断言（add_columns 唯一步骤、零 unsafeExecuteSql），
 * 外加真实 WatermelonDB + LokiJS 建库行为级验证（app_settings 全新安装路径
 * default_channels_json 可空可写、读回一致）。
 * 兼容策略先例（v10 chips_increments 同款）：新列 isOptional=true → 旧行回填 null，
 * 读层由 parseDefaultChannels 归一（旧数据/新行兜底），不写任何回填 SQL。
 */
import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import { SCHEMA_VERSION, schema } from '../schema';
import migrations from '../migrations';
import AppSettingsModel from '../models/AppSettingsModel';

let dbCounter = 0;

const createdAdapters: LokiJSAdapter[] = [];

afterAll(() => {
  for (const adapter of createdAdapters) {
    (adapter._driver as unknown as { loki?: { close: () => void } } | undefined)?.loki?.close();
  }
  createdAdapters.length = 0;
});

describe('schema v11（切片 19 阶段 1）', () => {
  it('SCHEMA_VERSION = 11 且 migrations 链 maxVersion = 11', () => {
    expect(SCHEMA_VERSION).toBe(11);
    expect(schema.version).toBe(11);
    expect(migrations.maxVersion).toBe(11);
    expect(migrations.minVersion).toBe(1); // 最早 step 是 toVersion 2，minVersion = 2 - 1 = 1
  });

  it('migration 链 toVersion 从 2 连续递增到 11，无跳号（v2–v10 已发布 step 未回改）', () => {
    const versions = migrations.sortedMigrations.map((entry) => entry.toVersion);
    expect(versions).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('v11 step：唯一 add_columns（app_settings.default_channels_json，isOptional=true），零 unsafeExecuteSql', () => {
    const step11 = migrations.sortedMigrations.find((entry) => entry.toVersion === 11);
    expect(step11).toBeDefined();
    expect(step11?.steps).toHaveLength(1);

    const addColumnsStep = step11?.steps[0];
    expect(addColumnsStep).toEqual({
      type: 'add_columns',
      table: 'app_settings',
      columns: [{ name: 'default_channels_json', type: 'string', isOptional: true }],
    });

    // 兼容策略：null 回填 + 读层归一，不写任何回填 SQL（v10 chips_increments 先例）。
    const sqlSteps = migrations.sortedMigrations
      .filter((entry) => entry.toVersion === 11)
      .flatMap((entry) => entry.steps)
      .filter((step) => step.type === 'sql');
    expect(sqlSteps).toEqual([]);
  });

  it('v2–v10 已发布 step 的 app_settings addColumns 不含 default_channels_json（新列只出现在 v11）', () => {
    // v7 加过 4 个小组件开关列、v10 加过 chips_increments——已发布 step 允许存在
    // app_settings addColumns，但不得触及 v11 新列（只允许末尾追加新 step）。
    const legacyColumnNames = migrations.sortedMigrations
      .filter((entry) => entry.toVersion < 11)
      .flatMap((entry) => entry.steps)
      .flatMap((step) =>
        step.type === 'add_columns' && step.table === 'app_settings'
          ? step.columns.map((column) => column.name)
          : [],
      );
    expect(legacyColumnNames).toEqual([
      // v7（切片 14 阶段 7a）
      'widget_show_overdue',
      'widget_show_todos',
      'widget_show_category_emoji',
      'widget_show_tags',
      // v10（切片 18）
      'chips_increments',
    ]);
    expect(legacyColumnNames).not.toContain('default_channels_json');
  });

  it('全新安装路径：schema.ts app_settings 表声明包含 v11 列且列属性一致', () => {
    const appSettings = schema.tables.app_settings;
    expect(appSettings).toBeDefined();
    const byName = new Map(appSettings.columnArray.map((column) => [column.name, column]));

    expect(byName.get('default_channels_json')).toEqual({
      name: 'default_channels_json',
      type: 'string',
      isOptional: true,
    });
  });

  it('行为级：v11 schema 建库后 app_settings 可建行，default_channels_json 可空可写', async () => {
    // LokiJS 内存适配器无持久化状态，升级路径（v10 旧库 → v11）的运行时验证只能在
    // 真机（AGENTS.md §5）；这里验证 v11 全新安装路径：表存在、model 映射正确、
    // 新列不写时读回 null（isOptional 兜底语义）。
    dbCounter += 1;
    const adapter = new LokiJSAdapter({
      dbName: `test-v11-fresh-${dbCounter}`,
      schema,
      migrations,
      useWebWorker: false,
      useIncrementalIndexedDB: false,
    });
    createdAdapters.push(adapter);
    const db = new Database({ adapter, modelClasses: [AppSettingsModel] });

    let createdId = '';
    await db.write(async () => {
      const created = await db.get<AppSettingsModel>('app_settings').create((record) => {
        record._raw.id = 'global';
        record.tagDisplayMode = 'text';
        record.widgetShowOverdue = true;
        record.widgetShowTodos = false;
        record.widgetShowCategoryEmoji = false;
        record.widgetShowTags = false;
        record.chipsIncrementsJson = '[10,60]';
        // 不写 defaultChannelsJson：旧行/省列场景的模拟
      });
      createdId = created.id;
    });

    const reloaded = await db.get<AppSettingsModel>('app_settings').find(createdId);
    expect(reloaded.chipsIncrementsJson).toBe('[10,60]');
    expect(reloaded.defaultChannelsJson).toBeNull(); // isOptional：省列读回 null

    await db.write(async () => {
      await reloaded.update((draft) => {
        draft.defaultChannelsJson = JSON.stringify(['system-notification', 'webhook']);
      });
    });
    const updated = await db.get<AppSettingsModel>('app_settings').find(createdId);
    expect(updated.defaultChannelsJson).toBe(JSON.stringify(['system-notification', 'webhook']));
  });
});
