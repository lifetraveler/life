/**
 * createSyncSnapshot / applySyncMerge / pruneSyncTombstones / 三删除方法墓碑
 * 副作用 数据层单测（切片 35 阶段 1，AGENTS.md §7.47 + repository.md v0.39 注记节）。
 * 用真实 WatermelonDB + LokiJS 内存适配器跑 WatermelonItemRepository
 * （dataSnapshotRepository.test.ts 同款 harness，补充 SyncTombstoneModel），
 * 覆盖：
 * - 组包（默认空库 / 全量数据 / JSON roundtrip / 墓碑进快照）；
 * - 落库（items/reminders 覆盖写穿、presets 单 default、tags/categories/joins 创建、
 *   appSettings 写穿、删除先行级联、墓碑合入去重、深层校验 localSkipped）；
 * - 原子事务（prepare* 收集 + 单次 adapter.batch；batch 失败整体回滚）；
 * - deleteItem/deleteReminder/deleteChannelPreset 同事务记 sync_tombstones；
 * - pruneSyncTombstones 严格早于裁剪；
 * - 双设备端到端小闭环（组包 → mergeSyncSnapshots → 落库）。
 */

import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import ItemModel from '../../db/models/ItemModel';
import ItemTagModel from '../../db/models/ItemTagModel';
import ReminderModel from '../../db/models/ReminderModel';
import CategoryModel from '../../db/models/CategoryModel';
import AppSettingsModel from '../../db/models/AppSettingsModel';
import TagModel from '../../db/models/TagModel';
import ChannelPresetModel from '../../db/models/ChannelPresetModel';
import SyncTombstoneModel from '../../db/models/SyncTombstoneModel';
import { schema } from '../../db/schema';
import { WatermelonItemRepository } from '../WatermelonItemRepository';
import type { ItemRepository } from '../ItemRepository';
import {
  isSyncSnapshotWire,
  parseSyncSnapshot,
  serializeSyncSnapshot,
  type SyncSnapshot,
  type SyncReminderEntry,
} from '../../domain/syncSnapshot';
import {
  mergeSyncSnapshots,
  type SyncMergeResult,
} from '../../domain/syncMerge';
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
} from '../../domain/settings';
import type {
  DataSnapshotItem,
  DataSnapshotChannelPreset,
} from '../../domain/dataSnapshot';
import type { CreateItemInput } from '../../domain/item';

let dbCounter = 0;

// LokiJS autosave 定时器会挂住 jest 进程——与 dataSnapshotRepository.test.ts 同款清理。
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
    dbName: `test-sync-repository-${dbCounter}`,
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
      ChannelPresetModel,
      SyncTombstoneModel,
    ],
  });
  return { repo: new WatermelonItemRepository(database, () => 'UTC'), adapter };
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

const DEVICE_A = '11111111-2222-4333-8444-555555555555';
const DEVICE_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function makeSyncReminder(
  overrides: Partial<SyncReminderEntry> & { id: string; itemId: string },
): SyncReminderEntry {
  return {
    frequency: 'daily',
    localTimeHour: 8,
    localTimeMinute: 30,
    weekdaysJson: '[]',
    dayOfMonth: 0,
    tzid: 'Asia/Shanghai',
    startAt: 1700000000000,
    enabled: true,
    onceCivilJson: null,
    channelsJson: '["system-notification"]',
    channelConfigsJson: null,
    createdAt: 1699999999000,
    updatedAt: 1699999999000,
    ...overrides,
  };
}

function makeSnapshotItem(overrides: Partial<DataSnapshotItem> & { id: string }): DataSnapshotItem {
  return {
    type: 'note',
    title: '快照条目',
    content: '',
    status: 'active',
    startAt: null,
    endAt: null,
    allDay: false,
    sourceType: 'local',
    sourceUid: null,
    sourceReadOnly: false,
    categoryId: 'other',
    priority: 0,
    createdAt: 1699999999000,
    updatedAt: 1699999999000,
    ...overrides,
  };
}

