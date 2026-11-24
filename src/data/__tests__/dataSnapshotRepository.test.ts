/**
 * createDataSnapshot / applyDataSnapshot 数据层单测（切片 31 阶段 1，
 * AGENTS.md §7.43 D2/D3——数据备份快照的组包与增量覆盖恢复）。
 * 用真实 WatermelonDB + LokiJS 内存适配器跑 WatermelonItemRepository
 * （configSnapshotRepository.test.ts 同款 harness，补充 ChannelPresetModel），
 * 覆盖：
 * - 组包（默认空库 / 全量数据 / JSON roundtrip）；
 * - 增量覆盖冻结语义（items id 命中覆盖+未命中创建+本地独有保留、tags 归一命中
 *   first-wins、reminders v10 列写穿+deprecated 兜底、channelPresets 单 default
 *   规范化、itemTags 删除重建）；
 * - 条目级宽容 skipped 计数（形状不符/悬挂引用/深层校验失败/重复 id）；
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
import ChannelPresetModel from '../../db/models/ChannelPresetModel';
import SparkModel from '../../db/models/SparkModel';
import SparkAttachmentModel from '../../db/models/SparkAttachmentModel';
import SparkItemModel from '../../db/models/SparkItemModel';
import ChatMessageModel from '../../db/models/ChatMessageModel';
import { schema } from '../../db/schema';
import { WatermelonItemRepository } from '../WatermelonItemRepository';
import type { ItemRepository } from '../ItemRepository';
import {
  isDataSnapshotWire,
  parseDataSnapshot,
  serializeDataSnapshot,
  type DataSnapshot,
  type DataSnapshotItem,
  type DataSnapshotReminder,
} from '../../domain/dataSnapshot';
import type { CreateItemInput } from '../../domain/item';

let dbCounter = 0;

// LokiJS autosave 定时器会挂住 jest 进程——与 configSnapshotRepository.test.ts 同款清理。
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
    dbName: `test-data-snapshot-${dbCounter}`,
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
      SparkModel,
      SparkAttachmentModel,
      SparkItemModel,
      ChatMessageModel,
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

function cloneSnapshot(snapshot: DataSnapshot): DataSnapshot {
  return parseDataSnapshot(serializeDataSnapshot(snapshot));
}

/** 手工快照条目基线（合法形状，测试按需覆盖字段）。 */
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

function makeSnapshotReminder(
  overrides: Partial<DataSnapshotReminder> & { id: string; itemId: string },
): DataSnapshotReminder {
  return {
    frequency: 'daily',
    localTimeHour: 8,
    localTimeMinute: 30,
    weekdaysJson: '',
    dayOfMonth: 0,
    tzid: 'Asia/Shanghai',
    startAt: 1700000000000,
    enabled: true,
    onceCivilJson: null,
    channelsJson: '["system-notification"]',
    channelConfigsJson: null,
    ...overrides,
  };
}

const WEBHOOK_CONFIG = JSON.stringify({
  url: 'https://zulip.example/api/v1/external/zulip',
  mode: 'form',
  payloadTemplate: { type: 'stream', topic: '{{title}}', content: '{{body}}' },
});
const APPRISE_CONFIG = JSON.stringify({ baseUrl: 'https://apprise.example', key: 'k1' });

function makeEmptySnapshot(overrides: Partial<DataSnapshot> = {}): DataSnapshot {
  return {
    version: 1,
    kind: 'data',
    exportedAt: '2026-11-18T09:30:00.000+08:00',
    items: [],
    tags: [],
    reminders: [],
    channelPresets: [],
    itemTags: [],
    ...overrides,
  };
}

