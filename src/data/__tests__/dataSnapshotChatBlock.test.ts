/**
 * 数据快照聊天可选块仓库级行为测试（切片 38 阶段 1，AGENTS.md §7.50 D3；
 * repository.md v0.44 注记节口径）：
 * - createDataSnapshot 追加 chatMessages 全量组包（seq 升序、200 条滚动上限）；
 * - applyDataSnapshot 聊天段恢复（upsert by seq：命中覆盖/未命中创建/本地独有保留）；
 * - created_at 经 _raw 保真（未命中创建走快照 createdAt，命中覆盖本地值不动）；
 * - 快照内重复 seq first-wins skipped；形状不符 skipped；缺块整个段跳过；
 * - 旧格式快照（无 chatMessages 键）零改动兼容。
 */

import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { Q } from '@nozbe/watermelondb';

import { schema } from '../../db/schema';
import ItemModel from '../../db/models/ItemModel';
import ItemTagModel from '../../db/models/ItemTagModel';
import ReminderModel from '../../db/models/ReminderModel';
import CategoryModel from '../../db/models/CategoryModel';
import AppSettingsModel from '../../db/models/AppSettingsModel';
import TagModel from '../../db/models/TagModel';
import ChannelPresetModel from '../../db/models/ChannelPresetModel';
import SyncTombstoneModel from '../../db/models/SyncTombstoneModel';
import SparkModel from '../../db/models/SparkModel';
import SparkAttachmentModel from '../../db/models/SparkAttachmentModel';
import SparkItemModel from '../../db/models/SparkItemModel';
import ChatMessageModel from '../../db/models/ChatMessageModel';
import { WatermelonItemRepository } from '../WatermelonItemRepository';
import { CHAT_MESSAGE_PERSIST_LIMIT } from '../ChatMessageRepository';
import {
  type DataSnapshotChatMessage,
  isDataSnapshotWire,
  serializeDataSnapshot,
  type DataSnapshot,
} from '../../domain/dataSnapshot';

let dbCounter = 0;

const createdAdapters: LokiJSAdapter[] = [];

afterAll(() => {
  for (const adapter of createdAdapters) {
    (adapter._driver as unknown as { loki?: { close: () => void } } | undefined)?.loki?.close();
  }
  createdAdapters.length = 0;
});

const MODEL_CLASSES = [
  ItemModel,
  TagModel,
  ItemTagModel,
  ReminderModel,
  CategoryModel,
  AppSettingsModel,
  ChannelPresetModel,
  SyncTombstoneModel,
  SparkModel,
  SparkAttachmentModel,
  SparkItemModel,
  ChatMessageModel,
];

type Harness = {
  repo: WatermelonItemRepository;
  database: Database;
  adapter: LokiJSAdapter;
};

