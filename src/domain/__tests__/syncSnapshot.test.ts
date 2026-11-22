/**
 * syncSnapshot 纯函数单测（切片 35 阶段 1，AGENTS.md §7.47）：整包守卫 /
 * SyncReminderEntry 扩展条目谓词 / 墓碑条目谓词 / 序列化与解析 / 固定名文件名。
 * dataSnapshot.test.ts（切片 31）同构蓝本。
 */

import {
  SYNC_SNAPSHOT_FILE_PATTERN,
  SyncSnapshotParseError,
  deviceIdFromSyncFileName,
  isSyncReminderEntry,
  isSyncSnapshotFileName,
  isSyncSnapshotWire,
  isSyncTombstoneEntry,
  parseSyncSnapshot,
  serializeSyncSnapshot,
  syncSnapshotFileName,
  type SyncReminderEntry,
  type SyncSnapshot,
  type SyncTombstoneEntry,
} from '../syncSnapshot';
import type { AppSettings } from '../settings';
import type { ConfigSnapshotCategoryEntry } from '../configSnapshot';

const DEVICE_A = '11111111-2222-4333-8444-555555555555';
const DEVICE_B = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee';

function makeAppSettings(): AppSettings {
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
    aiScheduleQueryEnabled: true,
  };
}

function makeCategory(id: string): ConfigSnapshotCategoryEntry {
  return { id, name: `分类-${id}`, color: '#ff0000', emoji: '🎯', priority: 10 };
}

/** DataSnapshotReminder 形状的合法 reminder 条目（13 键 + 时间戳；localTime 恒为域内 0-23/0-59 整数）。 */
function makeReminderBase(id: string): Record<string, unknown> {
  return {
    id,
    itemId: 'item-1',
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
  };
}

function makeReminderEntry(id: string, updatedAt = 1700000001000): SyncReminderEntry {
  return { ...makeReminderBase(id), createdAt: 1699999999000, updatedAt } as SyncReminderEntry;
}

function makeTombstone(kind: SyncTombstoneEntry['kind'], entityId: string): SyncTombstoneEntry {
  return { kind, entityId, deletedAt: 1700000010000 };
}

function makeSnapshot(deviceId = DEVICE_A, exportedAt = '2026-11-22T15:00:00.000+08:00'): SyncSnapshot {
  return {
    version: 1,
    kind: 'sync',
    deviceId,
    exportedAt,
    appSettings: makeAppSettings(),
    categories: [makeCategory('work')],
    items: [
      {
        id: 'item-1',
        type: 'note',
        title: '灵感一闪',
        content: '内容',
        status: 'active',
        startAt: 1700000000000,
        endAt: null,
        allDay: false,
        sourceType: 'local',
        sourceUid: null,
        sourceReadOnly: false,
        categoryId: 'work',
        priority: 2,
        createdAt: 1699999999000,
        updatedAt: 1700000001000,
      },
    ],
    tags: [{ id: 'tag-1', name: '灵感', color: '#00ff00', emoji: '💡' }],
    reminders: [makeReminderEntry('reminder-1')],
    channelPresets: [
      {
        id: 'preset-1',
        name: 'Zulip 主站',
        type: 'webhook',
        configJson: '{"url":"https://zulip.example","mode":"form"}',
        isDefault: true,
      },
    ],
    itemTags: [{ itemId: 'item-1', tagId: 'tag-1' }],
    tombstones: [makeTombstone('item', 'item-gone')],
  };
}