function makePreset(overrides: Partial<DataSnapshotChannelPreset> & { id: string }): DataSnapshotChannelPreset {
  return {
    name: 'Webhook 预设',
    type: 'webhook',
    configJson: JSON.stringify({
      url: 'https://zulip.example/api/v1/external/zulip',
      mode: 'form',
      payloadTemplate: { type: 'stream', topic: '{{title}}', content: '{{body}}' },
    }),
    isDefault: false,
    ...overrides,
  };
}

function makeEmptyMergeResult(overrides: Partial<SyncMergeResult> = {}): SyncMergeResult {
  return {
    toUpsertItems: [],
    toDeleteItemIds: [],
    toUpsertReminders: [],
    toDeleteReminderIds: [],
    toUpsertPresets: [],
    toDeletePresetIds: [],
    toCreateTags: [],
    toCreateCategories: [],
    rebuiltItemTags: [],
    tombstonesToAdd: [],
    appliedAppSettings: null,
    counts: { applied: 0, skipped: 0, conflictsResolved: 0, tombstonesPropagation: 0 },
    ...overrides,
  };
}

async function fetchTombstones(repo: WatermelonItemRepository): Promise<Array<{ kind: string; entityId: string; deletedAt: number }>> {
  const models = await (repo as unknown as { db: Database }).db
    .get<SyncTombstoneModel>('sync_tombstones')
    .query()
    .fetch();
  return models
    .map((model) => ({ kind: model.kind, entityId: model.entityId, deletedAt: model.deletedAt }))
    .sort((a, b) => (a.kind + a.entityId).localeCompare(b.kind + b.entityId));
}

function makeAppSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_APP_SETTINGS, ...overrides };
}

