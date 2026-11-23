/**
 * 切片 31 阶段 1（AGENTS.md §7.43）：数据备份快照的领域类型、守卫与序列化。
 *
 * 快照格式（§7.43 D1 冻结六块 + §7.49 D5 可选三块）：{version:1, kind:'data',
 * exportedAt, items, tags, reminders, channelPresets, itemTags, sparks?,
 * sparkAttachments?, sparkItems?}。整包守卫 isDataSnapshotWire 不过 =
 * 整包拒绝；条目级宽容（形状不符跳过 + 计数披露）在 Repository.applyDataSnapshot
 * 落地（本文件导出条目有效性谓词供其使用，深层的 JSON 列/tzid/悬挂引用校验
 * 在仓库层——reminderRuleMapping 解析器与白名单都在 data/ 层，domain 不反向依赖）。
 * 可选三块（切片 37）：缺块=恢复跳过该域；旧 App 读新快照忽略未知键，双向兼容。
 *
 * 与切片 12 导出（src/domain/export.ts version=1 无 kind）完全独立：旧导出文件
 * 不进恢复链路（恢复只认 kind:'data'）；src/domain/export.ts 冻结不动。
 * 与切片 28 配置快照（kind:'config'）互不相认（整包 kind 校验）。
 */

import type { Item, ItemSourceType, ItemStatus, ItemType } from './item';
import { isValidItemPriority } from './category';
import type { Reminder, ReminderFrequency } from './reminder';
import type { Tag } from './tag';
import type { ChannelPreset, ChannelPresetType } from './channelPreset';
import { CHANNEL_PRESET_TYPES } from './channelPreset';
import type { Spark, SparkAttachment, SparkAttachmentKind, SparkItemLink } from './spark';
import { SPARK_ATTACHMENT_KINDS } from './spark';
import { formatExportedAt } from './configSnapshot';

/** 快照内单条条目（items 六块之一，§7.43 D1：全字段 + id 保真）。 */
export interface DataSnapshotItem {
  id: string;
  type: ItemType;
  title: string;
  content: string;
  status: ItemStatus;
  startAt: number | null;
  endAt: number | null;
  allDay: boolean;
  sourceType: ItemSourceType;
  sourceUid: string | null;
  sourceReadOnly: boolean;
  categoryId: string;
  priority: number;
  /** 毫秒时间戳（恢复时经 _raw 保真写入，命中覆盖不动）。 */
  createdAt: number;
  /** 毫秒时间戳（恢复时经 _raw 保真写入，命中覆盖由 prepareUpdate 自动刷新）。 */
  updatedAt: number;
}

/** 快照内单条标签（id 保真，供 itemTags join 直连；name 为业务键）。 */
export interface DataSnapshotTag {
  id: string;
  name: string;
  color: string | null;
  emoji: string | null;
}

/**
 * 快照内单条提醒（仅 v10 语义列）：JSON 列存原始列串（weekdaysJson/onceCivilJson/
 * channelsJson/channelConfigsJson），恢复写穿。不含调度态两列（last_fired_occurrence_key/
 * last_reconciled_at，恢复覆盖不写防丢本地调度状态）与 deprecated channel/channel_config
 * 两列（新建行由仓库层兜底 channel='system-notification' + channel_config=null）。
 */
export interface DataSnapshotReminder {
  id: string;
  itemId: string;
  frequency: ReminderFrequency;
  /** 0–23（once 占位 0，写路径归一保证） */
  localTimeHour: number;
  /** 0–59 */
  localTimeMinute: number;
  /** 原始列串：'' 或 JSON 数组（1–7），语义见 reminderRuleMapping.parseWeekdaysJson */
  weekdaysJson: string;
  /** 仅 monthly 使用（1–31），其他 frequency 恒为 0 */
  dayOfMonth: number;
  /** IANA 时区标识（白名单校验在仓库层，REMINDER_TZ_WHITELIST） */
  tzid: string;
  /** 规则生效起点（绝对毫秒时间戳）；once 下不参与触发计算 */
  startAt: number;
  enabled: boolean;
  /** 原始列串：null 或 JSON {year,month,day,hour,minute} */
  onceCivilJson: string | null;
  /** 原始列串：非 null JSON 渠道数组（v10 已迁移行恒非 null） */
  channelsJson: string;
  /** 原始列串：null 或 JSON 配置字典 */
  channelConfigsJson: string | null;
}

