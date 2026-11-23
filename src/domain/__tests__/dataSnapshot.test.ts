/**
 * dataSnapshot 纯函数单测（切片 31 阶段 1，AGENTS.md §7.43 D1/D6）：
 * 整包守卫 / 条目有效性谓词 / 序列化与解析 / 文件名 / exportedAt / 组包映射。
 * configSnapshot.test.ts（切片 28）同构蓝本。
 */

import {
  DATA_SNAPSHOT_FILE_PATTERN,
  DataSnapshotParseError,
  dataSnapshotExportedAt,
  dataSnapshotFileName,
  isDataSnapshotChannelPresetEntry,
  isDataSnapshotFileName,
  isDataSnapshotItemEntry,
  isDataSnapshotItemTagEntry,
  isDataSnapshotReminderEntry,
  isDataSnapshotTagEntry,
  isDataSnapshotWire,
  parseDataSnapshot,
  serializeDataSnapshot,
  isDataSnapshotSparkAttachmentEntry,
  isDataSnapshotSparkEntry,
  isDataSnapshotSparkItemEntry,
  toDataSnapshotChannelPreset,
  toDataSnapshotItem,
  toDataSnapshotReminder,
  toDataSnapshotSpark,
  toDataSnapshotSparkAttachment,
  toDataSnapshotSparkItem,
  toDataSnapshotTag,
  type DataSnapshot,
} from '../dataSnapshot';
import type { Spark, SparkAttachment, SparkItemLink } from '../spark';
import type { Item } from '../item';
import type { Reminder } from '../reminder';
import type { ChannelPreset } from '../channelPreset';
import { formatExportedAt } from '../configSnapshot';

function makeItem(): Item {
  return {
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
  };
}

function makeReminder(): Reminder {
  return {
    id: 'reminder-1',
    itemId: 'item-1',
    frequency: 'weekly',
    localTimeHour: 8,
    localTimeMinute: 30,
    weekdays: [1, 5],
    dayOfMonth: 0,
    tzid: 'Asia/Shanghai',
    startAt: 1700000000000,
    enabled: true,
    onceAt: null,
    channels: ['system-notification'],
    channelConfigs: {},
    lastFiredOccurrenceKey: null,
    lastReconciledAt: null,
    createdAt: 1699999999000,
    updatedAt: 1700000001000,
  };
}

function makePreset(): ChannelPreset {
  return {
    id: 'preset-1',
    name: 'Zulip 主站',
    type: 'webhook',
    configJson: '{"url":"https://zulip.example","mode":"form"}',
    isDefault: true,
    createdAt: 1699999999000,
  };
}

function makeSnapshot(): DataSnapshot {
  return {
    version: 1,
    kind: 'data',
    exportedAt: '2026-11-18T09:30:00.000+08:00',
    items: [toDataSnapshotItem(makeItem())],
    tags: [{ id: 'tag-1', name: '灵感', color: '#00ff00', emoji: '💡' }],
    reminders: [toDataSnapshotReminder(makeReminder())],
    channelPresets: [toDataSnapshotChannelPreset(makePreset())],
    itemTags: [{ itemId: 'item-1', tagId: 'tag-1' }],
  };
}

describe('isDataSnapshotWire（整包守卫，§7.43 D1）', () => {
  it('合法快照通过', () => {
    expect(isDataSnapshotWire(makeSnapshot())).toBe(true);
  });

  it('拒绝：非对象 / version≠1 / kind 不符 / exportedAt 空 / 五块任一非数组', () => {
    expect(isDataSnapshotWire(null)).toBe(false);
    expect(isDataSnapshotWire('data')).toBe(false);
    expect(isDataSnapshotWire([])).toBe(false);
    const base = makeSnapshot();
    expect(isDataSnapshotWire({ ...base, version: 2 })).toBe(false);
    expect(isDataSnapshotWire({ ...base, kind: 'config' })).toBe(false);
    expect(isDataSnapshotWire({ ...base, kind: undefined })).toBe(false);
    expect(isDataSnapshotWire({ ...base, exportedAt: '' })).toBe(false);
    expect(isDataSnapshotWire({ ...base, items: 'nope' })).toBe(false);
    expect(isDataSnapshotWire({ ...base, tags: null })).toBe(false);
    expect(isDataSnapshotWire({ ...base, reminders: {} })).toBe(false);
    expect(isDataSnapshotWire({ ...base, channelPresets: 0 })).toBe(false);
    expect(isDataSnapshotWire({ ...base, itemTags: true })).toBe(false);
  });

  it('条目形状不在整包守卫内（宽容策略：跳过+计数在 applyDataSnapshot）', () => {
    const snapshot = makeSnapshot();
    const broken = {
      ...snapshot,
      items: ['garbage'],
      tags: [{ id: '' }],
      reminders: [{ id: 3 }],
      channelPresets: [{ id: null }],
      itemTags: [{ itemId: '' }],
    };
    expect(isDataSnapshotWire(broken)).toBe(true);
  });

  it('与配置快照（kind:config）互不相认', () => {
    const config = { ...makeSnapshot(), kind: 'config' };
    expect(isDataSnapshotWire(config)).toBe(false);
  });
});