describe('createDataSnapshot（只读组包，§7.43 D2）', () => {
  it('默认空库组包：六块全空 + wire 通过 + exportedAt 可解析', async () => {
    const { repo } = makeRepository();
    const snapshot = await repo.createDataSnapshot();

    expect(isDataSnapshotWire(snapshot)).toBe(true);
    expect(snapshot.version).toBe(1);
    expect(snapshot.kind).toBe('data');
    expect(Number.isNaN(Date.parse(snapshot.exportedAt))).toBe(false);
    expect(snapshot.items).toEqual([]);
    expect(snapshot.tags).toEqual([]);
    expect(snapshot.reminders).toEqual([]);
    expect(snapshot.channelPresets).toEqual([]);
    expect(snapshot.itemTags).toEqual([]);
  });

  it('组包反映本地数据：含 archived 条目、reminder v10 列串、preset、join', async () => {
    const { repo } = makeRepository();
    const active = await repo.createItem(makeCreateInput('活跃条目'));
    const archived = await repo.createItem({
      ...makeCreateInput('已归档条目'),
      type: 'task',
      priority: 2,
      categoryId: 'work',
    });
    await repo.archiveItem(archived.id);
    const tag = await repo.addTagToItem(active.id, '灵感');
    await repo.updateTagVisuals(tag.id, { color: '#00ff00', emoji: '💡' });
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
    const preset = await repo.createChannelPreset({
      name: 'Zulip 主站',
      type: 'webhook',
      configJson: WEBHOOK_CONFIG,
      isDefault: true,
    });

    const snapshot = await repo.createDataSnapshot();
    expect(snapshot.items).toHaveLength(2);
    const byTitle = new Map(snapshot.items.map((item) => [item.title, item]));
    const activeEntry = byTitle.get('活跃条目');
    const archivedEntry = byTitle.get('已归档条目');
    expect(activeEntry).toMatchObject({
      id: active.id,
      status: 'active',
      categoryId: 'other',
      priority: 0,
      createdAt: active.createdAt,
      updatedAt: active.updatedAt,
    });
    expect(archivedEntry).toMatchObject({
      id: archived.id,
      type: 'task',
      status: 'archived',
      categoryId: 'work',
      priority: 2,
    });
    expect(snapshot.tags).toEqual([
      { id: tag.id, name: '灵感', color: '#00ff00', emoji: '💡' },
    ]);
    expect(snapshot.reminders).toEqual([
      {
        id: reminder.id,
        itemId: active.id,
        frequency: 'weekly',
        localTimeHour: 8,
        localTimeMinute: 30,
        weekdaysJson: '[1,5]',
        dayOfMonth: 0,
        tzid: 'Asia/Shanghai',
        startAt: 1700000000000,
        enabled: true,
        onceCivilJson: null,
        channelsJson: '["system-notification","webhook"]', // canonical 序（写路径归一）。
        channelConfigsJson: '{"webhook":"https://hook.example"}',
      },
    ]);
    expect(snapshot.channelPresets).toEqual([
      {
        id: preset.id,
        name: 'Zulip 主站',
        type: 'webhook',
        configJson: WEBHOOK_CONFIG,
        isDefault: true,
      },
    ]);
    expect(snapshot.itemTags).toEqual([{ itemId: active.id, tagId: tag.id }]);
  });

  it('序列化 → parseDataSnapshot roundtrip 相等（含守卫通过）', async () => {
    const { repo } = makeRepository();
    const item = await repo.createItem(makeCreateInput('x'));
    await repo.addTagToItem(item.id, 'tag1');
    await repo.createReminder({
      itemId: item.id,
      frequency: 'once',
      localTimeHour: 0,
      localTimeMinute: 0,
      onceAt: { year: 2026, month: 12, day: 1, hour: 8, minute: 0 },
      tzid: 'Asia/Shanghai',
      startAt: 1700000000000,
      enabled: true,
    });
    await repo.createChannelPreset({ name: 'Apprise', type: 'apprise', configJson: APPRISE_CONFIG });

    const snapshot = await repo.createDataSnapshot();
    const roundtripped = parseDataSnapshot(serializeDataSnapshot(snapshot));
    expect(roundtripped).toEqual(snapshot);
    expect(isDataSnapshotWire(roundtripped)).toBe(true);
  });
});

