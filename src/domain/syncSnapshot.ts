/**
 * 双向同步快照（切片 35 阶段 1，AGENTS.md §7.47，提案 D4/D5）。
 *
 * 快照格式：{version:1, kind:'sync', deviceId, exportedAt, appSettings,
 * categories, items, tags, reminders, channelPresets, itemTags, tombstones}。
 * - 五块 items/tags/reminders/channelPresets/itemTags 与 DataSnapshot 条目
 *   **同构复用**（isDataSnapshotItemEntry 等条目级守卫直接复用；条目级宽容
 *   skipped 计数沿切片 31 纪律）。唯一例外 reminders：SyncReminderEntry =
 *   DataSnapshotReminder + createdAt/updatedAt（Q1 LWW 判据，见下方接口注释）。
 * - appSettings / categories 两块为提案 D4 键清单的缺陷补全（D4 未列但 D3
 *   语义必需：categories 按 id union、app_settings 按 exportedAt LWW），
 *   形状与 ConfigSnapshot 同构（appSettings 整包守卫仅要求对象——读层防御
 *   归一在 mergeSyncSnapshots 经 normalizeSnapshotAppSettings 落地）。
 * - tombstones 墓碑块：元素级校验在整包守卫内（提案 D4 原文「tombstones
 *   数组元素校验」——坏元素 = 整包拒绝，与五块条目级宽容刻意不同）。
 * - 文件名 `life-sync-<deviceId>.json` 固定名覆盖写（非滚动保留），与
 *   kind:'config'（切片 28）/kind:'data'（切片 31）互不相认。
 */

import type { AppSettings } from './settings';
import type { ConfigSnapshotCategoryEntry } from './configSnapshot';
import {
  isDataSnapshotReminderEntry,
  type DataSnapshotChannelPreset,
  type DataSnapshotItem,
  type DataSnapshotItemTag,
  type DataSnapshotReminder,
  type DataSnapshotTag,
} from './dataSnapshot';

/** 墓碑实体种类（新表 sync_tombstones.kind，schema v17）。 */
export type SyncTombstoneKind = 'item' | 'reminder' | 'channel_preset';

const TOMBSTONE_KINDS: readonly SyncTombstoneKind[] = ['item', 'reminder', 'channel_preset'];

/** 快照内单条墓碑（sync_tombstones 行的 wire 投影）。 */
export interface SyncTombstoneEntry {
  kind: SyncTombstoneKind;
  /** 被删实体 id（items.id / reminders.id / channel_presets.id）。 */
  entityId: string;
  /** 删除时刻毫秒时间戳（对端裁剪判据：deleted_at 严格早于全部对端 exportedAt 才可裁）。 */
  deletedAt: number;
}