/** 快照内单条渠道预设（configJson 明文上云为用户定案，提案 §3 知情接受）。 */
export interface DataSnapshotChannelPreset {
  id: string;
  name: string;
  type: ChannelPresetType;
  configJson: string;
  isDefault: boolean;
}

/** 快照内单条 join（itemTags 块：重建依据，itemId/tagId 均为快照内 id）。 */
export interface DataSnapshotItemTag {
  itemId: string;
  tagId: string;
}

/**
 * 快照内单条灵感（切片 37 §7.49 D5 可选三块之一，id 保真）。
 * title/content 双可空（纯录音灵感合法）；条目守卫只做形状校验，
 * trim 空串归 null 的写路径归一在 Repository 层（normalizeSparkNullableText）。
 */
export interface DataSnapshotSpark {
  id: string;
  title: string | null;
  content: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 快照内单条灵感附件（id 保真；uri 为源设备本地路径，恢复时经附件补链重下载）。 */
export interface DataSnapshotSparkAttachment {
  id: string;
  sparkId: string;
  kind: SparkAttachmentKind;
  uri: string;
  /** life-attachments 内远端文件名（不含目录前缀）；未上云为 null。 */
  remotePath: string | null;
  sha256: string | null;
  fileSize: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  createdAt: number;
}

/** 快照内单条灵感↔计划关联（id 保真，权威替换重建依据）。 */
export interface DataSnapshotSparkItem {
  id: string;
  sparkId: string;
  itemId: string;
  createdAt: number;
}

/**
 * 数据备份快照（§7.43 D1 六块 + §7.49 D5 可选三块）。
 * sparks/sparkAttachments/sparkItems 为切片 37 追加的可选块：缺块=恢复时跳过该域
 * （旧 App 读新快照忽略未知键，isDataSnapshotWire 只查必需键，双向兼容）。
 */
export interface DataSnapshot {
  version: 1;
  kind: 'data';
  /** 本地时区 ISO 8601 含偏移（configSnapshot.formatExportedAt 同构复用）。 */
  exportedAt: string;
  items: DataSnapshotItem[];
  tags: DataSnapshotTag[];
  reminders: DataSnapshotReminder[];
  channelPresets: DataSnapshotChannelPreset[];
  itemTags: DataSnapshotItemTag[];
  sparks?: DataSnapshotSpark[];
  sparkAttachments?: DataSnapshotSparkAttachment[];
  sparkItems?: DataSnapshotSparkItem[];
}

/** 恢复结果计数（ConfigSnapshotApplyResult 同构形状）。 */
export interface DataSnapshotApplyResult {
  /**
   * 已应用条目数：items/tags/reminders/channelPresets 每个实际写入（覆盖或创建）
   * 条目计 1；itemTags 每个新建 join 计 1（删除的旧 join 不计）；切片 37 可选三块
   * 同口径（sparkAttachments/sparkItems 每个实际写入或重建行计 1）。
   */
  applied: number;
  /**
   * 被跳过条目数：形状不符（条目谓词 / 仓库层深层校验）+ 悬挂引用（categoryId /
   * item_id / tagId / spark_id 解析失败）+ 快照内重复 id/重名 first-wins 丢弃的后续条目。
   */
  skipped: number;
  /**
   * 切片 37：附件文件补链结果（applyDataSnapshot 事务外逐个执行，§7.49 D5）。
   * restored=成功下载并回写行 uri 的附件数；failed=下载失败计数（行已恢复、
   * 详情页可重试）。仅在快照携带任一 Spark 可选块时返回（旧格式快照该字段缺省，
   * 调用方按 0/0 理解）；未注入附件 IO 时恒 {restored:0, failed:0}。
   */
  sparkAttachmentFiles?: { restored: number; failed: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ITEM_TYPES: readonly ItemType[] = ['note', 'task', 'event'];
const ITEM_STATUSES: readonly ItemStatus[] = ['active', 'done', 'archived'];
const ITEM_SOURCE_TYPES: readonly ItemSourceType[] = ['local', 'ics', 'system-calendar'];
const REMINDER_FREQUENCIES: readonly ReminderFrequency[] = ['daily', 'weekly', 'monthly', 'once'];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * 整包守卫（isConfigSnapshotWire 同纪律：谓词收窄，不重建不 cast）：version===1、
 * kind==='data'、exportedAt 非空串、五块均为数组。条目形状不在此校验——条目级
 * 宽容跳过 + 计数在 applyDataSnapshot 落地（条目有效性谓词见下方导出）。
 */
export function isDataSnapshotWire(value: unknown): value is DataSnapshot {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (value.kind !== 'data') return false;
  if (typeof value.exportedAt !== 'string' || value.exportedAt.length === 0) return false;
  if (!Array.isArray(value.items)) return false;
  if (!Array.isArray(value.tags)) return false;
  if (!Array.isArray(value.reminders)) return false;
  if (!Array.isArray(value.channelPresets)) return false;
  if (!Array.isArray(value.itemTags)) return false;
  return true;
}

/**
 * 条目有效性——items（repository.md v0.35 计数口径：形状不符计 skipped）：
 * id 非空串 + type/status/sourceType 枚举成员 + title trim 非空 + content 串 +
 * startAt/endAt 有限数|null + allDay/sourceReadOnly boolean + sourceUid string|null +
 * categoryId 非空串（悬挂引用校验在仓库层）+ priority 经 isValidItemPriority +
 * createdAt/updatedAt 有限数。
 */
export function isDataSnapshotItemEntry(value: unknown): value is DataSnapshotItem {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!ITEM_TYPES.includes(value.type as ItemType)) return false;
  if (typeof value.title !== 'string' || value.title.trim().length === 0) return false;
  if (typeof value.content !== 'string') return false;
  if (!ITEM_STATUSES.includes(value.status as ItemStatus)) return false;
  if (!isFiniteNumberOrNull(value.startAt)) return false;
  if (!isFiniteNumberOrNull(value.endAt)) return false;
  if (typeof value.allDay !== 'boolean') return false;
  if (!ITEM_SOURCE_TYPES.includes(value.sourceType as ItemSourceType)) return false;
  if (!isNullableString(value.sourceUid)) return false;
  if (typeof value.sourceReadOnly !== 'boolean') return false;
  if (!isNonEmptyString(value.categoryId)) return false;
  if (!isFiniteNumber(value.priority) || !isValidItemPriority(value.priority)) return false;
  if (!isFiniteNumber(value.createdAt)) return false;
  if (!isFiniteNumber(value.updatedAt)) return false;
  return true;
}

/** 条目有效性——tags：id 非空串 + name 串 trim 非空 + color/emoji string|null。 */
export function isDataSnapshotTagEntry(value: unknown): value is DataSnapshotTag {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (typeof value.name !== 'string' || value.name.trim().length === 0) return false;
  if (!isNullableString(value.color)) return false;
  if (!isNullableString(value.emoji)) return false;
  return true;
}

/**
 * 条目有效性——reminders（原始形状面）：id/itemId 非空串 + frequency 枚举 +
 * localTimeHour 0–23 整数 + localTimeMinute 0–59 整数 + weekdaysJson 串 +
 * dayOfMonth 0–31 整数 + tzid 非空串 + startAt 有限数 + enabled boolean +
 * onceCivilJson/channelsJson/channelConfigsJson 串或 null（JSON 列内容可解析性、
 * tzid 白名单、frequency 规则一致性、channels 数组合法性在仓库层深层校验）。
 */
export function isDataSnapshotReminderEntry(value: unknown): value is DataSnapshotReminder {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.itemId)) return false;
  if (!REMINDER_FREQUENCIES.includes(value.frequency as ReminderFrequency)) return false;
  if (!isIntInRange(value.localTimeHour, 0, 23)) return false;
  if (!isIntInRange(value.localTimeMinute, 0, 59)) return false;
  if (typeof value.weekdaysJson !== 'string') return false;
  if (!isIntInRange(value.dayOfMonth, 0, 31)) return false;
  if (!isNonEmptyString(value.tzid)) return false;
  if (!isFiniteNumber(value.startAt)) return false;
  if (typeof value.enabled !== 'boolean') return false;
  if (!isNullableString(value.onceCivilJson)) return false;
  if (typeof value.channelsJson !== 'string') return false;
  if (!isNullableString(value.channelConfigsJson)) return false;
  return true;
}

