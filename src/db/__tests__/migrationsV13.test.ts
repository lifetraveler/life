/**
 * 切片 26 阶段 1（AGENTS.md §7.38）：schema v12→v13 迁移结构断言。
 *
 * 同 migrationsV8/V9/V11/V12 思路：LokiJS 忽略 'sql' 步骤且 SQLite 升级路径只能在
 * 真机验证，因此对 v13 migration step 做结构级断言（add_columns 唯一步骤、
 * 零 unsafeExecuteSql），外加真实 WatermelonDB + LokiJS 建库行为级验证。
 * 兼容策略先例（v12 careful_mode 同款）：新列非可选 boolean → addColumns 后
 * 旧行由 WatermelonDB sanitizedRaw 自动回填 false，读层另有防御归一
 * （toDomainSettings），不写任何回填 SQL。
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

describe('schema v13（切片 26 阶段 1）', () => {
  it('SCHEMA_VERSION = 19 且 migrations 链 maxVersion = 19（切片 37 追加 v19 后例行更新）', () => {
    expect(SCHEMA_VERSION).toBe(19);
    expect(schema.version).toBe(19);
    expect(migrations.maxVersion).toBe(19);
    expect(migrations.minVersion).toBe(1); // 最早 step 是 toVersion 2，minVersion = 2 - 1 = 1
  });

  it('migration 链 toVersion 从 2 连续递增到 18，无跳号（v2–v17 已发布 step 未回改）', () => {
    const versions = migrations.sortedMigrations.map((entry) => entry.toVersion);
    expect(versions).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it('v13 step：唯一 add_columns（app_settings.show_ai_usage，非可选 boolean），零 unsafeExecuteSql', () => {
    const step13 = migrations.sortedMigrations.find((entry) => entry.toVersion === 13);
    expect(step13).toBeDefined();
    expect(step13?.steps).toHaveLength(1);

    const addColumnsStep = step13?.steps[0];
    expect(addColumnsStep).toEqual({
      type: 'add_columns',
      table: 'app_settings',
      columns: [{ name: 'show_ai_usage', type: 'boolean' }],
    });

    // 兼容策略：非可选 boolean 由 addColumns/sanitizedRaw 自动回填 false，
    // 不写任何回填 SQL（v12 careful_mode 先例，v11 起零 UPDATE 纪律延续）。
    const sqlSteps = migrations.sortedMigrations
      .filter((entry) => entry.toVersion === 13)
      .flatMap((entry) => entry.steps)
      .filter((step) => step.type === 'sql');
    expect(sqlSteps).toEqual([]);
  });

  it('v2–v12 已发布 step 的 app_settings addColumns 不含 show_ai_usage（新列只出现在 v13）', () => {
    // v7 加过 4 个小组件开关列、v10 加过 chips_increments、v11 加过
    // default_channels_json、v12 加过 careful_mode——已发布 step 允许存在
    // app_settings addColumns，但不得触及 v13 新列（只允许末尾追加新 step）。
    const legacyColumnNames = migrations.sortedMigrations
      .filter((entry) => entry.toVersion < 13)
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
      // v11（切片 19）
      'default_channels_json',
      // v12（切片 25）
      'careful_mode',
    ]);
    expect(legacyColumnNames).not.toContain('show_ai_usage');
  });

  it('全新安装路径：schema.ts app_settings 表声明包含 v13 列且列属性一致（非可选）', () => {
    const appSettings = schema.tables.app_settings;
    expect(appSettings).toBeDefined();
    const byName = new Map(appSettings.columnArray.map((column) => [column.name, column]));

    expect(byName.get('show_ai_usage')).toEqual({
      name: 'show_ai_usage',
      type: 'boolean',
    });
    // schema 列默认非可选：非可选列不写 isOptional 键（缺键即非可选）
    expect(byName.get('show_ai_usage')?.isOptional).toBeUndefined();
  });

  it('行为级：v13 schema 建库后 app_settings 可建行，show_ai_usage 缺省读回 false（回填语义）', async () => {
    // LokiJS 内存适配器无持久化状态，升级路径（v12 旧库 → v13）的运行时验证只能在
    // 真机（AGENTS.md §5）；这里验证 v13 全新安装路径：表存在、model 映射正确、
    // 非可选 boolean 不写时读回 false（addColumns 旧行回填同语义）。
    dbCounter += 1;
    const adapter = new LokiJSAdapter({
      dbName: `test-v13-fresh-${dbCounter}`,
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
        record.defaultChannelsJson = '["system-notification"]';
        record.carefulMode = false;
        // 不写 showAiUsage：v12 旧行升级后未写新列的形态
      });
      createdId = created.id;
    });

    const reloaded = await db.get<AppSettingsModel>('app_settings').find(createdId);
    expect(reloaded.showAiUsage).toBe(false); // 非可选 boolean 兜底 false

    await db.write(async () => {
      await reloaded.update((draft) => {
        draft.showAiUsage = true;
      });
    });
    const updated = await db.get<AppSettingsModel>('app_settings').find(createdId);
    expect(updated.showAiUsage).toBe(true);
  });
});