describe('createSyncSnapshot（只读组包）', () => {
  it('空库组包：块全空 + wire 通过 + deviceId 透传 + exportedAt 可解析', async () => {
    const { repo } = makeRepository();
    const snapshot = await repo.createSyncSnapshot(DEVICE_A);

    expect(isSyncSnapshotWire(snapshot)).toBe(true);
    expect(snapshot.version).toBe(1);
    expect(snapshot.kind).toBe('sync');
    expect(snapshot.deviceId).toBe(DEVICE_A);
    expect(Number.isNaN(Date.parse(snapshot.exportedAt))).toBe(false);
    expect(snapshot.appSettings).toEqual(makeAppSettings());
    expect(snapshot.categories.map((category) => category.id).sort()).toEqual(
      ['health', 'other', 'personal', 'study', 'work'].sort(),
    );
    expect(snapshot.items).toEqual([]);
    expect(snapshot.tags).toEqual([]);
    expect(snapshot.reminders).toEqual([]);
    expect(snapshot.channelPresets).toEqual([]);
    expect(snapshot.itemTags).toEqual([]);
    expect(snapshot.tombstones).toEqual([]);
  });

  it('组包反映本地数据：archived 条目、reminder 两时间戳、preset、tag/join', async () => {
    const { repo } = makeRepository();
    const active = await repo.createItem(makeCreateInput('活跃条目'));
    const archived = await repo.createItem({ ...makeCreateInput('已归档条目'), type: 'task', priority: 2, categoryId: 'work' });
    await repo.archiveItem(archived.id);
    await repo.addTagToItem(active.id, '灵感');
    const reminder = await repo.createReminder({
      itemId: active.id,
      frequency: 'weekly',
      localTimeHour: 8,
      localTimeMinute: 30,
      weekdays: [1, 5],
      tzid: 'Asia/Shanghai',
      startAt: 1700000000000,
      enabled: true,
      channels: ['system-notification', 'webhook'],
      channelConfigs: { webhook: 'https://hook.example' },
    });
    await repo.createChannelPreset({
      name: 'Zulip 主站',
      type: 'webhook',
      configJson: JSON.stringify({ url: 'https://zulip.example', mode: 'form', payloadTemplate: {} }),
      isDefault: true,
    });

    const snapshot = await repo.createSyncSnapshot(DEVICE_A);
    expect(snapshot.items).toHaveLength(2);
    const titles = snapshot.items.map((item) => item.title).sort();
    expect(titles).toEqual(['已归档条目', '活跃条目']);
    expect(snapshot.tags).toHaveLength(1);
    expect(snapshot.itemTags).toEqual([{ itemId: active.id, tagId: snapshot.tags[0]?.id }]);
    expect(snapshot.channelPresets).toHaveLength(1);
    expect(snapshot.channelPresets[0]).toMatchObject({ name: 'Zulip 主站', type: 'webhook', isDefault: true });

    expect(snapshot.reminders).toHaveLength(1);
    const reminderEntry = snapshot.reminders[0];
    expect(reminderEntry).toMatchObject({
      id: reminder.id,
      itemId: active.id,
      frequency: 'weekly',
      weekdaysJson: JSON.stringify([1, 5]),
      channelsJson: JSON.stringify(['system-notification', 'webhook']),
      channelConfigsJson: JSON.stringify({ webhook: 'https://hook.example' }),
    });
    expect(typeof reminderEntry.createdAt).toBe('number');
    expect(typeof reminderEntry.updatedAt).toBe('number');
    expect(reminderEntry.updatedAt).toBeGreaterThan(0);
  });

  it('roundtrip：serialize → parse → wire 通过，内容恒等', async () => {
    const { repo } = makeRepository();
    const item = await repo.createItem(makeCreateInput('往返条目'));
    await repo.addTagToItem(item.id, '往返标签');
    const doomed = await repo.createItem(makeCreateInput('往返删除条目'));
    await repo.deleteItem(doomed.id);

    const snapshot = await repo.createSyncSnapshot(DEVICE_B);
    const roundtripped = parseSyncSnapshot(serializeSyncSnapshot(snapshot));
    expect(isSyncSnapshotWire(roundtripped)).toBe(true);
    expect(roundtripped).toEqual(snapshot);
  });

  it('删除产生的墓碑进快照 tombstones 块', async () => {
    const { repo } = makeRepository();
    const item = await repo.createItem(makeCreateInput('待删条目'));
    await repo.deleteItem(item.id);

    const snapshot = await repo.createSyncSnapshot(DEVICE_A);
    expect(snapshot.tombstones).toHaveLength(1);
    expect(snapshot.tombstones[0]).toMatchObject({ kind: 'item', entityId: item.id });
    expect(snapshot.tombstones[0].deletedAt).toBeGreaterThan(0);
    expect(snapshot.items).toHaveLength(0);
  });
});

