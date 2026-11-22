/**
 * mergeSyncSnapshots 纯函数单测（切片 35 阶段 1，AGENTS.md §7.47 提案 D2/D3/D5）：
 * 行级 LWW（全局比较 / 平局本地赢 / 平局 deviceId 字典序）/ 墓碑传播与防回流 /
 * union 合流（tags 归一键、categories/presets id）/ itemTags 并集 /
 * appSettings 会话基线 LWW / 确定性（与输入顺序无关）。
 */

import { mergeSyncSnapshots, type SyncMergeOptions, type SyncMergeResult } from '../syncMerge';
import type { ConfigSnapshotCategoryEntry } from '../configSnapshot';
import type { DataSnapshotChannelPreset, DataSnapshotItem, DataSnapshotTag } from '../dataSnapshot';
import type { AppSettings } from '../settings';
import {
  deviceIdFromSyncFileName,
  type SyncReminderEntry,
  type SyncSnapshot,
  type SyncTombstoneEntry,
} from '../syncSnapshot';

const LOCAL_DEVICE = '00000000-0000-4000-8000-000000000000';
const DEVICE_A = '11111111-2222-4333-8444-555555555555';
const DEVICE_B = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee';

/** 非设置类用例的缺省基线：指向未来 → 远端 appSettings 永不合格（隔离设置块计数干扰）。 */
const BASELINE: SyncMergeOptions = { settingsBaselineExportedAt: '2027-01-01T00:00:00.000+08:00' };

function makeAppSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    tagDisplayMode: 'text',
    widgetShowOverdue: true,
    widgetShowTodos: true,
    widgetShowCategoryEmoji: false,
    widgetShowTags: false,
    chipsIncrements: [10, 60],
    defaultChannels: ['system-notification'],
    carefulMode: false,
    showAiUsage: false,
    displayCalendarIds: [],
    aiRetryMax: 3,
    flashDeletedCardDisplay: 'mark',
    showAiRequest: false,
    showAiResponse: false,
    ...overrides,
  };
}

function makeCategory(id: string, overrides: Partial<ConfigSnapshotCategoryEntry> = {}): ConfigSnapshotCategoryEntry {
  return { id, name: `分类-${id}`, color: '#ff0000', emoji: '🎯', priority: 10, ...overrides };
}

function makeItem(id: string, updatedAt: number, overrides: Partial<DataSnapshotItem> = {}): DataSnapshotItem {
  return {
    id,
    type: 'note',
    title: `条目-${id}`,
    content: '',
    status: 'active',
    startAt: 1700000000000,
    endAt: null,
    allDay: false,
    sourceType: 'local',
    sourceUid: null,
    sourceReadOnly: false,
    categoryId: 'work',
    priority: 2,
    createdAt: updatedAt - 1000,
    updatedAt,
    ...overrides,
  };
}

function makeReminder(
  id: string,
  itemId: string,
  updatedAt: number,
  overrides: Partial<SyncReminderEntry> = {},
): SyncReminderEntry {
  return {
    id,
    itemId,
    frequency: 'once',
    localTimeHour: 8,
    localTimeMinute: 30,
    weekdaysJson: '[]',
    dayOfMonth: 0,
    tzid: 'Asia/Shanghai',
    startAt: 1700000000000,
    enabled: true,
    onceCivilJson: '{"year":2026,"month":11,"day":22,"hour":8,"minute":30}',
    channelsJson: '["system-notification"]',
    channelConfigsJson: null,
    createdAt: updatedAt - 1000,
    updatedAt,
    ...overrides,
  };
}

function makePreset(id: string, overrides: Partial<DataSnapshotChannelPreset> = {}): DataSnapshotChannelPreset {
  return {
    id,
    name: `预设-${id}`,
    type: 'webhook',
    configJson: '{"url":"https://example"}',
    isDefault: false,
    ...overrides,
  };
}

function makeTag(id: string, name: string, overrides: Partial<DataSnapshotTag> = {}): DataSnapshotTag {
  return { id, name, color: null, emoji: null, ...overrides };
}

