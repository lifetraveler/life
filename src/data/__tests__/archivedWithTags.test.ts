import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import ItemModel from '../../db/models/ItemModel';
import ItemTagModel from '../../db/models/ItemTagModel';
import ReminderModel from '../../db/models/ReminderModel';
import CategoryModel from '../../db/models/CategoryModel';
import AppSettingsModel from '../../db/models/AppSettingsModel';
import TagModel from '../../db/models/TagModel';
import { schema } from '../../db/schema';
import { WatermelonItemRepository } from '../WatermelonItemRepository';
import type { ItemWithTags } from '../../domain/tag';

/**
 * 切片 12 归档视图查询单测（repository.md v0.12「搜索与归档增强接口」）。
 *
 * 与 viewQueries.test.ts 同款夹具：真实 WatermelonDB + LokiJS 内存适配器，
 * 验证查询语义而非内存过滤。
 */

let dbCounter = 0;

// LokiJS 默认开启 autosave（setInterval 挂住事件循环），测试结束后必须 close
// 释放；_driver 为异步赋值需惰性解析，jest 下还可能挂在 bridge 上，两条路都兜住。
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
    dbName: `test-archived-with-tags-${dbCounter}`,
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
      // 切片 14（§7.22）：seedPresetData 需要 categories/app_settings model，未注册则 db.get 返回 null
      CategoryModel,
      AppSettingsModel,
    ],
  });
  return new WatermelonItemRepository(database);
}

afterAll(() => {
  for (const adapter of createdAdapters) {
    extractLokiHandle(adapter)?.close();
  }
  createdAdapters.length = 0;
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createItems(
  repository: WatermelonItemRepository,
  specs: Array<{ title: string; tags?: string[] }>,
): Promise<Array<{ id: string; title: string }>> {
  const created: Array<{ id: string; title: string }> = [];
  for (const spec of specs) {
    const item = await repository.createItem({
      type: 'task',
      title: spec.title,
    });
    for (const tag of spec.tags ?? []) {
      await repository.addTagToItem(item.id, tag);
    }
    created.push({ id: item.id, title: item.title });
    await sleep(5);
  }
  return created;
}

describe('listArchivedItemsWithTags（v0.12 归档视图查询）', () => {
  it('仅返回 archived；active / done 排除', async () => {
    const repository = makeRepository();
    const created = await createItems(repository, [
      { title: 'will-archive' },
      { title: 'stays-active' },
      { title: 'stays-done' },
    ]);
    await repository.updateItem(created[2].id, { status: 'done' });
    await repository.archiveItem(created[0].id);

    const found = await repository.listArchivedItemsWithTags();
    expect(found.map((item) => item.title)).toEqual(['will-archive']);
    expect(found.every((item) => item.status === 'archived')).toBe(true);
  });

  it('按 updatedAt 降序（后归档的在前：归档刷新 updatedAt）', async () => {
    const repository = makeRepository();
    const created = await createItems(repository, [
      { title: 'first' },
      { title: 'second' },
    ]);
    await repository.archiveItem(created[0].id);
    await sleep(5);
    await repository.archiveItem(created[1].id);

    const found = await repository.listArchivedItemsWithTags();
    expect(found.map((item) => item.title)).toEqual(['second', 'first']);
  });

  it('返回 ItemWithTags：标签名齐全', async () => {
    const repository = makeRepository();
    const created = await createItems(repository, [
      { title: 'tagged', tags: ['工作', '灵感'] },
    ]);
    await repository.archiveItem(created[0].id);

    const found = await repository.listArchivedItemsWithTags();
    expect(found).toHaveLength(1);
    expect(found.map((item) => item.tags.map((tag) => tag.name).sort().join(',')))
      .toEqual(['工作,灵感']);
  });

  it('与 v0.3 listArchivedItems 等价（并存 sanity：同语义不同入口）', async () => {
    const repository = makeRepository();
    const created = await createItems(repository, [
      { title: 'a', tags: ['t1'] },
      { title: 'b' },
    ]);
    await repository.archiveItem(created[0].id);
    await repository.archiveItem(created[1].id);

    const viaNew = await repository.listArchivedItemsWithTags();
    const viaOld = await repository.listArchivedItems();
    expect(viaNew.map((item) => item.title)).toEqual(viaOld.map((item) => item.title));
  });

  it('空库返回 []', async () => {
    const repository = makeRepository();
    expect(await repository.listArchivedItemsWithTags()).toEqual([]);
  });
});