describe('applyDataSnapshot（增量覆盖恢复，repository.md v0.35 冻结语义）', () => {
  it('全新库整包恢复：五块 id/时间戳保真、v10 列读回、join 重建（applied=5）', async () => {
    const { repo: sourceRepo } = makeRepository();
    const item = await sourceRepo.createItem(makeCreateInput('灵感一闪'));
    await repo_addTagAndReminderAndPreset(sourceRepo, item.id);
    const snapshot = await sourceRepo.createDataSnapshot();
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.tags).toHaveLength(1);
    expect(snapshot.reminders).toHaveLength(1);
    expect(snapshot.channelPresets).toHaveLength(1);
    expect(snapshot.itemTags).toHaveLength(1);

    const { repo: freshRepo } = makeRepository();
    const result = await freshRepo.applyDataSnapshot(snapshot);
    // item 1 + tag 1 + reminder 1 + preset 1 + join 1；切片 37 起新格式快照恒携带
    // Spark 三键（本例为空数组）→ sparkAttachmentFiles 恒返回 {0,0}（未注入 IO）；
    // 旧格式（三键删除）该字段缺省。
    expect(result).toEqual({
      applied: 5,
      skipped: 0,
      sparkAttachmentFiles: { restored: 0, failed: 0 },
    });

    const items = await freshRepo.listItemsWithTags();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(snapshot.items[0].id); // id 保真。
    expect(items[0].createdAt).toBe(snapshot.items[0].createdAt); // created_at 保真。
    expect(items[0].title).toBe('灵感一闪');
    expect(items[0].tags.map((tag) => tag.id)).toEqual([snapshot.tags[0].id]); // tag id 保真 + join 重建。

    const reminders = await freshRepo.listAllReminders();
    expect(reminders).toHaveLength(1);
    expect(reminders[0].id).toBe(snapshot.reminders[0].id);
    expect(reminders[0].frequency).toBe('weekly');
    expect(reminders[0].weekdays).toEqual([1, 5]);
    expect(reminders[0].channels).toEqual(['system-notification', 'webhook']);
    expect(reminders[0].channelConfigs).toEqual({ webhook: 'https://hook.example' });

    const presets = await freshRepo.listChannelPresets();
    expect(presets).toHaveLength(1);
    expect(presets[0].id).toBe(snapshot.channelPresets[0].id);
    expect(presets[0].isDefault).toBe(true);
  });

  it('items：命中覆盖 11 业务字段写穿（createdAt 不动/updatedAt 自动）、本地独有保留、未命中创建保真', async () => {
    const { repo } = makeRepository();
    const local = await repo.createItem({ ...makeCreateInput('本地原题'), priority: 0 });
    const localOnly = await repo.createItem(makeCreateInput('本地独有'));
    const createdAt = local.createdAt;

    const snapshot = makeEmptySnapshot({
      items: [
        makeSnapshotItem({
          id: local.id,
          title: '快照新题',
          content: '新内容',
          status: 'done',
          startAt: 111,
          endAt: 222,
          allDay: true,
          sourceType: 'ics',
          sourceUid: 'uid-1',
          sourceReadOnly: true,
          categoryId: 'work',
          priority: 3,
          createdAt, // 命中覆盖时该值不写入（updatedAt 自动）。
          updatedAt: 1, // 明显过期值——恢复后应被自动刷新覆盖。
        }),
        makeSnapshotItem({ id: 'snapshot-new-item', title: '快照新建' }),
      ],
    });

    const result = await repo.applyDataSnapshot(snapshot);
    expect(result).toEqual({ applied: 2, skipped: 0 });

    const items = await repo.listItemsWithTags();
    expect(items).toHaveLength(3); // 覆盖 1 + 新建 1 + 本地独有 1。
    const covered = items.find((item) => item.id === local.id);
    expect(covered).toMatchObject({
      title: '快照新题',
      content: '新内容',
      status: 'done',
      startAt: 111,
      endAt: 222,
      allDay: true,
      sourceType: 'ics',
      sourceUid: 'uid-1',
      sourceReadOnly: true,
      categoryId: 'work',
      priority: 3,
      createdAt, // 不动。
    });
    expect(covered?.updatedAt).toBeGreaterThan(1); // prepareUpdate 自动刷新。
    const created = items.find((item) => item.id === 'snapshot-new-item');
    expect(created).toMatchObject({ title: '快照新建', createdAt: 1699999999000, updatedAt: 1699999999000 });
    expect(items.find((item) => item.id === localOnly.id)?.title).toBe('本地独有');
  });

  it('tags：归一命中覆盖 color/emoji 不重复建、未命中创建带快照 id、重复名 first-wins、本地独有保留', async () => {
    const { repo } = makeRepository();
    const item = await repo.createItem(makeCreateInput('x'));
    const localTag = await repo.addTagToItem(item.id, 'ABC');
    await repo.updateTagVisuals(localTag.id, { color: '#ff0000', emoji: '🔥' });

    const snapshot = makeEmptySnapshot({
      items: [makeSnapshotItem({ id: item.id })], // join 解析需要 item 已解析。
      tags: [
        { id: 'snap-t1', name: 'abc', color: '#123456', emoji: '✨' }, // 归一键命中本地 ABC。
        { id: 'snap-t2', name: '新A', color: '#00ff00', emoji: null }, // 未命中创建。
        { id: 'snap-t3', name: 'dup', color: '#111111', emoji: null }, // first-wins：建。
        { id: 'snap-t4', name: 'dup', color: '#222222', emoji: null }, // 重复名：skipped。
      ],
      itemTags: [
        { itemId: item.id, tagId: 'snap-t1' },
        { itemId: item.id, tagId: 'snap-t2' },
        { itemId: item.id, tagId: 'snap-t3' },
        { itemId: item.id, tagId: 'snap-t4' }, // 解析到 first-wins 行 → 与 t3 重复声明 skipped。
      ],
    });

    const result = await repo.applyDataSnapshot(snapshot);
    // item 1 + tags 3（abc/新A/dup 首条）+ joins 3（t4 重复 skipped）。
    expect(result).toEqual({ applied: 7, skipped: 2 });

    const tags = await repo.listTags();
    expect(tags).toHaveLength(3); // ABC 不重复建（归一命中）+ 新A + dup。
    const byName = new Map(tags.map((tag) => [tag.name, tag]));
    expect(byName.get('ABC')?.color).toBe('#123456'); // 归一键命中覆盖。
    expect(byName.get('ABC')?.emoji).toBe('✨');
    expect(byName.get('ABC')?.id).toBe(localTag.id); // 命中行 id 不变。
    expect(byName.get('新A')?.id).toBe('snap-t2'); // 创建带快照 id。
    const dupRows = tags.filter((tag) => tag.name === 'dup');
    expect(dupRows).toHaveLength(1);
    expect(dupRows[0].color).toBe('#111111'); // first-wins（非后者覆盖）。

    const hydrated = (await repo.listItemsWithTags()).find((entry) => entry.id === item.id);
    expect(hydrated?.tags.map((tag) => tag.name).sort()).toEqual(['ABC', 'dup', '新A']);
  });

  it('reminders：命中覆盖写穿（item_id 不改）、未命中创建 deprecated 兜底、调度态列不在快照', async () => {
    const { repo, adapter } = makeRepository();
    const item = await repo.createItem(makeCreateInput('x'));
    const reminder = await repo.createReminder({
      itemId: item.id,
      frequency: 'daily',
      localTimeHour: 9,
      localTimeMinute: 0,
      tzid: 'Asia/Shanghai',
      startAt: 1700000000000,
      enabled: true,
    });

    const snapshot = makeEmptySnapshot({
      items: [makeSnapshotItem({ id: item.id })],
      reminders: [
        makeSnapshotReminder({
          id: reminder.id, // 命中：改规则 + 渠道。
          itemId: '其他任何值也不改写 item_id',
          frequency: 'weekly',
          weekdaysJson: '[3]',
          enabled: false,
          channelsJson: '["alarm","webhook"]',
          channelConfigsJson: '{"webhook":"https://hook.example"}',
        }),
        makeSnapshotReminder({ id: 'snap-r2', itemId: item.id, frequency: 'once', onceCivilJson: '{"year":2026,"month":12,"day":1,"hour":8,"minute":0}' }),
      ],
    });

    const result = await repo.applyDataSnapshot(snapshot);
    expect(result).toEqual({ applied: 3, skipped: 0 }); // item 1 + reminder 覆盖 1 + 创建 1。

    const reminders = await repo.listAllReminders();
    expect(reminders).toHaveLength(2);
    const covered = reminders.find((entry) => entry.id === reminder.id);
    expect(covered?.itemId).toBe(item.id); // item_id 不改。
    expect(covered?.frequency).toBe('weekly');
    expect(covered?.weekdays).toEqual([3]);
    expect(covered?.enabled).toBe(false);
    expect(covered?.channels).toEqual(['alarm', 'webhook']);
    const created = reminders.find((entry) => entry.id === 'snap-r2');
    expect(created?.frequency).toBe('once');
    expect(created?.onceAt).toEqual({ year: 2026, month: 12, day: 1, hour: 8, minute: 0 });
    expect(created?.channels).toEqual(['system-notification']);

    // deprecated 两列兜底：直接读新建行原始列（channel 非可选恒写、channel_config null）。
    const loki = extractLokiHandle(adapter);
    expect(loki).not.toBeNull();
    const rawReminders = (loki?.getCollection('reminders')?.data ?? []) as Array<
      Record<string, unknown>
    >;
    const createdRow = rawReminders.find((row) => row.id === 'snap-r2');
    expect(createdRow).toBeDefined();
    expect(createdRow?.channel).toBe('system-notification');
    expect(createdRow?.channel_config).toBeNull();
  });

  it('reminders：item_id 悬挂与深层校验失败逐条 skipped（防砖：不写坏行）', async () => {
    const { repo } = makeRepository();
    const item = await repo.createItem(makeCreateInput('x'));

    const snapshot = makeEmptySnapshot({
      items: [makeSnapshotItem({ id: item.id })],
      reminders: [
        makeSnapshotReminder({ id: 'r-hang', itemId: 'ghost-item' }), // item_id 悬挂。
        makeSnapshotReminder({ id: 'r-bad-channel', itemId: item.id, channelsJson: '["bogus"]' }),
        makeSnapshotReminder({ id: 'r-empty-channel', itemId: item.id, channelsJson: '[]' }),
        makeSnapshotReminder({ id: 'r-expo-dupe', itemId: item.id, channelsJson: '["system-notification","alarm"]' }),
        makeSnapshotReminder({ id: 'r-bad-tz', itemId: item.id, tzid: 'Europe/Paris' }),
        makeSnapshotReminder({ id: 'r-weekly-empty', itemId: item.id, frequency: 'weekly', weekdaysJson: '[]' }),
        makeSnapshotReminder({ id: 'r-once-missing', itemId: item.id, frequency: 'once' }),
        makeSnapshotReminder({ id: 'r-once-bad-json', itemId: item.id, frequency: 'once', onceCivilJson: '{bad' }),
        makeSnapshotReminder({ id: 'r-monthly-zero', itemId: item.id, frequency: 'monthly', dayOfMonth: 0 }),
      ],
    });

    const result = await repo.applyDataSnapshot(snapshot);
    expect(result).toEqual({ applied: 1, skipped: 9 }); // 仅 item。

    const reminders = await repo.listAllReminders();
    expect(reminders).toHaveLength(0); // 一条坏行都不落库。
  });

  it('channelPresets：命中覆盖（type 不写）、type 不匹配 skipped、守卫失败 skipped、单 default 规范化', async () => {
    const { repo } = makeRepository();
    const webhookPreset = await repo.createChannelPreset({
      name: 'Zulip 旧',
      type: 'webhook',
      configJson: WEBHOOK_CONFIG,
      isDefault: true,
    });
    const localApprise = await repo.createChannelPreset({
      name: 'Apprise 本地',
      type: 'apprise',
      configJson: APPRISE_CONFIG,
      isDefault: true, // 本地独有 default：快照声明 apprise default 后应收敛 false。
    });

    const snapshot = makeEmptySnapshot({
      channelPresets: [
        {
          id: webhookPreset.id, // 命中：覆盖 name/configJson/isDefault（type 相同）。
          name: 'Zulip 新',
          type: 'webhook',
          configJson: JSON.stringify({ ...JSON.parse(WEBHOOK_CONFIG), url: 'https://new.example' }),
          isDefault: false,
        },
        {
          id: localApprise.id,
          name: 'Apprise 改名',
          type: 'webhook', // 与本地行 type 不匹配 → skipped。
          configJson: WEBHOOK_CONFIG,
          isDefault: true,
        },
        { id: 'snap-p3', name: 'Zulip 备份', type: 'webhook', configJson: WEBHOOK_CONFIG, isDefault: true },
        { id: 'snap-p4', name: 'Apprise 新', type: 'apprise', configJson: APPRISE_CONFIG, isDefault: true },
        { id: 'snap-p5', name: '坏配置', type: 'webhook', configJson: '{}', isDefault: false }, // 守卫失败。
        { id: 'snap-p6', name: 'Apprise 备份2', type: 'apprise', configJson: APPRISE_CONFIG, isDefault: true },
      ],
    });

    const result = await repo.applyDataSnapshot(snapshot);
    expect(result).toEqual({ applied: 4, skipped: 2 }); // 覆盖 1 + p3/p4/p6 创建 3；type 不匹配 + 坏配置。

    const presets = await repo.listChannelPresets();
    expect(presets).toHaveLength(5); // 2 本地 + 3 新建（p5 不落库）。
    const byName = new Map(presets.map((preset) => [preset.name, preset]));
    expect(byName.get('Zulip 新')?.id).toBe(webhookPreset.id);
    expect(byName.get('Zulip 新')?.isDefault).toBe(false); // 快照声明非 default。
    expect(byName.get('Zulip 备份')?.isDefault).toBe(true); // 快照序最后 webhook default 生效。
    expect(presets.filter((preset) => preset.type === 'webhook' && preset.isDefault)).toHaveLength(1);
    expect(byName.get('Apprise 备份2')?.isDefault).toBe(true); // apprise 最后 default。
    expect(byName.get('Apprise 新')?.isDefault).toBe(false);
    expect(byName.get('Apprise 本地')?.isDefault).toBe(false); // 本地独有 default 收敛。
    expect(byName.get('Apprise 改名')).toBeUndefined(); // type 不匹配未写入。
  });

  it('itemTags：删除重建（快照未声明的 join 移除）、悬挂 skipped、重复声明 skipped', async () => {
    const { repo } = makeRepository();
    const item = await repo.createItem(makeCreateInput('x'));
    const tagA = await repo.addTagToItem(item.id, 'A');
    const tagB = await repo.addTagToItem(item.id, 'B'); // 快照不声明 → join 删除。
    expect(tagA.id).not.toBe(tagB.id);

    const snapshot = makeEmptySnapshot({
      items: [makeSnapshotItem({ id: item.id })],
      tags: [
        { id: 'snap-tA', name: 'A', color: null, emoji: null },
        { id: 'snap-tB', name: 'B', color: null, emoji: null }, // 未声明 join：tag 行恢复但 join 移除。
      ],
      itemTags: [
        { itemId: item.id, tagId: 'snap-tA' },
        { itemId: 'ghost-item', tagId: 'snap-tA' }, // itemId 悬挂。
        { itemId: item.id, tagId: 'snap-ghost' }, // tagId 悬挂。
        { itemId: item.id, tagId: 'snap-tA' }, // 重复声明。
      ],
    });

    const result = await repo.applyDataSnapshot(snapshot);
    expect(result).toEqual({ applied: 4, skipped: 3 }); // item 1 + tags 2 + join A 1。

    const hydrated = (await repo.listItemsWithTags()).find((entry) => entry.id === item.id);
    expect(hydrated?.tags.map((tag) => tag.name)).toEqual(['A']); // B join 删除、A 保留。
    expect((await repo.listTags()).map((tag) => tag.name).sort()).toEqual(['A', 'B']);
  });

  it('守卫不过抛错、库零变化（不进事务）', async () => {
    const { repo } = makeRepository();
    const item = await repo.createItem(makeCreateInput('x'));
    await repo.addTagToItem(item.id, 'tag1');
    const before = await repo.listItemsWithTags();

    const broken = { version: 1, kind: 'config', items: [] } as unknown as DataSnapshot;
    await expect(repo.applyDataSnapshot(broken)).rejects.toThrow('applyDataSnapshot: 快照不符合 DataSnapshot 结构');
    expect(await repo.listItemsWithTags()).toEqual(before);
    expect((await repo.listTags()).map((tag) => tag.name)).toEqual(['tag1']);
  });

  it('items：categoryId 悬挂引用 skipped（预置分类命中正常）', async () => {
    const { repo } = makeRepository();
    const snapshot = makeEmptySnapshot({
      items: [
        makeSnapshotItem({ id: 'i-work', categoryId: 'work' }), // 预置分类命中。
        makeSnapshotItem({ id: 'i-hang', categoryId: 'ghost-cat' }), // 悬挂。
      ],
    });
    const result = await repo.applyDataSnapshot(snapshot);
    expect(result).toEqual({ applied: 1, skipped: 1 });
    expect((await repo.listItemsWithTags()).map((item) => item.id)).toEqual(['i-work']);
  });
});