describe('isSyncSnapshotWire（整包守卫，§7.47 D4）', () => {
  it('合法快照通过（含全部七块数组 + 墓碑元素）', () => {
    expect(isSyncSnapshotWire(makeSnapshot())).toBe(true);
  });

  it('空数组与空墓碑表是合法快照', () => {
    const snapshot = makeSnapshot();
    snapshot.items = [];
    snapshot.tags = [];
    snapshot.reminders = [];
    snapshot.channelPresets = [];
    snapshot.itemTags = [];
    snapshot.tombstones = [];
    snapshot.categories = [];
    expect(isSyncSnapshotWire(snapshot)).toBe(true);
  });

  it('version !== 1 或 kind !== sync 拒绝', () => {
    const wrongVersion = makeSnapshot();
    (wrongVersion as unknown as Record<string, unknown>).version = 2;
    expect(isSyncSnapshotWire(wrongVersion)).toBe(false);

    const wrongKind = makeSnapshot();
    (wrongKind as unknown as Record<string, unknown>).kind = 'data';
    expect(isSyncSnapshotWire(wrongKind)).toBe(false);
  });

  it('deviceId / exportedAt 空串或缺失拒绝（deviceId 不做 uuid 形状校验，提案 D4 原文）', () => {
    const emptyDevice = makeSnapshot();
    emptyDevice.deviceId = '';
    expect(isSyncSnapshotWire(emptyDevice)).toBe(false);

    const missingDevice = { ...makeSnapshot() } as Record<string, unknown>;
    delete missingDevice.deviceId;
    expect(isSyncSnapshotWire(missingDevice)).toBe(false);

    const weirdDevice = makeSnapshot();
    weirdDevice.deviceId = 'device-not-a-uuid';
    expect(isSyncSnapshotWire(weirdDevice)).toBe(true);

    const emptyExported = makeSnapshot();
    emptyExported.exportedAt = '';
    expect(isSyncSnapshotWire(emptyExported)).toBe(false);
  });

  it('appSettings 非对象拒绝（仅要求对象，读层防御归一）', () => {
    const snapshot = makeSnapshot();
    (snapshot as unknown as Record<string, unknown>).appSettings = 'not-a-record';
    expect(isSyncSnapshotWire(snapshot)).toBe(false);
  });

  it('任一块缺失或非数组拒绝', () => {
    for (const block of [
      'appSettings',
      'categories',
      'items',
      'tags',
      'reminders',
      'channelPresets',
      'itemTags',
      'tombstones',
    ] as const) {
      const broken = { ...makeSnapshot() } as Record<string, unknown>;
      delete broken[block];
      expect(isSyncSnapshotWire(broken)).toBe(false);

      const notArray = makeSnapshot();
      (notArray as unknown as Record<string, unknown>)[block] = block === 'appSettings' ? 42 : 'x';
      expect(isSyncSnapshotWire(notArray)).toBe(false);
    }
  });

  it('tombstones 任一元素非法 → 整包拒绝（元素级校验，提案 D4 原文）', () => {
    const snapshot = makeSnapshot();
    (snapshot as unknown as Record<string, unknown>).tombstones = [makeTombstone('item', 'ok'), { kind: 'widget', entityId: 'x', deletedAt: 1 }];
    expect(isSyncSnapshotWire(snapshot)).toBe(false);
  });
});

describe('isSyncTombstoneEntry / isSyncReminderEntry（条目谓词）', () => {
  it('墓碑：合法三元组通过；kind 枚举外 / entityId 空串 / deletedAt 非有限数 / 非对象拒绝', () => {
    expect(isSyncTombstoneEntry(makeTombstone('item', 'i1'))).toBe(true);
    expect(isSyncTombstoneEntry(makeTombstone('reminder', 'r1'))).toBe(true);
    expect(isSyncTombstoneEntry(makeTombstone('channel_preset', 'p1'))).toBe(true);

    expect(isSyncTombstoneEntry({ kind: 'tag', entityId: 'x', deletedAt: 1 })).toBe(false);
    expect(isSyncTombstoneEntry({ kind: 'item', entityId: '', deletedAt: 1 })).toBe(false);
    expect(isSyncTombstoneEntry({ kind: 'item', entityId: 'x', deletedAt: Number.NaN })).toBe(false);
    expect(isSyncTombstoneEntry({ kind: 'item', entityId: 'x', deletedAt: '1' })).toBe(false);
    expect(isSyncTombstoneEntry('tombstone')).toBe(false);
    expect(isSyncTombstoneEntry(null)).toBe(false);
  });

  it('reminder：DataSnapshotReminder 合法 + 两时间戳通过；缺/坏时间戳拒绝', () => {
    expect(isSyncReminderEntry(makeReminderEntry('r1'))).toBe(true);

    const missingUpdatedAt = makeReminderBase('r2');
    expect(isSyncReminderEntry(missingUpdatedAt)).toBe(false);

    const badUpdatedAt = { ...makeReminderBase('r3'), createdAt: 1, updatedAt: 'x' };
    expect(isSyncReminderEntry(badUpdatedAt)).toBe(false);

    const nanCreatedAt = { ...makeReminderBase('r4'), createdAt: Number.NaN, updatedAt: 1 };
    expect(isSyncReminderEntry(nanCreatedAt)).toBe(false);

    const brokenBase = { ...makeReminderBase('r5'), createdAt: 1, updatedAt: 2, frequency: 'hourly' };
    expect(isSyncReminderEntry(brokenBase)).toBe(false);
  });
});