describe('applySyncMerge（落库）', () => {
  it('全空 result → 零变更', async () => {
    const { repo } = makeRepository();
    const result = await repo.applySyncMerge(makeEmptyMergeResult());
    expect(result).toEqual({ applied: 0, skipped: 0, conflictsResolved: 0, tombstonesPropagation: 0 });
    const snapshot = await repo.createSyncSnapshot(DEVICE_A);
    expect(snapshot.items).toEqual([]);
    expect(snapshot.tombstones).toEqual([]);
  });

  it('items：未命中创建（id 保真+字段落库）/命中覆盖（LWW 胜出行写穿）', async () => {
    const { repo } = makeRepository();
    const existing = await repo.createItem(makeCreateInput('本地原题'));
    const before = await repo.getItem(existing.id);
    expect(before).not.toBeNull();
    const beforeUpdatedAt = before?.updatedAt ?? 0;

    const result = await repo.applySyncMerge(makeEmptyMergeResult({
      toUpsertItems: [
        makeSnapshotItem({ id: 'new-item', title: '远端新建', categoryId: 'work', priority: 3 }),
        makeSnapshotItem({ id: existing.id, title: '远端覆盖题', updatedAt: beforeUpdatedAt + 5000 }),
      ],
      counts: { applied: 2, skipped: 0, conflictsResolved: 1, tombstonesPropagation: 0 },
    }));

    expect(result.applied).toBe(2);
    expect(result.conflictsResolved).toBe(1);
    const created = await repo.getItemById('new-item');
    expect(created).not.toBeNull();
    expect(created?.title).toBe('远端新建');
    expect(created?.priority).toBe(3);
    expect(created?.categoryId).toBe('work');
    const updated = await repo.getItemById(existing.id);
    expect(updated?.title).toBe('远端覆盖题');
    // prepareUpdate 自动刷新 updated_at（毫秒粒度）；同毫秒内写入允许相等。
    expect(updated?.updatedAt ?? 0).toBeGreaterThanOrEqual(beforeUpdatedAt);
  });

  it('reminders：创建（deprecated channel 兜底）/覆盖（11 列写穿）', async () => {
    const { repo } = makeRepository();
    const item = await repo.createItem(makeCreateInput('宿主条目'));
    const existing = await repo.createReminder({
      itemId: item.id,
      frequency: 'daily',
      localTimeHour: 7,
      localTimeMinute: 0,
      weekdays: [],
      tzid: 'Asia/Shanghai',
      startAt: 1700000000000,
      enabled: true,
      channels: ['system-notification'],
      channelConfigs: {},
    });
    const existingList = await repo.listRemindersByItem(item.id);
    expect(existingList).toHaveLength(1);
    const beforeUpdatedAt = existing.updatedAt;

    await repo.applySyncMerge(makeEmptyMergeResult({
      toUpsertReminders: [
        makeSyncReminder({ id: 'r-new', itemId: item.id, frequency: 'weekly', weekdaysJson: JSON.stringify([1, 5]) }),
        makeSyncReminder({ id: existing.id, itemId: item.id, localTimeHour: 9, localTimeMinute: 45, updatedAt: beforeUpdatedAt + 5000 }),
      ],
      counts: { applied: 2, skipped: 0, conflictsResolved: 1, tombstonesPropagation: 0 },
    }));

    const afterList = await repo.listRemindersByItem(item.id);
    const byId = new Map(afterList.map((reminder) => [reminder.id, reminder]));
    const created = byId.get('r-new');
    expect(created).toBeDefined();
    expect(created?.frequency).toBe('weekly');
    expect(created?.weekdays).toEqual([1, 5]);
    expect(created?.channels).toEqual(['system-notification']);
    expect(created?.channelConfigs).toEqual({});
    const updated = byId.get(existing.id);
    expect(updated?.localTimeHour).toBe(9);
    expect(updated?.localTimeMinute).toBe(45);
  });

  it('presets：创建 + 同 type 单 default 规范化（新 default 生效旧行翻 false）', async () => {
    const { repo } = makeRepository();
    const existingDefault = await repo.createChannelPreset({
      name: '旧默认',
      type: 'webhook',
      configJson: JSON.stringify({ url: 'https://old.example', mode: 'form', payloadTemplate: { type: 'stream', topic: '{{title}}', content: '{{body}}' } }),
      isDefault: true,
    });

    await repo.applySyncMerge(makeEmptyMergeResult({
      toUpsertPresets: [
        makePreset({ id: 'p-new-1', name: '远端普通', isDefault: false }),
        makePreset({ id: 'p-new-2', name: '远端默认', isDefault: true }),
      ],
      counts: { applied: 2, skipped: 0, conflictsResolved: 0, tombstonesPropagation: 0 },
    }));

    const presets = await repo.listChannelPresets();
    const byId = new Map(presets.map((preset) => [preset.id, preset]));
    expect(byId.get(existingDefault.id)?.isDefault).toBe(false);
    expect(byId.get('p-new-1')?.isDefault).toBe(false);
    expect(byId.get('p-new-2')?.isDefault).toBe(true);
    expect(presets.filter((preset) => preset.isDefault && preset.type === 'webhook')).toHaveLength(1);
  });

  it('tags/categories：创建 id 保真；joins 增补落本地行 id', async () => {
    const { repo } = makeRepository();
    const item = await repo.createItem(makeCreateInput('条目'));

    await repo.applySyncMerge(makeEmptyMergeResult({
      toCreateCategories: [{ id: 'custom-cat', name: '自定义分类', color: '#123456', emoji: '🧩', priority: 20 }],
      toCreateTags: [{ id: 't-remote', name: '远端标签', color: '#aabbcc', emoji: '🏷' }],
      rebuiltItemTags: [{ itemId: item.id, tagId: 't-remote' }],
      counts: { applied: 3, skipped: 0, conflictsResolved: 0, tombstonesPropagation: 0 },
    }));

    const itemWithRelations = await repo.getItemById(item.id);
    expect(itemWithRelations).not.toBeNull();
    expect(itemWithRelations?.tags).toHaveLength(1);
    expect(itemWithRelations?.tags[0]).toMatchObject({ id: 't-remote', name: '远端标签', color: '#aabbcc' });
    const snapshot = await repo.createSyncSnapshot(DEVICE_A);
    expect(snapshot.categories.map((category) => category.id)).toContain('custom-cat');
  });

  it('appSettings：appliedAppSettings 非 null → 写穿（applied+1）', async () => {
    const { repo } = makeRepository();
    const result = await repo.applySyncMerge(makeEmptyMergeResult({
      appliedAppSettings: makeAppSettings({ tagDisplayMode: 'emoji', carefulMode: true, chipsIncrements: [15, 45] }),
      counts: { applied: 1, skipped: 0, conflictsResolved: 0, tombstonesPropagation: 0 },
    }));
    expect(result.applied).toBe(1);
    const settings = await repo.getSettings();
    expect(settings.tagDisplayMode).toBe('emoji');
    expect(settings.carefulMode).toBe(true);
    expect(settings.chipsIncrements).toEqual([15, 45]);
  });

  it('删除先行：toDeleteItemIds 级联 reminders+joins；缺行静默', async () => {
    const { repo } = makeRepository();
    const doomed = await repo.createItem(makeCreateInput('将被墓碑删'));
    const survivor = await repo.createItem(makeCreateInput('幸存条目'));
    await repo.addTagToItem(doomed.id, '共享标签');
    await repo.createReminder({
      itemId: doomed.id,
      frequency: 'daily',
      localTimeHour: 8,
      localTimeMinute: 30,
      weekdays: [],
      tzid: 'Asia/Shanghai',
      startAt: 1700000000000,
      enabled: true,
      channels: ['system-notification'],
      channelConfigs: {},
    });

    await repo.applySyncMerge(makeEmptyMergeResult({
      toDeleteItemIds: [doomed.id, 'ghost-item'],
      counts: { applied: 0, skipped: 0, conflictsResolved: 0, tombstonesPropagation: 1 },
    }));

    await expect(repo.getItem(doomed.id)).resolves.toBeNull();
    const snapshot = await repo.createSyncSnapshot(DEVICE_A);
    expect(snapshot.items.map((entry) => entry.id)).toEqual([survivor.id]);
    expect(snapshot.reminders).toEqual([]);
    expect(snapshot.itemTags).toEqual([]);
    expect(snapshot.tags.map((tag) => tag.name)).toEqual(['共享标签']);
  });

  it('墓碑合入：tombstonesToAdd 落库保真；已存在键不重复合入', async () => {
    const { repo } = makeRepository();
    const item = await repo.createItem(makeCreateInput('条目'));
    await repo.deleteItem(item.id);

    const result = await repo.applySyncMerge(makeEmptyMergeResult({
      toUpsertItems: [makeSnapshotItem({ id: 'fresh-item' })],
      tombstonesToAdd: [
        { kind: 'item', entityId: item.id, deletedAt: 1700000000000 },
        { kind: 'item', entityId: 'fresh-item', deletedAt: 1700000001000 },
        { kind: 'reminder', entityId: 'r-ghost', deletedAt: 1700000002000 },
      ],
      counts: { applied: 1, skipped: 0, conflictsResolved: 0, tombstonesPropagation: 0 },
    }));

    expect(result.applied).toBe(1);
    const tombstones = await fetchTombstones(repo);
    const byEntityId = new Map(tombstones.map((tombstone) => [tombstone.entityId, tombstone]));
    expect(tombstones).toHaveLength(3);
    expect(byEntityId.get('fresh-item')).toMatchObject({ kind: 'item', deletedAt: 1700000001000 });
    expect(byEntityId.get('r-ghost')).toMatchObject({ kind: 'reminder', deletedAt: 1700000002000 });
    // 本地已有墓碑：deleted_at 保留本地值（不更新，更保守），且不重复合入。
    const localTombstone = byEntityId.get(item.id);
    expect(localTombstone).toBeDefined();
    expect(localTombstone?.kind).toBe('item');
    expect(localTombstone?.deletedAt).toBeGreaterThan(0);
    expect(localTombstone?.deletedAt).not.toBe(1700000000000);
  });

  it('深层校验失败 → localSkipped 合入 skipped 计数', async () => {
    const { repo } = makeRepository();
    const item = await repo.createItem(makeCreateInput('宿主'));
    const result = await repo.applySyncMerge(makeEmptyMergeResult({
      toUpsertReminders: [
        makeSyncReminder({ id: 'r-bad', itemId: item.id, weekdaysJson: 'not-json' }),
        makeSyncReminder({ id: 'r-good', itemId: item.id }),
      ],
      counts: { applied: 0, skipped: 0, conflictsResolved: 0, tombstonesPropagation: 0 },
    }));
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(1);
    const snapshot = await repo.createSyncSnapshot(DEVICE_A);
    expect(snapshot.reminders.map((entry) => entry.id)).toEqual(['r-good']);
  });

  it('batch 失败 → 整体回滚（loki 原始行保持合流前状态）', async () => {
    const { repo, adapter } = makeRepository();
    const item = await repo.createItem(makeCreateInput('原题'));
    await repo.addTagToItem(item.id, '恢复前标签');
    const loki = extractLokiHandle(adapter);
    expect(loki).not.toBeNull();
    const rawTable = (name: string) => JSON.parse(JSON.stringify(loki?.getCollection(name)?.data ?? []));
    const before: Record<string, unknown[]> = {
      items: rawTable('items'),
      tags: rawTable('tags'),
      item_tags: rawTable('item_tags'),
      reminders: rawTable('reminders'),
      sync_tombstones: rawTable('sync_tombstones'),
    };

    const result = makeEmptyMergeResult({
      toUpsertItems: [
        makeSnapshotItem({ id: item.id, title: '漂移题', categoryId: 'work' }),
        makeSnapshotItem({ id: 'new-item', title: '新建' }),
      ],
      toCreateTags: [{ id: 't-new', name: '新标签', color: null, emoji: null }],
      rebuiltItemTags: [{ itemId: item.id, tagId: 't-new' }],
      toUpsertReminders: [makeSyncReminder({ id: 'r-new', itemId: item.id })],
      tombstonesToAdd: [{ kind: 'item', entityId: 'ghost', deletedAt: 1700000000000 }],
      counts: { applied: 5, skipped: 0, conflictsResolved: 1, tombstonesPropagation: 0 },
    });

    // LokiJSAdapter.batch 为 callback 风格——注入失败必须经 callback({error}) 回传。
    const batchSpy = jest
      .spyOn(adapter, 'batch')
      .mockImplementationOnce(
        (_operations, callback) => callback({ error: new Error('disk failure') }),
      );
    await expect(repo.applySyncMerge(result)).rejects.toThrow('disk failure');
    expect(batchSpy).toHaveBeenCalledTimes(1);

    for (const [table, rows] of Object.entries(before)) {
      expect(rawTable(table)).toEqual(rows);
    }
  });

  it('多写单批：一次 apply 恰好一次 adapter.batch', async () => {
    const { repo, adapter } = makeRepository();
    const item = await repo.createItem(makeCreateInput('x'));
    await repo.addTagToItem(item.id, 'A');

    const batchSpy = jest.spyOn(adapter, 'batch');
    const result = await repo.applySyncMerge(makeEmptyMergeResult({
      toUpsertItems: [makeSnapshotItem({ id: item.id, title: '覆盖', categoryId: 'work', updatedAt: 1699999999001 })],
      toUpsertReminders: [makeSyncReminder({ id: 'r-new', itemId: item.id })],
      toUpsertPresets: [makePreset({ id: 'p-new', name: '预设' })],
      toCreateTags: [{ id: 't-new', name: '新A', color: null, emoji: null }],
      rebuiltItemTags: [{ itemId: item.id, tagId: 't-new' }],
      tombstonesToAdd: [{ kind: 'item', entityId: 'ghost', deletedAt: 1700000000000 }],
      counts: { applied: 5, skipped: 0, conflictsResolved: 1, tombstonesPropagation: 0 },
    }));

    expect(result.applied).toBe(5);
    expect(batchSpy).toHaveBeenCalledTimes(1);
    const operations = batchSpy.mock.calls[0][0] as unknown[];
    // item 覆盖 + reminder 创建 + preset 创建 + tag 创建 + 新 join + 墓碑 = 6。
    expect(operations).toHaveLength(6);
  });

  it('端口绑定：ItemRepository 消费面三方法（编译面）', () => {
    const { repo } = makeRepository();
    const port: ItemRepository = repo;
    expect(typeof port.createSyncSnapshot).toBe('function');
    expect(typeof port.applySyncMerge).toBe('function');
    expect(typeof port.pruneSyncTombstones).toBe('function');
  });
});

