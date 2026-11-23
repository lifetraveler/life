/**
 * 切片 37 阶段 1（AGENTS.md §7.49）：schema v18→v19 迁移结构断言。
 *
 * 同 migrationsV17/V18.test.ts 思路：LokiJS/结构级断言（create_table step 形如
 * { type: 'create_table', name, columns }），外加真实 WatermelonDB + LokiJS 建库
 * 行为级验证（v19 全新安装路径三新表可建行、可写读；sparks title/content 双可空、
 * spark_attachments.isOptional 列模型类型为 number | null）。
 * 注：create_table step 的列定义必须与 schema.ts 全新安装路径逐字段一致（漂移会在
 * 真机 migration 时爆列，§5 升级安装重启验收兜底）。
 */
import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import { SCHEMA_VERSION, schema } from '../schema';
import migrations from '../migrations';
import SparkAttachmentModel from '../models/SparkAttachmentModel';
import SparkItemModel from '../models/SparkItemModel';
import SparkModel from '../models/SparkModel';

let dbCounter = 0;

const createdAdapters: LokiJSAdapter[] = [];

afterAll(() => {
  for (const adapter of createdAdapters) {
    (adapter._driver as unknown as { loki?: { close: () => void } } | undefined)?.loki?.close();
  }
  createdAdapters.length = 0;
});

describe('schema v19（切片 37 阶段 1）', () => {
  it('SCHEMA_VERSION = 19 且 migrations 链 maxVersion = 19（切片 37 追加 v19 后例行更新）', () => {
    expect(SCHEMA_VERSION).toBe(19);
    expect(schema.version).toBe(19);
    expect(migrations.maxVersion).toBe(19);
    expect(migrations.minVersion).toBe(1);
  });

  it('migration 链 toVersion 从 2 连续递增到 19，无跳号（v2–v18 已发布 step 未回改）', () => {
    const versions = migrations.sortedMigrations.map((entry) => entry.toVersion);
    expect(versions).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
  });

  it('v19 step：三条 create_table（sparks / spark_attachments / spark_items），列定义与 schema.ts 逐字段一致', () => {
    const step19 = migrations.sortedMigrations.find((entry) => entry.toVersion === 19);
    expect(step19).toBeDefined();
    expect(step19?.steps).toHaveLength(3);
    expect(step19?.steps.map((step) => step.type)).toEqual([
      'create_table',
      'create_table',
      'create_table',
    ]);

    // create_table step 携带完整 tableSchema 产物（{ name, columns: 字典 }）。
    const [sparksStep, attachmentsStep, itemsStep] = step19?.steps as {
      type: 'create_table';
      schema: { name: string; columns: Record<string, unknown> };
    }[];

    expect(sparksStep.schema.name).toBe('sparks');
    expect(sparksStep.schema.columns).toEqual({
      title: { name: 'title', type: 'string', isOptional: true },
      content: { name: 'content', type: 'string', isOptional: true },
      created_at: { name: 'created_at', type: 'number' },
      updated_at: { name: 'updated_at', type: 'number' },
    });

    expect(attachmentsStep.schema.name).toBe('spark_attachments');
    expect(attachmentsStep.schema.columns).toEqual({
      spark_id: { name: 'spark_id', type: 'string', isIndexed: true },
      kind: { name: 'kind', type: 'string' },
      uri: { name: 'uri', type: 'string' },
      remote_path: { name: 'remote_path', type: 'string', isOptional: true },
      sha256: { name: 'sha256', type: 'string', isOptional: true },
      file_size: { name: 'file_size', type: 'number' },
      duration_ms: { name: 'duration_ms', type: 'number', isOptional: true },
      width: { name: 'width', type: 'number', isOptional: true },
      height: { name: 'height', type: 'number', isOptional: true },
      created_at: { name: 'created_at', type: 'number' },
    });

    expect(itemsStep.schema.name).toBe('spark_items');
    expect(itemsStep.schema.columns).toEqual({
      spark_id: { name: 'spark_id', type: 'string', isIndexed: true },
      item_id: { name: 'item_id', type: 'string', isIndexed: true },
      created_at: { name: 'created_at', type: 'number' },
    });

    // 全新安装路径（schema.ts）同表，逐字段一致。
    expect(schema.tables.sparks?.columns.title).toEqual({
      name: 'title',
      type: 'string',
      isOptional: true,
    });
    expect(schema.tables.spark_attachments?.columns.spark_id).toEqual({
      name: 'spark_id',
      type: 'string',
      isIndexed: true,
    });
    expect(schema.tables.spark_items?.columns.item_id).toEqual({
      name: 'item_id',
      type: 'string',
      isIndexed: true,
    });
  });

  it('v2–v18 已发布 step 不含 create_table sparks/spark_attachments/spark_items（只允许末尾追加）', () => {
    const legacyCreate = migrations.sortedMigrations
      .filter((entry) => entry.toVersion < 19)
      .flatMap((entry) => entry.steps)
      .filter(
        (step) =>
          step.type === 'create_table' &&
          ['sparks', 'spark_attachments', 'spark_items'].includes(
            (step as { type: 'create_table'; schema: { name: string } }).schema.name,
          ),
      );
    expect(legacyCreate).toEqual([]);
  });

  it('行为级：v19 schema 建库后三新表可建行、可写读（sparks 双可空 / 附件可选数值列）', async () => {
    // LokiJS 内存适配器无持久化状态，升级路径（v18→v19 建表）的运行时验证只能在
    // 真机（AGENTS.md §5 新增表后重启验收）；这里验证 v19 全新安装路径。
    dbCounter += 1;
    const adapter = new LokiJSAdapter({
      dbName: `test-v19-fresh-${dbCounter}`,
      schema,
      migrations,
      useWebWorker: false,
      useIncrementalIndexedDB: false,
    });
    createdAdapters.push(adapter);
    const db = new Database({
      adapter,
      modelClasses: [SparkModel, SparkAttachmentModel, SparkItemModel],
    });

    let sparkId = '';
    await db.write(async () => {
      // 纯录音灵感先建行：title/content 双空合法（提案 D3 createSpark 允许双空）。
      const spark = await db.get<SparkModel>('sparks').create((record) => {
        record.title = null;
        record.content = null;
      });
      sparkId = spark.id;

      await db.get<SparkAttachmentModel>('spark_attachments').create((record) => {
        record.sparkId = sparkId;
        record.kind = 'audio';
        record.uri = '/tmp/sparks/test-audio.m4a';
        record.remotePath = null;
        record.sha256 = null;
        record.fileSize = 12345;
        record.durationMs = 61000;
        record.width = null;
        record.height = null;
      });

      await db.get<SparkItemModel>('spark_items').create((record) => {
        record.sparkId = sparkId;
        record.itemId = 'item-1';
      });
    });

    const reloaded = await db.get<SparkModel>('sparks').find(sparkId);
    expect(reloaded.title).toBeNull();
    expect(reloaded.content).toBeNull();

    const attachments = await db.get<SparkAttachmentModel>('spark_attachments').query().fetch();
    expect(attachments).toHaveLength(1);
    expect(attachments[0].kind).toBe('audio');
    expect(attachments[0].fileSize).toBe(12345);
    expect(attachments[0].durationMs).toBe(61000);
    expect(attachments[0].width).toBeNull();
    expect(attachments[0].remotePath).toBeNull();

    const links = await db.get<SparkItemModel>('spark_items').query().fetch();
    expect(links).toHaveLength(1);
    expect(links[0].sparkId).toBe(sparkId);
    expect(links[0].itemId).toBe('item-1');
  });
});
