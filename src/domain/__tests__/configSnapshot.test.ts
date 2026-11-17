/**
 * configSnapshot 纯函数单测（切片 28 阶段 1，AGENTS.md §7.42 D1）：
 * 整包守卫 / 条目有效性 / 序列化与解析 / 文件名 / exportedAt / appSettings
 * 增量覆盖归一（缺列保留本地、坏值回退默认、合法写穿）。
 */

import {
  CONFIG_SNAPSHOT_FILE_PATTERN,
  ConfigSnapshotParseError,
  configSnapshotFileName,
  formatExportedAt,
  isConfigSnapshotCategoryEntry,
  isConfigSnapshotFileName,
  isConfigSnapshotTagEntry,
  isConfigSnapshotWire,
  normalizeSnapshotAppSettings,
  parseConfigSnapshot,
  serializeConfigSnapshot,
  type ConfigSnapshot,
} from '../configSnapshot';
import { DEFAULT_APP_SETTINGS, parseDefaultChannels, type AppSettings } from '../settings';

function makeLocalSettings(): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    chipsIncrements: [15, 30],
    carefulMode: true,
    aiRetryMax: 5,
    tagDisplayMode: 'both',
  };
}

function makeSnapshot(): ConfigSnapshot {
  return {
    version: 1,
    kind: 'config',
    exportedAt: '2026-11-18T09:30:00.000+08:00',
    appSettings: { ...DEFAULT_APP_SETTINGS, showAiUsage: true },
    categories: [
      { id: 'work', name: '工作', color: '#ff0000', emoji: '💼', priority: 1 },
      { id: 'personal', name: '个人', color: null, emoji: null, priority: 2 },
    ],
    tags: [{ name: '灵感', color: '#00ff00', emoji: '💡' }],
  };
}

describe('isConfigSnapshotWire（整包守卫，§7.42 D1）', () => {
  it('合法快照通过', () => {
    expect(isConfigSnapshotWire(makeSnapshot())).toBe(true);
  });

  it('拒绝：非对象 / version≠1 / kind 不符 / exportedAt 空 / appSettings 缺 / categories·tags 非数组', () => {
    expect(isConfigSnapshotWire(null)).toBe(false);
    expect(isConfigSnapshotWire([])).toBe(false);
    expect(isConfigSnapshotWire('x')).toBe(false);
    expect(isConfigSnapshotWire({ ...makeSnapshot(), version: 2 })).toBe(false);
    expect(isConfigSnapshotWire({ ...makeSnapshot(), kind: 'data' })).toBe(false);
    expect(isConfigSnapshotWire({ ...makeSnapshot(), exportedAt: '' })).toBe(false);
    const { appSettings: _omitted, ...withoutSettings } = makeSnapshot();
    expect(isConfigSnapshotWire(withoutSettings)).toBe(false);
    expect(isConfigSnapshotWire({ ...makeSnapshot(), appSettings: [] })).toBe(false);
    expect(isConfigSnapshotWire({ ...makeSnapshot(), categories: {} })).toBe(false);
    expect(isConfigSnapshotWire({ ...makeSnapshot(), tags: null })).toBe(false);
  });

  it('条目形状不在整包守卫内（宽容策略：跳过+计数在 applyConfigSnapshot）', () => {
    const snapshot = makeSnapshot();
    expect(
      isConfigSnapshotWire({
        ...snapshot,
        categories: ['garbage', 42],
        tags: [null],
      }),
    ).toBe(true);
  });
});

describe('条目有效性谓词（repository.md v0.34 计数口径）', () => {
  it('category：id 非空串 + color/emoji string|null + priority 有限数', () => {
    expect(
      isConfigSnapshotCategoryEntry({ id: 'work', color: null, emoji: null, priority: 0 }),
    ).toBe(true);
    expect(
      isConfigSnapshotCategoryEntry({ id: 'work', color: '#fff', emoji: '💡', priority: -3 }),
    ).toBe(true);
    expect(
      isConfigSnapshotCategoryEntry({ id: '', color: null, emoji: null, priority: 1 }),
    ).toBe(false);
    expect(
      isConfigSnapshotCategoryEntry({ id: 'work', color: undefined, emoji: null, priority: 1 }),
    ).toBe(false);
    expect(
      isConfigSnapshotCategoryEntry({ id: 'work', color: null, emoji: 42, priority: 1 }),
    ).toBe(false);
    expect(
      isConfigSnapshotCategoryEntry({ id: 'work', color: null, emoji: null, priority: 'x' }),
    ).toBe(false);
    expect(
      isConfigSnapshotCategoryEntry({ id: 'work', color: null, emoji: null, priority: NaN }),
    ).toBe(false);
    expect(isConfigSnapshotCategoryEntry('garbage')).toBe(false);
  });

  it('tag：name trim 非空 + color/emoji string|null', () => {
    expect(isConfigSnapshotTagEntry({ name: '灵感', color: '#fff', emoji: null })).toBe(true);
    expect(isConfigSnapshotTagEntry({ name: ' 灵感 ', color: null, emoji: null })).toBe(true);
    expect(isConfigSnapshotTagEntry({ name: '   ', color: null, emoji: null })).toBe(false);
    expect(isConfigSnapshotTagEntry({ name: 42, color: null, emoji: null })).toBe(false);
    expect(isConfigSnapshotTagEntry({ name: 'x', color: undefined, emoji: null })).toBe(false);
    expect(isConfigSnapshotTagEntry({ name: 'x', color: null, emoji: true })).toBe(false);
    expect(isConfigSnapshotTagEntry(null)).toBe(false);
  });
});