function makeHarness(): Harness {
  dbCounter += 1;
  const adapter = new LokiJSAdapter({
    dbName: `test-ds-chat-${dbCounter}`,
    schema,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  createdAdapters.push(adapter);
  const database = new Database({ adapter, modelClasses: MODEL_CLASSES });
  const repo = new WatermelonItemRepository(database, undefined, undefined, null);
  return { repo, database, adapter };
}

const CHAT_TABLE = 'flash_chat_messages';

function makeChatEntry(overrides: Partial<DataSnapshotChatMessage> = {}): DataSnapshotChatMessage {
  return {
    seq: 1,
    role: 'user',
    text: '明天八点叫我',
    kind: 'text',
    cardPayloadJson: null,
    seedJson: null,
    createdAt: 1700000000000,
    ...overrides,
  };
}

async function chatRows(database: Database) {
  const rows = await database
    .get<ChatMessageModel>(CHAT_TABLE)
    .query(Q.sortBy('seq', Q.asc))
    .fetch();
  return rows;
}

describe('createDataSnapshot：chatMessages 组包', () => {
  it('聊天行全量进入快照（seq 升序、字段逐项投影、createdAt 保真）；空表=空数组', async () => {
    const { repo, database } = makeHarness();
    await database.write(async () => {
      const table = database.get<ChatMessageModel>(CHAT_TABLE);
      await table.create((record) => {
        record.seq = 2;
        record.role = 'assistant';
        record.text = '已保存《起床闹钟》';
        record.kind = 'card';
        record.cardPayloadJson = '{"itemId":"i1"}';
        record.seedJson = '{"title":"起床闹钟"}';
      });
      await table.create((record) => {
        record.seq = 1;
        record.role = 'user';
        record.text = '明天八点叫我';
        record.kind = 'text';
      });
    });

    const snapshot = await repo.createDataSnapshot();
    expect(snapshot.chatMessages).toBeDefined();
    expect(snapshot.chatMessages).toHaveLength(2);
    expect(snapshot.chatMessages?.[0].seq).toBe(1);
    expect(snapshot.chatMessages?.[0].kind).toBe('text');
    expect(snapshot.chatMessages?.[0].cardPayloadJson).toBeNull();
    expect(snapshot.chatMessages?.[1].seq).toBe(2);
    expect(snapshot.chatMessages?.[1].kind).toBe('card');
    expect(snapshot.chatMessages?.[1].cardPayloadJson).toBe('{"itemId":"i1"}');
    expect(snapshot.chatMessages?.[1].seedJson).toBe('{"title":"起床闹钟"}');
    expect(typeof snapshot.chatMessages?.[1].createdAt).toBe('number');

    const empty = await makeHarness().repo.createDataSnapshot();
    expect(empty.chatMessages).toEqual([]);
  });

  it('200 条滚动上限：本地 210 条 → 快照只带最近 200 条（seq 11 起）', async () => {
    const { repo, database } = makeHarness();
    await database.write(async () => {
      const table = database.get<ChatMessageModel>(CHAT_TABLE);
      for (let seq = 1; seq <= CHAT_MESSAGE_PERSIST_LIMIT + 10; seq += 1) {
        await table.create((record) => {
          record.seq = seq;
          record.role = 'user';
          record.text = `消息 ${seq}`;
          record.kind = 'text';
        });
      }
    });
    const snapshot = await repo.createDataSnapshot();
    expect(snapshot.chatMessages).toHaveLength(CHAT_MESSAGE_PERSIST_LIMIT);
    expect(snapshot.chatMessages?.[0].seq).toBe(11);
    expect(snapshot.chatMessages?.[snapshot.chatMessages.length - 1].seq).toBe(
      CHAT_MESSAGE_PERSIST_LIMIT + 10,
    );
  });

  it('serialize/parse 往返：聊天块随快照序列化并可整包解析（isDataSnapshotWire 通过）', async () => {
    const { repo, database } = makeHarness();
    await database.write(async () => {
      await database.get<ChatMessageModel>(CHAT_TABLE).create((record) => {
        record.seq = 1;
        record.role = 'user';
        record.text = '往返';
        record.kind = 'text';
      });
    });
    const snapshot = await repo.createDataSnapshot();
    const text = serializeDataSnapshot(snapshot);
    const parsed = JSON.parse(text);
    expect(isDataSnapshotWire(parsed)).toBe(true);
    expect(parsed.chatMessages).toHaveLength(1);
    expect(parsed.chatMessages[0].text).toBe('往返');
  });
});

describe('applyDataSnapshot：chatMessages 恢复', () => {
  function makeSnapshot(
    chatMessages: DataSnapshotChatMessage[],
    overrides: Partial<DataSnapshot> = {},
  ): DataSnapshot {
    return {
      version: 1,
      kind: 'data',
      exportedAt: '2026-01-01T00:00:00.000Z',
      items: [],
      tags: [],
      reminders: [],
      channelPresets: [],
      itemTags: [],
      chatMessages,
      ...overrides,
    };
  }

  it('未命中创建：行 id 派生自 seq（chat-<seq>）、created_at 经 _raw 保真', async () => {
    const { repo, database } = makeHarness();
    const result = await repo.applyDataSnapshot(
      makeSnapshot([makeChatEntry({ seq: 7, text: '远端消息' })]),
    );
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
    const rows = await chatRows(database);
    expect(rows).toHaveLength(1);
    expect(rows[0].seq).toBe(7);
    expect(rows[0].text).toBe('远端消息');
    expect(rows[0].createdAt.getTime()).toBe(1700000000000);
    expect(rows[0].id).toBe('chat-7');
  });

  it('命中覆盖：五字段写穿、本地 created_at 不动；命中且无变化幂等不写不计', async () => {
    const { repo, database } = makeHarness();
    await database.write(async () => {
      await database.get<ChatMessageModel>(CHAT_TABLE).create((record) => {
        record.seq = 1;
        record.role = 'user';
        record.text = '本地旧文案';
        record.kind = 'text';
      });
    });
    const [localRow] = await chatRows(database);
    const localCreatedAt = localRow.createdAt.getTime();

    const result = await repo.applyDataSnapshot(
      makeSnapshot([makeChatEntry({ seq: 1, role: 'assistant', text: '快照新文案' })]),
    );
    expect(result.applied).toBe(1);
    const rows = await chatRows(database);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('快照新文案');
    expect(rows[0].role).toBe('assistant');
    expect(rows[0].createdAt.getTime()).toBe(localCreatedAt);

    const idempotent = await repo.applyDataSnapshot(
      makeSnapshot([makeChatEntry({ seq: 1, role: 'assistant', text: '快照新文案' })]),
    );
    expect(idempotent.applied).toBe(0);
    expect(await chatRows(database)).toHaveLength(1);
  });

  it('本地独有保留 + 混合恢复（命中/未命中/独有并存）；恢复侧不二次裁剪', async () => {
    const { repo, database } = makeHarness();
    await database.write(async () => {
      const table = database.get<ChatMessageModel>(CHAT_TABLE);
      await table.create((record) => {
        record.seq = 1;
        record.role = 'user';
        record.text = '本地独有';
        record.kind = 'text';
      });
      await table.create((record) => {
        record.seq = 2;
        record.role = 'user';
        record.text = '会被覆盖';
        record.kind = 'text';
      });
    });
    const result = await repo.applyDataSnapshot(
      makeSnapshot([
        makeChatEntry({ seq: 2, text: '快照覆盖' }),
        makeChatEntry({ seq: 3, role: 'assistant', kind: 'card', text: '快照新增' }),
      ]),
    );
    expect(result.applied).toBe(2);
    const rows = await chatRows(database);
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(rows[0].text).toBe('本地独有');
    expect(rows[1].text).toBe('快照覆盖');
    expect(rows[2].text).toBe('快照新增');
  });

  it('快照内重复 seq first-wins skipped 计数；形状不符 skipped', async () => {
    const { repo, database } = makeHarness();
    const result = await repo.applyDataSnapshot(
      makeSnapshot([
        makeChatEntry({ seq: 1, text: '首个' }),
        makeChatEntry({ seq: 1, text: '重复' }),
        makeChatEntry({ seq: 2, role: 'system' as unknown as 'user', text: '坏角色' }),
        makeChatEntry({ seq: 'x' as unknown as number, text: '坏seq' }),
      ]),
    );
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(3);
    const rows = await chatRows(database);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('首个');
  });

  it('缺 chatMessages 键（旧格式快照）：聊天段整个跳过，本地行零改动', async () => {
    const { repo, database } = makeHarness();
    await database.write(async () => {
      await database.get<ChatMessageModel>(CHAT_TABLE).create((record) => {
        record.seq = 1;
        record.role = 'user';
        record.text = '本地消息';
        record.kind = 'text';
      });
    });
    const { chatMessages: _omitted, ...legacySnapshot } = makeSnapshot([]);
    const result = await repo.applyDataSnapshot(legacySnapshot);
    expect(result.applied).toBe(0);
    const rows = await chatRows(database);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('本地消息');
  });
});