function makeTombstone(kind: SyncTombstoneEntry['kind'], entityId: string, deletedAt = 1700000099000): SyncTombstoneEntry {
  return { kind, entityId, deletedAt };
}

type RemoteOverrides = Partial<Pick<SyncSnapshot, 'deviceId' | 'exportedAt'>> & {
  categories?: unknown[];
  items?: unknown[];
  tags?: unknown[];
  reminders?: unknown[];
  channelPresets?: unknown[];
  itemTags?: unknown[];
  tombstones?: unknown[];
  appSettings?: unknown;
};

function makeRemote(overrides: RemoteOverrides = {}): SyncSnapshot {
  const draft: Record<string, unknown> = {
    version: 1,
    kind: 'sync',
    deviceId: overrides.deviceId ?? DEVICE_A,
    exportedAt: overrides.exportedAt ?? '2026-11-22T12:00:00.000+08:00',
    appSettings: overrides.appSettings ?? makeAppSettings(),
    categories: overrides.categories ?? [makeCategory('work')],
    items: overrides.items ?? [],
    tags: overrides.tags ?? [],
    reminders: overrides.reminders ?? [],
    channelPresets: overrides.channelPresets ?? [],
    itemTags: overrides.itemTags ?? [],
    tombstones: overrides.tombstones ?? [],
  };
  // 与生产 parseSyncSnapshot 同一「JSON 边界恢复类型」路径（条目守卫在 parse 才生效）；
  // 测试经此注入畸形条目（形状不符/重复 id 分支的防御面探测）。
  return JSON.parse(JSON.stringify(draft)) as SyncSnapshot;
}

/** 本地基线快照：work 分类 + 本地条目/标签/提醒/preset 可按键覆盖。 */
function makeLocal(overrides: RemoteOverrides = {}): SyncSnapshot {
  return makeRemote({ deviceId: LOCAL_DEVICE, ...overrides });
}

function ids(values: Array<{ id: string }>): string[] {
  return values.map((value) => value.id);
}

function serializeResult(result: SyncMergeResult): string {
  return JSON.stringify(result);
}

describe('空远端 / 幂等基线', () => {
  it('无远端快照 → 全空结果，appSettings 保留本地', () => {
    const local = makeLocal({
      items: [makeItem('i1', 1700000001000)],
      tags: [makeTag('t1', '灵感')],
    });
    const result = mergeSyncSnapshots(local, [], [], BASELINE);
    expect(result.toUpsertItems).toEqual([]);
    expect(result.toDeleteItemIds).toEqual([]);
    expect(result.toUpsertReminders).toEqual([]);
    expect(result.toDeleteReminderIds).toEqual([]);
    expect(result.toUpsertPresets).toEqual([]);
    expect(result.toDeletePresetIds).toEqual([]);
    expect(result.toCreateTags).toEqual([]);
    expect(result.toCreateCategories).toEqual([]);
    expect(result.rebuiltItemTags).toEqual([]);
    expect(result.tombstonesToAdd).toEqual([]);
    expect(result.appliedAppSettings).toBeNull();
    expect(result.counts).toEqual({ applied: 0, skipped: 0, conflictsResolved: 0, tombstonesPropagation: 0 });
  });

  it('远端与本地全等 → 零写入零冲突（重跑同输入同结果）', () => {
    const shared = makeLocal({
      items: [makeItem('i1', 1700000001000)],
      tags: [makeTag('t1', '灵感')],
      itemTags: [{ itemId: 'i1', tagId: 't1' }],
      reminders: [makeReminder('r1', 'i1', 1700000001000)],
    });
    const result1 = mergeSyncSnapshots(shared, [shared], [], BASELINE);
    expect(result1.counts.applied).toBe(0);
    expect(result1.counts.conflictsResolved).toBe(0);
    expect(result1.counts.skipped).toBe(0);
    expect(result1.appliedAppSettings).toBeNull();
    const result2 = mergeSyncSnapshots(shared, [shared], [], BASELINE);
    expect(serializeResult(result1)).toBe(serializeResult(result2));
  });
});