/** 条目有效性——channelPresets：id 非空串 + name trim 非空 + type 枚举 + configJson 串 + isDefault boolean。 */
export function isDataSnapshotChannelPresetEntry(value: unknown): value is DataSnapshotChannelPreset {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (typeof value.name !== 'string' || value.name.trim().length === 0) return false;
  if (!CHANNEL_PRESET_TYPES.includes(value.type as ChannelPresetType)) return false;
  if (typeof value.configJson !== 'string') return false;
  if (typeof value.isDefault !== 'boolean') return false;
  return true;
}

/** 条目有效性——itemTags：itemId/tagId 非空串（解析失败在仓库层计 skipped）。 */
export function isDataSnapshotItemTagEntry(value: unknown): value is DataSnapshotItemTag {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.itemId)) return false;
  if (!isNonEmptyString(value.tagId)) return false;
  return true;
}

/**
 * 条目有效性——sparks（切片 37 §7.49 D5）：id 非空串 + title/content string|null
 * （trim 空串归 null 的归一在仓库层）+ createdAt/updatedAt 有限数。
 */
export function isDataSnapshotSparkEntry(value: unknown): value is DataSnapshotSpark {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNullableString(value.title)) return false;
  if (!isNullableString(value.content)) return false;
  if (!isFiniteNumber(value.createdAt)) return false;
  if (!isFiniteNumber(value.updatedAt)) return false;
  return true;
}

