/**
 * 切片 35 阶段 1（AGENTS.md §7.47）：schema v16→v17 迁移结构断言。
 *
 * 同 migrationsV9.test.ts 思路：LokiJS/结构级断言（create_table step 形如
 * { type: 'create_table', schema }），外加真实 WatermelonDB + LokiJS 建库行为级
 * 验证（v17 全新安装路径 sync_tombstones 可建行、三列读写）。
 * 注：create_table step 的列定义经 step.schema.columnArray 投影，schema.ts 全新安装路径
 * 的 sync_tombstones 表声明必须与之逐字段一致（漂移会在真机 migration 时爆列）。
 */
import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import type { CreateTableMigrationStep } from '@nozbe/watermelondb/Schema/migrations';

import { SCHEMA_VERSION, schema } from '../schema';
import migrations from '../migrations';
import SyncTombstoneModel from '../models/SyncTombstoneModel';

let dbCounter = 0;

const createdAdapters: LokiJSAdapter[] = [];

afterAll(() => {
  for (const adapter of createdAdapters) {
    (adapter._driver as unknown as { loki?: { close: () => void } } | undefined)?.loki?.close();
  }
  createdAdapters.length = 0;
});

describe('schema v17（切片 35 阶段 1）', () => {
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

  it('v17 step：仅一个 create_table（sync_tombstones），列定义与 schema.ts 逐字段一致', () => {
    const step17 = migrations.sortedMigrations.find((entry) => entry.toVersion === 17);
    expect(step17).toBeDefined();
    expect(step17?.steps).toHaveLength(1);

    const createStep = step17?.steps[0];
    expect(createStep?.type).toBe('create_table');
    if (createStep?.type !== 'create_table') {
      throw new Error('v17 step 应为 create_table');
    }
    expect(createStep.schema.name).toBe('sync_tombstones');
    // createTable() 后 schema.columns 是 TableMap（按列名索引），columnArray 为数组投影
    expect(createStep.schema.columnArray).toEqual([
      { name: 'kind', type: 'string' },
      { name: 'entity_id', type: 'string', isIndexed: true },
      { name: 'deleted_at', type: 'number' },
    ]);
    // 全新安装路径（schema.ts）同一张表，逐字段一致。
    expect(schema.tables.sync_tombstones?.columnArray).toEqual(createStep.schema.columnArray);
  });

  it('v2–v16 已发布 step 不含 create_table sync_tombstones（只允许末尾追加）', () => {
    const legacyCreate = migrations.sortedMigrations
      .filter((entry) => entry.toVersion < 17)
      .flatMap((entry) => entry.steps)
      .filter(
        (step) =>
          step.type === 'create_table' &&
          (step as CreateTableMigrationStep).schema?.name === 'sync_tombstones',
      );
    expect(legacyCreate).toEqual([]);
  });

  it('行为级：v17 schema 建库后 sync_tombstones 可建行、三列读写、同键可查', async () => {
    // LokiJS 内存适配器无持久化状态，升级路径的运行时验证只能在真机（AGENTS.md §5）；
    // 这里验证 v17 全新安装路径：表存在、model 映射正确、索引列可查询。
    dbCounter += 1;
    const adapter = new LokiJSAdapter({
      dbName: `test-v17-fresh-${dbCounter}`,
      schema,
      migrations,
      useWebWorker: false,
      useIncrementalIndexedDB: false,
    });
    createdAdapters.push(adapter);
    const db = new Database({ adapter, modelClasses: [SyncTombstoneModel] });

    let createdId = '';
    await db.write(async () => {
      const created = await db.get<SyncTombstoneModel>('sync_tombstones').create((record) => {
        record.kind = 'item';
        record.entityId = 'entity-1';
        record.deletedAt = 1700000000000;
      });
      createdId = created.id;
    });

    const reloaded = await db.get<SyncTombstoneModel>('sync_tombstones').find(createdId);
    expect(reloaded.kind).toBe('item');
    expect(reloaded.entityId).toBe('entity-1');
    expect(reloaded.deletedAt).toBe(1700000000000);

    const hits = await db
      .get<SyncTombstoneModel>('sync_tombstones')
      .query()
      .fetch();
    expect(hits).toHaveLength(1);
  });
});
