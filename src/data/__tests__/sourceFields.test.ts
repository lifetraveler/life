import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import ItemModel from '../../db/models/ItemModel';
import ItemTagModel from '../../db/models/ItemTagModel';
import ReminderModel from '../../db/models/ReminderModel';
import TagModel from '../../db/models/TagModel';
import { schema } from '../../db/schema';
import { WatermelonItemRepository } from '../WatermelonItemRepository';
import type { Item } from '../../domain/item';

/**
 * 切片 8 外部来源字段 + allDay 归一化的仓库层单测（真实 WatermelonDB + LokiJS
 * 内存适配器，同 viewQueries.test.ts 基准；时区经构造函数注入固定，不依赖测试机）。
 * createImportedItem 的导入语义测试见 importIcs.test.ts（步骤 5）。
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
  repository: WatermelonItemRepository;
  db: Database;
}

function makeContext(deviceTzid: () => string): TestContext {
  dbCounter += 1;
  const adapter = new LokiJSAdapter({
    dbName: `test-source-fields-${dbCounter}`,
    schema,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  createdAdapters.push(adapter);
  const database = new Database({
    adapter,
    modelClasses: [ItemModel, TagModel, ItemTagModel, ReminderModel],
  });
  return {
    repository: new WatermelonItemRepository(database, deviceTzid),
    db: database,
  };
}

afterAll(() => {
  for (const adapter of createdAdapters) {
    extractLokiHandle(adapter)?.close();
  }
  createdAdapters.length = 0;
});

/** 在 items 表直接造一条外部来源行（createImportedItem 属步骤 5，护栏测试先于此存在）。 */
async function insertImportedRow(
  db: Database,
  overrides: { sourceType?: 'ics' | 'system-calendar'; sourceUid?: string | null } = {},
): Promise<ItemModel> {
  return db.write(async () =>
    db.get<ItemModel>('items').create((record) => {
      record.type = 'event';
      record.title = '导入事件';
      record.content = '来自 ICS';
      record.status = 'active';
      record.sourceType = overrides.sourceType ?? 'ics';
      record.sourceUid = overrides.sourceUid ?? 'uid-ics-1';
      record.sourceReadOnly = true;
    }),
  );
}