describe('三删除方法墓碑副作用（同事务）', () => {
  it('deleteItem → item 墓碑；级联 reminders/joins 不记墓碑', async () => {
    const { repo } = makeRepository();
    const item = await repo.createItem(makeCreateInput('待删条目'));
    await repo.addTagToItem(item.id, '标签');
    await repo.createReminder({
      itemId: item.id,
      frequency: 'daily',
      localTimeHour: 8,
      localTimeMinute: 30,
      weekdays: [],
      tzid: 'Asia/Shanghai',
      startAt: 1700000000000,
      enabled: true,
      channels: ['system-notification'],
      channelConfigs: {},
    });
    const reminder = await repo.listRemindersByItem(item.id);
    expect(reminder).toHaveLength(1);

    await repo.deleteItem(item.id);
    const tombstones = await fetchTombstones(repo);
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]).toMatchObject({ kind: 'item', entityId: item.id });
    expect(tombstones[0].deletedAt).toBeGreaterThan(0);
  });

  it('deleteReminder → reminder 墓碑', async () => {
    const { repo } = makeRepository();
    const item = await repo.createItem(makeCreateInput('宿主'));
    const reminder = await repo.createReminder({
      itemId: item.id,
      frequency: 'daily',
      localTimeHour: 8,
      localTimeMinute: 30,
      weekdays: [],
      tzid: 'Asia/Shanghai',
      startAt: 1700000000000,
      enabled: true,
      channels: ['system-notification'],
      channelConfigs: {},
    });

    await repo.deleteReminder(reminder.id);
    const tombstones = await fetchTombstones(repo);
    expect(tombstones).toEqual([expect.objectContaining({ kind: 'reminder', entityId: reminder.id })]);
    expect(await repo.listRemindersByItem(item.id)).toHaveLength(0);
  });

  it('deleteChannelPreset → channel_preset 墓碑', async () => {
    const { repo } = makeRepository();
    const preset = await repo.createChannelPreset({
      name: '待删预设',
      type: 'webhook',
      configJson: JSON.stringify({ url: 'https://hook.example', mode: 'form', payloadTemplate: { type: 'stream', topic: '{{title}}', content: '{{body}}' } }),
      isDefault: false,
    });

    await repo.deleteChannelPreset(preset.id);
    const tombstones = await fetchTombstones(repo);
    expect(tombstones).toEqual([expect.objectContaining({ kind: 'channel_preset', entityId: preset.id })]);
    expect(await repo.listChannelPresets()).toHaveLength(0);
  });

  it('墓碑幂等：同实体重复删除路径不重复记墓碑（合流合入同键）', async () => {
    const { repo } = makeRepository();
    const item = await repo.createItem(makeCreateInput('条目'));
    await repo.deleteItem(item.id);
    const before = await fetchTombstones(repo);

    // 远端墓碑（同键）合入 → 不重复。
    await repo.applySyncMerge(makeEmptyMergeResult({
      tombstonesToAdd: [{ kind: 'item', entityId: item.id, deletedAt: before[0]?.deletedAt ?? 0 }],
    }));
    const after = await fetchTombstones(repo);
    expect(after).toHaveLength(before.length);
  });
});

