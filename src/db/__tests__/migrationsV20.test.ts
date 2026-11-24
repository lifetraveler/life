/**
 * 切片 38 阶段 1（AGENTS.md §7.50）：schema v19→v20 迁移结构断言。
 *
 * 同 migrationsV19.test.ts 思路：LokiJS/结构级断言（create_table step 形如
 * { type: 'create_table', name, columns }），外加真实 WatermelonDB + LokiJS 建库
 * 行为级验证（v20 全新安装路径 flash_chat_messages 可建行、可写读；seq 索引列、
 * card_payload_json/seed_json isOptional 列模型类型为 string | null）。
 * 注：create_table step 的列定义必须与 schema.ts 全新安装路径逐字段一致（漂移会在
 * 真机 migration 时爆列，§5 升级安装重启验收兜底）。
 */
import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import { SCHEMA_VERSION, schema } from '../schema';
import migrations from '../migrations';
import ChatMessageModel from '../models/ChatMessageModel';

let dbCounter = 0;

const createdAdapters: LokiJSAdapter[] = [];

afterAll(() => {
  for (const adapter of createdAdapters) {
    (adapter._driver as unknown as { loki?: { close: () => void } } | undefined)?.loki?.close();
  }
  createdAdapters.length = 0;
});

describe('schema v20（切片 38 阶段 1）', () => {
  it('SCHEMA_VERSION = 20 且 migrations 链 maxVersion = 20（切片 38 追加 v20 后例行更新）', () => {
    expect(SCHEMA_VERSION).toBe(20);
    expect(schema.version).toBe(20);
    expect(migrations.maxVersion).toBe(20);
    expect(migrations.minVersion).toBe(1);
  });

  it('migration 链 toVersion 从 2 连续递增到 20，无跳号（v2–v19 已发布 step 未回改）', () => {
    const versions = migrations.sortedMigrations.map((entry) => entry.toVersion);
    expect(versions).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
  });

  it('v20 step：单条 create_table（flash_chat_messages），列定义与 schema.ts 逐字段一致', () => {
    const step20 = migrations.sortedMigrations.find((entry) => entry.toVersion === 20);
    expect(step20).toBeDefined();
    expect(step20?.steps).toHaveLength(1);
    expect(step20?.steps.map((step) => step.type)).toEqual(['create_table']);

    // create_table step 携带完整 tableSchema 产物（{ name, columns: 字典 }）。
    const [chatStep] = step20?.steps as {
      type: 'create_table';
      schema: { name: string; columns: Record<string, unknown> };
    }[];

    expect(chatStep.schema.name).toBe('flash_chat_messages');
    expect(chatStep.schema.columns).toEqual({
      seq: { name: 'seq', type: 'number', isIndexed: true },
      role: { name: 'role', type: 'string' },
      text: { name: 'text', type: 'string' },
      kind: { name: 'kind', type: 'string' },
      card_payload_json: { name: 'card_payload_json', type: 'string', isOptional: true },
      seed_json: { name: 'seed_json', type: 'string', isOptional: true },
      created_at: { name: 'created_at', type: 'number' },
    });

    // 全新安装路径（schema.ts）同表，逐字段一致。
    expect(schema.tables.flash_chat_messages?.columns.seq).toEqual({
      name: 'seq',
      type: 'number',
      isIndexed: true,
    });
    expect(schema.tables.flash_chat_messages?.columns.card_payload_json).toEqual({
      name: 'card_payload_json',
      type: 'string',
      isOptional: true,
    });
    expect(schema.tables.flash_chat_messages?.columns.seed_json).toEqual({
      name: 'seed_json',
      type: 'string',
      isOptional: true,
    });
  });

  it('v2–v19 已发布 step 不含 create_table flash_chat_messages（只允许末尾追加）', () => {
    const legacyCreate = migrations.sortedMigrations
      .filter((entry) => entry.toVersion < 20)
      .flatMap((entry) => entry.steps)
      .filter(
        (step) =>
          step.type === 'create_table' &&
          (step as { type: 'create_table'; schema: { name: string } }).schema.name ===
            'flash_chat_messages',
      );
    expect(legacyCreate).toEqual([]);
  });

  it('行为级：v20 schema 建库后 flash_chat_messages 可建行、可写读（text 行两 JSON 列 null / card 行可写串）', async () => {
    // LokiJS 内存适配器无持久化状态，升级路径（v19→v20 建表）的运行时验证只能在
    // 真机（AGENTS.md §5 新增表后重启验收）；这里验证 v20 全新安装路径。
    dbCounter += 1;
    const adapter = new LokiJSAdapter({
      dbName: `test-v20-fresh-${dbCounter}`,
      schema,
      migrations,
      useWebWorker: false,
      useIncrementalIndexedDB: false,
    });
    createdAdapters.push(adapter);
    const db = new Database({
      adapter,
      modelClasses: [ChatMessageModel],
    });

    let textRowId = '';
    let cardRowId = '';
    await db.write(async () => {
      const textRow = await db.get<ChatMessageModel>('flash_chat_messages').create((record) => {
        record.seq = 1;
        record.role = 'user';
        record.text = '明天上午八点叫我起床';
        record.kind = 'text';
        record.cardPayloadJson = null;
        record.seedJson = null;
      });
      textRowId = textRow.id;

      const cardRow = await db.get<ChatMessageModel>('flash_chat_messages').create((record) => {
        record.seq = 2;
        record.role = 'assistant';
        record.text = '已保存《起床闹钟》';
        record.kind = 'card';
        record.cardPayloadJson = '{"itemId":"i1","title":"起床闹钟"}';
        record.seedJson = '{"title":"起床闹钟"}';
      });
      cardRowId = cardRow.id;
    });

    const textReloaded = await db.get<ChatMessageModel>('flash_chat_messages').find(textRowId);
    expect(textReloaded.seq).toBe(1);
    expect(textReloaded.role).toBe('user');
    expect(textReloaded.kind).toBe('text');
    expect(textReloaded.cardPayloadJson).toBeNull();
    expect(textReloaded.seedJson).toBeNull();
    expect(textReloaded.createdAt).toBeInstanceOf(Date);

    const cardReloaded = await db.get<ChatMessageModel>('flash_chat_messages').find(cardRowId);
    expect(cardReloaded.seq).toBe(2);
    expect(cardReloaded.kind).toBe('card');
    expect(cardReloaded.cardPayloadJson).toBe('{"itemId":"i1","title":"起床闹钟"}');
    expect(cardReloaded.seedJson).toBe('{"title":"起床闹钟"}');

    const all = await db.get<ChatMessageModel>('flash_chat_messages').query().fetch();
    expect(all).toHaveLength(2);
  });
});
