/**
 * createConfigSnapshot / applyConfigSnapshot 数据层单测（切片 28 阶段 1，
 * AGENTS.md §7.42 D6——配置备份快照的组包与增量覆盖恢复）。
 * 用真实 WatermelonDB + LokiJS 内存适配器跑 WatermelonItemRepository
 * （filterExistingItemIds.test.ts 同款 harness），覆盖：
 * - 组包（默认/定制）、守卫、JSON roundtrip；
 * - 增量覆盖冻结语义（settings 全列覆盖缺列保留、categories 按 id 命中覆盖
 *   未命中保留不建、tags 按 normalizeTagName 归一键命中覆盖/未命中创建/本地独有保留）；
 * - 条目级宽容 skipped 计数披露（repository.md v0.34 口径）；
 * - 原子事务（prepare* 收集 + 单次 adapter.batch；batch 失败整体回滚）。
 */

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
import type { ItemRepository, VisualPatch } from '../ItemRepository';
import {
  isConfigSnapshotWire,
  parseConfigSnapshot,
  serializeConfigSnapshot,
  type ConfigSnapshot,
} from '../../domain/configSnapshot';
import { DEFAULT_APP_SETTINGS } from '../../domain/settings';
import type { CreateItemInput } from '../../domain/item';

let dbCounter = 0;

// LokiJS autosave 定时器会挂住 jest 进程——与 filterExistingItemIds.test.ts 同款清理。
const createdAdapters: LokiJSAdapter[] = [];

type LokiHandle = {
  close: () => void;
  getCollection: (name: string) => { data: unknown[] } | null;
};

function extractLokiHandle(adapter: LokiJSAdapter): LokiHandle | null {
  const viaDriver = (adapter as unknown as { _driver?: { loki?: LokiHandle } })._driver;
  if (viaDriver?.loki) {
    return viaDriver.loki;
  }
  const viaBridge = (
    adapter as unknown as {
      _dispatcher?: { _worker?: { _bridge?: { driver?: { loki?: LokiHandle } } } };
    }
  )._dispatcher;
  return viaBridge?._worker?._bridge?.driver?.loki ?? null;
}

