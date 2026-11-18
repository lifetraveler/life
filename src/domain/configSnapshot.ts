/**
 * 切片 28 阶段 1（AGENTS.md §7.42）：配置备份快照的领域类型、守卫与序列化。
 *
 * 快照格式（§7.42 D1 冻结）：{version:1, kind:'config', exportedAt, appSettings,
 * categories, tags}。整包守卫 isConfigSnapshotWire 不过 = 整包拒绝；条目级
 * 宽容（形状不符跳过 + 计数披露）在 Repository.applyConfigSnapshot 落地。
 * 快照不含 WebDAV 连接配置与 AI Provider 配置（自引用防护 + 凭据面隔离，
 * 提案 §4.3）。
 */

import {
  DEFAULT_AI_RETRY_MAX,
  DEFAULT_APP_SETTINGS,
  isFlashDeletedCardDisplay,
  isTagDisplayMode,
  parseAiRetryMax,
  parseChipsIncrements,
  parseDefaultChannels,
  parseDisplayCalendarIds,
  type AppSettings,
} from './settings';

/** 快照内单条分类（§7.42 D1）。 */
export interface ConfigSnapshotCategoryEntry {
  id: string;
  name: string;
  color: string | null;
  emoji: string | null;
  priority: number;
}

/** 快照内单条标签（name 为原始名；恢复侧按 normalizeTagName 归一键匹配）。 */
export interface ConfigSnapshotTagEntry {
  name: string;
  color: string | null;
  emoji: string | null;
}

/** 配置快照（仅配置面：appSettings 全字段 + categories + tags，不含凭据面）。 */
export interface ConfigSnapshot {
  version: 1;
  kind: 'config';
  /** 本地时区 ISO 8601 含偏移，如 2026-11-18T09:30:00.000+08:00（提案 §4.1）。 */
  exportedAt: string;
  appSettings: AppSettings;
  categories: ConfigSnapshotCategoryEntry[];
  tags: ConfigSnapshotTagEntry[];
}

/** 恢复结果计数（repository.md v0.34：applied 含 appSettings 块计 1）。 */
export interface ConfigSnapshotApplyResult {
  /** 已应用条目数 = appSettings 块计 1 + 实际写入的 categories/tags 条目数。 */
  applied: number;
  /** 形状不符被跳过的 categories/tags 条目数（条目级宽容披露）。 */
  skipped: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 整包守卫（isParsedItemDraft / isRemoteDraftWire 同纪律：谓词收窄，不重建
 * 不 cast）：version===1、kind==='config'、exportedAt 非空串、appSettings 为
 * 对象、categories/tags 为数组。categories/tags 的条目形状不在此校验——条目级
 * 宽容跳过 + 计数在 applyConfigSnapshot 落地（条目有效性谓词见下方导出）。
 */
export function isConfigSnapshotWire(value: unknown): value is ConfigSnapshot {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (value.kind !== 'config') return false;
  if (typeof value.exportedAt !== 'string' || value.exportedAt.length === 0) return false;
  if (!isRecord(value.appSettings)) return false;
  if (!Array.isArray(value.categories)) return false;
  if (!Array.isArray(value.tags)) return false;
  return true;
}

/**
 * 条目有效性（repository.md v0.34 计数口径）：
 * - category：id 非空串 + color/emoji 是 string|null（undefined 即无效；null
 *   = 清空视觉，写穿）+ priority 有限数（name 不校验，不写穿）；
 * - tag：name 串 trim 非空 + color/emoji 是 string|null。
 */
export function isConfigSnapshotCategoryEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (value.color !== null && typeof value.color !== 'string') return false;
  if (value.emoji !== null && typeof value.emoji !== 'string') return false;
  if (typeof value.priority !== 'number' || !Number.isFinite(value.priority)) return false;
  return true;
}

export function isConfigSnapshotTagEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.name !== 'string' || value.name.trim().length === 0) return false;
  if (value.color !== null && typeof value.color !== 'string') return false;
  if (value.emoji !== null && typeof value.emoji !== 'string') return false;
  return true;
}

/** 快照 → 存储 JSON（2 空格缩进，与切片 12 数据导出可读性口径一致）。 */
export function serializeConfigSnapshot(snapshot: ConfigSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/** 快照解析失败（JSON 非法 / 整包守卫不过），message 面向用户中文。 */
export class ConfigSnapshotParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigSnapshotParseError';
  }
}

/** 下载的快照 JSON 文本 → ConfigSnapshot；非法 JSON / 守卫不过均抛 ConfigSnapshotParseError。 */
export function parseConfigSnapshot(raw: string): ConfigSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigSnapshotParseError('快照文件不是合法 JSON');
  }
  if (!isConfigSnapshotWire(parsed)) {
    throw new ConfigSnapshotParseError(
      '快照格式不符合要求（version/kind/appSettings/categories/tags）',
    );
  }
  return parsed;
}

/** 快照文件名模式（§7.42 D5）：列表与删除仅匹配它，不触碰目录内其他文件。 */
export const CONFIG_SNAPSHOT_FILE_PATTERN = /^life-config-\d{8}-\d{6}\.json$/;