describe('items 行级 LWW（全局比较）', () => {
  it('远端新建（本地无）→ toUpsertItems + applied', () => {
    const local = makeLocal({ categories: [makeCategory('work')] });
    const remote = makeRemote({ items: [makeItem('r1', 1700000005000)] });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(ids(result.toUpsertItems)).toEqual(['r1']);
    expect(result.counts.applied).toBe(1);
    expect(result.counts.conflictsResolved).toBe(0);
  });

  it('远端 updatedAt 严格晚于本地 → 覆盖 + conflictsResolved', () => {
    const local = makeLocal({ items: [makeItem('i1', 1700000001000)] });
    const remote = makeRemote({ items: [makeItem('i1', 1700000005000)] });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(ids(result.toUpsertItems)).toEqual(['i1']);
    expect(result.counts.conflictsResolved).toBe(1);
    expect(result.counts.applied).toBe(1);
  });

  it('远端 updatedAt 更早 → 不覆盖（本地赢）', () => {
    const local = makeLocal({ items: [makeItem('i1', 1700000005000)] });
    const remote = makeRemote({ items: [makeItem('i1', 1700000001000)] });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(result.toUpsertItems).toEqual([]);
    expect(result.counts.applied).toBe(0);
    expect(result.counts.conflictsResolved).toBe(0);
  });

  it('updatedAt 平局 → 本地赢（不覆盖）', () => {
    const local = makeLocal({ items: [makeItem('i1', 1700000005000)] });
    const remote = makeRemote({ items: [makeItem('i1', 1700000005000, { title: '远端标题' })] });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(result.toUpsertItems).toEqual([]);
    expect(result.counts.conflictsResolved).toBe(0);
  });

  it('多远端同 id：全局比较取 updatedAt 最大者（非「列表最后快照」），与输入顺序无关', () => {
    const local = makeLocal();
    const early = makeRemote({
      deviceId: DEVICE_A,
      exportedAt: '2026-11-22T10:00:00.000+08:00',
      items: [makeItem('i1', 1700000001000, { title: 'A-早' })],
    });
    const late = makeRemote({
      deviceId: DEVICE_B,
      exportedAt: '2026-11-22T11:00:00.000+08:00',
      items: [makeItem('i1', 1700000005000, { title: 'B-晚' })],
    });
    const resultA = mergeSyncSnapshots(local, [early, late], [], BASELINE);
    const resultB = mergeSyncSnapshots(local, [late, early], [], BASELINE);
    expect(resultA.toUpsertItems).toHaveLength(1);
    expect(resultA.toUpsertItems[0].title).toBe('B-晚');
    expect(serializeResult(resultA)).toBe(serializeResult(resultB));
  });

  it('updatedAt 平局的跨远端冲突：deviceId 字典序最大者胜出', () => {
    const local = makeLocal();
    const remoteA = makeRemote({
      deviceId: DEVICE_A,
      items: [makeItem('i1', 1700000005000, { title: 'A' })],
    });
    const remoteB = makeRemote({
      deviceId: DEVICE_B,
      items: [makeItem('i1', 1700000005000, { title: 'B' })],
    });
    const result = mergeSyncSnapshots(local, [remoteA, remoteB], [], BASELINE);
    expect(result.toUpsertItems[0].title).toBe('B'); // 'aaaa…' > '1111…'
  });

  it('同一快照内重复 id first-wins + skipped', () => {
    const local = makeLocal();
    const remote = makeRemote({
      items: [makeItem('i1', 1700000005000, { title: '首条' }), makeItem('i1', 1700000009000, { title: '重复' })],
    });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(result.toUpsertItems).toHaveLength(1);
    expect(result.toUpsertItems[0].title).toBe('首条');
    expect(result.counts.skipped).toBe(1);
  });

  it('形状不符条目计 skipped', () => {
    const local = makeLocal();
    const remote = makeRemote({
      items: [makeItem('ok', 1700000005000), { id: 'bad', title: '缺一堆键' }],
    });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(ids(result.toUpsertItems)).toEqual(['ok']);
    expect(result.counts.skipped).toBe(1);
  });

  it('categoryId 悬挂（本地与本轮创建均无）→ skipped', () => {
    const local = makeLocal({ categories: [makeCategory('work')] });
    const remote = makeRemote({ items: [makeItem('i1', 1700000005000, { categoryId: 'ghost' })] });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(result.toUpsertItems).toEqual([]);
    expect(result.counts.skipped).toBe(1);
  });

  it('远端新分类先于 items 解析：新建分类覆盖本轮 item 的 categoryId → 不悬挂', () => {
    const local = makeLocal({ categories: [makeCategory('work')] });
    const remote = makeRemote({
      categories: [makeCategory('study', { name: '学习' })],
      items: [makeItem('i1', 1700000005000, { categoryId: 'study' })],
    });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(ids(result.toCreateCategories)).toEqual(['study']);
    expect(ids(result.toUpsertItems)).toEqual(['i1']);
    expect(result.counts.skipped).toBe(0);
  });
});

