/**
 * 双向同步合流纯函数（切片 35 阶段 1，AGENTS.md §7.47，提案 D2/D3/D5）。
 *
 * 语义冻结（提案定案，2026-11-22 三问）：
 * - items/reminders 行级 LWW：updated_at 晚者赢（**全局比较**——多远端同 id 候选
 *   取 updatedAt 最大者而非「最新快照的行」，平局先比远端 deviceId 字典序、再比
 *   本地优先；D5「updated_at 全局比较」原文）。远端严格晚于本地才覆盖（平局本地赢，
 *   幂等：重跑同输入同结果）。
 * - 删除传播 = 墓碑：本地行命中任意墓碑（本地或远端）→ 删除；远端墓碑全部合入
 *   本地墓碑集（防回流复活——含本地无此实体的墓碑，抵御第三方陈旧快照重建）。
 * - 无时间戳表 union：tags 按 normalizeTagName 归一键 / categories、channel_presets
 *   按 id——命中保留本地、未命中创建（id 保真）；itemTags 并集增补（不删本地既有）。
 * - app_settings 整行按快照 exportedAt LWW（内存态会话基线，见 SyncMergeOptions）。
 *
 * 确定性纪律：远端快照先按 (exportedAt 毫秒, deviceId) 升序排序，全程单遍处理，
 * 与输入顺序无关；同一快照内重复 id first-wins 计 skipped。处理次序固定为
 * 墓碑 → categories → items → reminders → presets → tags → itemTags → appSettings
 * （categories 先于 items：item categoryId 悬挂检查需覆盖本轮创建的分类）。
 *
 * 分层边界：形状级校验（isDataSnapshot*Entry 条目谓词）在本函数；深层校验
 * （weekdaysJson 可解析、tzid 白名单、preset configJson 守卫等）在仓库层
 * applySyncMerge（reminderRuleMapping / assertValidChannelPresetConfig 都在 data/）。
 */

import { normalizeTagName } from './tag';
import type { AppSettings } from './settings';
import { normalizeSnapshotAppSettings, type ConfigSnapshotCategoryEntry } from './configSnapshot';
import {
  isDataSnapshotChannelPresetEntry,
  isDataSnapshotItemEntry,
  isDataSnapshotItemTagEntry,
  isDataSnapshotTagEntry,
  type DataSnapshotChannelPreset,
  type DataSnapshotItem,
  type DataSnapshotItemTag,
  type DataSnapshotTag,
} from './dataSnapshot';
import {
  isSyncReminderEntry,
  type SyncReminderEntry,
  type SyncSnapshot,
  type SyncTombstoneEntry,
} from './syncSnapshot';

/**
 * app_settings LWW 的内存态会话基线（提案 D3「本地上次同步基准（内存态，
 * 本次会话内比对）」）：上次合流后本地上传快照的 exportedAt；null = 本会话
 * 首次合流（全部远端合格，远端设置胜出——重启后基线归零的已知代价）。
 * 基线串不可解析（Date.parse NaN）按 -Infinity（全部远端合格）。
 */
export interface SyncMergeOptions {
  settingsBaselineExportedAt: string | null;
}

export interface SyncMergeCounts {
  /** 实际写入条目：item/reminder 覆盖与创建 + tag/category/preset 创建 + join 创建 + appSettings 块（1/0）。 */
  applied: number;
  /** 形状不符 + 快照内重复 + 孤儿/悬挂解析失败 + 同名重复标签。深层校验的追加 skipped 由仓库层累加。 */
  skipped: number;
  /** 本地已有行被远端覆盖（严格胜出）的次数（items/reminders 合计）。 */
  conflictsResolved: number;
  /** 墓碑命中的本地行删除数（items/reminders/channelPresets 合计）。 */
  tombstonesPropagation: number;
}

/**
 * applySyncMerge（仓库层）的落库结果：applied 为仓库层自数（本轮实际写入行数，
 * app_settings 块命中计 1）；skipped = mergeSyncSnapshots 计数 + 仓库层深层校验
 * 追加 skipped；conflictsResolved / tombstonesPropagation 透传合流计数。
 */
export interface SyncMergeApplyResult {
  applied: number;
  skipped: number;
  conflictsResolved: number;
  tombstonesPropagation: number;
}