describe('serialize / parse（快照文件读写）', () => {
  it('serialize → parse 往返恒等（深比较）', () => {
    const snapshot = makeSnapshot();
    const restored = parseSyncSnapshot(serializeSyncSnapshot(snapshot));
    expect(restored).toEqual(snapshot);
  });

  it('serialize 无缩进（体积优先，切片 31 同口径）', () => {
    const text = serializeSyncSnapshot(makeSnapshot());
    expect(text).not.toContain('\n');
    expect(text.startsWith('{')).toBe(true);
  });

  it('非法 JSON 抛 SyncSnapshotParseError（消息「同步快照文件不是合法 JSON」）', () => {
    expect(() => parseSyncSnapshot('not json {')).toThrow(SyncSnapshotParseError);
    expect(() => parseSyncSnapshot('not json {')).toThrow('同步快照文件不是合法 JSON');
  });

  it('JSON 合法但守卫不过抛 SyncSnapshotParseError（格式消息）', () => {
    const broken = JSON.stringify({ version: 1, kind: 'sync', deviceId: 'x' });
    expect(() => parseSyncSnapshot(broken)).toThrow(SyncSnapshotParseError);
    expect(() => parseSyncSnapshot(broken)).toThrow('同步快照格式不符合要求');
  });

  it('kind:"config" / kind:"data" 整包拒绝（互不相认）', () => {
    const configLike = JSON.stringify({ ...makeSnapshot(), kind: 'config' });
    expect(() => parseSyncSnapshot(configLike)).toThrow(SyncSnapshotParseError);

    const dataLike = JSON.stringify({ ...makeSnapshot(), kind: 'data' });
    expect(() => parseSyncSnapshot(dataLike)).toThrow(SyncSnapshotParseError);
  });
});

describe('文件名（固定名覆盖写，非滚动保留）', () => {
  it('SYNC_SNAPSHOT_FILE_PATTERN 与提案原文一致：匹配 v4 形状、拒绝 kind 前缀混淆', () => {
    expect(SYNC_SNAPSHOT_FILE_PATTERN.test('life-sync-11111111-2222-4333-8444-555555555555.json')).toBe(true);
    expect(SYNC_SNAPSHOT_FILE_PATTERN.test('life-config-20261122-150000.json')).toBe(false);
    expect(SYNC_SNAPSHOT_FILE_PATTERN.test('life-data-20261122-150000.json')).toBe(false);
    expect(SYNC_SNAPSHOT_FILE_PATTERN.test('life-sync-not-a-uuid.json')).toBe(false);
    expect(SYNC_SNAPSHOT_FILE_PATTERN.test('life-sync-11111111-2222-4333-8444-555555555555.json.bak')).toBe(false);
  });

  it('isSyncSnapshotFileName / syncSnapshotFileName / deviceIdFromSyncFileName 往返', () => {
    const fileName = syncSnapshotFileName(DEVICE_A);
    expect(fileName).toBe('life-sync-11111111-2222-4333-8444-555555555555.json');
    expect(isSyncSnapshotFileName(fileName)).toBe(true);
    expect(deviceIdFromSyncFileName(fileName)).toBe(DEVICE_A);
    expect(deviceIdFromSyncFileName('life-config-20261122-150000.json')).toBeNull();
  });
});
