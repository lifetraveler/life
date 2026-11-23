/**
 * 切片 36 阶段 1（AGENTS.md §7.48）：schema v17→v18 迁移结构断言。
 *
 * 同 migrationsV17.test.ts 思路：LokiJS/结构级断言（add_columns step 形如
 * { type: 'add_columns', table, columns }），外加真实 WatermelonDB + LokiJS 建库
 * 行为级验证（v18 全新安装路径 app_settings 单行可建、ai_schedule_query_enabled
 * 列读写；isOptional boolean 列模型类型为 boolean | null）。
 * 注：add_columns step 的列定义必须与 schema.ts 全新安装路径的 app_settings 表
 * 声明逐字段一致（漂移会在真机 migration 时爆列，§5 升级安装重启验收兜底）。
 */
import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import type { AddColumnsMigrationStep } from '@nozbe/watermelondb/Schema/migrations';

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

describe('schema v18（切片 36 阶段 1）', () => {
  it('SCHEMA_VERSION = 18 且 migrations 链 maxVersion = 18（切片 36 追加 v18 后例行更新）', () => {
    expect(SCHEMA_VERSION).toBe(18);
    expect(schema.version).toBe(18);
    expect(migrations.maxVersion).toBe(18);
    expect(migrations.minVersion).toBe(1);
  });

  it('migration 链 toVersion 从 2 连续递增到 18，无跳号（v2–v17 已发布 step 未回改）', () => {
    const versions = migrations.sortedMigrations.map((entry) => entry.toVersion);
    expect(versions).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });

  it('v18 step：仅一个 add_columns（app_settings），列定义与 schema.ts 逐字段一致', () => {
    const step18 = migrations.sortedMigrations.find((entry) => entry.toVersion === 18);
    expect(step18).toBeDefined();
    expect(step18?.steps).toHaveLength(1);

    const addStep = step18?.steps[0];
    expect(addStep?.type).toBe('add_columns');
    if (addStep?.type !== 'add_columns') {
      throw new Error('v18 step 应为 add_columns');
    }
    expect((addStep as AddColumnsMigrationStep).table).toBe('app_settings');
    // isOptional boolean 列：既有行回填 null（非可选 boolean 回填 false 与
    // 「默认开」定案冲突——切片 30 ai_retry_max 教训同构）。
    expect(addStep.columns).toEqual([
      { name: 'ai_schedule_query_enabled', type: 'boolean', isOptional: true },
    ]);
    // 全新安装路径（schema.ts）同一列，逐字段一致。
    expect(schema.tables.app_settings?.columns.ai_schedule_query_enabled).toEqual(
      addStep.columns[0],
    );
  });

  it('v2–v17 已发布 step 不含 add_columns ai_schedule_query_enabled（只允许末尾追加）', () => {
    const legacyAdd = migrations.sortedMigrations
      .filter((entry) => entry.toVersion < 18)
      .flatMap((entry) => entry.steps)
      .filter(
        (step) =>
          step.type === 'add_columns' &&
          (step as AddColumnsMigrationStep).columns?.some(
            (column) => column.name === 'ai_schedule_query_enabled',
          ),
      );
    expect(legacyAdd).toEqual([]);
  });

  it('行为级：v18 schema 建库后 app_settings 可建行、ai_schedule_query_enabled 可写读', async () => {
    // LokiJS 内存适配器无持久化状态，升级路径（v17→v18 存量行回填 null）的运行时
    // 验证只能在真机（AGENTS.md §5 升级安装重启验收）；这里验证 v18 全新安装路径。
    dbCounter += 1;
    const adapter = new LokiJSAdapter({
      dbName: `test-v18-fresh-${dbCounter}`,
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
        record.aiScheduleQueryEnabled = true;
      });
      createdId = created.id;
    });

    const reloaded = await db.get<AppSettingsModel>('app_settings').find(createdId);
    expect(reloaded._raw.id).toBe('global');
    expect(reloaded.aiScheduleQueryEnabled).toBe(true);
  });
});