describe('serialize / parse（快照文件读写）', () => {
  it('序列化 → 解析 roundtrip 保留全部字段（含条目级垃圾形状）', () => {
    const snapshot = makeSnapshot();
    const roundtripped = parseConfigSnapshot(serializeConfigSnapshot(snapshot));
    expect(roundtripped).toEqual(snapshot);
    expect(roundtripped.appSettings).toEqual(snapshot.appSettings);
    expect(roundtripped.categories).toEqual(snapshot.categories);
    expect(roundtripped.tags).toEqual(snapshot.tags);
  });

  it('非法 JSON 抛 ConfigSnapshotParseError（中文 message 面向用户）', () => {
    expect(() => parseConfigSnapshot('not json{')).toThrow(ConfigSnapshotParseError);
    expect(() => parseConfigSnapshot('not json{')).toThrow('快照文件不是合法 JSON');
  });

  it('整包守卫不过抛 ConfigSnapshotParseError', () => {
    const bad = JSON.stringify({ version: 2, kind: 'config' });
    expect(() => parseConfigSnapshot(bad)).toThrow(ConfigSnapshotParseError);
    expect(() => parseConfigSnapshot(bad)).toThrow(
      '快照格式不符合要求（version/kind/appSettings/categories/tags）',
    );
  });
});

describe('文件名与 exportedAt（§7.42 D5 / 提案 §4.1）', () => {
  it('configSnapshotFileName：本地时区 life-config-YYYYMMDD-HHmmss.json', () => {
    // 本地时区 Date 构造（分量恒定，与运行环境时区无关）。
    const date = new Date(2026, 10, 18, 9, 5, 3);
    const fileName = configSnapshotFileName(date);
    expect(fileName).toBe('life-config-20261118-090503.json');
    expect(CONFIG_SNAPSHOT_FILE_PATTERN.test(fileName)).toBe(true);
  });

  it('isConfigSnapshotFileName：仅匹配快照文件名模式', () => {
    expect(isConfigSnapshotFileName('life-config-20261118-090503.json')).toBe(true);
    expect(isConfigSnapshotFileName('life-config-20261118-090503.txt')).toBe(false);
    expect(isConfigSnapshotFileName('life-config-2026111-090503.json')).toBe(false);
    expect(isConfigSnapshotFileName('other.json')).toBe(false);
    expect(isConfigSnapshotFileName('life-config-20261118-090503.json.bak')).toBe(false);
  });

  it('formatExportedAt：本地时区 ISO 8601 含偏移，Date.parse roundtrip 同一瞬间', () => {
    const date = new Date('2026-11-18T09:30:00.567+08:00');
    const formatted = formatExportedAt(date);
    expect(formatted).toMatch(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})([+-]\d{2}:\d{2})$/,
    );
    // 本地分量 + 偏移 → 与原始瞬间一致（时区无关断言）。
    expect(Date.parse(formatted)).toBe(date.getTime());
    expect(Date.parse(formatExportedAt(new Date(0)))).toBe(0);
  });
});