describe('墓碑（删除传播 + 防回流 + 墓碑胜过 LWW）', () => {
  it('远端墓碑命中本地 item → toDeleteItemIds + tombstonesPropagation + 墓碑合入', () => {
    const local = makeLocal({ items: [makeItem('i1', 1700000005000)] });
    const remote = makeRemote({ tombstones: [makeTombstone('item', 'i1')] });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(result.toDeleteItemIds).toEqual(['i1']);
    expect(result.counts.tombstonesPropagation).toBe(1);
    expect(result.tombstonesToAdd).toEqual([makeTombstone('item', 'i1')]);
  });

  it('墓碑胜过 LWW：远端行更新更晚但同快照携带墓碑 → 不 upsert', () => {
    const local = makeLocal({ items: [makeItem('i1', 1700000001000)] });
    const remote = makeRemote({
      items: [makeItem('i1', 1700000009000)],
      tombstones: [makeTombstone('item', 'i1')],
    });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(result.toUpsertItems).toEqual([]);
    expect(result.toDeleteItemIds).toEqual(['i1']);
  });

  it('本地已有墓碑 → tombstonesToAdd 不重复合入（幂等）', () => {
    const localTombstone = makeTombstone('item', 'i1', 1700000010000);
    const remote = makeRemote({ tombstones: [makeTombstone('item', 'i1', 1700000099000)] });
    const result = mergeSyncSnapshots(makeLocal(), [remote], [localTombstone], BASELINE);
    expect(result.tombstonesToAdd).toEqual([]);
  });

  it('本地无实体的远端墓碑也合入（防第三方陈旧快照重建复活）', () => {
    const remote = makeRemote({ tombstones: [makeTombstone('item', 'never-existed')] });
    const result = mergeSyncSnapshots(makeLocal(), [remote], [], BASELINE);
    expect(result.tombstonesToAdd).toHaveLength(1);
    expect(result.tombstonesToAdd[0].entityId).toBe('never-existed');
  });

  it('reminder 墓碑：命中本地 → toDeleteReminderIds；远端同 id 行被压制', () => {
    const local = makeLocal({ reminders: [makeReminder('r1', 'i-local', 1700000005000)] });
    const remote = makeRemote({
      reminders: [makeReminder('r1', 'i-local', 1700000009000)],
      tombstones: [makeTombstone('reminder', 'r1')],
    });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(result.toUpsertReminders).toEqual([]);
    expect(result.toDeleteReminderIds).toEqual(['r1']);
    expect(result.counts.tombstonesPropagation).toBe(1);
  });

  it('preset 墓碑：命中本地 → toDeletePresetIds；远端未命中创建被压制', () => {
    const local = makeLocal({ channelPresets: [makePreset('p1')] });
    const remote = makeRemote({
      channelPresets: [makePreset('p1'), makePreset('p2')],
      tombstones: [makeTombstone('channel_preset', 'p1'), makeTombstone('channel_preset', 'p2')],
    });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(result.toUpsertPresets).toEqual([]);
    expect(result.toDeletePresetIds).toEqual(['p1']);
    expect(result.counts.tombstonesPropagation).toBe(1);
  });
});

