import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import CategoryModel from '../../db/models/CategoryModel';
import AppSettingsModel from '../../db/models/AppSettingsModel';
import ItemModel from '../../db/models/ItemModel';
import ItemTagModel from '../../db/models/ItemTagModel';
import ReminderModel from '../../db/models/ReminderModel';
import TagModel from '../../db/models/TagModel';
import { schema } from '../../db/schema';
import { APP_SETTINGS_ROW_ID, type TagDisplayMode } from '../../domain/settings';
import { WatermelonItemRepository } from '../WatermelonItemRepository';

/**
 * 切片 14 阶段 1（schema v6 分类/设置底座）data 层单测：
 * - 全局设置兜底（getSettings/updateSettings，repository.md v0.14）；
 * - 关系水合（ItemWithRelations.category/tags，AGENTS.md §7.23）与悬挂 category_id 容错；
 * - createItem/updateItem 的分类与优先级校验（§7.22）；
 * - updateCategoryVisuals/updateTagVisuals 视觉更新；
 * - createImportedItem 落默认分类（category='other'，priority=0）。
 * 真实 WatermelonDB + LokiJS 内存适配器（同 viewQueries/importExport 基准）；
 * 时区经构造函数注入固定为 Asia/Shanghai，不依赖测试机设置。
 */

let dbCounter = 0;

// created_at 是毫秒时间戳：需要「绑定顺序/创建顺序」确定性的写入之间隔 5ms，
// 避免同毫秒时间戳导致排序不稳定（同 viewQueries.test.ts 的做法）。
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
    dbName: `test-category-settings-${dbCounter}`,
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
    ],
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

describe('全局设置兜底（getSettings/updateSettings）', () => {
  it('空库 getSettings() 兜底返回 text 并静默落唯一 global 行；两次调用幂等不重复插行', async () => {
    const { db, repository } = makeContext();
    // 未经 seedPresetData 的空库：首次 getSettings 经 ensureSeeded 兜底
    expect(await repository.getSettings()).toEqual({ tagDisplayMode: 'text' });
    const rows = await db.get<AppSettingsModel>('app_settings').query().fetch();
    expect(rows.length).toBe(1);
    expect(rows[0]?._raw.id).toBe(APP_SETTINGS_ROW_ID);
    expect(rows[0]?.tagDisplayMode).toBe('text');

    // 第二次调用：幂等，不新增行
    expect(await repository.getSettings()).toEqual({ tagDisplayMode: 'text' });
    const rowsAgain = await db.get<AppSettingsModel>('app_settings').query().fetch();
    expect(rowsAgain.length).toBe(1);
  });

  it('updateSettings 合法值生效并可回读', async () => {
    const { repository } = makeContext();
    await repository.updateSettings({ tagDisplayMode: 'emoji' });
    expect(await repository.getSettings()).toEqual({ tagDisplayMode: 'emoji' });
  });

  it('updateSettings 非法值抛 updateSettings: invalid tagDisplayMode', async () => {
    const { repository } = makeContext();
    await expect(
      repository.updateSettings({ tagDisplayMode: 'bogus' as unknown as TagDisplayMode }),
    ).rejects.toThrow('updateSettings: invalid tagDisplayMode');
  });
});

describe('关系水合（ItemWithRelations，§7.23）', () => {
  it('createItem 带 categoryId + 两个标签：各查询均水合完整 category 与 tags', async () => {
    const { repository } = makeContext();
    const item = await repository.createItem({
      type: 'note',
      title: 'A',
      categoryId: 'work',
    });
    await repository.addTagToItem(item.id, '标签一');
    // tags 数组按 item_tags.created_at 升序（绑定顺序）：两次绑定需落在不同毫秒。
    await sleep(5);
    await repository.addTagToItem(item.id, '标签二');

    // getItemById：category 完整对象（id/name/color/emoji/priority）+ tags 数组
    const fetched = await repository.getItemById(item.id);
    expect(fetched?.category).toEqual({
      id: 'work',
      name: '工作',
      color: '#E57373',
      emoji: '💼',
      priority: 1,
    });
    expect(
      fetched?.tags.map((tag) => ({
        name: tag.name,
        color: tag.color,
        emoji: tag.emoji,
      })),
    ).toEqual([
      { name: '标签一', color: null, emoji: null },
      { name: '标签二', color: null, emoji: null },
    ]);

    // listItems / listItemsWithTags：同样水合
    const listed = await repository.listItems();
    expect(listed.length).toBe(1);
    expect(listed[0]?.category?.id).toBe('work');
    expect(listed[0]?.tags.length).toBe(2);
    const withTags = await repository.listItemsWithTags();
    expect(withTags[0]?.category?.id).toBe('work');
    expect(withTags[0]?.tags.map((tag) => tag.name)).toEqual(['标签一', '标签二']);

    // searchItems：水合不丢
    const searched = await repository.searchItems('A');
    expect(searched.length).toBe(1);
    expect(searched[0]?.category?.id).toBe('work');
    expect(searched[0]?.tags.length).toBe(2);

    // listScheduledItemsInRange：带 startAt 的任务在范围内，水合 category
    await repository.createItem({
      type: 'task',
      title: 'B',
      categoryId: 'work',
      startAt: 1000,
      endAt: 2000,
    });
    const scheduled = await repository.listScheduledItemsInRange(0, 5000);
    expect(scheduled.map((scheduledItem) => scheduledItem.title)).toEqual(['B']);
    expect(scheduled[0]?.category?.id).toBe('work');
    expect(scheduled[0]?.tags).toEqual([]);
  });

  it('createItem 未传 categoryId → 落默认分类 other，priority 默认 0', async () => {
    const { repository } = makeContext();
    // createItem 冻结签名返回 Item（非水合），默认分类经 getItemById 水合验证
    const item = await repository.createItem({ type: 'note', title: '默认分类' });
    const fetched = await repository.getItemById(item.id);
    expect(fetched?.category?.id).toBe('other');
    expect(fetched?.priority).toBe(0);
  });

  it('悬挂 category_id（绕过 repository 直插 ghost 行）：查询返回 category null 且不抛错', async () => {
    const { db, repository } = makeContext();
    await db.write(async () => {
      await db.get<ItemModel>('items').create((record) => {
        record.type = 'note';
        record.title = '悬挂分类';
        record.content = '';
        record.status = 'active';
        record.categoryId = 'ghost';
        record.priority = 0;
      });
    });
    const created = (await db.get<ItemModel>('items').query().fetch())[0];
    const fetched = await repository.getItemById(created.id);
    expect(fetched?.category).toBeNull();
    expect(fetched?.tags).toEqual([]);
    const listed = await repository.listItems();
    expect(listed[0]?.category).toBeNull();
    const searched = await repository.searchItems('悬挂');
    expect(searched[0]?.category).toBeNull();
  });
});

