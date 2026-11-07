import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import type {
  AddColumnsMigrationStep,
  CreateTableMigrationStep,
  SchemaMigrations,
  SqlMigrationStep,
} from '@nozbe/watermelondb/Schema/migrations';

import CategoryModel from '../models/CategoryModel';
import AppSettingsModel from '../models/AppSettingsModel';
import ItemModel from '../models/ItemModel';
import ItemTagModel from '../models/ItemTagModel';
import ReminderModel from '../models/ReminderModel';
import TagModel from '../models/TagModel';
import migrations from '../migrations';
import { seedPresetData } from '../seed';
import { schema, SCHEMA_VERSION } from '../schema';
import { PRESET_CATEGORIES } from '../../domain/category';
import { APP_SETTINGS_ROW_ID } from '../../domain/settings';
import { WatermelonItemRepository } from '../../data/WatermelonItemRepository';

/**
 * 切片 14 阶段 1（schema v6 分类/设置底座）db 层单测：
 * 1. 迁移结构：SCHEMA_VERSION 与 migrations v6 step 的结构/字符串断言
 *    （schemaMigrations 运行时形状：{ sortedMigrations, minVersion, maxVersion, validated }）。
 *    已知限制：LokiJS 适配器（仅测试用）忽略 'sql' 步骤，v6 的 UPDATE 回填与 INSERT
 *    预置行在 loki 行为级不可测——行为级迁移验收依赖真机覆盖安装（任务卡阶段 1）。
 * 2. seedPresetData 幂等：两次 seed 后仍为 5 条预置分类 + 唯一 app_settings global 行。
 */

let dbCounter = 0;

// LokiJS 默认开启 500ms autosave（lokiExtensions.js），setInterval 会挂住 Node 事件循环，
// 测试结束后必须对每个实例调用 loki.close() 释放（同 viewQueries.test.ts 的处理）。
const createdAdapters: LokiJSAdapter[] = [];

function extractLokiHandle(adapter: LokiJSAdapter): { close: () => void } | null {
  const viaDriver = (adapter as unknown as { _driver?: { loki?: { close: () => void } } })
    ._driver;
  if (viaDriver?.loki) {
    return viaDriver.loki;
  }
  const viaBridge = (
    adapter as unknown as {
      _dispatcher?: { _worker?: { _bridge?: { driver?: { loki?: { close: () => void } } } } };
    }
  )._dispatcher;
  return viaBridge?._worker?._bridge?.driver?.loki ?? null;
}

interface TestContext {
  database: Database;
  repository: WatermelonItemRepository;
}

