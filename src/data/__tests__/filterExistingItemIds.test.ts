/**
 * WatermelonItemRepository.filterExistingItemIds 单测（切片 30 阶段 4，
 * AGENTS.md §7.41 D2——聊天已删除卡联动的批量 id 存在性查询）。
 * 用真实 WatermelonDB + LokiJS 内存适配器跑查询语义（viewQueries.test.ts
 * 同模式）：验证 IN 语义真的落在查询里（存在/缺失/重复输入/空输入）。
 */

import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import ItemModel from '../../db/models/ItemModel';
import ItemTagModel from '../../db/models/ItemTagModel';
import ReminderModel from '../../db/models/ReminderModel';
import CategoryModel from '../../db/models/CategoryModel';
import AppSettingsModel from '../../db/models/AppSettingsModel';
import TagModel from '../../db/models/TagModel';
import SyncTombstoneModel from '../../db/models/SyncTombstoneModel';
import { schema } from '../../db/schema';
import { WatermelonItemRepository } from '../WatermelonItemRepository';
import type { CreateItemInput } from '../../domain/item';

let dbCounter = 0;

// LokiJS autosave 定时器会挂住 jest 进程——与 viewQueries.test.ts 同款清理。
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

function makeRepository(): WatermelonItemRepository {
  dbCounter += 1;
  const adapter = new LokiJSAdapter({
    dbName: `test-existing-ids-${dbCounter}`,
    schema,
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
    SyncTombstoneModel,
    ],
  });
  return new WatermelonItemRepository(database);
}

afterAll(() => {
  for (const adapter of createdAdapters) {
    extractLokiHandle(adapter)?.close();
  }
});

function makeCreateInput(title: string): CreateItemInput {
  return {
    title,
    content: '',
    type: 'note',
    startAt: null,
    endAt: null,
    allDay: false,
    categoryId: null,
    priority: 0,
    recurrence: null,
    sourceType: 'local',
    sourceUid: null,
    sourceReadOnly: false,
  } as CreateItemInput;
}

describe('filterExistingItemIds（切片 30 §7.41 D2）', () => {
  it('返回 ids 中实际存在的子集；重复输入安全；空输入短路', async () => {
    const repo = makeRepository();
    const created = await repo.createItem(makeCreateInput('存在条目'));
    const created2 = await repo.createItem(makeCreateInput('另一条'));

    const found = await repo.filterExistingItemIds([
      created.id,
      'missing-id',
      created2.id,
      created.id,
    ]);
    expect(found.size).toBe(2);
    expect(found.has(created.id)).toBe(true);
    expect(found.has(created2.id)).toBe(true);
    expect(found.has('missing-id')).toBe(false);

    const empty = await repo.filterExistingItemIds([]);
    expect(empty.size).toBe(0);
  });

  it('删除条目后不再出现在结果中（已删除卡联动语义）', async () => {
    const repo = makeRepository();
    const created = await repo.createItem(makeCreateInput('将被删除'));
    await repo.deleteItem(created.id);
    const found = await repo.filterExistingItemIds([created.id]);
    expect(found.size).toBe(0);
  });
});