/**
 * 条目有效性——sparkAttachments：id/sparkId/uri 非空串 + kind 枚举 +
 * remotePath/sha256 string|null + fileSize 有限数（25MB 上限校验在仓库层，
 * 与写路径同口径拒绝超限附件）+ durationMs/width/height 有限数|null + createdAt 有限数。
 */
export function isDataSnapshotSparkAttachmentEntry(
  value: unknown,
): value is DataSnapshotSparkAttachment {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.sparkId)) return false;
  if (!SPARK_ATTACHMENT_KINDS.includes(value.kind as SparkAttachmentKind)) return false;
  if (!isNonEmptyString(value.uri)) return false;
  if (!isNullableString(value.remotePath)) return false;
  if (!isNullableString(value.sha256)) return false;
  if (!isFiniteNumber(value.fileSize) || value.fileSize < 0) return false;
  if (!isFiniteNumberOrNull(value.durationMs)) return false;
  if (!isFiniteNumberOrNull(value.width)) return false;
  if (!isFiniteNumberOrNull(value.height)) return false;
  if (!isFiniteNumber(value.createdAt)) return false;
  return true;
}

/**
 * 条目有效性——sparkItems：id/sparkId/itemId 非空串 + createdAt 有限数
 * （悬挂引用解析在仓库层计 skipped）。
 */
export function isDataSnapshotSparkItemEntry(value: unknown): value is DataSnapshotSparkItem {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.sparkId)) return false;
  if (!isNonEmptyString(value.itemId)) return false;
  if (!isFiniteNumber(value.createdAt)) return false;
  return true;
}

/**
 * 快照 → 存储 JSON（无缩进，提案 §7 体积优先：数据快照 items 多时体积大，
 * 与配置快照的 2 空格缩进口径刻意不同——快照非人读，15s 超时兜底披露）。
 */
export function serializeDataSnapshot(snapshot: DataSnapshot): string {
  return JSON.stringify(snapshot);
}

/** 快照解析失败（JSON 非法 / 整包守卫不过），message 面向用户中文。 */
export class DataSnapshotParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataSnapshotParseError';
  }
}

/** 下载的快照 JSON 文本 → DataSnapshot；非法 JSON / 守卫不过均抛 DataSnapshotParseError。 */
export function parseDataSnapshot(raw: string): DataSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DataSnapshotParseError('快照文件不是合法 JSON');
  }
  if (!isDataSnapshotWire(parsed)) {
    throw new DataSnapshotParseError(
      '快照格式不符合要求（version/kind/items/tags/reminders/channelPresets/itemTags）',
    );
  }
  return parsed;
}