describe('reminders 行级 LWW 与孤儿/级联过滤', () => {
  it('远端新建 reminder（基线 item 存活）→ toUpsertReminders', () => {
    const local = makeLocal({ items: [makeItem('i1', 1700000001000)] });
    const remote = makeRemote({ reminders: [makeReminder('r1', 'i1', 1700000005000)] });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(ids(result.toUpsertReminders)).toEqual(['r1']);
    expect(result.counts.applied).toBe(1);
  });

  it('孤儿 reminder（基线 item 本地无且本轮无）→ skipped', () => {
    const local = makeLocal();
    const remote = makeRemote({ reminders: [makeReminder('r1', 'ghost-item', 1700000005000)] });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(result.toUpsertReminders).toEqual([]);
    expect(result.counts.skipped).toBe(1);
  });

  it('基线 item 本轮被墓碑删 → reminder 级联静默跳过（不 skipped 不 upsert）', () => {
    const local = makeLocal({ items: [makeItem('i1', 1700000001000)] });
    const remote = makeRemote({
      reminders: [makeReminder('r1', 'i1', 1700000005000)],
      tombstones: [makeTombstone('item', 'i1')],
    });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(result.toUpsertReminders).toEqual([]);
    expect(result.counts.skipped).toBe(0);
    expect(result.counts.tombstonesPropagation).toBe(1);
  });

  it('孤儿判定覆盖本轮 upsert item：远端成对 item+reminder → reminder 可解析', () => {
    const local = makeLocal();
    const remote = makeRemote({
      items: [makeItem('r-item', 1700000005000)],
      reminders: [makeReminder('r1', 'r-item', 1700000005000)],
    });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(ids(result.toUpsertReminders)).toEqual(['r1']);
    expect(result.counts.skipped).toBe(0);
  });

  it('reminder LWW：晚者覆盖 + conflictsResolved；早者不覆盖', () => {
    const local = makeLocal({ items: [makeItem('i1', 1700000001000)], reminders: [makeReminder('r1', 'i1', 1700000005000)] });
    const newer = makeRemote({ reminders: [makeReminder('r1', 'i1', 1700000009000)] });
    const older = makeRemote({ reminders: [makeReminder('r1', 'i1', 1700000001000)] });
    expect(mergeSyncSnapshots(local, [newer], [], BASELINE).counts.conflictsResolved).toBe(1);
    const stale = mergeSyncSnapshots(local, [older], [], BASELINE);
    expect(stale.toUpsertReminders).toEqual([]);
    expect(stale.counts.conflictsResolved).toBe(0);
  });

  it('reminder 形状不符（缺时间戳）计 skipped', () => {
    const local = makeLocal({ items: [makeItem('i1', 1700000001000)] });
    const broken: Record<string, unknown> = { ...makeReminder('r2', 'i1', 1700000005000) };
    delete broken.createdAt;
    const remote = makeRemote({
      reminders: [makeReminder('r1', 'i1', 1700000005000), broken],
    });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(ids(result.toUpsertReminders)).toEqual(['r1']);
    expect(result.counts.skipped).toBe(1);
  });
});