describe('条目有效性谓词（repository.md v0.35 计数口径）', () => {
  it('item：枚举成员 / title trim 非空 / 时间戳有限 / priority 范围', () => {
    const entry = toDataSnapshotItem(makeItem());
    expect(isDataSnapshotItemEntry(entry)).toBe(true);

    expect(isDataSnapshotItemEntry({ ...entry, type: 'memo' })).toBe(false);
    expect(isDataSnapshotItemEntry({ ...entry, status: 'deleted' })).toBe(false);
    expect(isDataSnapshotItemEntry({ ...entry, sourceType: 'gdrive' })).toBe(false);
    expect(isDataSnapshotItemEntry({ ...entry, title: '   ' })).toBe(false);
    expect(isDataSnapshotItemEntry({ ...entry, content: 5 })).toBe(false);
    expect(isDataSnapshotItemEntry({ ...entry, startAt: Number.NaN })).toBe(false);
    expect(isDataSnapshotItemEntry({ ...entry, endAt: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isDataSnapshotItemEntry({ ...entry, allDay: 'yes' })).toBe(false);
    expect(isDataSnapshotItemEntry({ ...entry, sourceUid: 7 })).toBe(false);
    expect(isDataSnapshotItemEntry({ ...entry, categoryId: '' })).toBe(false);
    expect(isDataSnapshotItemEntry({ ...entry, priority: 4 })).toBe(false);
    expect(isDataSnapshotItemEntry({ ...entry, priority: -1 })).toBe(false);
    expect(isDataSnapshotItemEntry({ ...entry, priority: 2.5 })).toBe(false);
    expect(isDataSnapshotItemEntry({ ...entry, createdAt: Number.NaN })).toBe(false);
    expect(isDataSnapshotItemEntry({ ...entry, updatedAt: null })).toBe(false);
    expect(isDataSnapshotItemEntry({ ...entry, id: '' })).toBe(false);
    expect(isDataSnapshotItemEntry(null)).toBe(false);
    // 合法边界：priority 0–3、时间戳可 null。
    expect(isDataSnapshotItemEntry({ ...entry, priority: 0 })).toBe(true);
    expect(isDataSnapshotItemEntry({ ...entry, priority: 3 })).toBe(true);
    expect(isDataSnapshotItemEntry({ ...entry, startAt: null, endAt: null })).toBe(true);
  });

  it('tag：id 非空 + name trim 非空 + color/emoji string|null', () => {
    expect(isDataSnapshotTagEntry({ id: 't1', name: '灵感', color: null, emoji: null })).toBe(true);
    expect(isDataSnapshotTagEntry({ id: 't1', name: '  x  ', color: '#fff', emoji: 'e' })).toBe(
      true,
    );
    expect(isDataSnapshotTagEntry({ id: '', name: 'x', color: null, emoji: null })).toBe(false);
    expect(isDataSnapshotTagEntry({ id: 't1', name: '   ', color: null, emoji: null })).toBe(false);
    expect(isDataSnapshotTagEntry({ id: 't1', name: 3, color: null, emoji: null })).toBe(false);
    expect(isDataSnapshotTagEntry({ id: 't1', name: 'x', color: 1, emoji: null })).toBe(false);
    expect(isDataSnapshotTagEntry({ id: 't1', name: 'x', color: null, emoji: {} })).toBe(false);
    expect(isDataSnapshotTagEntry('tag')).toBe(false);
  });

  it('reminder：原始形状面（JSON 列内容/白名单在仓库层深层校验）', () => {
    const entry = toDataSnapshotReminder(makeReminder());
    expect(isDataSnapshotReminderEntry(entry)).toBe(true);

    expect(isDataSnapshotReminderEntry({ ...entry, frequency: 'hourly' })).toBe(false);
    expect(isDataSnapshotReminderEntry({ ...entry, localTimeHour: 24 })).toBe(false);
    expect(isDataSnapshotReminderEntry({ ...entry, localTimeHour: -1 })).toBe(false);
    expect(isDataSnapshotReminderEntry({ ...entry, localTimeMinute: 60 })).toBe(false);
    expect(isDataSnapshotReminderEntry({ ...entry, localTimeMinute: 1.5 })).toBe(false);
    expect(isDataSnapshotReminderEntry({ ...entry, dayOfMonth: 32 })).toBe(false);
    expect(isDataSnapshotReminderEntry({ ...entry, dayOfMonth: 31 })).toBe(true);
    expect(isDataSnapshotReminderEntry({ ...entry, weekdaysJson: null })).toBe(false);
    expect(isDataSnapshotReminderEntry({ ...entry, tzid: '' })).toBe(false);
    expect(isDataSnapshotReminderEntry({ ...entry, startAt: Number.NaN })).toBe(false);
    expect(isDataSnapshotReminderEntry({ ...entry, enabled: 1 })).toBe(false);
    expect(isDataSnapshotReminderEntry({ ...entry, channelsJson: ['a'] })).toBe(false);
    expect(isDataSnapshotReminderEntry({ ...entry, onceCivilJson: 0 })).toBe(false);
    expect(isDataSnapshotReminderEntry({ ...entry, channelConfigsJson: 9 })).toBe(false);
    expect(isDataSnapshotReminderEntry({ ...entry, itemId: '' })).toBe(false);
    expect(isDataSnapshotReminderEntry(null)).toBe(false);
    // 合法边界：once 形状（onceCivilJson 串、channelsJson 串）。
    expect(
      isDataSnapshotReminderEntry({
        ...entry,
        frequency: 'once',
        weekdaysJson: '',
        dayOfMonth: 0,
        onceCivilJson: '{"year":2026,"month":12,"day":1,"hour":8,"minute":0}',
      }),
    ).toBe(true);
  });

  it('channelPreset：id 非空 + name trim 非空 + type 枚举 + configJson 串 + isDefault boolean', () => {
    const entry = toDataSnapshotChannelPreset(makePreset());
    expect(isDataSnapshotChannelPresetEntry(entry)).toBe(true);
    expect(isDataSnapshotChannelPresetEntry({ ...entry, type: 'slack' })).toBe(false);
    expect(isDataSnapshotChannelPresetEntry({ ...entry, name: '  ' })).toBe(false);
    expect(isDataSnapshotChannelPresetEntry({ ...entry, configJson: 1 })).toBe(false);
    expect(isDataSnapshotChannelPresetEntry({ ...entry, isDefault: 'yes' })).toBe(false);
    expect(isDataSnapshotChannelPresetEntry({ ...entry, id: '' })).toBe(false);
    expect(isDataSnapshotChannelPresetEntry([])).toBe(false);
    expect(isDataSnapshotChannelPresetEntry({ ...entry, type: 'apprise' })).toBe(true);
  });

  it('itemTag：itemId/tagId 非空串', () => {
    expect(isDataSnapshotItemTagEntry({ itemId: 'i1', tagId: 't1' })).toBe(true);
    expect(isDataSnapshotItemTagEntry({ itemId: '', tagId: 't1' })).toBe(false);
    expect(isDataSnapshotItemTagEntry({ itemId: 'i1', tagId: null })).toBe(false);
    expect(isDataSnapshotItemTagEntry({ itemId: 'i1' })).toBe(false);
    expect(isDataSnapshotItemTagEntry('join')).toBe(false);
  });
});

describe('serialize / parse（快照文件读写）', () => {
  it('序列化 → 解析 roundtrip 相等（含守卫通过）', () => {
    const snapshot = makeSnapshot();
    const roundtripped = parseDataSnapshot(serializeDataSnapshot(snapshot));
    expect(roundtripped).toEqual(snapshot);
    expect(isDataSnapshotWire(roundtripped)).toBe(true);
  });

  it('序列化无缩进（提案 §7 体积优先：与配置快照 2 空格刻意不同）', () => {
    const text = serializeDataSnapshot(makeSnapshot());
    expect(text).not.toContain('\n  ');
    expect(text.startsWith('{"version":1,"kind":"data"')).toBe(true);
  });

  it('条目级垃圾形状原样 roundtrip（宽容策略在仓库层落地）', () => {
    const snapshot = makeSnapshot();
    const broken: DataSnapshot = {
      ...snapshot,
      items: ['garbage' as unknown as DataSnapshot['items'][number]],
      tags: [{ id: '' } as unknown as DataSnapshot['tags'][number]],
    };
    const roundtripped = parseDataSnapshot(serializeDataSnapshot(broken));
    expect(roundtripped.items).toEqual(['garbage']);
    expect(roundtripped.tags).toEqual([{ id: '' }]);
  });

  it('非法 JSON 抛 DataSnapshotParseError（中文 message 面向用户）', () => {
    expect(() => parseDataSnapshot('not json {')).toThrow(DataSnapshotParseError);
    expect(() => parseDataSnapshot('not json {')).toThrow('快照文件不是合法 JSON');
  });

  it('整包守卫不过抛 DataSnapshotParseError', () => {
    expect(() => parseDataSnapshot('{"version":1,"kind":"config"}')).toThrow(
      DataSnapshotParseError,
    );
    expect(() => parseDataSnapshot('{"version":1,"kind":"config"}')).toThrow(
      '快照格式不符合要求',
    );
    expect(() => parseDataSnapshot('{}')).toThrow(DataSnapshotParseError);
  });
});

describe('文件名与 exportedAt（§7.43 D6 / 提案 §4.1）', () => {
  it('dataSnapshotFileName：本地时区 life-data-YYYYMMDD-HHmmss.json', () => {
    expect(dataSnapshotFileName(new Date(2026, 10, 18, 9, 5, 3))).toBe(
      'life-data-20261118-090503.json',
    );
    expect(dataSnapshotFileName(new Date(2026, 0, 2, 23, 59, 59))).toBe(
      'life-data-20260102-235959.json',
    );
  });

  it('isDataSnapshotFileName：仅匹配数据快照文件名模式', () => {
    expect(isDataSnapshotFileName('life-data-20261118-090503.json')).toBe(true);
    expect(isDataSnapshotFileName('life-config-20261118-090503.json')).toBe(false);
    expect(isDataSnapshotFileName('life-data-2026118-090503.json')).toBe(false);
    expect(isDataSnapshotFileName('life-data-20261118-09050.txt')).toBe(false);
    expect(isDataSnapshotFileName('x-life-data-20261118-090503.json')).toBe(false);
    expect(DATA_SNAPSHOT_FILE_PATTERN.test('life-data-20261118-090503.json')).toBe(true);
  });

  it('dataSnapshotExportedAt：formatExportedAt 转发（单一实现）', () => {
    const date = new Date(2026, 10, 18, 9, 30, 0);
    expect(dataSnapshotExportedAt(date)).toBe(formatExportedAt(date));
    expect(Number.isNaN(Date.parse(dataSnapshotExportedAt(date)))).toBe(false);
  });
});

describe('组包映射（领域对象 → 快照条目）', () => {
  it('toDataSnapshotItem：全字段投影（id/时间戳保真）', () => {
    const item = makeItem();
    expect(toDataSnapshotItem(item)).toEqual({
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
    });
  });

  it('toDataSnapshotReminder：v10 语义列序列化（调度态两列不投影）', () => {
    const entry = toDataSnapshotReminder(makeReminder());
    expect(entry.weekdaysJson).toBe('[1,5]');
    expect(entry.channelsJson).toBe('["system-notification"]');
    expect(entry.channelConfigsJson).toBeNull(); // 空字典 → null（serializeReminderChannelConfigs 同构）。
    expect(entry.onceCivilJson).toBeNull();
    expect('lastFiredOccurrenceKey' in entry).toBe(false);
    expect('lastReconciledAt' in entry).toBe(false);
    expect('channel' in entry).toBe(false);
    expect('channelConfig' in entry).toBe(false);
    // once 形状。
    const once = toDataSnapshotReminder({
      ...makeReminder(),
      frequency: 'once',
      weekdays: [],
      dayOfMonth: 0,
      onceAt: { year: 2026, month: 12, day: 1, hour: 8, minute: 0 },
      channels: ['webhook', 'alarm'],
      channelConfigs: { webhook: 'https://x.example' },
    });
    expect(once.weekdaysJson).toBe('[]');
    expect(once.dayOfMonth).toBe(0);
    expect(once.onceCivilJson).toBe('{"year":2026,"month":12,"day":1,"hour":8,"minute":0}');
    expect(once.channelsJson).toBe('["webhook","alarm"]'); // 纯映射透传（归一在写路径）。
    expect(once.channelConfigsJson).toBe('{"webhook":"https://x.example"}');
  });

  it('toDataSnapshotChannelPreset / toDataSnapshotTag：createdAt 剥离', () => {
    expect(toDataSnapshotChannelPreset(makePreset())).toEqual({
      id: 'preset-1',
      name: 'Zulip 主站',
      type: 'webhook',
      configJson: '{"url":"https://zulip.example","mode":"form"}',
      isDefault: true,
    });
    expect(
      toDataSnapshotTag({ id: 'tag-1', name: '灵感', color: '#00ff00', emoji: '💡' }),
    ).toEqual({ id: 'tag-1', name: '灵感', color: '#00ff00', emoji: '💡' });
  });
});

describe('Spark 可选三块（切片 37 §7.49 D5）：条目有效性谓词', () => {
  function makeSpark(): Spark {
    return { id: 'spark-1', title: null, content: '一条灵感', createdAt: 1699999999000, updatedAt: 1700000001000 };
  }
  function makeAttachment(): SparkAttachment {
    return {
      id: 'att-1', sparkId: 'spark-1', kind: 'audio', uri: '/sparks/a.m4a',
      remotePath: 'abc123def4567890-rec.m4a', sha256: 'abc123def4567890', fileSize: 1024,
      durationMs: 3000, width: null, height: null, createdAt: 1699999999000,
    };
  }
  function makeLink(): SparkItemLink & { id: string } {
    return { id: 'link-1', sparkId: 'spark-1', itemId: 'item-1', createdAt: 1699999999000 };
  }
  it('spark：id 非空 + title/content string|null + 时间戳有限', () => {
    expect(isDataSnapshotSparkEntry(toDataSnapshotSpark(makeSpark()))).toBe(true);
    expect(isDataSnapshotSparkEntry({ id: '', title: null, content: null, createdAt: 1, updatedAt: 1 })).toBe(false);
    expect(isDataSnapshotSparkEntry({ id: 's', title: 1, content: null, createdAt: 1, updatedAt: 1 })).toBe(false);
    expect(isDataSnapshotSparkEntry({ id: 's', title: null, content: null, createdAt: 'x', updatedAt: 1 })).toBe(false);
    expect(isDataSnapshotSparkEntry(null)).toBe(false);
  });
  it('sparkAttachment：kind 枚举 + uri 非空 + fileSize 有限 + 可空维度字段', () => {
    expect(isDataSnapshotSparkAttachmentEntry(toDataSnapshotSparkAttachment(makeAttachment()))).toBe(true);
    const badKind = { ...makeAttachment(), kind: 'video' };
    expect(isDataSnapshotSparkAttachmentEntry(badKind)).toBe(false);
    expect(isDataSnapshotSparkAttachmentEntry({ ...makeAttachment(), uri: '' })).toBe(false);
    expect(isDataSnapshotSparkAttachmentEntry({ ...makeAttachment(), fileSize: 'x' })).toBe(false);
    expect(isDataSnapshotSparkAttachmentEntry({ ...makeAttachment(), durationMs: null, width: 100, height: 50 })).toBe(true);
    expect(isDataSnapshotSparkAttachmentEntry({ ...makeAttachment(), remotePath: null, sha256: null })).toBe(true);
  });
  it('sparkItem：id/sparkId/itemId 非空串 + createdAt 有限', () => {
    expect(isDataSnapshotSparkItemEntry(toDataSnapshotSparkItem(makeLink()))).toBe(true);
    expect(isDataSnapshotSparkItemEntry({ id: 'l', sparkId: 's', itemId: '', createdAt: 1 })).toBe(false);
    expect(isDataSnapshotSparkItemEntry({ id: 'l', sparkId: 's', itemId: 'i', createdAt: null })).toBe(false);
  });
});

describe('Spark 可选三块：组包映射（领域对象 → 快照条目）', () => {
  it('toDataSnapshotSpark：双可空投影 + 时间戳保真', () => {
    const spark: Spark = { id: 's1', title: '标题', content: null, createdAt: 111, updatedAt: 222 };
    expect(toDataSnapshotSpark(spark)).toEqual({ id: 's1', title: '标题', content: null, createdAt: 111, updatedAt: 222 });
  });
  it('toDataSnapshotSparkAttachment：全字段投影（remotePath/sha256 保真）', () => {
    const att: SparkAttachment = {
      id: 'a1', sparkId: 's1', kind: 'image', uri: '/sparks/a.jpg', remotePath: null, sha256: null,
      fileSize: 2048, durationMs: null, width: 800, height: 600, createdAt: 333,
    };
    expect(toDataSnapshotSparkAttachment(att)).toEqual(att);
  });
  it('toDataSnapshotSparkItem：id + sparkId/itemId + createdAt 投影', () => {
    expect(toDataSnapshotSparkItem({ id: 'l1', sparkId: 's1', itemId: 'i1', createdAt: 444 })).toEqual({
      id: 'l1', sparkId: 's1', itemId: 'i1', createdAt: 444,
    });
  });
});