function makeRepository(): {
  repo: WatermelonItemRepository;
  adapter: LokiJSAdapter;
} {
  dbCounter += 1;
  const adapter = new LokiJSAdapter({
    dbName: `test-config-snapshot-${dbCounter}`,
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
  return { repo: new WatermelonItemRepository(database), adapter };
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

function cloneSnapshot(snapshot: ConfigSnapshot): ConfigSnapshot {
  return parseConfigSnapshot(serializeConfigSnapshot(snapshot));
}

const PRESET_CATEGORY_IDS = ['work', 'personal', 'study', 'health', 'other'];

describe('createConfigSnapshot（只读组包，§7.42 D6）', () => {
  it('默认库组包：12 字段默认设置 + 5 预置分类 + 空 tags + exportedAt 可解析', async () => {
    const { repo } = makeRepository();
    const snapshot = await repo.createConfigSnapshot();

    expect(isConfigSnapshotWire(snapshot)).toBe(true);
    expect(snapshot.version).toBe(1);
    expect(snapshot.kind).toBe('config');
    expect(Number.isNaN(Date.parse(snapshot.exportedAt))).toBe(false);

    expect(snapshot.appSettings).toEqual(DEFAULT_APP_SETTINGS);
    expect(snapshot.categories).toHaveLength(5);
    expect(snapshot.categories.map((c) => c.id)).toEqual(PRESET_CATEGORY_IDS);
    for (const category of snapshot.categories) {
      expect(category.color === null || typeof category.color === 'string').toBe(true);
      expect(category.emoji === null || typeof category.emoji === 'string').toBe(true);
      expect(typeof category.priority).toBe('number');
    }
    expect(snapshot.tags).toEqual([]);
  });

  it('组包反映本地定制（settings/分类视觉/标签）', async () => {
    const { repo } = makeRepository();
    await repo.updateSettings({ showAiUsage: true, chipsIncrements: [25, 75] });
    await repo.updateCategoryVisuals('work', { color: '#111111', emoji: '🚀' });
    const item = await repo.createItem(makeCreateInput('带标签条目'));
    await repo.addTagToItem(item.id, '灵感');

    const snapshot = await repo.createConfigSnapshot();
    expect(snapshot.appSettings.showAiUsage).toBe(true);
    expect(snapshot.appSettings.chipsIncrements).toEqual([25, 75]);
    const work = snapshot.categories.find((c) => c.id === 'work');
    expect(work?.color).toBe('#111111');
    expect(work?.emoji).toBe('🚀');
    expect(snapshot.tags).toEqual([{ name: '灵感', color: null, emoji: null }]);
  });

  it('序列化 → parseConfigSnapshot roundtrip 相等（含守卫通过）', async () => {
    const { repo } = makeRepository();
    await repo.updateSettings({ showAiUsage: true });
    await repo.updateCategoryVisuals('health', { color: '#00ff00', emoji: null });
    const item = await repo.createItem(makeCreateInput('x'));
    await repo.addTagToItem(item.id, 'tag1');

    const snapshot = await repo.createConfigSnapshot();
    const roundtripped = parseConfigSnapshot(serializeConfigSnapshot(snapshot));
    expect(roundtripped).toEqual(snapshot);
    expect(isConfigSnapshotWire(roundtripped)).toBe(true);
  });
});

describe('applyConfigSnapshot（增量覆盖恢复，repository.md v0.34 冻结语义）', () => {
  it('roundtrip 恢复：快照组包→本地改动→apply→设置与分类视觉还原、本地独有 tag 保留', async () => {
    const { repo } = makeRepository();
    await repo.getSettings(); // 预建 settings 行（getSettings 补行语义）。
    const snapshot = await repo.createConfigSnapshot();
    const presetWork = snapshot.categories.find((c) => c.id === 'work');

    // 本地漂移：设置改 3 项、work 分类视觉改掉、加一个快照里没有的 tag。
    await repo.updateSettings({ showAiUsage: true, carefulMode: true, chipsIncrements: [15, 30] });
    await repo.updateCategoryVisuals('work', { color: '#111111', emoji: '🚀' });
    const item = await repo.createItem(makeCreateInput('a'));
    await repo.addTagToItem(item.id, '本地独有');

    const result = await repo.applyConfigSnapshot(snapshot);
    expect(result).toEqual({ applied: 6, skipped: 0 }); // settings 1 + categories 5。

    const settings = await repo.getSettings();
    expect(settings).toEqual(DEFAULT_APP_SETTINGS);
    const categories = await repo.getCategories();
    expect(categories.find((c) => c.id === 'work')?.color).toBe(presetWork?.color);
    expect(categories.find((c) => c.id === 'work')?.emoji).toBe(presetWork?.emoji);
    // 本地独有 tag 保留（快照 tags 为空）。
    const tags = await repo.listTags();
    expect(tags.map((t) => t.name)).toEqual(['本地独有']);
  });

  it('tags：归一键命中覆盖（abc → ABC）+ 未命中创建 + 同快照重复名后者覆盖', async () => {
    const { repo } = makeRepository();
    await repo.getSettings();
    const item = await repo.createItem(makeCreateInput('x'));
    await repo.addTagToItem(item.id, 'ABC');
    // 快照先于视觉改动组包——本地漂移（updateTagVisuals）留到快照之后。
    const snapshot = await repo.createConfigSnapshot();
    expect(snapshot.tags).toEqual([{ name: 'ABC', color: null, emoji: null }]);
    const tag = (await repo.listTags())[0];
    await repo.updateTagVisuals(tag.id, { color: '#ff0000', emoji: '🔥' });

    // 手工构造恢复包：'abc'（归一键命中本地 ABC）、'新A'（未命中创建）、重复名 dup。
    const restore = cloneSnapshot(snapshot);
    restore.tags = [
      { name: 'abc', color: '#123456', emoji: '✨' },
      { name: '新A', color: '#00ff00', emoji: null },
      { name: 'dup', color: '#111111', emoji: null },
      { name: 'dup', color: '#222222', emoji: null },
    ];
    const result = await repo.applyConfigSnapshot(restore);
    // settings 1 + categories 5（restore 保留快照原 categories，全部命中本地预置）+ tags 4（dup 累计）。
    expect(result).toEqual({ applied: 10, skipped: 0 });

    const tags = await repo.listTags();
    const byName = new Map(tags.map((t) => [t.name, t]));
    expect(tags).toHaveLength(3); // ABC 不重复建（归一键命中）、dup 只建一次。
    expect(byName.get('ABC')?.color).toBe('#123456'); // 归一键命中覆盖。
    expect(byName.get('ABC')?.emoji).toBe('✨');
    expect(byName.get('新A')?.color).toBe('#00ff00');
    expect(byName.get('dup')?.color).toBe('#222222'); // 同快照重复名后者覆盖。
  });

  it('条目级宽容：形状不符跳过计数披露、category 未命中保留不建、不计数', async () => {
    const { repo } = makeRepository();
    await repo.getSettings();
    const before = await repo.getCategories();
    expect(before).toHaveLength(5);

    const snapshot = await repo.createConfigSnapshot();
    const restore = cloneSnapshot(snapshot);
    restore.categories = [
      { id: 'work', name: '工作', color: '#111111', emoji: null, priority: 9 }, // 命中覆盖。
      'garbage' as unknown as ConfigSnapshot['categories'][number], // 形状不符 → skipped。
      { id: 'nope', name: '不会建', color: null, emoji: null, priority: 1 }, // 未命中 → 保留不建、不计数。
      { id: 42, name: '形状不符', color: null, emoji: null, priority: 1 } as unknown as ConfigSnapshot['categories'][number], // 形状不符 → skipped。
    ];
    restore.tags = [
      { name: 'ok1', color: '#111111', emoji: null }, // 创建 → applied。
      'garbage' as unknown as ConfigSnapshot['tags'][number], // 形状不符 → skipped。
      { name: '   ', color: null, emoji: null } as unknown as ConfigSnapshot['tags'][number], // trim 空名 → skipped。
      { name: 'ok2', color: null, emoji: null }, // 创建 → applied。
    ];
    const result = await repo.applyConfigSnapshot(restore);
    expect(result).toEqual({ applied: 4, skipped: 4 }); // settings 1 + work + ok1 + ok2；skipped = 2 cat + 2 tags。

    const categories = await repo.getCategories();
    expect(categories).toHaveLength(5); // nope 未创建。
    expect(categories.find((c) => c.id === 'work')?.color).toBe('#111111');
    expect(categories.find((c) => c.id === 'work')?.priority).toBe(9);
    const tagNames = (await repo.listTags()).map((t) => t.name).sort();
    expect(tagNames).toEqual(['ok1', 'ok2']);
  });

  it('appSettings 部分缺列：缺列保留本地、存在列写穿（applied=1）', async () => {
    const { repo } = makeRepository();
    await repo.getSettings();
    await repo.updateSettings({ carefulMode: true, showAiUsage: true, chipsIncrements: [15, 30] });
    const snapshot = await repo.createConfigSnapshot();
    const restore = cloneSnapshot(snapshot);
    // 隔离 settings 语义：清空 categories/tags 两块（合法空数组），只测 appSettings 增量。
    restore.categories = [];
    restore.tags = [];
    restore.appSettings = { showAiUsage: false } as unknown as ConfigSnapshot['appSettings'];

    const result = await repo.applyConfigSnapshot(restore);
    expect(result).toEqual({ applied: 1, skipped: 0 });

    const settings = await repo.getSettings();
    expect(settings.showAiUsage).toBe(false); // 快照写穿。
    expect(settings.carefulMode).toBe(true); // 缺列保留本地。
    expect(settings.chipsIncrements).toEqual([15, 30]); // 缺列保留本地。
  });

  it('appSettings 坏值：走读层防御归一回退默认（不抛错）', async () => {
    const { repo } = makeRepository();
    await repo.getSettings();
    await repo.updateSettings({ chipsIncrements: [15, 30], carefulMode: true });
    const snapshot = await repo.createConfigSnapshot();
    const restore = cloneSnapshot(snapshot);
    restore.categories = [];
    restore.tags = [];
    restore.appSettings = {
      chipsIncrements: [30, 99999, 'x'],
      carefulMode: 'yes',
      aiRetryMax: 9,
      displayCalendarIds: 'garbage',
    } as unknown as ConfigSnapshot['appSettings'];

    const result = await repo.applyConfigSnapshot(restore);
    expect(result.applied).toBe(1);

    const settings = await repo.getSettings();
    expect(settings.chipsIncrements).toEqual([30]); // 99999/'x' 丢弃。
    expect(settings.carefulMode).toBe(false); // 非布尔回退默认。
    expect(settings.aiRetryMax).toBe(3); // 越界回退默认。
    expect(settings.displayCalendarIds).toEqual([]); // 坏串回退默认。
  });

  it('非 ConfigSnapshot 形状（kind 不符）→ throw 且本地零变化', async () => {
    const { repo } = makeRepository();
    await repo.getSettings();
    await repo.updateSettings({ showAiUsage: true });
    const item = await repo.createItem(makeCreateInput('x'));
    await repo.addTagToItem(item.id, '保留');
    const beforeSettings = await repo.getSettings();
    const beforeCategories = await repo.getCategories();
    const beforeTags = await repo.listTags();

    const snapshot = await repo.createConfigSnapshot();
    const broken = {
      ...cloneSnapshot(snapshot),
      kind: 'data',
    } as unknown as ConfigSnapshot;
    await expect(repo.applyConfigSnapshot(broken)).rejects.toThrow(
      'applyConfigSnapshot: 快照不符合 ConfigSnapshot 结构（version/kind/appSettings/categories/tags）',
    );

    expect(await repo.getSettings()).toEqual(beforeSettings);
    expect(await repo.getCategories()).toEqual(beforeCategories);
    expect(await repo.listTags()).toEqual(beforeTags);
  });
});

describe('applyConfigSnapshot 原子事务（prepare* 收集 + 单次 adapter.batch）', () => {
  it('batch 失败 → 整体回滚（settings/categories/tags 全部保持恢复前状态）', async () => {
    const { repo, adapter } = makeRepository();
    await repo.getSettings(); // 预建行 + 预热 ensureSeeded。
    const snapshot = await repo.createConfigSnapshot();

    // 持久层断言直接读 Loki 原始行：batch 失败后同 Database 读会命中模型缓存
    // （prepareUpdate 已同步改写 model._raw，内存不回滚），且同一 adapter 上
    // 新建 Database 会触发 "not cached" 断言——原始行是唯一可信回滚证据。
    const loki = extractLokiHandle(adapter);
    expect(loki).not.toBeNull();
    const rawSettings = () => JSON.parse(JSON.stringify(loki?.getCollection('app_settings')?.data ?? []));
    const rawCategories = () => JSON.parse(JSON.stringify(loki?.getCollection('categories')?.data ?? []));
    const rawTags = () => JSON.parse(JSON.stringify(loki?.getCollection('tags')?.data ?? []));

    // 恢复前状态：本地漂移。
    await repo.updateSettings({ showAiUsage: true, carefulMode: true });
    await repo.updateCategoryVisuals('work', { color: '#222222', emoji: '💥' });
    const item = await repo.createItem(makeCreateInput('x'));
    await repo.addTagToItem(item.id, '恢复前标签');
    const beforeSettingsRaw = rawSettings();
    const beforeCategoriesRaw = rawCategories();
    const beforeTagsRaw = rawTags();
    expect(beforeSettingsRaw).toHaveLength(1);
    expect(beforeTagsRaw).toHaveLength(1);

    // LokiJSAdapter.batch 为 callback 风格（operations, callback）——注入失败必须
    // 经 callback({error}) 回传；若用 Promise.reject 实现，compat 层不消费返回值
    // → unhandled rejection + toPromise 永不 settle → 测试超时。
    const batchSpy = jest
      .spyOn(adapter, 'batch')
      .mockImplementationOnce(
        (_operations, callback) => callback({ error: new Error('disk failure') }),
      );
    await expect(repo.applyConfigSnapshot(snapshot)).rejects.toThrow('disk failure');
    expect(batchSpy).toHaveBeenCalledTimes(1);

    expect(rawSettings()).toEqual(beforeSettingsRaw);
    expect(rawCategories()).toEqual(beforeCategoriesRaw);
    expect(rawTags()).toEqual(beforeTagsRaw);
  });

  it('多写单批：一次 apply 恰好一次 adapter.batch，操作集 = settings+category+tag', async () => {
    const { repo, adapter } = makeRepository();
    await repo.getSettings();
    const snapshot = await repo.createConfigSnapshot();
    const restore = cloneSnapshot(snapshot);
    restore.categories = [{ id: 'work', name: '工作', color: '#111111', emoji: '🚀', priority: 9 }];
    restore.tags = [{ name: '新A', color: null, emoji: null }];

    const batchSpy = jest.spyOn(adapter, 'batch');
    const result = await repo.applyConfigSnapshot(restore);
    expect(result).toEqual({ applied: 3, skipped: 0 });
    expect(batchSpy).toHaveBeenCalledTimes(1);
    const operations = batchSpy.mock.calls[0][0] as unknown[];
    expect(operations).toHaveLength(3); // settings update + category update + tag create。
  });

  it('settings 缺行：apply 直接建行（prepareCreate 分支），随后 getSettings 读到快照值', async () => {
    const { repo } = makeRepository();
    // 全新库不调 getSettings——settings 行不存在，走 create 分支。
    const snapshot = await repo.createConfigSnapshot();
    // createConfigSnapshot 内部调 getSettings 会补行——换手工快照验证真正缺行路径。
    const manualSnapshot = cloneSnapshot(snapshot);
    manualSnapshot.appSettings = { ...DEFAULT_APP_SETTINGS, showAiUsage: true, carefulMode: true };
    // 隔离 settings 语义：categories/tags 清空（freshRepo 与首个 repo 的预置分类相同会命中计数）。
    manualSnapshot.categories = [];
    manualSnapshot.tags = [];

    const { repo: freshRepo } = makeRepository();
    const result = await freshRepo.applyConfigSnapshot(manualSnapshot);
    expect(result).toEqual({ applied: 1, skipped: 0 }); // settings 1；categories [] / tags []。

    const settings = await freshRepo.getSettings();
    expect(settings.showAiUsage).toBe(true);
    expect(settings.carefulMode).toBe(true);
  });
});

describe('ItemRepository 端口实现绑定（编译面，§7.42 D6）', () => {
  it('WatermelonItemRepository 可作为 ItemRepository 消费（端口成对扩展）', () => {
    const { repo } = makeRepository();
    const port: ItemRepository = repo;
    expect(typeof port.createConfigSnapshot).toBe('function');
    expect(typeof port.applyConfigSnapshot).toBe('function');
  });
});