/** 与生产 src/db/database.ts 同构：schema + migrations + 全部 6 个 model class。 */
function makeContext(): TestContext {
  dbCounter += 1;
  const adapter = new LokiJSAdapter({
    dbName: `test-seed-preset-${dbCounter}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  createdAdapters.push(adapter);
  const database = new Database({
    adapter,
    modelClasses: [
      ItemModel,
      TagModel,
      ItemTagModel,
      ReminderModel,
      CategoryModel,
      AppSettingsModel,
    ],
  });
  return {
    database,
    repository: new WatermelonItemRepository(database),
  };
}

afterAll(() => {
  for (const adapter of createdAdapters) {
    extractLokiHandle(adapter)?.close();
  }
  createdAdapters.length = 0;
});

function findMigrationToVersion(
  spec: SchemaMigrations,
  toVersion: number,
): SchemaMigrations['sortedMigrations'][number] | undefined {
  return spec.sortedMigrations.find((migration) => migration.toVersion === toVersion);
}

describe('schema v6 迁移结构（结构/字符串断言）', () => {
  it('SCHEMA_VERSION === 6，migrations 无缺口且 maxVersion === 6', () => {
    expect(SCHEMA_VERSION).toBe(6);
    expect(migrations.validated).toBe(true);
    expect(migrations.maxVersion).toBe(6);
    // 最早 step 是 toVersion 2（v1 初始库无需迁移），minVersion = 2 - 1 = 1
    expect(migrations.minVersion).toBe(1);
    expect(migrations.sortedMigrations.map((migration) => migration.toVersion)).toEqual([
      2, 3, 4, 5, 6,
    ]);
  });

  it('v6 step 存在：步骤类型序列为 2 create_table + 2 add_columns + 7 sql', () => {
    const v6 = findMigrationToVersion(migrations, 6);
    expect(v6).toBeDefined();
    expect((v6?.steps ?? []).map((step) => step.type)).toEqual([
      'create_table',
      'create_table',
      'add_columns',
      'add_columns',
      'sql',
      'sql',
      'sql',
      'sql',
      'sql',
      'sql',
      'sql',
    ]);
  });

  it('v6 结构：新增 categories/app_settings 表；items 加 category_id/priority；tags 加 color/emoji', () => {
    const steps = findMigrationToVersion(migrations, 6)?.steps ?? [];
    const createTableSteps = steps.filter(
      (step): step is CreateTableMigrationStep => step.type === 'create_table',
    );
    expect(createTableSteps.map((step) => step.schema.name)).toEqual([
      'categories',
      'app_settings',
    ]);
    const addColumnsSteps = steps.filter(
      (step): step is AddColumnsMigrationStep => step.type === 'add_columns',
    );
    expect(addColumnsSteps.map((step) => step.table)).toEqual(['items', 'tags']);
    expect(addColumnsSteps[0]?.columns.map((column) => column.name)).toEqual([
      'category_id',
      'priority',
    ]);
    expect(addColumnsSteps[1]?.columns.map((column) => column.name)).toEqual([
      'color',
      'emoji',
    ]);
  });

  it('v6 sql 步骤：items 回填 other、预置分类插入 ×5、app_settings 默认行（LokiJS 忽略 sql，行为级靠真机覆盖安装验收）', () => {
    const steps = findMigrationToVersion(migrations, 6)?.steps ?? [];
    const sqlSteps = steps.filter((step): step is SqlMigrationStep => step.type === 'sql');
    expect(sqlSteps.length).toBe(1 + PRESET_CATEGORIES.length + 1);
    // 既有 items 行 category_id 回填 'other'（§7.22 默认分类）
    expect(sqlSteps[0]?.sql).toContain('UPDATE "items" SET "category_id"');
    expect(sqlSteps[0]?.sql).toContain("'other'");
    // 预置分类插入：条数与 PRESET_CATEGORIES 一致（数据源防漂移）
    const categoryInserts = sqlSteps.filter((step) =>
      step.sql.includes('INSERT OR IGNORE INTO "categories"'),
    );
    expect(categoryInserts.length).toBe(PRESET_CATEGORIES.length);
    // app_settings 默认行：主键 global、tag_display_mode 默认 text
    expect(sqlSteps[sqlSteps.length - 1]?.sql).toContain(
      'INSERT OR IGNORE INTO "app_settings"',
    );
    expect(sqlSteps[sqlSteps.length - 1]?.sql).toContain(`'${APP_SETTINGS_ROW_ID}'`);
    expect(sqlSteps[sqlSteps.length - 1]?.sql).toContain("'text'");
  });
});

describe('migrations 可被 LokiJS 接受 + seedPresetData 幂等', () => {
  it('带 migrations 的 LokiJSAdapter 新建库成功且可查询（迁移对象被适配器接受）', async () => {
    const { database } = makeContext();
    // 全新空库：categories/app_settings 可查询但无行（尚未 seed）
    const categories = await database.get<CategoryModel>('categories').query().fetch();
    expect(categories).toEqual([]);
    const settings = await database.get<AppSettingsModel>('app_settings').query().fetch();
    expect(settings).toEqual([]);
  });

  it('seedPresetData 执行两次幂等：5 条预置分类（priority 升序）+ 唯一 app_settings global 行', async () => {
    const { database, repository } = makeContext();
    await seedPresetData(database);
    await seedPresetData(database);

    // 直接查表断言（不经 Repository，避免 ensureSeeded 介入掩盖 seed 本身的幂等性）
    const categoryRows = await database.get<CategoryModel>('categories').query().fetch();
    expect(categoryRows.length).toBe(PRESET_CATEGORIES.length);
    const settingsRows = await database.get<AppSettingsModel>('app_settings')
      .query()
      .fetch();
    expect(settingsRows.length).toBe(1);
    expect(settingsRows[0]?._raw.id).toBe(APP_SETTINGS_ROW_ID);
    expect(settingsRows[0]?.tagDisplayMode).toBe('text');

    // Repository.getCategories()：内容与 §7.22 预置契约一致，priority 升序
    const viaRepository = await repository.getCategories();
    expect(viaRepository).toEqual([
      { id: 'work', name: '工作', color: '#E57373', emoji: '💼', priority: 1 },
      { id: 'personal', name: '个人', color: '#64B5F6', emoji: '🏠', priority: 2 },
      { id: 'study', name: '学习', color: '#FFB74D', emoji: '📚', priority: 3 },
      { id: 'health', name: '健康', color: '#81C784', emoji: '🏃', priority: 4 },
      { id: 'other', name: '其他', color: '#9E9E9E', emoji: '📌', priority: 5 },
    ]);
  });
});