describe('无时间戳表 union（tags 归一键 / categories、presets id）', () => {
  it('tags 按 normalizeTagName 命中本地（trim + 大小写不敏感）→ 不创建', () => {
    const local = makeLocal({ tags: [makeTag('local-t1', ' Inspiration ')] });
    const remote = makeRemote({ tags: [makeTag('remote-t1', 'inspiration')] });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(result.toCreateTags).toEqual([]);
    expect(result.counts.applied).toBe(0);
  });

  it('归一键命中 → 远端 tag id 解析到本地行 id（join 声明落到本地行）', () => {
    const local = makeLocal({
      tags: [makeTag('local-t1', '灵感')],
      items: [makeItem('i1', 1700000001000)],
      itemTags: [{ itemId: 'i1', tagId: 'remote-t1' }],
    });
    const remote = makeRemote({
      tags: [makeTag('remote-t1', ' 灵感 ')],
      itemTags: [{ itemId: 'i1', tagId: 'remote-t1' }],
    });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(result.toCreateTags).toEqual([]);
    expect(result.rebuiltItemTags).toEqual([{ itemId: 'i1', tagId: 'local-t1' }]);
  });

  it('tags 未命中创建（id 保真）；后续同归一键远端 tag 解析到首建行', () => {
    const local = makeLocal();
    const first = makeRemote({
      deviceId: DEVICE_A,
      exportedAt: '2026-11-22T10:00:00.000+08:00',
      tags: [makeTag('t-a', '灵感')],
    });
    const second = makeRemote({
      deviceId: DEVICE_B,
      exportedAt: '2026-11-22T11:00:00.000+08:00',
      tags: [makeTag('t-b', ' 灵感 ')],
    });
    const result = mergeSyncSnapshots(local, [first, second], [], BASELINE);
    expect(ids(result.toCreateTags)).toEqual(['t-a']);
    expect(result.counts.applied).toBe(1);
    const joinResult = mergeSyncSnapshots(local, [first, second, makeRemote({
      itemTags: [{ itemId: 'i1', tagId: 't-b' }],
      items: [makeItem('i1', 1700000001000)],
    })], [], BASELINE);
    expect(joinResult.rebuiltItemTags).toEqual([{ itemId: 'i1', tagId: 't-a' }]);
  });

  it('categories id union：命中保留本地、未命中创建（id 保真）', () => {
    const local = makeLocal({ categories: [makeCategory('work')] });
    const remote = makeRemote({
      categories: [makeCategory('work', { name: '远端工作' }), makeCategory('study', { name: '学习' })],
    });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(ids(result.toCreateCategories)).toEqual(['study']);
    expect(result.toCreateCategories[0].name).toBe('学习');
    expect(result.counts.applied).toBe(1);
  });

  it('categories 形状不符（name 空白）→ skipped', () => {
    const local = makeLocal();
    const remote = makeRemote({
      categories: [makeCategory('bad', { name: '   ' }), makeCategory('ok')],
    });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(ids(result.toCreateCategories)).toEqual(['ok']);
    expect(result.counts.skipped).toBe(1);
  });

  it('presets id union：命中保留本地 / 未命中创建 / 重复声明 skipped', () => {
    const local = makeLocal({ channelPresets: [makePreset('p1')] });
    const remote = makeRemote({
      channelPresets: [makePreset('p1', { name: '远端改名' }), makePreset('p2'), makePreset('p2')],
    });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(ids(result.toUpsertPresets)).toEqual(['p2']);
    expect(result.counts.skipped).toBe(1);
    expect(result.counts.applied).toBe(1);
  });
});

describe('itemTags 并集增补', () => {
  it('本地已有 join 静默去重；新增 join 计 applied', () => {
    const local = makeLocal({
      items: [makeItem('i1', 1700000001000)],
      tags: [makeTag('t1', '灵感')],
      itemTags: [{ itemId: 'i1', tagId: 't1' }],
    });
    const remote = makeRemote({
      items: [makeItem('i1', 1700000001000)],
      tags: [makeTag('t1', '灵感'), makeTag('t2', '新标签')],
      itemTags: [
        { itemId: 'i1', tagId: 't1' },
        { itemId: 'i1', tagId: 't2' },
      ],
    });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(result.rebuiltItemTags).toEqual([{ itemId: 'i1', tagId: 't2' }]);
    // applied = tag 创建 1 + join 创建 1
    expect(result.counts.applied).toBe(2);
  });

  it('悬挂 itemId / tagId → skipped；同快照重复声明 → skipped', () => {
    const local = makeLocal({
      items: [makeItem('i1', 1700000001000)],
      tags: [makeTag('t1', '灵感')],
    });
    const remote = makeRemote({
      items: [makeItem('i1', 1700000001000)],
      tags: [makeTag('t1', '灵感')],
      itemTags: [
        { itemId: 'ghost', tagId: 't1' },
        { itemId: 'i1', tagId: 'ghost-tag' },
        { itemId: 'i1', tagId: 't1' },
        { itemId: 'i1', tagId: 't1' },
      ],
    });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(result.rebuiltItemTags).toEqual([{ itemId: 'i1', tagId: 't1' }]);
    expect(result.counts.skipped).toBe(3);
  });

  it('被墓碑删除的 item 的 join 声明 → skipped（基线不在合流后集合）', () => {
    const local = makeLocal({ items: [makeItem('i1', 1700000001000)] });
    const remote = makeRemote({
      items: [makeItem('i1', 1700000001000)],
      tags: [makeTag('t1', '灵感')],
      itemTags: [{ itemId: 'i1', tagId: 't1' }],
      tombstones: [makeTombstone('item', 'i1')],
    });
    const result = mergeSyncSnapshots(local, [remote], [], BASELINE);
    expect(result.rebuiltItemTags).toEqual([]);
    expect(result.counts.skipped).toBe(1);
  });
});