describe('normalizeSnapshotAppSettings（增量覆盖冻结语义逐字段，提案 §4.1）', () => {
  it('字段存在且合法 → 快照值写穿（全 12 字段）', () => {
    const local = makeLocalSettings();
    const normalized = normalizeSnapshotAppSettings(
      {
        tagDisplayMode: 'emoji',
        widgetShowOverdue: false,
        widgetShowTodos: true,
        widgetShowCategoryEmoji: true,
        widgetShowTags: true,
        chipsIncrements: [5, 10],
        defaultChannels: ['alarm'],
        carefulMode: false,
        showAiUsage: true,
        displayCalendarIds: ['cal-1', 'cal-2'],
        aiRetryMax: 1,
        flashDeletedCardDisplay: 'remove',
      },
      local,
    );
    expect(normalized).toEqual({
      tagDisplayMode: 'emoji',
      widgetShowOverdue: false,
      widgetShowTodos: true,
      widgetShowCategoryEmoji: true,
      widgetShowTags: true,
      chipsIncrements: [5, 10],
      defaultChannels: ['alarm'],
      carefulMode: false,
      showAiUsage: true,
      displayCalendarIds: ['cal-1', 'cal-2'],
      aiRetryMax: 1,
      flashDeletedCardDisplay: 'remove',
    });
  });

  it('空对象（全缺列）→ 整块保留本地', () => {
    const local = makeLocalSettings();
    expect(normalizeSnapshotAppSettings({}, local)).toEqual(local);
  });

  it('部分缺列 → 缺列保留本地、存在列写穿', () => {
    const local = makeLocalSettings();
    const normalized = normalizeSnapshotAppSettings({ showAiUsage: true }, local);
    expect(normalized).toEqual({ ...local, showAiUsage: true });
  });

  it('坏值 → 走既有读层防御归一回退默认（不抛错）', () => {
    const local = makeLocalSettings();
    const normalized = normalizeSnapshotAppSettings(
      {
        tagDisplayMode: 42,
        widgetShowOverdue: 'yes',
        widgetShowTodos: null,
        widgetShowCategoryEmoji: 0,
        widgetShowTags: {},
        chipsIncrements: [99999999, 'x', 0],
        defaultChannels: '["expo"]',
        carefulMode: 'on',
        showAiUsage: 'off',
        displayCalendarIds: 'garbage',
        aiRetryMax: 9,
        flashDeletedCardDisplay: 'x',
      },
      local,
    );
    expect(normalized).toEqual({
      ...DEFAULT_APP_SETTINGS,
      // 本地缺列语义不适用（字段均存在但坏值）→ 全部回退默认。
      carefulMode: DEFAULT_APP_SETTINGS.carefulMode,
    });
    expect(normalized.chipsIncrements).toEqual([10, 60]);
    expect(normalized.defaultChannels).toEqual(parseDefaultChannels(null));
    expect(normalized.displayCalendarIds).toEqual([]);
    expect(normalized.aiRetryMax).toBe(3);
    expect(normalized.flashDeletedCardDisplay).toBe('mark');
  });

  it('null 值 → 回退默认（null ≠ undefined 缺列）', () => {
    const local = makeLocalSettings();
    const normalized = normalizeSnapshotAppSettings(
      {
        chipsIncrements: null,
        defaultChannels: null,
        displayCalendarIds: null,
        aiRetryMax: null,
        flashDeletedCardDisplay: null,
        tagDisplayMode: null,
      },
      local,
    );
    expect(normalized.chipsIncrements).toEqual([10, 60]);
    expect(normalized.defaultChannels).toEqual(parseDefaultChannels(null));
    expect(normalized.displayCalendarIds).toEqual([]);
    expect(normalized.aiRetryMax).toBe(3);
    expect(normalized.flashDeletedCardDisplay).toBe('mark');
    expect(normalized.tagDisplayMode).toBe('text');
    // 未提及的列保留本地。
    expect(normalized.carefulMode).toBe(true);
  });

  it('JSON 列宽容接受字符串形态或值形态（旧手写快照两种写法）', () => {
    const local = makeLocalSettings();
    const byString = normalizeSnapshotAppSettings(
      { chipsIncrements: '[20,40]', displayCalendarIds: '["cal-9"]', defaultChannels: '["alarm"]' },
      local,
    );
    expect(byString.chipsIncrements).toEqual([20, 40]);
    expect(byString.displayCalendarIds).toEqual(['cal-9']);
    expect(byString.defaultChannels).toEqual(['alarm']);
    const byValue = normalizeSnapshotAppSettings(
      { chipsIncrements: [20, 40], displayCalendarIds: ['cal-2'] },
      local,
    );
    expect(byValue.chipsIncrements).toEqual([20, 40]);
    expect(byValue.displayCalendarIds).toEqual(['cal-2']);
  });

  it('raw 非 record → 整块保留 local（守卫已保证对象，兜底）', () => {
    const local = makeLocalSettings();
    expect(normalizeSnapshotAppSettings(null, local)).toEqual(local);
    expect(normalizeSnapshotAppSettings([1, 2], local)).toEqual(local);
  });
});