export interface SyncMergeResult {
  /** 待覆盖/创建的 item 条目（仓库层命中 prepareUpdate / 未命中 prepareCreateFromDirtyRaw）。 */
  toUpsertItems: DataSnapshotItem[];
  /** 墓碑命中的本地 item id（仓库层级联删 reminders/joins 后删 item）。 */
  toDeleteItemIds: string[];
  /** 待覆盖/创建的 reminder 条目（孤儿与级联冲突已在本函数过滤）。 */
  toUpsertReminders: SyncReminderEntry[];
  /** 墓碑命中的本地 reminder id（item 级联已覆盖的不在此列）。 */
  toDeleteReminderIds: string[];
  /** 待创建的 preset 条目（union：命中本地一律保留，无覆盖）；排序 = 远端处理序（default last-wins 判据）。 */
  toUpsertPresets: DataSnapshotChannelPreset[];
  /** 墓碑命中的本地 preset id。 */
  toDeletePresetIds: string[];
  /** 待创建的 tag 条目（未命中归一键；id 保真）。 */
  toCreateTags: DataSnapshotTag[];
  /** 待创建的 category 条目（未命中 id；需 name 非空）。 */
  toCreateCategories: ConfigSnapshotCategoryEntry[];
  /** 待增补 join 对（itemId 恒等映射；tagId 已解析为本地行 id；与本地既有及本轮已发去重）。 */
  rebuiltItemTags: DataSnapshotItemTag[];
  /** 待合入本地 sync_tombstones 的远端墓碑（防回流复活；与本地墓碑集已去重）。 */
  tombstonesToAdd: SyncTombstoneEntry[];
  /** app_settings 覆盖值（缺列保留本地已归一）；null = 保留本地。 */
  appliedAppSettings: AppSettings | null;
  counts: SyncMergeCounts;
}

/** 远端快照排序键：exportedAt 毫秒（不可解析按 -Infinity）升序，平局 deviceId 字典序升序。 */
function remoteSortKey(snapshot: SyncSnapshot): { exportedAtMs: number; deviceId: string } {
  const parsed = Date.parse(snapshot.exportedAt);
  return {
    exportedAtMs: Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed,
    deviceId: snapshot.deviceId,
  };
}

function compareRemotes(a: SyncSnapshot, b: SyncSnapshot): number {
  const ka = remoteSortKey(a);
  const kb = remoteSortKey(b);
  if (ka.exportedAtMs !== kb.exportedAtMs) return ka.exportedAtMs - kb.exportedAtMs;
  return ka.deviceId < kb.deviceId ? -1 : ka.deviceId > kb.deviceId ? 1 : 0;
}

/** 墓碑 map 键。 */
function tombstoneKey(kind: SyncTombstoneEntry['kind'], entityId: string): string {
  return `${kind}:${entityId}`;
}

/** 同 id 多远端候选的行级 LWW 胜者的候选项。 */
interface RemoteRowCandidate<T> {
  entry: T;
  remote: SyncSnapshot;
}

/**
 * 行级 LWW 胜者：updatedAt 最大者；平局远端 deviceId 字典序最大者（确定性、
 * 顺序无关）。同一快照内重复 id 已在候选收集时 first-wins 丢弃。
 */
function pickRowWinner<T extends { updatedAt: number }>(
  candidates: Array<RemoteRowCandidate<T>>,
): RemoteRowCandidate<T> | null {
  let winner: RemoteRowCandidate<T> | null = null;
  for (const candidate of candidates) {
    if (
      winner === null ||
      candidate.entry.updatedAt > winner.entry.updatedAt ||
      (candidate.entry.updatedAt === winner.entry.updatedAt &&
        candidate.remote.deviceId > winner.remote.deviceId)
    ) {
      winner = candidate;
    }
  }
  return winner;
}

/** 同一远端快照内重复 id 的候选收集（first-wins + skipped 计数共用骨架）。 */
function collectRowCandidates<T extends { updatedAt: number; id: string }>(
  remotes: readonly SyncSnapshot[],
  pickEntries: (remote: SyncSnapshot) => readonly unknown[],
  validateEntry: (entry: unknown) => entry is T,
  onSkip: () => void,
): Map<string, Array<RemoteRowCandidate<T>>> {
  const candidates = new Map<string, Array<RemoteRowCandidate<T>>>();
  for (const remote of remotes) {
    for (const raw of pickEntries(remote)) {
      if (!validateEntry(raw)) {
        onSkip();
        continue;
      }
      const bucket = candidates.get(raw.id);
      if (bucket) {
        if (bucket.some((candidate) => candidate.remote.deviceId === remote.deviceId)) {
          onSkip(); // 同一快照内重复 id first-wins
          continue;
        }
        bucket.push({ entry: raw, remote });
      } else {
        candidates.set(raw.id, [{ entry: raw, remote }]);
      }
    }
  }
  return candidates;
}