describe('appSettings 快照 exportedAt LWW（会话基线）', () => {
  it('基线 null（会话首次）→ 全部远端合格，exportedAt 最大者胜出', () => {
    const local = makeLocal({ appSettings: makeAppSettings({ tagDisplayMode: 'emoji' }) });
    const early = makeRemote({
      deviceId: DEVICE_A,
      exportedAt: '2026-11-22T10:00:00.000+08:00',
      appSettings: makeAppSettings({ tagDisplayMode: 'both' }),
    });
    const late = makeRemote({
      deviceId: DEVICE_B,
      exportedAt: '2026-11-22T11:00:00.000+08:00',
      appSettings: makeAppSettings({ carefulMode: true }),
    });
    const result = mergeSyncSnapshots(local, [early, late], [], { settingsBaselineExportedAt: null });
    expect(result.appliedAppSettings?.carefulMode).toBe(true);
    expect(result.appliedAppSettings?.tagDisplayMode).toBe('text'); // late 快照的 makeAppSettings 全字段默认值
    expect(result.counts.applied).toBe(1);
  });

  it('exportedAt 平局 → deviceId 字典序最大者胜出', () => {
    const local = makeLocal();
    const remoteA = makeRemote({
      deviceId: DEVICE_A,
      exportedAt: '2026-11-22T11:00:00.000+08:00',
      appSettings: makeAppSettings({ carefulMode: false, showAiUsage: true }),
    });
    const remoteB = makeRemote({
      deviceId: DEVICE_B,
      exportedAt: '2026-11-22T11:00:00.000+08:00',
      appSettings: makeAppSettings({ carefulMode: true }),
    });
    const result = mergeSyncSnapshots(local, [remoteA, remoteB], [], { settingsBaselineExportedAt: null });
    expect(result.appliedAppSettings?.carefulMode).toBe(true);
  });

  it('基线晚于全部远端 → null 保留本地（applied 不计）', () => {
    const local = makeLocal();
    const remote = makeRemote({
      exportedAt: '2026-11-22T10:00:00.000+08:00',
      appSettings: makeAppSettings({ carefulMode: true }),
    });
    const result = mergeSyncSnapshots(local, [remote], [], {
      settingsBaselineExportedAt: '2026-11-22T12:00:00.000+08:00',
    });
    expect(result.appliedAppSettings).toBeNull();
    expect(result.counts.applied).toBe(0);
  });

  it('基线早于部分远端 → 仅基线之后合格', () => {
    const local = makeLocal();
    const stale = makeRemote({
      deviceId: DEVICE_A,
      exportedAt: '2026-11-22T10:00:00.000+08:00',
      appSettings: makeAppSettings({ carefulMode: false, showAiRequest: true }),
    });
    const fresh = makeRemote({
      deviceId: DEVICE_B,
      exportedAt: '2026-11-22T11:00:00.000+08:00',
      appSettings: makeAppSettings({ carefulMode: true }),
    });
    const result = mergeSyncSnapshots(local, [stale, fresh], [], {
      settingsBaselineExportedAt: '2026-11-22T10:30:00.000+08:00',
    });
    expect(result.appliedAppSettings?.carefulMode).toBe(true);
    expect(result.appliedAppSettings?.showAiRequest).toBe(false); // stale 不参与
  });

  it('基线串不可解析按 -Infinity（全部远端合格）', () => {
    const local = makeLocal();
    const remote = makeRemote({ appSettings: makeAppSettings({ carefulMode: true }) });
    const result = mergeSyncSnapshots(local, [remote], [], { settingsBaselineExportedAt: 'not-a-date' });
    expect(result.appliedAppSettings?.carefulMode).toBe(true);
  });

  it('appliedAppSettings 缺列保留本地（normalizeSnapshotAppSettings 语义）', () => {
    const local = makeLocal({ appSettings: makeAppSettings({ chipsIncrements: [15, 45] }) });
    const remote = makeRemote({ appSettings: { tagDisplayMode: 'emoji' } });
    const result = mergeSyncSnapshots(local, [remote], [], { settingsBaselineExportedAt: null });
    expect(result.appliedAppSettings?.tagDisplayMode).toBe('emoji');
    expect(result.appliedAppSettings?.chipsIncrements).toEqual([15, 45]);
    expect(result.appliedAppSettings?.aiRetryMax).toBe(3);
  });
});

