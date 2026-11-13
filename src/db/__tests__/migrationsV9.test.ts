/**
 * 切片 17 阶段 1（AGENTS.md §7.27）：schema v8→v9 迁移结构断言。
 *
 * 同 migrationsV8.test.ts 思路：LokiJS/结构级断言（create_table step 形如
 * { type: 'create_table', schema }），外加真实 WatermelonDB + LokiJS 建库行为级
 * 验证（v9 全新安装路径 channel_presets 可建行、created_at 自动写入）。
 * 注：create_table step 的列定义经 step.schema.columnArray 投影，schema.ts 全新安装路径
 * 的 channel_presets 表声明必须与之逐字段一致（漂移会在真机 migration 时爆列）。
 */
import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import type { CreateTableMigrationStep } from '@nozbe/watermelondb/Schema/migrations';

import { SCHEMA_VERSION, schema } from '../schema';
import migrations from '../migrations';
import ChannelPresetModel from '../models/ChannelPresetModel';

let dbCounter = 0;

const createdAdapters: LokiJSAdapter[] = [];

afterAll(() => {
  for (const adapter of createdAdapters) {
    (adapter._driver as unknown as { loki?: { close: () => void } } | undefined)?.loki?.close();
  }
  createdAdapters.length = 0;
});

describe('schema v9（切片 17 阶段 1）', () => {
  it('SCHEMA_VERSION = 11 且 migrations 链 maxVersion = 11（切片 19 追加 v11 后例行更新）', () => {
    expect(SCHEMA_VERSION).toBe(11);
    expect(schema.version).toBe(11);
    expect(migrations.maxVersion).toBe(11);
    expect(migrations.minVersion).toBe(1);
  });

  it('migration 链 toVersion 从 2 连续递增到 11，无跳号（v2–v10 已发布 step 未回改）', () => {
    const versions = migrations.sortedMigrations.map((entry) => entry.toVersion);
    expect(versions).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('v9 step：仅一个 create_table（channel_presets），列定义与 schema.ts 逐字段一致', () => {
    const step9 = migrations.sortedMigrations.find((entry) => entry.toVersion === 9);
    expect(step9).toBeDefined();
    expect(step9?.steps).toHaveLength(1);

    const createStep = step9?.steps[0];
    expect(createStep?.type).toBe('create_table');
    if (createStep?.type !== 'create_table') {
      throw new Error('v9 step 应为 create_table');
    }
    expect(createStep.schema.name).toBe('channel_presets');
    // createTable() 后 schema.columns 是 TableMap（按列名索引），columnArray 为数组投影
    expect(createStep.schema.columnArray).toEqual([
      { name: 'name', type: 'string' },
      { name: 'type', type: 'string', isIndexed: true },
      { name: 'config_json', type: 'string' },
      { name: 'created_at', type: 'number' },
    ]);
    // 全新安装路径（schema.ts）同一张表；v10 追加 is_default 列（addColumns step，
    // 已发布 v9 create_table step 不回改），比对时剔除 v10 新增列。
    expect(
      schema.tables.channel_presets?.columnArray.filter((column) => column.name !== 'is_default'),
    ).toEqual(createStep.schema.columnArray);
  });

  it('v2–v8 已发布 step 不含 create_table channel_presets（只允许末尾追加）', () => {
    const legacyCreate = migrations.sortedMigrations
      .filter((entry) => entry.toVersion < 9)
      .flatMap((entry) => entry.steps)
      .filter(
        (step) =>
          step.type === 'create_table' &&
          (step as CreateTableMigrationStep).schema?.name === 'channel_presets',
      );
    expect(legacyCreate).toEqual([]);
  });

  it('行为级：v9 schema 建库后 channel_presets 可建行，created_at 由 WatermelonDB 自动写入', async () => {
    // LokiJS 内存适配器无持久化状态，升级路径的运行时验证只能在真机（AGENTS.md §5）；
    // 这里验证 v9 全新安装路径：表存在、model 映射正确、create 自动写 created_at。
    dbCounter += 1;
    const adapter = new LokiJSAdapter({
      dbName: `test-v9-fresh-${dbCounter}`,
      schema,
      migrations,
      useWebWorker: false,
      useIncrementalIndexedDB: false,
    });
    createdAdapters.push(adapter);
    const db = new Database({ adapter, modelClasses: [ChannelPresetModel] });

    let createdId = '';
    await db.write(async () => {
      const created = await db.get<ChannelPresetModel>('channel_presets').create((record) => {
        record.name = 'Zulip';
        record.type = 'webhook';
        record.configJson = JSON.stringify({ url: 'https://hook.example/z' });
        expect(record.createdAt.getTime()).toBeGreaterThan(0); // WatermelonDB 自动写 created_at
      });
      createdId = created.id;
    });

    const reloaded = await db.get<ChannelPresetModel>('channel_presets').find(createdId);
    expect(reloaded.name).toBe('Zulip');
    expect(reloaded.type).toBe('webhook');
    expect(reloaded.createdAt.getTime()).toBeGreaterThan(0);
  });
});