describe('pruneSyncTombstones（严格早于裁剪）', () => {
  it('deleted_at < min 被裁、>= min 保留、返回删除数、无命中 0', async () => {
    const { repo } = makeRepository();
    await repo.applySyncMerge(makeEmptyMergeResult({
      tombstonesToAdd: [
        { kind: 'item', entityId: 'old-1', deletedAt: 1000 },
        { kind: 'item', entityId: 'old-2', deletedAt: 1999 },
        { kind: 'reminder', entityId: 'keep-1', deletedAt: 2000 },
        { kind: 'channel_preset', entityId: 'keep-2', deletedAt: 3000 },
      ],
    }));

    const pruned = await repo.pruneSyncTombstones(2000);
    expect(pruned).toBe(2);
    const remaining = await fetchTombstones(repo);
    expect(remaining.map((tombstone) => tombstone.entityId).sort()).toEqual(['keep-1', 'keep-2']);

    expect(await repo.pruneSyncTombstones(1)).toBe(0);
    expect(await fetchTombstones(repo)).toHaveLength(2);
  });
});

describe('双设备端到端小闭环（组包 → 合流 → 落库）', () => {
  it('B 的数据经 mergeSyncSnapshots 进入 A（items/tags/join/墓碑全链）', async () => {
    const { repo: repoA } = makeRepository();
    const second = makeRepository();
    const repoB = second.repo;

    const itemB = await repoB.createItem({ ...makeCreateInput('B 新建条目'), categoryId: 'work', priority: 2 });
    await repoB.addTagToItem(itemB.id, 'B标签');
    await repoB.createReminder({
      itemId: itemB.id,
      frequency: 'daily',
      localTimeHour: 6,
      localTimeMinute: 30,
      weekdays: [],
      tzid: 'Asia/Shanghai',
      startAt: 1700000000000,
      enabled: true,
      channels: ['system-notification'],
      channelConfigs: {},
    });
    const doomedB = await repoB.createItem(makeCreateInput('B 删除条目'));
    await repoB.deleteItem(doomedB.id);

    const localA = await repoA.createSyncSnapshot(DEVICE_A);
    const remoteB = await repoB.createSyncSnapshot(DEVICE_B);
    const merge = mergeSyncSnapshots(localA, [remoteB], [], { settingsBaselineExportedAt: null });
    const result = await repoA.applySyncMerge(merge);

    expect(result.applied).toBeGreaterThan(0);
    expect(result.tombstonesPropagation).toBe(0); // B 删除的条目 A 本来就没有。
    const itemsA = await repoA.listItemsWithTags();
    expect(itemsA.map((item) => item.title)).toContain('B 新建条目');
    const snapshotA = await repoA.createSyncSnapshot(DEVICE_A);
    expect(snapshotA.tags.map((tag) => tag.name)).toContain('B标签');
    expect(snapshotA.tombstones.map((tombstone) => tombstone.entityId)).toContain(doomedB.id);
    const joined = itemsA.find((item) => item.title === 'B 新建条目');
    expect(joined?.tags.map((tag) => tag.name)).toContain('B标签');
    expect(snapshotA.reminders).toHaveLength(1);
  });
});