describe('createItem/updateItem 分类与优先级校验', () => {
  it('createItem 分类不存在抛 createItem: category not found: nope', async () => {
    const { repository } = makeContext();
    await expect(
      repository.createItem({ type: 'note', title: 'X', categoryId: 'nope' }),
    ).rejects.toThrow('createItem: category not found: nope');
  });

  it('createItem priority 越界抛 createItem: priority must be an integer in [0, 3]', async () => {
    const { repository } = makeContext();
    await expect(
      repository.createItem({ type: 'note', title: 'X', priority: 4 }),
    ).rejects.toThrow('createItem: priority must be an integer in [0, 3]');
    await expect(
      repository.createItem({ type: 'note', title: 'X', priority: -1 }),
    ).rejects.toThrow('createItem: priority must be an integer in [0, 3]');
  });

  it('updateItem 分类不存在/优先级越界抛对应错误', async () => {
    const { repository } = makeContext();
    const item = await repository.createItem({ type: 'note', title: 'X' });
    await expect(
      repository.updateItem(item.id, { categoryId: 'nope' }),
    ).rejects.toThrow('updateItem: category not found: nope');
    await expect(
      repository.updateItem(item.id, { priority: 4 }),
    ).rejects.toThrow('updateItem: priority must be an integer in [0, 3]');
  });
});

describe('视觉更新（updateCategoryVisuals/updateTagVisuals）', () => {
  it('updateCategoryVisuals 改 color 不动 emoji；未知 id 抛错', async () => {
    const { repository } = makeContext();
    // updateCategoryVisuals 本身不触发 ensureSeeded（与实现一致）：真实使用中预置分类
    // 由任一带 ensureSeeded 的读/写入口先行落库，这里先 getCategories() 复现该顺序。
    await repository.getCategories();
    const updated = await repository.updateCategoryVisuals('work', { color: '#123456' });
    expect(updated).toEqual({
      id: 'work',
      name: '工作',
      color: '#123456',
      emoji: '💼',
      priority: 1,
    });
    const categories = await repository.getCategories();
    const work = categories.find((category) => category.id === 'work');
    expect(work?.color).toBe('#123456');
    expect(work?.emoji).toBe('💼');
    await expect(repository.updateCategoryVisuals('nope', {})).rejects.toThrow(
      'updateCategoryVisuals: category not found: nope',
    );
  });

  it('updateTagVisuals 对存在 tag 修改 color/emoji 生效；未知 id 抛错', async () => {
    const { repository } = makeContext();
    const item = await repository.createItem({ type: 'note', title: 'X' });
    const tag = await repository.addTagToItem(item.id, '标签A');
    const updated = await repository.updateTagVisuals(tag.id, {
      color: '#ABCDEF',
      emoji: '🔥',
    });
    expect(updated.color).toBe('#ABCDEF');
    expect(updated.emoji).toBe('🔥');
    expect(updated.name).toBe('标签A');
    expect(typeof updated.createdAt).toBe('number');
    // 回读验证：listItemsWithTags 水合出的 tag 视觉字段已更新
    const listed = await repository.listItemsWithTags();
    expect(listed[0]?.tags[0]?.color).toBe('#ABCDEF');
    expect(listed[0]?.tags[0]?.emoji).toBe('🔥');
    await expect(repository.updateTagVisuals('nope', {})).rejects.toThrow(
      'updateTagVisuals: tag not found: nope',
    );
  });
});

describe('导入落默认分类（createImportedItem）', () => {
  it('createImportedItem 后 category 为 other 且 priority 为 0', async () => {
    const { repository } = makeContext();
    const startAt = Date.UTC(2026, 0, 1, 8, 0, 0);
    const imported = await repository.createImportedItem({
      title: '导入事件',
      startAt,
      endAt: startAt + 1000,
      sourceUid: 'u1',
    });
    const fetched = await repository.getItemById(imported.id);
    expect(fetched?.category?.id).toBe('other');
    expect(fetched?.priority).toBe(0);
  });
});
