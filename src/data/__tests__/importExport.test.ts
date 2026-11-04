import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import type { ImportedItemInput } from '../../domain/item';
import ItemModel from '../../db/models/ItemModel';
import ItemTagModel from '../../db/models/ItemTagModel';
import ReminderModel from '../../db/models/ReminderModel';
import TagModel from '../../db/models/TagModel';
import { schema } from '../../db/schema';
import { WatermelonItemRepository } from '../WatermelonItemRepository';

/**
 * 切片 8 ICS 导入导出接口的仓库层单测（repository.md v0.8「ICS 导入导出接口」）：
 * 真实 WatermelonDB + LokiJS 内存适配器（同 viewQueries/sourceFields 基准）；
 * 时区经构造函数注入固定为 Asia/Shanghai，不依赖测试机设置。
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

function makeContext(): TestContext {
  dbCounter += 1;
  const adapter = new LokiJSAdapter({
    dbName: `test-import-export-${dbCounter}`,
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
    repository: new WatermelonItemRepository(database, () => 'Asia/Shanghai'),
    db: database,
  };
}

afterAll(() => {
  for (const adapter of createdAdapters) {
    extractLokiHandle(adapter)?.close();
  }
  createdAdapters.length = 0;
});

let inputCounter = 0;

function makeInput(overrides: Partial<ImportedItemInput> = {}): ImportedItemInput {
  inputCounter += 1;
  return {
    title: `ICS 事件 ${inputCounter}`,
    content: '来自 ICS',
    // 2026-11-10 10:30 +08:00 ～ 11:30
    startAt: Date.UTC(2026, 10, 10, 2, 30),
    endAt: Date.UTC(2026, 10, 10, 3, 30),
    allDay: false,
    sourceUid: `uid-${inputCounter}`,
    ...overrides,
  };
}

describe('WatermelonItemRepository ICS 导入导出（切片 8）', () => {
  describe('createImportedItem', () => {
    it('sourceType/sourceUid/sourceReadOnly 按契约固定，标题 trim，tags 为空', async () => {
      const { repository } = makeContext();
      const item = await repository.createImportedItem(
        makeInput({ title: '  ICS 事件  ', sourceUid: 'uid-a' }),
      );
      expect(item.sourceType).toBe('ics');
      expect(item.sourceUid).toBe('uid-a');
      expect(item.sourceReadOnly).toBe(true);
      expect(item.type).toBe('event');
      expect(item.status).toBe('active');
      expect(item.title).toBe('ICS 事件');
      expect(item.tags).toEqual([]);
    });

    it('sourceUid 非 null 且重复时抛 DuplicateSourceUid，不做 upsert', async () => {
      const { repository } = makeContext();
      await repository.createImportedItem(makeInput({ sourceUid: 'uid-dup' }));
      await expect(
        repository.createImportedItem(makeInput({ title: '另一个', sourceUid: 'uid-dup' })),
      ).rejects.toThrow(/DuplicateSourceUid/);
    });

    it('sourceUid=null 的 ICS 事件每次都作为新项插入', async () => {
      const { repository } = makeContext();
      const first = await repository.createImportedItem(makeInput({ sourceUid: null }));
      const second = await repository.createImportedItem(makeInput({ sourceUid: null }));
      expect(first.id).not.toBe(second.id);
    });

    it('allDay=true 时 startAt 归一为注入时区当天 00:00，endAt 不动', async () => {
      const { repository } = makeContext();
      const item = await repository.createImportedItem(
        makeInput({
          allDay: true,
          startAt: Date.UTC(2026, 10, 10, 2, 30),
          endAt: Date.UTC(2026, 10, 10, 4, 0),
        }),
      );
      // 2026-11-10 00:00 +08:00
      expect(item.startAt).toBe(Date.UTC(2026, 10, 9, 16, 0));
      expect(item.allDay).toBe(true);
      expect(item.endAt).toBe(Date.UTC(2026, 10, 10, 4, 0));
    });

    it('标题空白抛错', async () => {
      const { repository } = makeContext();
      await expect(repository.createImportedItem(makeInput({ title: '   ' }))).rejects.toThrow(
        /title must not be blank/,
      );
    });
  });

  describe('findItemBySource', () => {
    it('按 (ics, sourceUid) 命中；未命中返回 null', async () => {
      const { repository } = makeContext();
      const a = await repository.createImportedItem(makeInput({ sourceUid: 'uid-a' }));
      await repository.createImportedItem(makeInput({ sourceUid: 'uid-b' }));
      const found = await repository.findItemBySource('ics', 'uid-a');
      expect(found?.id).toBe(a.id);
      expect(found?.sourceUid).toBe('uid-a');
      expect(await repository.findItemBySource('ics', 'uid-missing')).toBeNull();
    });
  });

  describe('listItemsForExport', () => {
    it('导出未归档（active+done，含导入项），排除 archived', async () => {
      const { repository } = makeContext();
      const active = await repository.createItem({ type: 'task', title: '本地 active' });
      const done = await repository.createItem({ type: 'task', title: '本地 done' });
      await repository.updateItem(done.id, { status: 'done' });
      const archived = await repository.createItem({ type: 'task', title: '本地 archived' });
      await repository.archiveItem(archived.id);
      const imported = await repository.createImportedItem(makeInput({ sourceUid: 'uid-x' }));

      const exported = await repository.listItemsForExport({
        includeArchived: false,
        includeDone: true,
      });
      expect(exported.length).toBe(3);
      const ids = new Set(exported.map((item) => item.id));
      expect(ids.has(active.id)).toBe(true);
      expect(ids.has(done.id)).toBe(true);
      expect(ids.has(imported.id)).toBe(true);
      expect(ids.has(archived.id)).toBe(false);
    });

    it('固定 filter 之外的组合抛错', async () => {
      const { repository } = makeContext();
      const bad = {
        includeArchived: true,
        includeDone: true,
      } as unknown as Parameters<WatermelonItemRepository['listItemsForExport']>[0];
      await expect(repository.listItemsForExport(bad)).rejects.toThrow(/fixed MVP filter/);
    });
  });

  describe('updateImportedItemTime', () => {
    it('sourceReadOnly=true 抛明确错误，时间不变', async () => {
      const { repository } = makeContext();
      const imported = await repository.createImportedItem(makeInput({ sourceUid: 'uid-ro' }));
      await expect(
        repository.updateImportedItemTime(imported.id, {
          startAt: Date.UTC(2026, 10, 11, 2, 30),
        }),
      ).rejects.toThrow(/source read-only/);
      const unchanged = await repository.getItem(imported.id);
      expect(unchanged?.startAt).toBe(Date.UTC(2026, 10, 10, 2, 30));
    });
  });

  describe('deleteItem', () => {
    it('删除本地副本：行+提醒+item_tags 物理删除，tag 保留', async () => {
      const { repository, db } = makeContext();
      const item = await repository.createItem({ type: 'task', title: '要删除的任务' });
      await repository.addTagToItem(item.id, '工作');
      await repository.createReminder({
        itemId: item.id,
        frequency: 'daily',
        localTimeHour: 8,
        localTimeMinute: 0,
        tzid: 'Asia/Shanghai',
        startAt: Date.UTC(2026, 10, 10, 0, 0),
        enabled: true,
      });

      await repository.deleteItem(item.id);

      expect(await repository.getItem(item.id)).toBeNull();
      expect(await repository.listRemindersByItem(item.id)).toEqual([]);
      expect(await db.get<TagModel>('tags').query().fetchCount()).toBe(1);
      expect(await db.get<ItemTagModel>('item_tags').query().fetchCount()).toBe(0);
    });
  });

  describe('importItemsInBatches', () => {
    it('101 条分 2 批写入且全部落库', async () => {
      const { repository, db } = makeContext();
      const writeSpy = jest.spyOn(db, 'write');
      const inputs = Array.from({ length: 101 }, () => makeInput());
      const result = await repository.importItemsInBatches(inputs);
      expect(result.createdCount).toBe(101);
      expect(result.skippedDuplicateCount).toBe(0);
      expect(result.failures).toEqual([]);
      expect(writeSpy).toHaveBeenCalledTimes(2);
      expect(await repository.findItemBySource('ics', inputs[0].sourceUid as string)).not.toBeNull();
      expect(
        await repository.findItemBySource('ics', inputs[100].sourceUid as string),
      ).not.toBeNull();
      writeSpy.mockRestore();
    });

    it('单条失败不影响已成功项落库，失败清单上报', async () => {
      const { repository } = makeContext();
      const ok1 = makeInput({ sourceUid: 'uid-ok-1' });
      const bad = makeInput({ sourceUid: 'uid-bad', title: '   ' });
      const ok2 = makeInput({ sourceUid: 'uid-ok-2' });
      const result = await repository.importItemsInBatches([ok1, bad, ok2]);
      expect(result.createdCount).toBe(2);
      expect(result.failures.length).toBe(1);
      expect(result.failures[0]?.title).toBe('   ');
      expect(result.failures[0]?.sourceUid).toBe('uid-bad');
      expect(result.failures[0]?.reason).toContain('title must not be blank');
      expect(await repository.findItemBySource('ics', 'uid-ok-1')).not.toBeNull();
      expect(await repository.findItemBySource('ics', 'uid-ok-2')).not.toBeNull();
      expect(await repository.findItemBySource('ics', 'uid-bad')).toBeNull();
    });

    it('批内重复计入 skippedDuplicateCount', async () => {
      const { repository } = makeContext();
      await repository.createImportedItem(makeInput({ sourceUid: 'uid-pre' }));
      const result = await repository.importItemsInBatches([
        makeInput({ sourceUid: 'uid-pre', title: '重复项' }),
        makeInput({ sourceUid: 'uid-new' }),
      ]);
      expect(result.createdCount).toBe(1);
      expect(result.skippedDuplicateCount).toBe(1);
      expect(result.failures).toEqual([]);
    });
  });
});