/**
 * 快照内 category 条目形状守卫（含创建前置 name 非空；isConfigSnapshotCategoryEntry
 * 不收窄类型且不校验 name，此处独立收窄谓词）。
 */
function isSyncCategoryEntry(value: unknown): value is ConfigSnapshotCategoryEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id.length === 0) return false;
  if (record.color !== null && typeof record.color !== 'string') return false;
  if (record.emoji !== null && typeof record.emoji !== 'string') return false;
  if (typeof record.priority !== 'number' || !Number.isFinite(record.priority)) return false;
  if (typeof record.name !== 'string' || record.name.trim().length === 0) return false;
  return true;
}

export function mergeSyncSnapshots(
  local: SyncSnapshot,
  remoteSnapshots: readonly SyncSnapshot[],
  localTombstones: readonly SyncTombstoneEntry[],
  options: SyncMergeOptions,
): SyncMergeResult {
  const remotes = [...remoteSnapshots].sort(compareRemotes);

  const counts: SyncMergeCounts = {
    applied: 0,
    skipped: 0,
    conflictsResolved: 0,
    tombstonesPropagation: 0,
  };

  // —— 墓碑合并：本地既有保留（不更新 deleted_at，裁剪语义更保守）；
  // 远端墓碑按排序序逐条合入 map，本地缺的全部进 tombstonesToAdd（防回流复活）。
  const tombstoneMap = new Map<string, SyncTombstoneEntry>();
  for (const tombstone of localTombstones) {
    tombstoneMap.set(tombstoneKey(tombstone.kind, tombstone.entityId), tombstone);
  }
  const tombstonesToAdd: SyncTombstoneEntry[] = [];
  for (const remote of remotes) {
    for (const tombstone of remote.tombstones) {
      const key = tombstoneKey(tombstone.kind, tombstone.entityId);
      if (tombstoneMap.has(key)) continue;
      tombstoneMap.set(key, tombstone);
      tombstonesToAdd.push(tombstone);
    }
  }

  // —— categories：id union（创建需 name 非空）。先于 items 处理：
  // item categoryId 悬挂检查需覆盖本轮创建的分类 id。
  const resolvedCategoryIds = new Set<string>();
  for (const category of local.categories) {
    if (typeof category?.id === 'string' && category.id.length > 0) {
      resolvedCategoryIds.add(category.id);
    }
  }
  const toCreateCategories: ConfigSnapshotCategoryEntry[] = [];
  const seenCategoryIds = new Set<string>();
  for (const remote of remotes) {
    for (const raw of remote.categories) {
      if (!isSyncCategoryEntry(raw)) {
        counts.skipped += 1;
        continue;
      }
      if (seenCategoryIds.has(raw.id)) {
        counts.skipped += 1; // 跨/同快照重复声明 first-wins
        continue;
      }
      seenCategoryIds.add(raw.id);
      if (resolvedCategoryIds.has(raw.id)) continue; // union 命中：保留本地（已知限制明文披露）
      resolvedCategoryIds.add(raw.id);
      toCreateCategories.push(raw);
      counts.applied += 1;
    }
  }

  // —— items：逐 id 候选 → 行级 LWW 胜者 → 墓碑/悬挂/本地比较。
  const localItemById = new Map<string, DataSnapshotItem>();
  for (const item of local.items) {
    if (!localItemById.has(item.id)) localItemById.set(item.id, item);
  }
  const itemCandidates = collectRowCandidates(
    remotes,
    (remote) => remote.items,
    isDataSnapshotItemEntry,
    () => {
      counts.skipped += 1;
    },
  );
  const toUpsertItems: DataSnapshotItem[] = [];
  const toDeleteItemIds: string[] = [];
  for (const [id, candidates] of itemCandidates) {
    const winner = pickRowWinner(candidates);
    if (winner === null) continue;
    if (tombstoneMap.has(tombstoneKey('item', id))) continue; // 墓碑胜过一切 LWW
    if (!resolvedCategoryIds.has(winner.entry.categoryId)) {
      counts.skipped += 1; // categoryId 悬挂引用（本地与本轮创建均无）
      continue;
    }
    const localRow = localItemById.get(id);
    if (localRow === undefined) {
      toUpsertItems.push(winner.entry);
      counts.applied += 1;
    } else if (winner.entry.updatedAt > localRow.updatedAt) {
      toUpsertItems.push(winner.entry);
      counts.applied += 1;
      counts.conflictsResolved += 1;
    }
    // 平局（updatedAt 相等）本地赢：不写。
  }
  for (const id of localItemById.keys()) {
    if (tombstoneMap.has(tombstoneKey('item', id))) {
      toDeleteItemIds.push(id);
      counts.tombstonesPropagation += 1;
    }
  }

  // 合流后仍存在的 item 集合（reminders/joins 解析基准）：
  // 本地存活（未被墓碑删）∪ 本轮 upsert。
  const resolvedItemIds = new Set<string>();
  for (const id of localItemById.keys()) {
    if (!toDeleteItemIds.includes(id)) resolvedItemIds.add(id);
  }
  for (const entry of toUpsertItems) {
    resolvedItemIds.add(entry.id);
  }

  // —— reminders：行级 LWW + 孤儿/级联过滤。
  const localReminderById = new Map<string, SyncReminderEntry>();
  for (const reminder of local.reminders) {
    if (!localReminderById.has(reminder.id)) localReminderById.set(reminder.id, reminder);
  }
  const reminderCandidates = collectRowCandidates(
    remotes,
    (remote) => remote.reminders,
    isSyncReminderEntry,
    () => {
      counts.skipped += 1;
    },
  );
  const toUpsertReminders: SyncReminderEntry[] = [];
  const toDeleteReminderIds: string[] = [];
  for (const [id, candidates] of reminderCandidates) {
    const winner = pickRowWinner(candidates);
    if (winner === null) continue;
    if (tombstoneMap.has(tombstoneKey('reminder', id))) continue; // 墓碑胜过一切
    if (toDeleteItemIds.includes(winner.entry.itemId)) continue; // 基线 item 本轮被墓碑删 → 级联覆盖，静默跳过
    if (!resolvedItemIds.has(winner.entry.itemId)) {
      counts.skipped += 1; // 孤儿 reminder（基线 item 不在合流后集合）
      continue;
    }
    const localRow = localReminderById.get(id);
    if (localRow === undefined) {
      toUpsertReminders.push(winner.entry);
      counts.applied += 1;
    } else if (winner.entry.updatedAt > localRow.updatedAt) {
      toUpsertReminders.push(winner.entry);
      counts.applied += 1;
      counts.conflictsResolved += 1;
    }
  }
  for (const id of localReminderById.keys()) {
    if (tombstoneMap.has(tombstoneKey('reminder', id))) {
      toDeleteReminderIds.push(id);
      counts.tombstonesPropagation += 1;
    }
  }

  // —— channel_presets：id union（命中保留本地、未命中创建）；墓碑命中删本地。
  const localPresetById = new Map<string, DataSnapshotChannelPreset>();
  for (const preset of local.channelPresets) {
    if (!localPresetById.has(preset.id)) localPresetById.set(preset.id, preset);
  }
  const toUpsertPresets: DataSnapshotChannelPreset[] = [];
  const toDeletePresetIds: string[] = [];
  const seenPresetIds = new Set<string>();
  for (const remote of remotes) {
    for (const raw of remote.channelPresets) {
      if (!isDataSnapshotChannelPresetEntry(raw)) {
        counts.skipped += 1;
        continue;
      }
      if (seenPresetIds.has(raw.id)) {
        counts.skipped += 1; // 跨/同快照重复声明 first-wins
        continue;
      }
      seenPresetIds.add(raw.id);
      if (tombstoneMap.has(tombstoneKey('channel_preset', raw.id))) continue;
      if (localPresetById.has(raw.id)) continue; // union 命中：保留本地（已知限制明文披露）
      toUpsertPresets.push(raw);
      counts.applied += 1;
    }
  }
  for (const id of localPresetById.keys()) {
    if (tombstoneMap.has(tombstoneKey('channel_preset', id))) {
      toDeletePresetIds.push(id);
      counts.tombstonesPropagation += 1;
    }
  }

  // —— tags：normalizeTagName 归一键 union；远端 tag id → 本地行 id 解析映射。
  const localTagIdByDedupKey = new Map<string, string>();
  for (const tag of local.tags) {
    if (typeof tag?.name !== 'string' || tag.name.trim().length === 0) continue;
    const { dedupKey } = normalizeTagName(tag.name);
    if (!localTagIdByDedupKey.has(dedupKey)) localTagIdByDedupKey.set(dedupKey, tag.id);
  }
  const toCreateTags: DataSnapshotTag[] = [];
  const remoteTagIdToLocal = new Map<string, string>();
  const seenTagIds = new Set<string>();
  for (const remote of remotes) {
    for (const raw of remote.tags) {
      if (!isDataSnapshotTagEntry(raw)) {
        counts.skipped += 1;
        continue;
      }
      if (seenTagIds.has(raw.id)) {
        counts.skipped += 1; // 跨/同快照重复声明 first-wins
        continue;
      }
      seenTagIds.add(raw.id);
      const { dedupKey } = normalizeTagName(raw.name);
      const localTagId = localTagIdByDedupKey.get(dedupKey);
      if (localTagId !== undefined) {
        remoteTagIdToLocal.set(raw.id, localTagId); // union 命中：保留本地
        continue;
      }
      // 未命中创建（id 保真；后续同归一键的其他远端 tag 解析到本条）。
      localTagIdByDedupKey.set(dedupKey, raw.id);
      remoteTagIdToLocal.set(raw.id, raw.id);
      toCreateTags.push(raw);
      counts.applied += 1;
    }
  }

  // —— itemTags：并集增补（itemId 恒等映射、tagId 经解析映射；不删本地既有 join）。
  const localJoinKeys = new Set<string>();
  for (const join of local.itemTags) {
    if (typeof join?.itemId === 'string' && typeof join?.tagId === 'string') {
      localJoinKeys.add(`${join.itemId}:${join.tagId}`);
    }
  }
  const rebuiltItemTags: DataSnapshotItemTag[] = [];
  const emittedJoinKeys = new Set<string>();
  for (const remote of remotes) {
    const declaredInRemote = new Set<string>();
    for (const raw of remote.itemTags) {
      if (!isDataSnapshotItemTagEntry(raw)) {
        counts.skipped += 1;
        continue;
      }
      if (!resolvedItemIds.has(raw.itemId)) {
        counts.skipped += 1; // 悬挂：基线 item 不在合流后集合
        continue;
      }
      const localTagId = remoteTagIdToLocal.get(raw.tagId);
      if (localTagId === undefined) {
        counts.skipped += 1; // 悬挂：tagId 解析失败
        continue;
      }
      const key = `${raw.itemId}:${localTagId}`;
      if (localJoinKeys.has(key)) continue; // 本地已满足：并集交集，静默去重
      if (emittedJoinKeys.has(key)) {
        if (declaredInRemote.has(key)) {
          counts.skipped += 1; // 同一快照内重复声明
        }
        continue; // 跨快照重复声明：并集幂等，静默去重
      }
      declaredInRemote.add(key);
      emittedJoinKeys.add(key);
      rebuiltItemTags.push({ itemId: raw.itemId, tagId: localTagId });
      counts.applied += 1;
    }
  }

  // —— app_settings：快照 exportedAt LWW（内存态会话基线，缺列保留本地）。
  // remotes 已升序排序：逐个合格者覆盖，循环结束即「exportedAt 最大、平局
  // deviceId 最大字典序」的远端胜出（与输入顺序无关）。
  let baselineMs = Number.NEGATIVE_INFINITY;
  if (options.settingsBaselineExportedAt !== null) {
    const parsed = Date.parse(options.settingsBaselineExportedAt);
    if (!Number.isNaN(parsed)) baselineMs = parsed;
  }
  let appliedAppSettings: AppSettings | null = null;
  for (const remote of remotes) {
    if (remoteSortKey(remote).exportedAtMs <= baselineMs) continue; // 基线后无更新 → 保留本地
    appliedAppSettings = normalizeSnapshotAppSettings(remote.appSettings, local.appSettings);
  }
  if (appliedAppSettings !== null) {
    counts.applied += 1;
  }

  return {
    toUpsertItems,
    toDeleteItemIds,
    toUpsertReminders,
    toDeleteReminderIds,
    toUpsertPresets,
    toDeletePresetIds,
    toCreateTags,
    toCreateCategories,
    rebuiltItemTags,
    tombstonesToAdd,
    appliedAppSettings,
    counts,
  };
}