describe('WatermelonItemRepository 外部来源字段（切片 8）', () => {
  describe('createItem 本地路径', () => {
    it('新行固定写入 (local, null, false)', async () => {
      const { repository } = makeContext(() => 'Asia/Shanghai');
      const item = await repository.createItem({ type: 'task', title: '本地任务' });
      expect(item.sourceType).toBe('local');
      expect(item.sourceUid).toBeNull();
      expect(item.sourceReadOnly).toBe(false);
    });

    it('allDay=true 时 startAt 归一为注入时区当天 00:00', async () => {
      const { repository } = makeContext(() => 'Asia/Shanghai');
      // 2026-11-10 10:30 +08:00
      const item = await repository.createItem({
        type: 'event',
        title: '全天事件',
        startAt: Date.UTC(2026, 10, 10, 2, 30),
        endAt: Date.UTC(2026, 10, 10, 4, 0),
        allDay: true,
      });
      // 2026-11-10 00:00 +08:00
      expect(item.startAt).toBe(Date.UTC(2026, 10, 9, 16, 0));
      expect(item.allDay).toBe(true);
      expect(item.endAt).toBe(Date.UTC(2026, 10, 10, 4, 0));
    });

    it('allDay=false 时 startAt 不归一', async () => {
      const { repository } = makeContext(() => 'Asia/Shanghai');
      const item = await repository.createItem({
        type: 'event',
        title: '普通事件',
        startAt: Date.UTC(2026, 10, 10, 2, 30),
        endAt: null,
      });
      expect(item.startAt).toBe(Date.UTC(2026, 10, 10, 2, 30));
    });
  });

  describe('updateItemTime 归一化', () => {
    it('既有 allDay=true 项改 startAt：落同日 00:00', async () => {
      const { repository } = makeContext(() => 'Asia/Shanghai');
      const created = await repository.createItem({
        type: 'event',
        title: '全天事件',
        startAt: Date.UTC(2026, 10, 9, 16, 0), // 11-10 00:00 +08
        allDay: true,
      });
      // 改为 2026-11-11 15:00 +08:00
      const updated = await repository.updateItemTime(created.id, {
        startAt: Date.UTC(2026, 10, 11, 7, 0),
      });
      // 2026-11-11 00:00 +08:00
      expect(updated.startAt).toBe(Date.UTC(2026, 10, 10, 16, 0));
      expect(updated.allDay).toBe(true);
    });

    it('patch 翻转 allDay=false→true：startAt 同步归一', async () => {
      const { repository } = makeContext(() => 'Asia/Shanghai');
      const created = await repository.createItem({
        type: 'event',
        title: '普通事件',
        startAt: Date.UTC(2026, 10, 10, 2, 30), // 11-10 10:30 +08
      });
      const updated = await repository.updateItemTime(created.id, { allDay: true });
      expect(updated.startAt).toBe(Date.UTC(2026, 10, 9, 16, 0)); // 11-10 00:00 +08
      expect(updated.allDay).toBe(true);
    });

    it('仅翻转 allDay=true→false：startAt 原样保留、不再改写', async () => {
      const { repository } = makeContext(() => 'Asia/Shanghai');
      const created = await repository.createItem({
        type: 'event',
        title: '全天事件',
        startAt: Date.UTC(2026, 10, 9, 16, 0),
        allDay: true,
      });
      const updated = await repository.updateItemTime(created.id, { allDay: false });
      expect(updated.startAt).toBe(Date.UTC(2026, 10, 9, 16, 0));
      expect(updated.allDay).toBe(false);
    });
  });

  describe('updateItem 只读护栏（data-model.md v0.8）', () => {
    it('source_read_only=true：title/content/type 全部拒绝，错误信息明确', async () => {
      const { repository, db } = makeContext(() => 'Asia/Shanghai');
      const imported = await insertImportedRow(db);
      await expect(repository.updateItem(imported.id, { title: '改标题' })).rejects.toThrow(
        'source read-only',
      );
      await expect(repository.updateItem(imported.id, { content: '改内容' })).rejects.toThrow(
        'source read-only',
      );
      await expect(repository.updateItem(imported.id, { type: 'task' })).rejects.toThrow(
        'source read-only',
      );
    });

    it('source_read_only=true：status 更新放行（完成/归档语义）', async () => {
      const { repository, db } = makeContext(() => 'Asia/Shanghai');
      const imported = await insertImportedRow(db);
      const done = await repository.updateItem(imported.id, { status: 'done' });
      expect(done.status).toBe('done');
      await expect(repository.archiveItem(imported.id)).resolves.toBeUndefined();
      const archived = await repository.getItem(imported.id);
      expect(archived?.status).toBe('archived');
    });

    it('source_read_only=false（本地行）：title 更新不受影响', async () => {
      const { repository } = makeContext(() => 'Asia/Shanghai');
      const local = await repository.createItem({ type: 'task', title: '本地任务' });
      const updated = await repository.updateItem(local.id, { title: '改标题' });
      expect(updated.title).toBe('改标题');
    });

    it('导入行经 updateItemTime 抛错（data-model.md：只读项不可编辑时间）', async () => {
      const { repository, db } = makeContext(() => 'Asia/Shanghai');
      const imported = await insertImportedRow(db);
      await expect(
        repository.updateItemTime(imported.id, {
          startAt: Date.UTC(2026, 10, 10, 2, 30),
        }),
      ).rejects.toThrow('updateItemTime: item is source read-only');
      // 抛错后时间未被改写（夹具行本就未设 startAt，仍应为 null）。
      const unchanged = await repository.getItem(imported.id);
      expect(unchanged?.startAt).toBeNull();
    });
  });
});