/** 双向同步快照（D3 union/LWW 语义的全部载荷）。 */
export interface SyncSnapshot {
  version: 1;
  kind: 'sync';
  /** 产生快照的设备标识（uuid v4；固定文件名 life-sync-<deviceId>.json 同值）。 */
  deviceId: string;
  /** 本地时区 ISO 8601 含偏移（dataSnapshotExportedAt 同构复用）。 */
  exportedAt: string;
  appSettings: AppSettings;
  categories: ConfigSnapshotCategoryEntry[];
  items: DataSnapshotItem[];
  tags: DataSnapshotTag[];
  /** SyncReminderEntry = DataSnapshotReminder + createdAt/updatedAt（Q1 reminders LWW 判据，见接口注释）。 */
  reminders: SyncReminderEntry[];
  channelPresets: DataSnapshotChannelPreset[];
  itemTags: DataSnapshotItemTag[];
  tombstones: SyncTombstoneEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 快照内单条提醒：DataSnapshotReminder 全字段（v10 语义列）+ createdAt/updatedAt
 * 两毫秒时间戳。提案缺陷披露（本片实现修订）：D4 原文「条目形状与 DataSnapshot
 * 五块同构复用」，但 DataSnapshotReminder（切片 31 冻结形状）不含 updated_at，
 * 而 Q1 定案明文「items/reminders 有 updated_at → 行级 LWW」——reminders LWW
 * 必须有 wire 时间戳可比。本接口在 DataSnapshotReminder 基础上追加两键，
 * isSyncReminderEntry = isDataSnapshotReminderEntry + 两键有限数校验；
 * LWW 决胜用 updatedAt，落库仍为 prepareUpdate 自动刷新语义（见 syncMerge.ts）。
 */
export interface SyncReminderEntry extends DataSnapshotReminder {
  /** 毫秒时间戳（LWW 决胜判据；落库新建行走 WatermelonDB 自动时间戳）。 */
  createdAt: number;
  /** 毫秒时间戳（LWW 决胜判据）。 */
  updatedAt: number;
}

/** SyncReminderEntry 形状守卫（深层校验 weekdaysJson 等仍在仓库层）。 */
export function isSyncReminderEntry(value: unknown): value is SyncReminderEntry {
  if (!isDataSnapshotReminderEntry(value)) return false;
  if (!isRecord(value)) return false;
  if (!isFiniteNumber(value.createdAt)) return false;
  if (!isFiniteNumber(value.updatedAt)) return false;
  return true;
}

/**
 * 墓碑条目守卫（提案 D4：元素级校验在顶层整包守卫内）：
 * kind 枚举成员 + entityId 非空串 + deletedAt 有限数。
 */
export function isSyncTombstoneEntry(value: unknown): value is SyncTombstoneEntry {
  if (!isRecord(value)) return false;
  if (!TOMBSTONE_KINDS.includes(value.kind as SyncTombstoneKind)) return false;
  if (typeof value.entityId !== 'string' || value.entityId.length === 0) return false;
  if (!isFiniteNumber(value.deletedAt)) return false;
  return true;
}

/**
 * 整包守卫（isConfigSnapshotWire / isDataSnapshotWire 同纪律：谓词收窄，不重建
 * 不 cast）：version===1、kind==='sync'、deviceId 非空串（提案 D4 原文，不做
 * uuid 形状校验）、exportedAt 非空串、appSettings 为对象、categories 与五块
 * 均为数组、tombstones 为数组且**每个元素**过 isSyncTombstoneEntry（坏元素 =
 * 整包拒绝）。五块/categories 的条目形状不在此校验——条目级宽容跳过 + 计数在
 * mergeSyncSnapshots / applySyncMerge 落地。
 */
export function isSyncSnapshotWire(value: unknown): value is SyncSnapshot {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (value.kind !== 'sync') return false;
  if (typeof value.deviceId !== 'string' || value.deviceId.length === 0) return false;
  if (typeof value.exportedAt !== 'string' || value.exportedAt.length === 0) return false;
  if (!isRecord(value.appSettings)) return false;
  if (!Array.isArray(value.categories)) return false;
  if (!Array.isArray(value.items)) return false;
  if (!Array.isArray(value.tags)) return false;
  if (!Array.isArray(value.reminders)) return false;
  if (!Array.isArray(value.channelPresets)) return false;
  if (!Array.isArray(value.itemTags)) return false;
  if (!Array.isArray(value.tombstones)) return false;
  for (const entry of value.tombstones) {
    if (!isSyncTombstoneEntry(entry)) return false;
  }
  return true;
}

/**
 * 快照 → 存储 JSON（无缩进，dataSnapshot.serializeDataSnapshot 同口径：
 * items 多时体积优先，快照非人读）。
 */
export function serializeSyncSnapshot(snapshot: SyncSnapshot): string {
  return JSON.stringify(snapshot);
}

/** 快照解析失败（JSON 非法 / 整包守卫不过），message 面向用户中文。 */
export class SyncSnapshotParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncSnapshotParseError';
  }
}

/** 下载的对端快照 JSON 文本 → SyncSnapshot；非法 JSON / 守卫不过均抛 SyncSnapshotParseError。 */
export function parseSyncSnapshot(raw: string): SyncSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SyncSnapshotParseError('同步快照文件不是合法 JSON');
  }
  if (!isSyncSnapshotWire(parsed)) {
    throw new SyncSnapshotParseError(
      '同步快照格式不符合要求（version/kind/deviceId/exportedAt/七块数组/墓碑元素）',
    );
  }
  return parsed;
}

/**
 * 同步快照文件名模式（提案 D4 原文）：life-sync-<uuid>.json，uuid 形状宽松
 * （8-4-4-4-12 十六进制，不锁 v4/变体位——与 deviceIdFromSyncFileName 同口径）。
 */
export const SYNC_SNAPSHOT_FILE_PATTERN =
  /^life-sync-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.json$/;

export function isSyncSnapshotFileName(fileName: string): boolean {
  return SYNC_SNAPSHOT_FILE_PATTERN.test(fileName);
}

/** 固定名快照文件（每设备一份，覆盖写非滚动保留）。 */
export function syncSnapshotFileName(deviceId: string): string {
  return `life-sync-${deviceId}.json`;
}

/** `life-sync-<deviceId>.json` → deviceId；不匹配返回 null（列表过滤后仍防御）。 */
export function deviceIdFromSyncFileName(fileName: string): string | null {
  if (!SYNC_SNAPSHOT_FILE_PATTERN.test(fileName)) return null;
  return fileName.slice('life-sync-'.length, -'.json'.length);
}