/** 数据快照文件名模式（§7.43 D6）：与配置快照同目录独立命名，互不挤占。 */
export const DATA_SNAPSHOT_FILE_PATTERN = /^life-data-\d{8}-\d{6}\.json$/;

export function isDataSnapshotFileName(fileName: string): boolean {
  return DATA_SNAPSHOT_FILE_PATTERN.test(fileName);
}

/**
 * 数据快照文件名（本地时区）：life-data-YYYYMMDD-HHmmss.json。
 * 同一秒内两次备份同名覆盖（configSnapshotFileName 同口径，未列为约束）。
 */
export function dataSnapshotFileName(date: Date): string {
  const y = String(date.getFullYear());
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `life-data-${y}${mo}${d}-${h}${mi}${s}.json`;
}

/**
 * 领域对象 → 快照条目的组装（供 Repository.createDataSnapshot 消费的映射函数：
 * 领域层持有全部输入类型，不依赖 data/ 层——JSON 列串的序列化在仓库层经
 * reminderRuleMapping 完成，本文件只做 items/tags/channelPresets 这类纯字段投影）。
 */
export function toDataSnapshotItem(item: Item): DataSnapshotItem {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    content: item.content,
    status: item.status,
    startAt: item.startAt,
    endAt: item.endAt,
    allDay: item.allDay,
    sourceType: item.sourceType,
    sourceUid: item.sourceUid,
    sourceReadOnly: item.sourceReadOnly,
    categoryId: item.categoryId,
    priority: item.priority,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function toDataSnapshotTag(tag: Omit<Tag, 'createdAt'>): DataSnapshotTag {
  return { id: tag.id, name: tag.name, color: tag.color, emoji: tag.emoji };
}

export function toDataSnapshotReminder(reminder: Reminder): DataSnapshotReminder {
  return {
    id: reminder.id,
    itemId: reminder.itemId,
    frequency: reminder.frequency,
    localTimeHour: reminder.localTimeHour,
    localTimeMinute: reminder.localTimeMinute,
    weekdaysJson: JSON.stringify(reminder.weekdays),
    dayOfMonth: reminder.dayOfMonth,
    tzid: reminder.tzid,
    startAt: reminder.startAt,
    enabled: reminder.enabled,
    onceCivilJson: reminder.onceAt === null ? null : JSON.stringify(reminder.onceAt),
    channelsJson: JSON.stringify(reminder.channels),
    channelConfigsJson:
      Object.keys(reminder.channelConfigs).length === 0
        ? null
        : JSON.stringify(reminder.channelConfigs),
  };
}

export function toDataSnapshotChannelPreset(
  preset: Omit<ChannelPreset, 'createdAt'>,
): DataSnapshotChannelPreset {
  return {
    id: preset.id,
    name: preset.name,
    type: preset.type,
    configJson: preset.configJson,
    isDefault: preset.isDefault,
  };
}

/** 灵感 → 快照条目组装（切片 37，§7.49 D5；Repository.createDataSnapshot 消费）。 */
export function toDataSnapshotSpark(spark: Spark): DataSnapshotSpark {
  return {
    id: spark.id,
    title: spark.title,
    content: spark.content,
    createdAt: spark.createdAt,
    updatedAt: spark.updatedAt,
  };
}

export function toDataSnapshotSparkAttachment(
  attachment: SparkAttachment,
): DataSnapshotSparkAttachment {
  return {
    id: attachment.id,
    sparkId: attachment.sparkId,
    kind: attachment.kind,
    uri: attachment.uri,
    remotePath: attachment.remotePath,
    sha256: attachment.sha256,
    fileSize: attachment.fileSize,
    durationMs: attachment.durationMs,
    width: attachment.width,
    height: attachment.height,
    createdAt: attachment.createdAt,
  };
}

export function toDataSnapshotSparkItem(link: SparkItemLink & { id: string }): DataSnapshotSparkItem {
  return {
    id: link.id,
    sparkId: link.sparkId,
    itemId: link.itemId,
    createdAt: link.createdAt,
  };
}

/** 组包 exportedAt（configSnapshot.formatExportedAt 转发，单一实现）。 */
export function dataSnapshotExportedAt(date: Date): string {
  return formatExportedAt(date);
}