describe('确定性（与输入顺序无关）', () => {
  it('同一输入集合任意排列 → 结果完全一致', () => {
    const local = makeLocal({
      items: [makeItem('i-local', 1700000001000)],
      tags: [makeTag('t-local', '灵感')],
      itemTags: [{ itemId: 'i-local', tagId: 't-local' }],
      reminders: [makeReminder('r-local', 'i-local', 1700000001000)],
      channelPresets: [makePreset('p-local')],
      tombstones: [makeTombstone('item', 'i-old', 1700000009000)],
    });
    const remotes = [
      makeRemote({
        deviceId: DEVICE_A,
        exportedAt: '2026-11-22T10:00:00.000+08:00',
        categories: [makeCategory('work'), makeCategory('study')],
        items: [makeItem('i-local', 1700000005000), makeItem('i-a', 1700000005000)],
        tags: [makeTag('t-local', '灵感'), makeTag('t-a', '工作')],
        reminders: [makeReminder('r-local', 'i-local', 1700000005000)],
        channelPresets: [makePreset('p-local'), makePreset('p-a', { isDefault: true })],
        itemTags: [{ itemId: 'i-local', tagId: 't-a' }],
        tombstones: [makeTombstone('item', 'i-old', 1700000009000)],
      }),
      makeRemote({
        deviceId: DEVICE_B,
        exportedAt: '2026-11-22T11:00:00.000+08:00',
        items: [makeItem('i-b', 1700000005000)],
        tags: [makeTag('t-b', '生活')],
        reminders: [makeReminder('r-b', 'i-b', 1700000005000)],
        channelPresets: [makePreset('p-b')],
        itemTags: [{ itemId: 'i-b', tagId: 't-b' }],
        tombstones: [makeTombstone('reminder', 'r-old', 1700000009000)],
        appSettings: makeAppSettings({ carefulMode: true }),
      }),
    ];
    const baseline = mergeSyncSnapshots(local, remotes, [], BASELINE);
    for (let i = 0; i < 5; i += 1) {
      const shuffled = [...remotes].sort(() => Math.random() - 0.5);
      const result = mergeSyncSnapshots(local, shuffled, [], BASELINE);
      expect(serializeResult(result)).toBe(serializeResult(baseline));
    }
    expect(baseline.counts.conflictsResolved).toBe(2); // i-local 行覆盖 + r-local 行覆盖（appSettings 块不计冲突）
  });
});

describe('deviceIdFromSyncFileName（编排层辅助，排除自己用）', () => {
  it('从固定名文件名取回 deviceId', () => {
    expect(deviceIdFromSyncFileName(`life-sync-${DEVICE_A}.json`)).toBe(DEVICE_A);
  });
});