describe('applyDataSnapshot 原子事务（prepare* 收集 + 单次 adapter.batch）', () => {
  it('batch 失败 → 整体回滚（items/tags/join 全部保持恢复前状态）', async () => {
    const { repo, adapter } = makeRepository();
    const item = await repo.createItem(makeCreateInput('原题'));
    await repo.addTagToItem(item.id, '恢复前标签');
    const loki = extractLokiHandle(adapter);
    expect(loki).not.toBeNull();
    const rawItems = () => JSON.parse(JSON.stringify(loki?.getCollection('items')?.data ?? []));
    const rawTags = () => JSON.parse(JSON.stringify(loki?.getCollection('tags')?.data ?? []));
    const rawJoins = () => JSON.parse(JSON.stringify(loki?.getCollection('item_tags')?.data ?? []));
    const beforeItems = rawItems();
    const beforeTags = rawTags();
    const beforeJoins = rawJoins();

    const snapshot = makeEmptySnapshot({
      items: [
        makeSnapshotItem({ id: item.id, title: '漂移题', categoryId: 'work' }), // 命中覆盖。
        makeSnapshotItem({ id: 'new-item', title: '新建' }), // 创建。
      ],
      tags: [{ id: 'new-tag', name: '新标签', color: null, emoji: null }], // 创建。
      itemTags: [{ itemId: item.id, tagId: 'new-tag' }], // 删旧 join + 建新 join。
    });

    // LokiJSAdapter.batch 为 callback 风格——注入失败必须经 callback({error}) 回传
    // （configSnapshotRepository.test.ts 同款）。
    const batchSpy = jest
      .spyOn(adapter, 'batch')
      .mockImplementationOnce(
        (_operations, callback) => callback({ error: new Error('disk failure') }),
      );
    await expect(repo.applyDataSnapshot(snapshot)).rejects.toThrow('disk failure');
    expect(batchSpy).toHaveBeenCalledTimes(1);

    expect(rawItems()).toEqual(beforeItems);
    expect(rawTags()).toEqual(beforeTags);
    expect(rawJoins()).toEqual(beforeJoins);
  });

  it('多写单批：一次 apply 恰好一次 adapter.batch（覆盖+创建+join 删/建）', async () => {
    const { repo, adapter } = makeRepository();
    const item = await repo.createItem(makeCreateInput('x'));
    await repo.addTagToItem(item.id, 'A');

    const snapshot = makeEmptySnapshot({
      items: [makeSnapshotItem({ id: item.id, title: '覆盖', categoryId: 'work' })],
      tags: [{ id: 't-new', name: '新A', color: null, emoji: null }],
      reminders: [makeSnapshotReminder({ id: 'r-new', itemId: item.id })],
      itemTags: [{ itemId: item.id, tagId: 't-new' }],
    });

    const batchSpy = jest.spyOn(adapter, 'batch');
    const result = await repo.applyDataSnapshot(snapshot);
    expect(result).toEqual({ applied: 4, skipped: 0 }); // item 覆盖 + tag + reminder + join。
    expect(batchSpy).toHaveBeenCalledTimes(1);
    const operations = batchSpy.mock.calls[0][0] as unknown[];
    expect(operations).toHaveLength(5); // item update + tag create + reminder create + 旧 join 删 + 新 join 建。
  });
});

describe('ItemRepository 端口实现绑定（编译面，§7.43 D2）', () => {
  it('WatermelonItemRepository 可作为 ItemRepository 消费（端口成对扩展）', () => {
    const { repo } = makeRepository();
    const port: ItemRepository = repo;
    expect(typeof port.createDataSnapshot).toBe('function');
    expect(typeof port.applyDataSnapshot).toBe('function');
  });
});

// —— 辅助（避免顶层 await 的预置数据组装）——

async function repo_addTagAndReminderAndPreset(
  repo: WatermelonItemRepository,
  itemId: string,
): Promise<void> {
  await repo.addTagToItem(itemId, '灵感');
  await repo.createReminder({
    itemId,
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
    configJson: WEBHOOK_CONFIG,
    isDefault: true,
  });
}