export function isConfigSnapshotFileName(fileName: string): boolean {
  return CONFIG_SNAPSHOT_FILE_PATTERN.test(fileName);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 快照文件名（本地时区）：life-config-YYYYMMDD-HHmmss.json。
 * 同一秒内两次备份同名覆盖（可接受，提案 §7 未列为约束）。
 */
export function configSnapshotFileName(date: Date): string {
  const y = String(date.getFullYear());
  const mo = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const h = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const s = pad2(date.getSeconds());
  return `life-config-${y}${mo}${d}-${h}${mi}${s}.json`;
}

/**
 * exportedAt（本地时区 ISO 8601 含偏移）：2026-11-18T09:30:00.000+08:00。
 * 逐段取本地时间分量 + getTimezoneOffset 反号拼偏移，不用 toISOString
 * （其恒为 Z，提案 §4.1 要求含时区偏移）。
 */
export function formatExportedAt(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const offset = `${sign}${pad2(Math.floor(absOffset / 60))}:${pad2(absOffset % 60)}`;
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.` +
    `${milliseconds}${offset}`
  );
}

/**
 * 快照 appSettings → 可落库 AppSettings（增量覆盖冻结语义的逐字段实现，提案 §4.1）：
 * - 字段 undefined（旧格式/缺列）→ 保留本地值 local[field]；
 * - 字段存在 → 走既有读层防御归一（parseChipsIncrements 等）：坏值回退默认
 *   （与正常读路径同一纪律，不抛错）；合法值写穿。
 * - raw 非 record（守卫已保证 appSettings 为对象，此处兜底）→ 整块保留 local。
 * 三个 JSON 列（chips/defaultChannels/displayCalendarIds）宽容接受字符串形态
 * 或值形态（数组）——旧手写快照两种写法都归一。
 */
export function normalizeSnapshotAppSettings(raw: unknown, local: AppSettings): AppSettings {
  if (!isRecord(raw)) {
    return { ...local };
  }
  const jsonValueToString = (value: unknown): string | undefined => {
    if (value === undefined) return undefined;
    return typeof value === 'string' ? value : JSON.stringify(value) ?? undefined;
  };
  return {
    tagDisplayMode:
      raw.tagDisplayMode === undefined
        ? local.tagDisplayMode
        : isTagDisplayMode(raw.tagDisplayMode)
          ? raw.tagDisplayMode
          : DEFAULT_APP_SETTINGS.tagDisplayMode,
    widgetShowOverdue:
      raw.widgetShowOverdue === undefined
        ? local.widgetShowOverdue
        : typeof raw.widgetShowOverdue === 'boolean'
          ? raw.widgetShowOverdue
          : DEFAULT_APP_SETTINGS.widgetShowOverdue,
    widgetShowTodos:
      raw.widgetShowTodos === undefined
        ? local.widgetShowTodos
        : typeof raw.widgetShowTodos === 'boolean'
          ? raw.widgetShowTodos
          : DEFAULT_APP_SETTINGS.widgetShowTodos,
    widgetShowCategoryEmoji:
      raw.widgetShowCategoryEmoji === undefined
        ? local.widgetShowCategoryEmoji
        : typeof raw.widgetShowCategoryEmoji === 'boolean'
          ? raw.widgetShowCategoryEmoji
          : DEFAULT_APP_SETTINGS.widgetShowCategoryEmoji,
    widgetShowTags:
      raw.widgetShowTags === undefined
        ? local.widgetShowTags
        : typeof raw.widgetShowTags === 'boolean'
          ? raw.widgetShowTags
          : DEFAULT_APP_SETTINGS.widgetShowTags,
    chipsIncrements:
      raw.chipsIncrements === undefined
        ? local.chipsIncrements
        : parseChipsIncrements(jsonValueToString(raw.chipsIncrements)),
    defaultChannels:
      raw.defaultChannels === undefined
        ? local.defaultChannels
        : parseDefaultChannels(jsonValueToString(raw.defaultChannels)),
    carefulMode:
      raw.carefulMode === undefined
        ? local.carefulMode
        : typeof raw.carefulMode === 'boolean'
          ? raw.carefulMode
          : DEFAULT_APP_SETTINGS.carefulMode,
    showAiUsage:
      raw.showAiUsage === undefined
        ? local.showAiUsage
        : typeof raw.showAiUsage === 'boolean'
          ? raw.showAiUsage
          : DEFAULT_APP_SETTINGS.showAiUsage,
    displayCalendarIds:
      raw.displayCalendarIds === undefined
        ? local.displayCalendarIds
        : parseDisplayCalendarIds(jsonValueToString(raw.displayCalendarIds)),
    aiRetryMax:
      raw.aiRetryMax === undefined
        ? local.aiRetryMax
        : typeof raw.aiRetryMax === 'number'
          ? parseAiRetryMax(raw.aiRetryMax)
          : DEFAULT_AI_RETRY_MAX,
    flashDeletedCardDisplay:
      raw.flashDeletedCardDisplay === undefined
        ? local.flashDeletedCardDisplay
        : isFlashDeletedCardDisplay(raw.flashDeletedCardDisplay)
          ? raw.flashDeletedCardDisplay
          : DEFAULT_APP_SETTINGS.flashDeletedCardDisplay,
    // 切片 32（§7.44）：调试查看器两开关同 showAiUsage 增量覆盖语义——
    // 缺列保留本地，出现则 boolean 写穿（非 boolean 回退默认 false）。
    showAiRequest:
      raw.showAiRequest === undefined
        ? local.showAiRequest
        : typeof raw.showAiRequest === 'boolean'
          ? raw.showAiRequest
          : DEFAULT_APP_SETTINGS.showAiRequest,
    showAiResponse:
      raw.showAiResponse === undefined
        ? local.showAiResponse
        : typeof raw.showAiResponse === 'boolean'
          ? raw.showAiResponse
          : DEFAULT_APP_SETTINGS.showAiResponse,
  };
}
