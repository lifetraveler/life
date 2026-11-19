import { Database, Q, Query, type Model } from '@nozbe/watermelondb';

import type {
  CreateItemInput,
  ImportedItemInput,
  Item,
  ItemSourceType,
  UpdateItemInput,
} from '../domain/item';
import { filterEventsInRange } from '../domain/systemCalendar/filterEventsInRange';
import {
  mapSystemEventToImportedItem,
  systemEventDisplayTitle,
} from '../domain/systemCalendar/mapSystemEvent';
import type { SystemCalendarEvent } from '../domain/systemCalendar/types';
import type {
  CreateReminderInput,
  Reminder,
  UpdateReminderInput,
} from '../domain/reminder';
import {
  escapeLikePattern,
  extractDateFragment,
  matchesDateFragment,
  normalizeSearchKeyword,
} from '../domain/search';
import { DEFAULT_CATEGORY_ID, isValidItemPriority } from '../domain/category';
import type { Category } from '../domain/category';
import {
  isChannelPresetType,
  type ChannelPreset,
  type ChannelPresetType,
  type CreateChannelPresetInput,
  type UpdateChannelPresetInput,
} from '../domain/channelPreset';
import { normalizeTagName } from '../domain/tag';
import type { ItemWithTags, Tag } from '../domain/tag';
import type { ItemWithRelations } from '../domain/relations/itemWithRelations';
import {
  APP_SETTINGS_ROW_ID,
  DEFAULT_APP_SETTINGS,
  isTagDisplayMode,
  isFlashDeletedCardDisplay,
  parseAiRetryMax,
  parseChipsIncrements,
  parseDefaultChannels,
  parseDisplayCalendarIds,
  serializeChipsIncrements,
  serializeDefaultChannels,
  serializeDisplayCalendarIds,
  validateAiRetryMax,
  validateDisplayCalendarIds,
  validateChipsIncrements,
  validateDefaultChannels,
} from '../domain/settings';
import type { AppSettings } from '../domain/settings';
import {
  formatExportedAt,
  isConfigSnapshotCategoryEntry,
  isConfigSnapshotTagEntry,
  isConfigSnapshotWire,
  normalizeSnapshotAppSettings,
  type ConfigSnapshot,
  type ConfigSnapshotApplyResult,
} from '../domain/configSnapshot';
import {
  dataSnapshotExportedAt,
  isDataSnapshotChannelPresetEntry,
  isDataSnapshotItemEntry,
  isDataSnapshotItemTagEntry,
  isDataSnapshotReminderEntry,
  isDataSnapshotTagEntry,
  isDataSnapshotWire,
  toDataSnapshotChannelPreset,
  toDataSnapshotItem,
  type DataSnapshot,
  type DataSnapshotApplyResult,
  type DataSnapshotChannelPreset,
  type DataSnapshotReminder,
  type DataSnapshotTag,
} from '../domain/dataSnapshot';
import {
  DEFAULT_REMINDER_CHANNEL,
  isExpoReminderChannel,
  isReminderChannel,
  type ReminderChannel,
} from '../domain/reminder';
import AppSettingsModel from '../db/models/AppSettingsModel';
import CategoryModel from '../db/models/CategoryModel';
import ChannelPresetModel from '../db/models/ChannelPresetModel';
import ItemModel from '../db/models/ItemModel';
import ItemTagModel from '../db/models/ItemTagModel';
import ReminderModel from '../db/models/ReminderModel';
import TagModel from '../db/models/TagModel';
import { seedPresetData } from '../db/seed';
import { parseIcs } from '../domain/ics/parseIcs';
import { parseAppriseChannelConfig } from '../notifications/channels/appriseConfig';
import { parseWebhookChannelConfig } from '../notifications/channels/webhookConfig';
import { normalizeAllDayTimestamps } from './allDayNormalize';
import { getDeviceTzid } from './deviceTimezone';
import { assertValidItemTimePatch, assertValidItemTimeRange } from './itemTimeRules';
import type {
  IcsPreviewEntry,
  IcsPreviewResult,
  ImportBatchResult,
  ItemRepository,
  SystemCalendarImportInput,
  SystemCalendarPreviewResult,
  SystemImportResult,
  VisualPatch,
} from './ItemRepository';
import { defaultSystemCalendarDeps } from './systemCalendarAdapters';
import type { SystemCalendarDeps } from './systemCalendarAdapters';
import {
  normalizeReminderChannelFields,
  normalizeReminderRuleFields,
  normalizeStartAt,
  parseOnceCivilJson,
  parseWeekdaysJson,
  resolveOnceAt,
  resolveReminderChannelRow,
  serializeOnceCivilJson,
  serializeReminderChannels,
  serializeReminderChannelConfigs,
  serializeWeekdays,
} from './reminderRuleMapping';
import { assertWhitelistedReminderTz } from './reminderTzWhitelist';

const ITEMS_TABLE = 'items';
const TAGS_TABLE = 'tags';
const ITEM_TAGS_TABLE = 'item_tags';
const REMINDERS_TABLE = 'reminders';
// 切片 14（AGENTS.md §7.22，schema v6）：分类与全局设置表。
const CATEGORIES_TABLE = 'categories';
const APP_SETTINGS_TABLE = 'app_settings';
// 切片 17 阶段 1（AGENTS.md §7.27，schema v9）：渠道预设表。
const CHANNEL_PRESETS_TABLE = 'channel_presets';

/** repository.md v0.8：导入超过 500 条时分批写入，每批 100 条。 */
const IMPORT_BATCH_SIZE = 100;

/** 切片 8：导入项预处理结果（createImportedItem / importItemsInBatches 共用）。 */
interface PreparedImportedItem {
  title: string;
  content: string;
  startAt: number;
  endAt: number | null;
  allDay: boolean;
  sourceUid: string | null;
}

/** §4.7 默认列表语义：未归档（含 active/done），未删除（本应用不物理删除 Item）。 */
const NOT_ARCHIVED = Q.where('status', Q.notEq('archived'));

/** §4.8 列表与搜索排序约定：updatedAt 降序（并列时以 id 升序保证确定性）。 */
const SORT_BY_UPDATED_DESC = Q.sortBy('updated_at', 'desc');

/**
 * 行内字段级变化也要发射的列清单：WatermelonDB 的 Query.observe() 只在「匹配集合成员」
 * 变化时发射（processChangeSet 按记录集合 diff）；行内 update（如新增保存链第二步
 * updateItemTime 的时间字段、设置页改 Tag/Category 颜色）成员不变，observe() 不发射，
 * 必须用 observeWithColumns 按列订阅。切片 14 阶段 5h 真机实锤（P5Hwk2 时间落库但
 * 列表永远停在「无时间」中态）后统一修正。
 */
const ITEM_WATCH_COLUMNS = [
  'title',
  'content',
  'type',
  'status',
  'start_at',
  'end_at',
  'all_day',
  'category_id',
  'priority',
];
const TAG_WATCH_COLUMNS = ['name', 'color', 'emoji'];
const CATEGORY_WATCH_COLUMNS = ['name', 'color', 'emoji', 'priority'];

/**
 * WatermelonDB Query.observe()（rxjs Observable）只用到 subscribe 的最小结构。
 * 声明为独立接口避免运行时 import rxjs（本工程无 rxjs 直接依赖）。
 */
interface Subscribable<T> {
  subscribe(next: (value: T) => void): { unsubscribe(): void };
}

function toDomainItem(model: ItemModel): Item {
  return {
    id: model.id,
    type: model.type,
    title: model.title,
    content: model.content,
    status: model.status,
    // 切片 6（§4.23）：migration addColumns 对既有行不回填，读取层归一
    // （null → null / all_day null → false），与 createItem 写入的缺省一致。
    startAt: model.startAt ?? null,
    endAt: model.endAt ?? null,
    allDay: model.allDay ?? false,
    // 切片 8（data-model.md v0.8）：外部来源字段，migration 不回填，读取层归一：
    // 迁移前的既有行 → ('local', null, false)；新行由 Repository 写入显式值。
    sourceType: model.sourceType ?? 'local',
    sourceUid: model.sourceUid ?? null,
    sourceReadOnly: model.sourceReadOnly ?? false,
    // 切片 14（AGENTS.md §7.22，schema v6）：分类关联与优先级。
    // category_id 列 isOptional（升级安装迁移以 SQL 回填 'other'）；域层归一为 'other'，
    // 与 sourceType ?? 'local' 同一模式。priority 非可选（迁移对既有行回填 0）。
    categoryId: model.categoryId ?? DEFAULT_CATEGORY_ID,
    priority: model.priority,
    createdAt: model.createdAt.getTime(),
    updatedAt: model.updatedAt.getTime(),
  };
}

function toDomainTag(model: TagModel): Tag {
  return {
    id: model.id,
    name: model.name,
    // 切片 14（AGENTS.md §7.22，schema v6）：标签视觉字段；列 isOptional，既有行迁移回填 null。
    color: model.color ?? null,
    emoji: model.emoji ?? null,
    createdAt: model.createdAt.getTime(),
  };
}

/** 切片 14（§7.22）：categories 行 → 领域 Category。 */
function toDomainCategory(model: CategoryModel): Category {
  return {
    id: model.id,
    name: model.name,
    color: model.color ?? null,
    emoji: model.emoji ?? null,
    priority: model.priority,
  };
}

/**
 * 切片 14（§7.22）：app_settings 行 → 领域 AppSettings。
 * 库中读到非法枚举值（理论上不应出现，如手改数据库）时防御性回退默认值，不抛错。
 * 阶段 7a（schema v7）：小组件显示开关 4 列为非可选 boolean（v7 migration/seed 保证有值），
 * 直接映射；列本身无枚举语义，不存在非法值分支。
 * 切片 18（§7.29，schema v10）：chips_increments 经 parseChipsIncrements 读层防御归一
 * （null/坏 JSON/越界项 → 回退默认 [10, 60]，不抛错——对齐 tagDisplayMode 先例）。
 * 切片 19（§7.30，schema v11）：default_channels_json 经 parseDefaultChannels 读层防御归一
 * （null/坏 JSON/非法渠道/空 → 回退默认 ["system-notification"]；expo 双开保留 canonical
 * 序靠前者；不抛错——同上先例）。
 * 切片 25（§7.37，schema v12）：careful_mode 非可选 boolean 列（v12 migration/seed 保证
 * 有值），直接映射；防御归一——库中读到非 boolean（理论上不应出现，如手改数据库）时
 * 回退默认 false，不抛错（列本身无枚举语义，boolean 归一即可）。
 * 切片 26（§7.38，schema v13）：show_ai_usage 同 careful_mode 先例——非可选 boolean
 * 直接映射，非 boolean 回退默认 false，不抛错。
 * 切片 27（§7.39，schema v14）：display_calendar_ids_json 经 parseDisplayCalendarIds
 * 读层防御归一（null/坏 JSON/非串/空串剔除 → []，不抛错；[] = 功能关闭，合法状态）。
 */
function toDomainSettings(model: AppSettingsModel): AppSettings {
  return {
    tagDisplayMode: isTagDisplayMode(model.tagDisplayMode)
      ? model.tagDisplayMode
      : DEFAULT_APP_SETTINGS.tagDisplayMode,
    widgetShowOverdue: model.widgetShowOverdue,
    widgetShowTodos: model.widgetShowTodos,
    widgetShowCategoryEmoji: model.widgetShowCategoryEmoji,
    widgetShowTags: model.widgetShowTags,
    chipsIncrements: parseChipsIncrements(model.chipsIncrementsJson),
    defaultChannels: parseDefaultChannels(model.defaultChannelsJson),
    carefulMode: typeof model.carefulMode === 'boolean'
      ? model.carefulMode
      : DEFAULT_APP_SETTINGS.carefulMode,
    showAiUsage: typeof model.showAiUsage === 'boolean'
      ? model.showAiUsage
      : DEFAULT_APP_SETTINGS.showAiUsage,
    displayCalendarIds: parseDisplayCalendarIds(model.displayCalendarIdsJson),
    // 切片 30（§7.41，schema v15）：ai_retry_max number isOptional 列——既有行回填
    // null（非可选 number 会回填 0 与「关闭」语义混淆），parseAiRetryMax 归一
    // （null/越界/非整数 → 默认 3，不抛错）；flash_deleted_card_display string
    // isOptional 列——非枚举值回退 'mark'（isFlashDeletedCardDisplay 守卫）。
    aiRetryMax: parseAiRetryMax(model.aiRetryMax),
    flashDeletedCardDisplay: isFlashDeletedCardDisplay(model.flashDeletedCardDisplay)
      ? model.flashDeletedCardDisplay
      : DEFAULT_APP_SETTINGS.flashDeletedCardDisplay,
    // 切片 32（§7.44，schema v16）：show_ai_request / show_ai_response 同
    // careful_mode/show_ai_usage 先例——非可选 boolean 直接映射，非 boolean
    // 回退默认 false，不抛错。
    showAiRequest: typeof model.showAiRequest === 'boolean'
      ? model.showAiRequest
      : DEFAULT_APP_SETTINGS.showAiRequest,
    showAiResponse: typeof model.showAiResponse === 'boolean'
      ? model.showAiResponse
      : DEFAULT_APP_SETTINGS.showAiResponse,
  };
}

/**
 * reminders 行 → 领域 Reminder；weekdays / once_civil_json JSON 解析失败在此抛错
 * （不得静默，§4.18/任务卡）。
 *
 * 渠道读取（切片 18，schema v10）：经 resolveReminderChannelRow 的读层 legacy bridge
 * （all-or-nothing，提案 §4）——未迁移行（channels_json 为 null/''）由旧 channel/
 * channel_config 推导，已迁移行只认新列；防御纪律与切片 16 相同（读层回退不抛错，
 * 写路径仍严格校验 normalizeReminderChannelFields）。
 */
function toDomainReminder(model: ReminderModel): Reminder {
  const channelFields = resolveReminderChannelRow({
    channelsJson: model.channelsJson,
    channelConfigsJson: model.channelConfigsJson,
    legacyChannel: model.channel,
    legacyChannelConfig: model.channelConfig,
  });
  return {
    id: model.id,
    itemId: model.itemId,
    frequency: model.frequency,
    localTimeHour: model.localTimeHour,
    localTimeMinute: model.localTimeMinute,
    weekdays: parseWeekdaysJson(model.weekdaysJson),
    dayOfMonth: model.dayOfMonth,
    onceAt: model.onceCivilJson === null ? null : parseOnceCivilJson(model.onceCivilJson),
    tzid: model.tzid,
    startAt: model.startAt,
    enabled: model.enabled,
    channels: channelFields.channels,
    channelConfigs: channelFields.channelConfigs,
    lastFiredOccurrenceKey: model.lastFiredOccurrenceKey,
    lastReconciledAt: model.lastReconciledAt,
    createdAt: model.createdAt.getTime(),
    updatedAt: model.updatedAt.getTime(),
  };
}

/**
 * 切片 17 阶段 1（AGENTS.md §7.27，schema v9）：channel_presets 行 → 领域 ChannelPreset。
 * type 读到非法值时抛错不静默（parseWeekdaysJson 同纪律）：channel_presets 无 migration
 * 回填、无 '' 零值来源（写路径严格守卫），出现非法值即数据异常。
 */
function toDomainChannelPreset(model: ChannelPresetModel): ChannelPreset {
  if (!isChannelPresetType(model.type)) {
    throw new Error(`channel_presets row ${model.id} has invalid type: ${String(model.type)}`);
  }
  return {
    id: model.id,
    name: model.name,
    type: model.type,
    configJson: model.configJson,
    isDefault: model.isDefault,
    createdAt: model.createdAt.getTime(),
  };
}

/**
 * 渠道预设 configJson 写路径校验：经对应渠道守卫解析，解析失败抛守卫的明确错误
 * （守卫错误自带 'WebhookChannel: ' / 'AppriseChannel: ' 前缀，deliver 与预设写路径
 * 共用同一份校验，保证「存进预设的配置必然能被渠道投递解析」）。
 * 注：从 notifications/channels 导入的是纯 TS 配置守卫（无 expo-notifications / RN 依赖），
 * 与 parseIcs 从 domain 导入同理，不违反 §4.3（UI/domain 不得 import 通知实现）。
 */
function assertValidChannelPresetConfig(
  type: ChannelPresetType,
  configJson: string,
  context: string,
): void {
  if (typeof configJson !== 'string' || configJson.trim().length === 0) {
    throw new Error(`${context}: configJson must be a non-empty JSON string`);
  }
  if (type === 'webhook') {
    parseWebhookChannelConfig(configJson);
  } else {
    parseAppriseChannelConfig(configJson);
  }
}

/**
 * 切片 18（§7.29，提案 §3.3）：取消同 type 其余预设的默认标记（除 exceptId）。
 * 调用方必须已在 db.write 事务内（createChannelPreset / updateChannelPreset），
 * 与目标行的写入构成同一事务，保证「同 type 至多一个 is_default=true」不变量。
 */
async function unsetOtherDefaultPresets(
  db: Database,
  type: ChannelPresetType,
  exceptId: string,
): Promise<void> {
  const defaults = await db
    .get<ChannelPresetModel>(CHANNEL_PRESETS_TABLE)
    .query(Q.where('type', type), Q.where('is_default', true))
    .fetch();
  for (const model of defaults) {
    if (model.id !== exceptId) {
      await model.update((draft) => {
        draft.isDefault = false;
      });
    }
  }
}

// —— 切片 31 阶段 1（AGENTS.md §7.43）：数据快照恢复的深层校验帮手（仓库层）——
// 目的：恢复不写入任何会让读路径（toDomainReminder 等）抛错的行（防砖）：
// reminderRuleMapping 的 parseWeekdaysJson/parseOnceCivilJson 读路径抛错，恢复
// 必须提前把它们拦截为条目级 skipped（isDataSnapshotReminderEntry 只做原始形状面）。

/** channelsJson 列串校验：非空 JSON 数组 + 全元素合法渠道 + 去重后 expo ≤1（互斥）。 */
function isValidSnapshotChannelsJson(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return false;
  }
  const seen: ReminderChannel[] = [];
  let expoCount = 0;
  for (const item of parsed) {
    if (!isReminderChannel(item)) {
      return false;
    }
    if (!seen.includes(item)) {
      seen.push(item);
      if (isExpoReminderChannel(item)) {
        expoCount += 1;
      }
    }
  }
  return expoCount <= 1;
}

/** channelConfigsJson 列串校验：null 已在上层放过；此处要求 JSON 对象且值全为字符串。 */
function isValidSnapshotChannelConfigsJson(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return false;
  }
  return Object.values(parsed).every((value) => typeof value === 'string');
}

/**
 * 数据快照 reminder 条目深层校验（恢复前，失败计 skipped）：
 * - weekdaysJson 可解析（''=空；JSON 数组元素 1–7）——读路径 parseWeekdaysJson 抛错点；
 * - 规则字段一致性（normalizeReminderRuleFields：daily hour/minute 范围、weekly
 *   必有 1–7 weekdays、monthly 必有 1–31 dayOfMonth）；
 * - once 频率必须携带可解析 onceCivilJson；非 null 的 onceCivilJson 一律可解析
 *   （读路径 parseOnceCivilJson 抛错点）；
 * - channelsJson 非空合法渠道数组且 expo ≤1；
 * - channelConfigsJson 为 null 或字符串字典 JSON；
 * - tzid 在白名单内（assertWhitelistedReminderTz）。
 */
function isValidDataSnapshotReminderEntry(entry: DataSnapshotReminder): boolean {
  let weekdays: number[];
  try {
    weekdays = parseWeekdaysJson(entry.weekdaysJson);
  } catch {
    return false;
  }
  try {
    normalizeReminderRuleFields({
      frequency: entry.frequency,
      localTimeHour: entry.localTimeHour,
      localTimeMinute: entry.localTimeMinute,
      weekdays,
      dayOfMonth: entry.dayOfMonth,
    });
  } catch {
    return false;
  }
  if (entry.frequency === 'once' && entry.onceCivilJson === null) {
    return false;
  }
  if (entry.onceCivilJson !== null) {
    try {
      parseOnceCivilJson(entry.onceCivilJson);
    } catch {
      return false;
    }
  }
  if (!isValidSnapshotChannelsJson(entry.channelsJson)) {
    return false;
  }
  if (entry.channelConfigsJson !== null && !isValidSnapshotChannelConfigsJson(entry.channelConfigsJson)) {
    return false;
  }
  try {
    assertWhitelistedReminderTz(entry.tzid);
  } catch {
    return false;
  }
  return true;
}

/**
 * 内存连接：Item × ItemTag × Tag × Category → ItemWithRelations
 * （tags 按 join 的 created_at 升序，即绑定顺序；category 悬挂引用 → null，
 * repository.md v0.14「关联 Category 未找到（数据异常）时 category 返回 null」）。
 */
function joinItemsWithRelations(
  itemModels: ItemModel[],
  joinModels: ItemTagModel[],
  tagModels: TagModel[],
  categoryModels: CategoryModel[],
): ItemWithRelations[] {
  const tagsById = new Map<string, Tag>();
  for (const tagModel of tagModels) {
    tagsById.set(tagModel.id, toDomainTag(tagModel));
  }
  const categoriesById = new Map<string, Category>();
  for (const categoryModel of categoryModels) {
    categoriesById.set(categoryModel.id, toDomainCategory(categoryModel));
  }

  const tagsByItemId = new Map<string, Tag[]>();
  for (const join of joinModels) {
    const tag = tagsById.get(join.tagId);
    if (!tag) {
      continue;
    }
    const list = tagsByItemId.get(join.itemId);
    if (list) {
      list.push(tag);
    } else {
      tagsByItemId.set(join.itemId, [tag]);
    }
  }

  return itemModels.map((itemModel) => ({
    ...toDomainItem(itemModel),
    tags: tagsByItemId.get(itemModel.id) ?? [],
    category: itemModel.categoryId === null
      ? null
      : (categoriesById.get(itemModel.categoryId) ?? null),
  }));
}

/** §4.8：updatedAt 降序；updatedAt 并列时按 id 升序，保证合并去重后的顺序确定。 */
function sortByUpdatedAtDesc(items: ItemWithRelations[]): ItemWithRelations[] {
  return [...items].sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) {
      return b.updatedAt - a.updatedAt;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * 给定 items 查询，批量水合 ItemWithRelations（AGENTS.md §7.23；切片 14 任务卡要求）：
 * 先取 items → 收集 itemIds/categoryIds → Q.oneOf 批量取 item_tags 与 categories
 * → 再按 join 收集 tagIds → Q.oneOf 取 tags → 内存合并。
 * 不用全表 join 查询、不用 model @children/@relation，避免 N+1 与无关数据扫描。
 * Q.oneOf 不接受空数组：集合为空时跳过对应查询。
 */
async function loadItemsWithRelationsByItemQuery(
  db: Database,
  itemQuery: Query<ItemModel>,
): Promise<ItemWithRelations[]> {
  const itemModels = await itemQuery.fetch();
  if (itemModels.length === 0) {
    return [];
  }

  const categoryIds = [...new Set(
    itemModels
      .map((model) => model.categoryId)
      .filter((id): id is string => id !== null),
  )];
  const categoryModels = categoryIds.length === 0
    ? []
    : await db.get<CategoryModel>(CATEGORIES_TABLE)
      .query(Q.where('id', Q.oneOf(categoryIds)))
      .fetch();

  const joinModels = await db.get<ItemTagModel>(ITEM_TAGS_TABLE)
    .query(
      Q.where('item_id', Q.oneOf(itemModels.map((model) => model.id))),
      Q.sortBy('created_at', 'asc'),
    )
    .fetch();

  const tagIds = [...new Set(joinModels.map((join) => join.tagId))];
  const tagModels = tagIds.length === 0
    ? []
    : await db.get<TagModel>(TAGS_TABLE).query(Q.where('id', Q.oneOf(tagIds))).fetch();

  return joinItemsWithRelations(itemModels, joinModels, tagModels, categoryModels);
}

/** 四路 observe 的最小 combineLatest：四者都到达后才投影 onNext；无需引入 rxjs */
function combineLatest4<T1, T2, T3, T4, R>(
  source1: Subscribable<T1>,
  source2: Subscribable<T2>,
  source3: Subscribable<T3>,
  source4: Subscribable<T4>,
  project: (value1: T1, value2: T2, value3: T3, value4: T4) => R,
  onNext: (value: R) => void,
): () => void {
  let value1: T1 | undefined;
  let value2: T2 | undefined;
  let value3: T3 | undefined;
  let value4: T4 | undefined;
  let ready1 = false;
  let ready2 = false;
  let ready3 = false;
  let ready4 = false;

  const emit = (): void => {
    if (
      ready1 && ready2 && ready3 && ready4
      && value1 !== undefined && value2 !== undefined && value3 !== undefined && value4 !== undefined
    ) {
      onNext(project(value1, value2, value3, value4));
    }
  };

  const sub1 = source1.subscribe((value) => { value1 = value; ready1 = true; emit(); });
  const sub2 = source2.subscribe((value) => { value2 = value; ready2 = true; emit(); });
  const sub3 = source3.subscribe((value) => { value3 = value; ready3 = true; emit(); });
  const sub4 = source4.subscribe((value) => { value4 = value; ready4 = true; emit(); });

  return (): void => {
    sub1.unsubscribe();
    sub2.unsubscribe();
    sub3.unsubscribe();
    sub4.unsubscribe();
  };
}

/**
 * ItemRepository 的 WatermelonDB 实现。UI 与业务层不得直接使用本类之外的 WatermelonDB API。
 * Tag.name 唯一性（trim + 大小写不敏感）在本层保证（AGENTS.md §4.4）。
 * 切片 14（AGENTS.md §7.22/§7.23）：所有查询统一水合 ItemWithRelations；
 * categories/app_settings 预置行由 migration（升级安装）或 seedPresetData（全新安装）就位，
 * 写路径与分类/设置入口经 ensureSeeded() 兜底。
 */
export class WatermelonItemRepository implements ItemRepository {
  private readonly db: Database;

  /**
   * 切片 14：seedPresetData 的单次执行缓存（幂等）。
   * undefined = 尚未执行；执行失败时重置回 undefined，允许下次写路径重试。
   */
  private seedPromise: Promise<void> | undefined;

  /**
   * 设备时区读取（切片 8）：allDay startAt 归一化按「设备当前 IANA 时区」执行。
   * 默认实现读 Intl；第二参可注入替换，便于单测固定时区（不改动冻结的
   * ItemRepository 接口，仅影响具体类构造）。
   */
  private readonly deviceTzid: () => string;

  /**
   * 切片 9：系统日历读取与哈希依赖（第三参，可选）。
   * 生产默认 expo-calendar / expo-crypto 实现；测试注入内存实现
   * （原生模块在 Jest 不可用）。现有单参/双参调用点不受影响。
   */
  private readonly systemCalendar: SystemCalendarDeps;

  constructor(
    db: Database,
    deviceTzid: () => string = getDeviceTzid,
    systemCalendar: SystemCalendarDeps = defaultSystemCalendarDeps(),
  ) {
    this.db = db;
    this.deviceTzid = deviceTzid;
    this.systemCalendar = systemCalendar;
  }

  async createItem(input: CreateItemInput): Promise<Item> {
    const title = input.title.trim();
    if (title.length === 0) {
      throw new Error('createItem: title is required');
    }

    // 切片 6（§4.24）：时间字段与 updateItemTime 同一套校验（有限性 + endAt >= startAt）。
    assertValidItemTimePatch({ startAt: input.startAt, endAt: input.endAt });
    // 切片 8（§4.23）：allDay=true 时 startAt 归一为设备时区当天 00:00；区间校验用归一后的值。
    const normalized = normalizeAllDayTimestamps(
      input.startAt ?? null,
      input.endAt ?? null,
      input.allDay ?? false,
      this.deviceTzid(),
    );
    assertValidItemTimeRange(normalized.startAt, normalized.endAt);

    // 切片 14（§7.22/repository.md v0.14）：未传 categoryId 落默认 'other'，未传 priority 落 0；
    // 显式传入 categoryId（含 null→归一后的默认值）时校验分类存在。
    const explicitCategoryId = input.categoryId ?? null;
    const categoryId = explicitCategoryId ?? DEFAULT_CATEGORY_ID;
    const priority = input.priority ?? 0;
    if (!isValidItemPriority(priority)) {
      throw new Error('createItem: priority must be an integer in [0, 3]');
    }
    // 全新安装兜底：预置分类与设置行必须已就位（升级安装由 migration 插入）。
    await this.ensureSeeded();

    const created = await this.db.write(async () => {
      if (explicitCategoryId !== null) {
        await this.assertCategoryExistsInTransaction(categoryId, 'createItem');
      }
      const item = await this.db.get<ItemModel>(ITEMS_TABLE).create((record) => {
        record.type = input.type;
        record.title = title;
        record.content = input.content ?? '';
        record.status = 'active';
        // §4.24：未传时 startAt/endAt 落 null、allDay 落 false。
        record.startAt = normalized.startAt;
        record.endAt = normalized.endAt;
        record.allDay = input.allDay ?? false;
        // 切片 8（data-model.md v0.8）：本地创建固定 ('local', null, false)；
        // 外部来源三字段仅经 createImportedItem 写入。
        record.sourceType = 'local';
        record.sourceUid = null;
        record.sourceReadOnly = false;
        // 切片 14（§7.22）：分类与优先级。
        record.categoryId = categoryId;
        record.priority = priority;
      });
      return item;
    });

    return toDomainItem(created);
  }

  async listItems(): Promise<ItemWithRelations[]> {
    // 切片 14（§7.23）：listItems 升级为完整水合投影。
    return loadItemsWithRelationsByItemQuery(
      this.db,
      this.db.get<ItemModel>(ITEMS_TABLE).query(),
    );
  }

  observeItems(onNext: (items: ItemWithRelations[]) => void): () => void {
    // 切片 14（§7.23）：观察路径同样返回完整水合投影；第四路源为 categories 全表，
    // 分类行变化（改名/换色）也能触发重新投影。
    return combineLatest4(
      this.db
        .get<ItemModel>(ITEMS_TABLE)
        .query(Q.sortBy('created_at', 'desc'))
        // 列订阅：编辑页改标题/内容/时间属行内字段更新（成员不变），observe() 不发射
        .observeWithColumns(ITEM_WATCH_COLUMNS),
      this.itemTagsJoinQuery().observe(),
      this.allTagsQuery().observeWithColumns(TAG_WATCH_COLUMNS),
      this.allCategoriesQuery().observeWithColumns(CATEGORY_WATCH_COLUMNS),
      joinItemsWithRelations,
      onNext,
    );
  }

  async updateItem(id: string, patch: UpdateItemInput): Promise<Item> {
    const updated = await this.db.write(async () => {
      const record = await this.db.get<ItemModel>(ITEMS_TABLE).find(id);
      // 切片 8（data-model.md v0.8）：外部来源只读护栏 —— source_read_only=true 的
      // 导入项禁改 title/content/type；status（完成/取消完成、归档/取消归档）仍可更新。
      if (
        (record.sourceReadOnly ?? false)
        && (patch.title !== undefined || patch.content !== undefined || patch.type !== undefined)
      ) {
        throw new Error(
          'updateItem: item is source read-only (imported); only status may be updated',
        );
      }
      // 切片 14（§7.22/repository.md v0.14）：分类与优先级扩展。
      // categoryId 显式 null → 归一为默认分类 'other'；显式非 null 时校验分类存在。
      let nextCategoryId: string | undefined;
      if (patch.categoryId !== undefined) {
        nextCategoryId = patch.categoryId ?? DEFAULT_CATEGORY_ID;
        await this.assertCategoryExistsInTransaction(nextCategoryId, 'updateItem');
      }
      let nextPriority: number | undefined;
      if (patch.priority !== undefined) {
        if (!isValidItemPriority(patch.priority)) {
          throw new Error('updateItem: priority must be an integer in [0, 3]');
        }
        nextPriority = patch.priority;
      }
      return record.update((draft) => {
        if (patch.title !== undefined) {
          const title = patch.title.trim();
          if (title.length === 0) {
            throw new Error('updateItem: title cannot be empty');
          }
          draft.title = title;
        }
        if (patch.content !== undefined) {
          draft.content = patch.content;
        }
        if (patch.type !== undefined) {
          draft.type = patch.type;
        }
        if (patch.status !== undefined) {
          draft.status = patch.status;
        }
        if (nextCategoryId !== undefined) {
          draft.categoryId = nextCategoryId;
        }
        if (nextPriority !== undefined) {
          draft.priority = nextPriority;
        }
        // updated_at 不在此赋值：WatermelonDB prepareUpdate 内部自动刷新（且列声明为 readonly）。
      });
    });

    return toDomainItem(updated);
  }

  async addTagToItem(itemId: string, tagName: string): Promise<Tag> {
    const { name, dedupKey } = normalizeTagName(tagName);
    if (name.length === 0) {
      throw new Error('addTagToItem: tag name is required');
    }

    return this.db.write(async () => {
      const item = await this.db.get<ItemModel>(ITEMS_TABLE).find(itemId);

      // 大小写不敏感查重：标签量小，全量取出内存比对；命中即复用（AGENTS.md §4.4）。
      const allTags = await this.db.get<TagModel>(TAGS_TABLE).query().fetch();
      const existingTag = allTags.find((tagModel) => tagModel.name.toLowerCase() === dedupKey);

      let tag: TagModel;
      if (existingTag) {
        tag = existingTag;
      } else {
        tag = await this.db.get<TagModel>(TAGS_TABLE).create((record) => {
          record.name = name;
        });
      }

      // 同一 Item 重复添加同一标签时幂等：item_tags 不重复建行。
      const existingJoins = await this.db
        .get<ItemTagModel>(ITEM_TAGS_TABLE)
        .query(Q.where('item_id', itemId), Q.where('tag_id', tag.id))
        .fetch();
      if (existingJoins.length === 0) {
        await this.db.get<ItemTagModel>(ITEM_TAGS_TABLE).create((record) => {
          record.itemId = item.id;
          record.tagId = tag.id;
        });
      }

      return toDomainTag(tag);
    });
  }

  async removeTagFromItem(itemId: string, tagId: string): Promise<void> {
    await this.db.write(async () => {
      const joins = await this.db
        .get<ItemTagModel>(ITEM_TAGS_TABLE)
        .query(Q.where('item_id', itemId), Q.where('tag_id', tagId))
        .fetch();
      await Promise.all(joins.map((join) => join.destroyPermanently()));
      // Tag 本体保留：孤儿标签可继续被「已有标签可点击复用」。
    });
  }

  async listItemsWithTags(): Promise<ItemWithRelations[]> {
    // §4.7：默认列表语义 = 未归档 + 未删除；§4.8：按 updatedAt 降序。
    // 切片 14（§7.23）：升级为 ItemWithRelations 水合。
    return loadItemsWithRelationsByItemQuery(
      this.db,
      this.db.get<ItemModel>(ITEMS_TABLE).query(NOT_ARCHIVED, SORT_BY_UPDATED_DESC),
    );
  }

  /**
   * 搜索（AGENTS.md §4.9，分步实现，禁止单条跨表 OR）：
   * 1. tags 表按 name LIKE 匹配 → tagIds；
   * 2. item_tags 按 tag_id oneOf → itemIds；
   * 3. items 表 title/content LIKE（同表 OR 允许）→ itemIds；
   * 3.5（v0.12）仅当关键词整体解析为日期片段时：items 表取 start_at/end_at
   *    非空行，内存中对格式化日期（设备时区）做子串匹配 → itemIds；
   * 4. 合并去重，取回完整 ItemWithRelations（切片 14 水合），按 updatedAt 降序返回。
   * 空关键词（trim 后为空）直接返回 []，不查库。
   */
  async searchItems(keyword: string): Promise<ItemWithRelations[]> {
    const trimmed = normalizeSearchKeyword(keyword);
    if (trimmed.length === 0) {
      return [];
    }

    // §4.9：特殊字符先转义再用于 Q.like，不得直接拼接原始关键词。
    const likeArg = `%${escapeLikePattern(trimmed)}%`;

    // 第 1 步：标签名命中 → tagIds
    const matchedTags = await this.db
      .get<TagModel>(TAGS_TABLE)
      .query(Q.where('name', Q.like(likeArg)))
      .fetch();
    const tagIds = matchedTags.map((tagModel) => tagModel.id);

    // 第 2 步：tagIds → itemIds（Q.oneOf 不接受空数组，故仅在有命中时执行）
    const matchedItemIds = new Set<string>();
    if (tagIds.length > 0) {
      const joins = await this.db
        .get<ItemTagModel>(ITEM_TAGS_TABLE)
        .query(Q.where('tag_id', Q.oneOf(tagIds)))
        .fetch();
      for (const join of joins) {
        matchedItemIds.add(join.itemId);
      }
    }

    // 第 3 步：title / content 命中（单表内 OR，符合 §4.9 对跨表 OR 的禁令）
    const textMatchedModels = await this.db
      .get<ItemModel>(ITEMS_TABLE)
      .query(Q.or(
        Q.where('title', Q.like(likeArg)),
        Q.where('content', Q.like(likeArg)),
      ))
      .fetch();
    for (const itemModel of textMatchedModels) {
      matchedItemIds.add(itemModel.id);
    }

    // 第 3.5 步（repository.md v0.12）：日期片段命中。LIKE 语义无法对 epoch
    // 数值列匹配 'YYYY-MM-DD' 格式化串，schema v5 冻结不能加生成列，故仅在
    // 关键词整体解析为日期片段时：单表取 start_at/end_at 非空行（同表 OR 允许），
    // 内存中对格式化日期（设备时区 = 构造器注入 deviceTzid，切片 11 来源）做
    // 子串匹配。非日期关键词完全不触发本路径；本路径不过滤 status，与
    // title/content/tag 匹配范围一致（结果并集只增不减）。
    const dateFragment = extractDateFragment(trimmed);
    if (dateFragment !== null) {
      const tzid = this.deviceTzid();
      const scheduledModels = await this.db
        .get<ItemModel>(ITEMS_TABLE)
        .query(Q.or(
          Q.where('start_at', Q.notEq(null)),
          Q.where('end_at', Q.notEq(null)),
        ))
        .fetch();
      for (const scheduledModel of scheduledModels) {
        if (
          matchesDateFragment(scheduledModel.startAt, dateFragment, tzid) ||
          matchesDateFragment(scheduledModel.endAt, dateFragment, tzid)
        ) {
          matchedItemIds.add(scheduledModel.id);
        }
      }
    }

    // 第 4 步：合并去重 → 完整水合投影（§7.23，批量 Q.oneOf 而非全表扫描）→ updatedAt 降序
    if (matchedItemIds.size === 0) {
      return [];
    }
    return sortByUpdatedAtDesc(
      await loadItemsWithRelationsByItemQuery(
        this.db,
        this.db
          .get<ItemModel>(ITEMS_TABLE)
          .query(Q.where('id', Q.oneOf([...matchedItemIds]))),
      ),
    );
  }

  /** 归档：只改 status（AGENTS.md §4.7），不级联改动标签关系，不删除 Item。 */
  async archiveItem(id: string): Promise<void> {
    await this.updateItem(id, { status: 'archived' });
  }

  /** 取消归档：只改 status，恢复进默认列表（MVP 不追踪归档前状态，统一恢复为 active）。 */
  async unarchiveItem(id: string): Promise<void> {
    await this.updateItem(id, { status: 'active' });
  }

  async listArchivedItems(): Promise<ItemWithRelations[]> {
    return loadItemsWithRelationsByItemQuery(
      this.db,
      this.db
        .get<ItemModel>(ITEMS_TABLE)
        .query(Q.where('status', 'archived'), SORT_BY_UPDATED_DESC),
    );
  }

  /**
   * 归档视图查询（repository.md v0.12「搜索与归档增强接口」）：status='archived'，
   * updatedAt 降序，返回 ItemWithRelations。与 v0.3 的 listArchivedItems 同语义并存，
   * 切片 12 决策 C：归档页换调本方法；listArchivedItems 保留不删。
   */
  async listArchivedItemsWithTags(): Promise<ItemWithRelations[]> {
    return loadItemsWithRelationsByItemQuery(
      this.db,
      this.db
        .get<ItemModel>(ITEMS_TABLE)
        .query(Q.where('status', 'archived'), SORT_BY_UPDATED_DESC),
    );
  }

  observeItemsWithTags(onNext: (items: ItemWithRelations[]) => void): () => void {
    return combineLatest4(
      this.db
        .get<ItemModel>(ITEMS_TABLE)
        // 与 listItemsWithTags 同语义：默认列表（§4.7 未归档 + 未删除，§4.8 updatedAt 降序），
        // 否则归档后行内仍滞留在观察列表中。
        .query(NOT_ARCHIVED, SORT_BY_UPDATED_DESC)
        // Query.observe() 只在匹配集合成员变化时发射；行内字段更新（成员不变）不发射。
        // 新增保存链是 createItem → updateItemTime 两步写，第二步的时间字段（start_at 等）
        // 属成员不变的字段级变化——真机实锤列表永远停在「无时间」中态。必须列订阅捕获。
        .observeWithColumns(ITEM_WATCH_COLUMNS),
      this.itemTagsJoinQuery().observe(),
      this.allTagsQuery().observeWithColumns(TAG_WATCH_COLUMNS),
      this.allCategoriesQuery().observeWithColumns(CATEGORY_WATCH_COLUMNS),
      joinItemsWithRelations,
      onNext,
    );
  }

  /** join 投影辅助：全量 item_tags，join 顺序 = created_at 升序（与 loadItemsWithRelationsByItemQuery 一致）。 */
  private itemTagsJoinQuery(): Query<ItemTagModel> {
    return this.db.get<ItemTagModel>(ITEM_TAGS_TABLE).query(Q.sortBy('created_at', 'asc'));
  }

  /** join 投影辅助：全量 tags。 */
  private allTagsQuery(): Query<TagModel> {
    return this.db.get<TagModel>(TAGS_TABLE).query();
  }

  /** join 投影辅助：全量 categories（切片 14，§7.23 水合的第四路 observe 源）。 */
  private allCategoriesQuery(): Query<CategoryModel> {
    return this.db.get<CategoryModel>(CATEGORIES_TABLE).query(Q.sortBy('priority', 'asc'));
  }

  observeTags(onNext: (tags: Tag[]) => void): () => void {
    const subscription = this.db
      .get<TagModel>(TAGS_TABLE)
      .query(Q.sortBy('created_at', 'asc'))
      // 列订阅：设置页改标签颜色/Emoji 属行内字段更新（成员不变），observe() 不发射
      .observeWithColumns(TAG_WATCH_COLUMNS)
      .subscribe((models) => {
        onNext(models.map(toDomainTag));
      });

    return (): void => {
      subscription.unsubscribe();
    };
  }

  /** 切片 14 阶段 3（契约外扩展，先例同 getCategories）：一次性取全部标签；供视觉保存后显式刷新。 */
  async listTags(): Promise<Tag[]> {
    const models = await this.db
      .get<TagModel>(TAGS_TABLE)
      .query(Q.sortBy('created_at', 'asc'))
      .fetch();
    return models.map(toDomainTag);
  }

  /** 契约外扩展（见接口注释）：按 id 取 Item，不存在返回 null（调度器用于完成/归档判定）。 */
  async getItem(id: string): Promise<Item | null> {
    const models = await this.db
      .get<ItemModel>(ITEMS_TABLE)
      .query(Q.where('id', id))
      .fetch();
    return models.length > 0 ? toDomainItem(models[0]) : null;
  }

  /** 切片 6（§4.24 冻结）：按 id 取条目，不存在返回 null（详情页用）；切片 14 起返回完整水合投影。 */
  async getItemById(id: string): Promise<ItemWithRelations | null> {
    const found = await loadItemsWithRelationsByItemQuery(
      this.db,
      this.db.get<ItemModel>(ITEMS_TABLE).query(Q.where('id', id)),
    );
    return found.length > 0 ? found[0] : null;
  }

  /**
   * 切片 30 阶段 4（契约外扩展，见接口注释）：批量 id 存在性查询。
   * Q.oneOf 走 SQLite IN 语义；空输入短路返回空集合（不发查询）。
   */
  async filterExistingItemIds(ids: readonly string[]): Promise<Set<string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Set();
    const models = await this.db
      .get<ItemModel>(ITEMS_TABLE)
      .query(Q.where('id', Q.oneOf(unique)))
      .fetch();
    return new Set(models.map((model) => model.id));
  }

  // —— 切片 28 阶段 1：配置备份快照（repository.md v0.34 注记节；契约外显式扩展成对，
  //    先例 filterExistingItemIds；AGENTS.md §7.42——设置页「备份与恢复」的组包/
  //    恢复落点。⚠️ Model.update()/collection.create() 内部逐个走 db.batch（单 op
  //    即单次 adapter.batch，node_modules/@nozbe/watermelondb/Model/index.js:79-84），
  //    逐 op await 不构成原子事务；本方法按 Database.batch 契约以 prepareUpdate/
  //    prepareCreate 同步收集全部变更、最后一次 this.db.batch(...) 提交（单次
  //    adapter.batch = 适配器级原子，中途失败整体不落库））——

  /** 只读组包配置快照：appSettings 全字段 + categories 全部 + tags 全部（§7.42 D1）。 */
  async createConfigSnapshot(): Promise<ConfigSnapshot> {
    const [appSettings, categories, tags] = await Promise.all([
      this.getSettings(),
      this.getCategories(),
      this.listTags(),
    ]);
    return {
      version: 1,
      kind: 'config',
      exportedAt: formatExportedAt(new Date()),
      appSettings,
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        color: category.color,
        emoji: category.emoji,
        priority: category.priority,
      })),
      tags: tags.map((tag) => ({
        name: tag.name,
        color: tag.color,
        emoji: tag.emoji,
      })),
    };
  }

  /**
   * 增量覆盖恢复（§7.42 D2 冻结语义，repository.md v0.34）：
   * - appSettings 全列覆盖：逐字段经 normalizeSnapshotAppSettings（快照缺列保留
   *   本地、坏值走读层防御归一回退默认、合法值写穿），行不存在时建行；
   * - categories 按 id 命中覆盖 color/emoji/priority，未命中保留不建（不计入
   *   applied/skipped）；形状不符条目计入 skipped；
   * - tags 按 normalizeTagName 归一键（trim + 大小写不敏感，唯一入口，与
   *   addTagToItem 同纪律；本地去重映射 first-wins 对齐其 find() 语义）命中覆盖
   *   color/emoji、未命中创建、本地独有保留；同快照重复名后者覆盖前者（不重复建）；
   * - skipped = categories/tags 形状不符条目数；applied = appSettings 块计 1 +
   *   实际写入的 categories/tags 条目数。
   * 整包守卫不过（version/kind/三大块）直接抛错，不进事务。
   */
  async applyConfigSnapshot(snapshot: ConfigSnapshot): Promise<ConfigSnapshotApplyResult> {
    if (!isConfigSnapshotWire(snapshot)) {
      throw new Error(
        'applyConfigSnapshot: 快照不符合 ConfigSnapshot 结构（version/kind/appSettings/categories/tags）',
      );
    }
    await this.ensureSeeded();
    let applied = 0;
    let skipped = 0;
    await this.db.write(async () => {
      // 1) 事务内全量读取本地 categories/tags/app_settings（读取失败 = 整体不落库）。
      const categoryModels = await this.db.get<CategoryModel>(CATEGORIES_TABLE).query().fetch();
      const categoryById = new Map(categoryModels.map((model) => [model.id, model]));
      const tagModels = await this.db.get<TagModel>(TAGS_TABLE).query().fetch();
      // 本地 tags 键去重 first-wins（addTagToItem allTags.find() 语义）。
      const tagByDedupKey = new Map<string, TagModel>();
      for (const model of tagModels) {
        const key = model.name.toLowerCase();
        if (!tagByDedupKey.has(key)) {
          tagByDedupKey.set(key, model);
        }
      }
      const settingsModels = await this.db
        .get<AppSettingsModel>(APP_SETTINGS_TABLE)
        .query()
        .fetch();
      const settingsModel = settingsModels[0] ?? null;

      // 2) 同步收集全部变更（prepareUpdate/prepareCreate 必须同步送入 batch，
      //    Database.batch 契约），3) 单次 db.batch 提交（适配器级原子）。
      const operations: Model[] = [];

      // categories：id 命中覆盖 color/emoji/priority；未命中保留不建（不计数）。
      for (const entry of snapshot.categories) {
        if (!isConfigSnapshotCategoryEntry(entry)) {
          skipped += 1;
          continue;
        }
        const model = categoryById.get(entry.id);
        if (!model) continue;
        operations.push(
          model.prepareUpdate((draft) => {
            draft.color = entry.color;
            draft.emoji = entry.emoji;
            draft.priority = entry.priority;
          }),
        );
        applied += 1;
      }

      // tags：两遍法——先按归一键归并（同快照重复名后者覆盖，applied 累计），
      // 再统一 prepare；避免对 prepareCreate 后的同批模型调用 prepareUpdate
      // （prepareUpdate 拒绝 pending 记录，中途 throw 会让已 prepare 记录
      // 未同步入 batch 触发 nextTick 不变式）。
      const pendingTagOps = new Map<string, { name: string; color: string | null; emoji: string | null }>();
      for (const entry of snapshot.tags) {
        if (!isConfigSnapshotTagEntry(entry)) {
          skipped += 1;
          continue;
        }
        const { name, dedupKey } = normalizeTagName(entry.name);
        const pending = pendingTagOps.get(dedupKey);
        if (pending) {
          pending.name = name;
          pending.color = entry.color;
          pending.emoji = entry.emoji;
        } else {
          pendingTagOps.set(dedupKey, { name, color: entry.color, emoji: entry.emoji });
        }
        applied += 1;
      }
      for (const [dedupKey, pending] of pendingTagOps) {
        const existing = tagByDedupKey.get(dedupKey);
        if (existing) {
          operations.push(
            existing.prepareUpdate((draft) => {
              draft.color = pending.color;
              draft.emoji = pending.emoji;
            }),
          );
        } else {
          operations.push(
            this.db.get<TagModel>(TAGS_TABLE).prepareCreate((record) => {
              record.name = pending.name;
              record.color = pending.color;
              record.emoji = pending.emoji;
            }),
          );
        }
      }

      // app_settings 全列覆盖：normalize（缺列保留本地）→ 命中行 prepareUpdate /
      // 缺行 prepareCreate（_raw.id 固定 'global'，getSettings 补行先例）。
      const localSettings = settingsModel ? toDomainSettings(settingsModel) : { ...DEFAULT_APP_SETTINGS };
      const normalized = normalizeSnapshotAppSettings(snapshot.appSettings, localSettings);
      const writeSettingsPatch = (draft: AppSettingsModel) => {
        draft.tagDisplayMode = normalized.tagDisplayMode;
        draft.widgetShowOverdue = normalized.widgetShowOverdue;
        draft.widgetShowTodos = normalized.widgetShowTodos;
        draft.widgetShowCategoryEmoji = normalized.widgetShowCategoryEmoji;
        draft.widgetShowTags = normalized.widgetShowTags;
        draft.chipsIncrementsJson = serializeChipsIncrements(normalized.chipsIncrements);
        draft.defaultChannelsJson = serializeDefaultChannels(normalized.defaultChannels);
        draft.displayCalendarIdsJson = serializeDisplayCalendarIds(normalized.displayCalendarIds);
        draft.carefulMode = normalized.carefulMode;
        draft.showAiUsage = normalized.showAiUsage;
        draft.aiRetryMax = validateAiRetryMax(normalized.aiRetryMax);
        draft.flashDeletedCardDisplay = normalized.flashDeletedCardDisplay;
        draft.showAiRequest = normalized.showAiRequest;
        draft.showAiResponse = normalized.showAiResponse;
      };
      if (settingsModel) {
        operations.push(settingsModel.prepareUpdate(writeSettingsPatch));
      } else {
        operations.push(
          this.db.get<AppSettingsModel>(APP_SETTINGS_TABLE).prepareCreate((record) => {
            record._raw.id = APP_SETTINGS_ROW_ID;
            writeSettingsPatch(record);
          }),
        );
      }
      applied += 1;

      await this.db.batch(...operations);
    });
    return { applied, skipped };
  }

  // —— 切片 31 阶段 1：数据备份 WebDAV（AGENTS.md §7.43 D1/D3；repository.md v0.35 注记节）——

  /**
   * 只读组包当前数据快照（§7.43 D1 六块，端口契约外显式扩展成对，先例
   * createConfigSnapshot）：items 全库（listItemsWithTags ∪ listArchivedItemsWithTags，
   * 含 archived/done）全字段 id 保真 + tags（含 id 供 join）+ reminders（v10 语义
   * 列全量；调度态两列与 deprecated 两列不进快照）+ channelPresets + itemTags join
   * 全量（item_tags 直查，不经领域层）。外层 {version:1, kind:'data', exportedAt}。
   */
  async createDataSnapshot(): Promise<DataSnapshot> {
    const [activeItems, archivedItems, reminders, tags, channelPresets, joinModels] =
      await Promise.all([
        this.listItemsWithTags(),
        this.listArchivedItemsWithTags(),
        this.listAllReminders(),
        this.listTags(),
        this.listChannelPresets(),
        this.itemTagsJoinQuery().fetch(),
      ]);
    return {
      version: 1,
      kind: 'data',
      exportedAt: dataSnapshotExportedAt(new Date()),
      items: [...activeItems, ...archivedItems].map((entry) => toDataSnapshotItem(entry)),
      tags: tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        emoji: tag.emoji,
      })),
      reminders: reminders.map((reminder) => ({
        id: reminder.id,
        itemId: reminder.itemId,
        frequency: reminder.frequency,
        localTimeHour: reminder.localTimeHour,
        localTimeMinute: reminder.localTimeMinute,
        weekdaysJson: serializeWeekdays(reminder.weekdays),
        dayOfMonth: reminder.dayOfMonth,
        tzid: reminder.tzid,
        startAt: reminder.startAt,
        enabled: reminder.enabled,
        onceCivilJson: reminder.onceAt === null ? null : serializeOnceCivilJson(reminder.onceAt),
        channelsJson: serializeReminderChannels(reminder.channels),
        channelConfigsJson: serializeReminderChannelConfigs(reminder.channelConfigs),
      })),
      channelPresets: channelPresets.map((preset) => toDataSnapshotChannelPreset(preset)),
      itemTags: joinModels.map((model) => ({ itemId: model.itemId, tagId: model.tagId })),
    };
  }

  /**
   * 增量覆盖恢复（§7.43 D3 冻结语义，切片 28 两遍法照抄）：整包守卫不过抛错不进
   * 事务 → ensureSeeded → 单 db.write（事务内全量读六表 → operations 同步收集 →
   * 单次 db.batch）→ 返回 {applied, skipped}。逐块语义见 ItemRepository.applyDataSnapshot
   * 文档注释。恢复成功后的 reminderScheduler.reconcile() 由调用方显式执行。
   */
  async applyDataSnapshot(snapshot: DataSnapshot): Promise<DataSnapshotApplyResult> {
    if (!isDataSnapshotWire(snapshot)) {
      throw new Error(
        'applyDataSnapshot: 快照不符合 DataSnapshot 结构（version/kind/items/tags/reminders/channelPresets/itemTags）',
      );
    }
    await this.ensureSeeded();
    let applied = 0;
    let skipped = 0;
    await this.db.write(async () => {
      // 1) 事务内全量读取本地相关表（先全读后写：读失败 = 整体不落库）。
      const itemModels = await this.db.get<ItemModel>(ITEMS_TABLE).query().fetch();
      const itemById = new Map(itemModels.map((model) => [model.id, model]));
      const categoryModels = await this.db.get<CategoryModel>(CATEGORIES_TABLE).query().fetch();
      const categoryIds = new Set(categoryModels.map((model) => model.id));
      const tagModels = await this.db.get<TagModel>(TAGS_TABLE).query().fetch();
      const tagByDedupKey = new Map<string, TagModel>();
      for (const model of tagModels) {
        const key = model.name.toLowerCase();
        if (!tagByDedupKey.has(key)) {
          tagByDedupKey.set(key, model);
        }
      }
      const reminderModels = await this.db.get<ReminderModel>(REMINDERS_TABLE).query().fetch();
      const reminderById = new Map(reminderModels.map((model) => [model.id, model]));
      const presetModels = await this.db
        .get<ChannelPresetModel>(CHANNEL_PRESETS_TABLE)
        .query()
        .fetch();
      const presetById = new Map(presetModels.map((model) => [model.id, model]));
      const joinModels = await this.db.get<ItemTagModel>(ITEM_TAGS_TABLE).query().fetch();

      const operations: Model[] = [];

      // —— items：按 id 命中覆盖 / 未命中创建（id 保真）/ 悬挂 categoryId 计 skipped。
      // 快照内重复 id first-wins（同一本地行二次 prepareUpdate 会抛 pending 不变式，
      // 同 id 二次 prepareCreate 会撞主键——统一首条生效、后续计 skipped）。
      const seenItemIds = new Set<string>();
      // 已解析条目集合（快照 item id == 恢复后本地行 id：命中行本就同 id，新建行
      // _raw.id 写快照 id），供 reminders 的 item_id 与 itemTags 重建解析。
      const resolvedItemIds = new Set<string>();
      for (const entry of snapshot.items) {
        if (!isDataSnapshotItemEntry(entry)) {
          skipped += 1;
          continue;
        }
        if (seenItemIds.has(entry.id)) {
          skipped += 1;
          continue;
        }
        seenItemIds.add(entry.id);
        if (!categoryIds.has(entry.categoryId)) {
          // categoryId 悬挂引用（快照指向不存在的分类）：跳过该条目（提案 §4.2）。
          skipped += 1;
          continue;
        }
        const existing = itemById.get(entry.id);
        if (existing) {
          // 命中覆盖：11 业务字段写穿；createdAt 不动、updatedAt 由 prepareUpdate
          // 自动刷新（时间戳保真语义，提案 §4.2）。
          operations.push(
            existing.prepareUpdate((draft) => {
              draft.type = entry.type;
              draft.title = entry.title;
              draft.content = entry.content;
              draft.status = entry.status;
              draft.startAt = entry.startAt;
              draft.endAt = entry.endAt;
              draft.allDay = entry.allDay;
              draft.sourceType = entry.sourceType;
              draft.sourceUid = entry.sourceUid;
              draft.sourceReadOnly = entry.sourceReadOnly;
              draft.categoryId = entry.categoryId;
              draft.priority = entry.priority;
            }),
          );
        } else {
          // 未命中创建：id/created_at/updated_at 保真经 prepareCreateFromDirtyRaw
          // （WatermelonDB sync apply 官方建行路径，sanitizedRaw 按列消毒；_status
          // 'created' 与应用自建行一致）。快照条目已过谓词（有限数字/布尔/串），
          // 消毒为透传。
          operations.push(
            this.db.get<ItemModel>(ITEMS_TABLE).prepareCreateFromDirtyRaw({
              id: entry.id,
              _status: 'created',
              _changed: '',
              type: entry.type,
              title: entry.title,
              content: entry.content,
              status: entry.status,
              start_at: entry.startAt,
              end_at: entry.endAt,
              all_day: entry.allDay,
              source_type: entry.sourceType,
              source_uid: entry.sourceUid,
              source_read_only: entry.sourceReadOnly,
              category_id: entry.categoryId,
              priority: entry.priority,
              created_at: entry.createdAt,
              updated_at: entry.updatedAt,
            }),
          );
        }
        resolvedItemIds.add(entry.id);
        applied += 1;
      }

      // —— tags：按 normalizeTagName 归一键命中覆盖 / 未命中创建（带快照 id）；
      // name 为业务键命中行不写；快照内重复名 first-wins（提案 §4.2：与配置快照
      // 「后者覆盖」刻意不同——数据快照的 tag id 是 itemTags join 锚点，首条即建
      // 映射，后续重复名条目计 skipped 但其 id 仍映射首条解析行保 join 可解析）。
      const tagResolution = new Map<string, string>(); // 快照 tag id → 本地行 id
      const tagKeyResolution = new Map<string, string>(); // 归一键 → 本地行 id（first-wins）
      const pendingTagOps: Array<{
        model: TagModel | null;
        id: string;
        name: string;
        color: string | null;
        emoji: string | null;
      }> = [];
      for (const entry of snapshot.tags) {
        if (!isDataSnapshotTagEntry(entry)) {
          skipped += 1;
          continue;
        }
        const { name, dedupKey } = normalizeTagName(entry.name);
        const resolvedRowId = tagKeyResolution.get(dedupKey);
        if (resolvedRowId !== undefined) {
          tagResolution.set(entry.id, resolvedRowId);
          skipped += 1;
          continue;
        }
        const existing = tagByDedupKey.get(dedupKey) ?? null;
        pendingTagOps.push({
          model: existing,
          id: entry.id,
          name,
          color: entry.color,
          emoji: entry.emoji,
        });
        const localId = existing ? existing.id : entry.id;
        tagKeyResolution.set(dedupKey, localId);
        tagResolution.set(entry.id, localId);
        applied += 1;
      }
      for (const pending of pendingTagOps) {
        if (pending.model) {
          operations.push(
            pending.model.prepareUpdate((draft) => {
              draft.color = pending.color;
              draft.emoji = pending.emoji;
            }),
          );
        } else {
          operations.push(
            this.db.get<TagModel>(TAGS_TABLE).prepareCreate((record) => {
              record._raw.id = pending.id;
              record.name = pending.name;
              record.color = pending.color;
              record.emoji = pending.emoji;
            }),
          );
        }
      }

      // —— reminders：深层校验（防砖）→ 按 id 命中覆盖写穿 v10 语义列 / 未命中创建；
      // item_id 不改（命中）、调度态两列（last_fired_occurrence_key/last_reconciled_at）
      // 不写（防丢本地调度状态）、deprecated 两列新建行兜底 'system-notification'/null。
      const seenReminderIds = new Set<string>();
      const reminderUpdates: Array<{ model: ReminderModel; entry: DataSnapshotReminder }> = [];
      const reminderCreates: Array<{ entry: DataSnapshotReminder; targetItemId: string }> = [];
      for (const entry of snapshot.reminders) {
        if (!isDataSnapshotReminderEntry(entry)) {
          skipped += 1;
          continue;
        }
        if (seenReminderIds.has(entry.id)) {
          skipped += 1;
          continue;
        }
        seenReminderIds.add(entry.id);
        if (!isValidDataSnapshotReminderEntry(entry)) {
          skipped += 1;
          continue;
        }
        const existing = reminderById.get(entry.id);
        if (existing) {
          // 命中覆盖：item_id 不改（提案 §4.2）、调度态两列不写。
          reminderUpdates.push({ model: existing, entry });
        } else {
          // 未命中创建：仅要求快照 itemId 指向本轮已解析 item（未在快照中的本地
          // item 不承接新提醒，悬挂计 skipped，提案 §4.2）。
          if (!resolvedItemIds.has(entry.itemId)) {
            skipped += 1;
            continue;
          }
          reminderCreates.push({ entry, targetItemId: entry.itemId });
        }
        applied += 1;
      }
      for (const { model, entry } of reminderUpdates) {
        operations.push(
          model.prepareUpdate((draft) => {
            draft.frequency = entry.frequency;
            draft.localTimeHour = entry.localTimeHour;
            draft.localTimeMinute = entry.localTimeMinute;
            draft.weekdaysJson = entry.weekdaysJson;
            draft.dayOfMonth = entry.dayOfMonth;
            draft.tzid = entry.tzid;
            draft.startAt = entry.startAt;
            draft.enabled = entry.enabled;
            draft.onceCivilJson = entry.onceCivilJson;
            draft.channelsJson = entry.channelsJson;
            draft.channelConfigsJson = entry.channelConfigsJson;
          }),
        );
      }
      for (const { entry, targetItemId } of reminderCreates) {
        operations.push(
          this.db.get<ReminderModel>(REMINDERS_TABLE).prepareCreate((record) => {
            record._raw.id = entry.id;
            record.itemId = targetItemId;
            record.frequency = entry.frequency;
            record.localTimeHour = entry.localTimeHour;
            record.localTimeMinute = entry.localTimeMinute;
            record.weekdaysJson = entry.weekdaysJson;
            record.dayOfMonth = entry.dayOfMonth;
            record.tzid = entry.tzid;
            record.startAt = entry.startAt;
            record.enabled = entry.enabled;
            record.onceCivilJson = entry.onceCivilJson;
            // deprecated 两列兜底（v8 迁移回填语义）：channelsJson 恒非 null，读层
            // legacy bridge 不会回退到这两列，写默认值仅为列完整性。
            record.channel = DEFAULT_REMINDER_CHANNEL;
            record.channelConfig = null;
            record.channelsJson = entry.channelsJson;
            record.channelConfigsJson = entry.channelConfigsJson;
          }),
        );
      }

      // —— channelPresets：按 id 命中覆盖 name/configJson/isDefault（type 创建后
      // 不可变：与本地行 type 不匹配计 skipped，代码注释披露）/未命中创建（id 保真）；
      // configJson 经渠道配置守卫校验（失败计 skipped）；同 type 单 default 规范化
      // （slice-18 §3.3 不变量跨恢复事务成立：快照序最后一个声明 default 的行生效，
      // 同 type 其余行——含本地独有——收敛为 false；快照未声明 default 的 type 不动本地）。
      const seenPresetIds = new Set<string>();
      const pendingPresetOps: Array<{ model: ChannelPresetModel | null; entry: DataSnapshotChannelPreset }> = [];
      for (const entry of snapshot.channelPresets) {
        if (!isDataSnapshotChannelPresetEntry(entry)) {
          skipped += 1;
          continue;
        }
        if (seenPresetIds.has(entry.id)) {
          skipped += 1;
          continue;
        }
        seenPresetIds.add(entry.id);
        const existing = presetById.get(entry.id) ?? null;
        if (existing && existing.type !== entry.type) {
          skipped += 1;
          continue;
        }
        try {
          assertValidChannelPresetConfig(entry.type, entry.configJson, 'applyDataSnapshot');
        } catch {
          skipped += 1;
          continue;
        }
        pendingPresetOps.push({ model: existing, entry });
        applied += 1;
      }
      const pendingPresetModelIds = new Set<string>();
      for (const op of pendingPresetOps) {
        if (op.model !== null) {
          pendingPresetModelIds.add(op.model.id);
        }
      }
      const lastDefaultByType = new Map<ChannelPresetType, string>(); // type → 生效 default 行 id
      for (const pending of pendingPresetOps) {
        if (pending.entry.isDefault) {
          lastDefaultByType.set(pending.entry.type, pending.model ? pending.model.id : pending.entry.id);
        }
      }
      for (const pending of pendingPresetOps) {
        const rowId = pending.model ? pending.model.id : pending.entry.id;
        const isDefault = lastDefaultByType.get(pending.entry.type) === rowId;
        if (pending.model) {
          operations.push(
            pending.model.prepareUpdate((draft) => {
              draft.name = pending.entry.name;
              draft.configJson = pending.entry.configJson;
              draft.isDefault = isDefault;
            }),
          );
        } else {
          operations.push(
            this.db.get<ChannelPresetModel>(CHANNEL_PRESETS_TABLE).prepareCreate((record) => {
              record._raw.id = pending.entry.id;
              record.name = pending.entry.name;
              record.type = pending.entry.type;
              record.configJson = pending.entry.configJson;
              record.isDefault = isDefault;
            }),
          );
        }
      }
      // 本地独有 default 收敛：快照声明了 default 的 type，其本地其余 default 行置
      // false（已在 pendingPresetOps 的行上面按最终值写过，跳过防 pending 二次
      // prepareUpdate 抛不变式）。
      for (const [type, defaultId] of lastDefaultByType) {
        for (const model of presetModels) {
          if (
            model.type === type &&
            model.id !== defaultId &&
            model.isDefault &&
            !pendingPresetModelIds.has(model.id)
          ) {
            operations.push(
              model.prepareUpdate((draft) => {
                draft.isDefault = false;
              }),
            );
          }
        }
      }

      // —— itemTags：对每个已解析快照 item 删除现有全部 join + 按快照重建
      // （join 表无其他消费方，重建幂等）；声明里 itemId/tagId 解析失败计 skipped，
      // 重复 join 声明 first-wins（防同 join 双建）。删除不计 applied，新建 join 各计 1。
      const joinsByItemId = new Map<string, ItemTagModel[]>();
      for (const model of joinModels) {
        const list = joinsByItemId.get(model.itemId) ?? [];
        list.push(model);
        joinsByItemId.set(model.itemId, list);
      }
      const declaredTagIdsByItemId = new Map<string, string[]>();
      for (const entry of snapshot.itemTags) {
        if (!isDataSnapshotItemTagEntry(entry)) {
          skipped += 1;
          continue;
        }
        if (!resolvedItemIds.has(entry.itemId)) {
          skipped += 1;
          continue;
        }
        const localTagId = tagResolution.get(entry.tagId);
        if (localTagId === undefined) {
          skipped += 1;
          continue;
        }
        const list = declaredTagIdsByItemId.get(entry.itemId) ?? [];
        if (list.includes(localTagId)) {
          skipped += 1;
          continue;
        }
        list.push(localTagId);
        declaredTagIdsByItemId.set(entry.itemId, list);
      }
      for (const itemId of resolvedItemIds) {
        for (const joinModel of joinsByItemId.get(itemId) ?? []) {
          operations.push(joinModel.prepareDestroyPermanently());
        }
        for (const tagId of declaredTagIdsByItemId.get(itemId) ?? []) {
          operations.push(
            this.db.get<ItemTagModel>(ITEM_TAGS_TABLE).prepareCreate((record) => {
              record.itemId = itemId;
              record.tagId = tagId;
            }),
          );
          applied += 1;
        }
      }

      await this.db.batch(...operations);
    });
    return { applied, skipped };
  }

  /**
   * 切片 6（§4.24 冻结）：只更新时间字段；updatedAt 由 prepareUpdate 自动刷新。
   * - patch 值必须为有限数字或 null（NaN/Infinity 抛错）；
   * - 合并既有值后，startAt/endAt 同时非 null 时校验 endAt >= startAt；
   * - 切片 8（§4.23）：合并后 allDay=true（含经 patch 翻转为 true）时 startAt
   *   归一为设备时区当天 00:00，区间校验与落库均用归一后的值；
   * - 切片 8 只读护栏（data-model.md「source_read_only」）：sourceReadOnly=true 的
   *   条目「不可编辑时间」，本方法对其抛错（与 updateItem 的标题/内容护栏同一逻辑；
   *   既有本地行 sourceReadOnly=false 不受影响）。
   * - 不改 createdAt，不触碰 title/content/type/status（时间只走本方法）。
   */
  async updateItemTime(
    id: string,
    patch: { startAt?: number | null; endAt?: number | null; allDay?: boolean },
  ): Promise<Item> {
    assertValidItemTimePatch(patch);

    const updated = await this.db.write(async () => {
      const record = await this.db.get<ItemModel>(ITEMS_TABLE).find(id);
      if (record.sourceReadOnly ?? false) {
        throw new Error(
          'updateItemTime: item is source read-only (imported); time fields may not be updated',
        );
      }
      const nextStartAt = patch.startAt !== undefined ? patch.startAt : (record.startAt ?? null);
      const nextEndAt = patch.endAt !== undefined ? patch.endAt : (record.endAt ?? null);
      const nextAllDay = patch.allDay !== undefined ? patch.allDay : (record.allDay ?? false);
      const normalized = normalizeAllDayTimestamps(nextStartAt, nextEndAt, nextAllDay, this.deviceTzid());
      assertValidItemTimeRange(normalized.startAt, normalized.endAt);

      // 仅在值确实变化时赋值，避免无谓的 updatedAt 刷新（如仅翻转 allDay 之外的空 patch）。
      const shouldWriteStartAt = patch.startAt !== undefined || normalized.startAt !== nextStartAt;
      const shouldWriteEndAt = patch.endAt !== undefined || normalized.endAt !== nextEndAt;

      return record.update((draft) => {
        if (shouldWriteStartAt) {
          draft.startAt = normalized.startAt;
        }
        if (shouldWriteEndAt) {
          draft.endAt = normalized.endAt;
        }
        if (patch.allDay !== undefined) {
          draft.allDay = patch.allDay;
        }
      });
    });

    return toDomainItem(updated);
  }

  // —— 切片 8：ICS 导入导出（repository.md「ICS 导入导出接口（v0.8，切片 8 落地）」）——

  /**
   * 导入项公共预处理：标题 trim 非空、时间 patch 校验、allDay 归一化、区间校验。
   * createImportedItem 与 importItemsInBatches 共用，保证两条入口语义一致。
   */
  private prepareImportedItem(input: ImportedItemInput): PreparedImportedItem {
    const title = input.title.trim();
    if (title.length === 0) {
      throw new Error('createImportedItem: title must not be blank');
    }
    assertValidItemTimePatch({ startAt: input.startAt, endAt: input.endAt });
    const normalized = normalizeAllDayTimestamps(
      input.startAt,
      input.endAt,
      input.allDay ?? false,
      this.deviceTzid(),
    );
    assertValidItemTimeRange(normalized.startAt, normalized.endAt);
    if (normalized.startAt === null) {
      // ImportedItemInput.startAt 为必填 number，透传路径不会产生 null；此分支仅为收窄类型。
      throw new Error('createImportedItem: startAt must not be null');
    }
    return {
      title,
      content: input.content ?? '',
      startAt: normalized.startAt,
      endAt: normalized.endAt,
      allDay: input.allDay ?? false,
      sourceUid: input.sourceUid,
    };
  }

  /**
   * repository.md v0.8 去重：sourceUid 非 null 且 (sourceType='ics', sourceUid) 已存在时
   * 抛 DuplicateSourceUid；sourceUid 为 null 的 ICS 事件（无 UID）每次都作为新项插入。
   * 必须在调用方的 db.write 事务内执行（与插入同事务，防并发窗口）。
   */
  private async assertNoDuplicateSourceUid(sourceUid: string | null): Promise<void> {
    if (sourceUid === null) {
      return;
    }
    const duplicates = await this.db
      .get<ItemModel>(ITEMS_TABLE)
      .query(Q.where('source_type', 'ics'), Q.where('source_uid', sourceUid))
      .fetchCount();
    if (duplicates > 0) {
      throw new Error(
        `DuplicateSourceUid: an item with sourceType=ics, sourceUid=${sourceUid} already exists`,
      );
    }
  }

  /** 预处理行的落库（调用方必须已处于 db.write 事务内）；type='event'/status='active' 为契约固定值。 */
  private async insertImportedItemInTransaction(prepared: PreparedImportedItem): Promise<ItemWithTags> {
    const created = await this.db.get<ItemModel>(ITEMS_TABLE).create((record) => {
      record.type = 'event';
      record.title = prepared.title;
      record.content = prepared.content;
      record.status = 'active';
      record.startAt = prepared.startAt;
      record.endAt = prepared.endAt;
      record.allDay = prepared.allDay;
      // 契约固定：导入项 sourceType='ics'、sourceReadOnly=true。
      record.sourceType = 'ics';
      record.sourceUid = prepared.sourceUid;
      record.sourceReadOnly = true;
      // 切片 14（§7.22）：导入项固定默认分类与无优先级。
      record.categoryId = DEFAULT_CATEGORY_ID;
      record.priority = 0;
    });
    return { ...toDomainItem(created), tags: [] };
  }

  async createImportedItem(input: ImportedItemInput): Promise<ItemWithTags> {
    const prepared = this.prepareImportedItem(input);
    // 切片 14：导入项落默认分类 'other'，先保证预置行就位。
    await this.ensureSeeded();
    return this.db.write(async () => {
      await this.assertNoDuplicateSourceUid(prepared.sourceUid);
      return this.insertImportedItemInTransaction(prepared);
    });
  }

  /**
   * 切片 9：sourceType 参数放宽为 ItemSourceType（AGENTS.md §7.15，v0.9 授权）；
   * 查询结构与 v0.8 相同（(source_type, source_uid) 二元组唯一命中）。
   */
  async findItemBySource(
    sourceType: ItemSourceType,
    sourceUid: string,
  ): Promise<ItemWithRelations | null> {
    const found = await loadItemsWithRelationsByItemQuery(
      this.db,
      this.db
        .get<ItemModel>(ITEMS_TABLE)
        .query(Q.where('source_type', sourceType), Q.where('source_uid', sourceUid)),
    );
    return found[0] ?? null;
  }

  async listItemsForExport(filter: {
    includeArchived: false;
    includeDone: true;
  }): Promise<ItemWithRelations[]> {
    // MVP 只支持固定 filter（repository.md v0.8）；运行时显式拒绝其他组合。
    if (filter.includeArchived !== false || filter.includeDone !== true) {
      throw new Error(
        'listItemsForExport: only the fixed MVP filter {includeArchived: false, includeDone: true} is supported',
      );
    }
    return loadItemsWithRelationsByItemQuery(
      this.db,
      this.db
        .get<ItemModel>(ITEMS_TABLE)
        .query(NOT_ARCHIVED, Q.sortBy('created_at', 'asc')),
    );
  }

  async updateImportedItemTime(
    id: string,
    patch: { startAt?: number | null; endAt?: number | null; allDay?: boolean },
  ): Promise<Item> {
    // 与 updateItemTime 同语义（含只读拒绝）：sourceReadOnly=true 时 updateItemTime 抛错。
    return this.updateItemTime(id, patch);
  }

  /**
   * 契约外显式扩展：删除本地副本（data-model.md v0.8「删除即从本地库移除，
   * 不影响外部来源」）。关联 reminders 与 item_tags 一并物理删除；tags 保留。
   */
  async deleteItem(id: string): Promise<void> {
    await this.db.write(async () => {
      const record = await this.db.get<ItemModel>(ITEMS_TABLE).find(id);
      const reminders = await this.db
        .get<ReminderModel>(REMINDERS_TABLE)
        .query(Q.where('item_id', id))
        .fetch();
      for (const reminder of reminders) {
        await reminder.destroyPermanently();
      }
      const itemTags = await this.db
        .get<ItemTagModel>(ITEM_TAGS_TABLE)
        .query(Q.where('item_id', id))
        .fetch();
      for (const itemTag of itemTags) {
        await itemTag.destroyPermanently();
      }
      await record.destroyPermanently();
    });
  }

  /**
   * 契约外显式扩展：批量导入（repository.md v0.8 约束）——每批 100 条一个事务；
   * 批内单条失败只记入失败清单（重复计入 skippedDuplicateCount），不影响已成功项落库。
   */
  async importItemsInBatches(inputs: ImportedItemInput[]): Promise<ImportBatchResult> {
    const result: ImportBatchResult = { createdCount: 0, skippedDuplicateCount: 0, failures: [] };
    // 切片 14：导入项落默认分类 'other'，先保证预置行就位。
    await this.ensureSeeded();
    for (let offset = 0; offset < inputs.length; offset += IMPORT_BATCH_SIZE) {
      const batch = inputs.slice(offset, offset + IMPORT_BATCH_SIZE);
      await this.db.write(async () => {
        for (const input of batch) {
          try {
            const prepared = this.prepareImportedItem(input);
            await this.assertNoDuplicateSourceUid(prepared.sourceUid);
            await this.insertImportedItemInTransaction(prepared);
            result.createdCount += 1;
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            if (reason.startsWith('DuplicateSourceUid')) {
              result.skippedDuplicateCount += 1;
            } else {
              result.failures.push({ title: input.title, sourceUid: input.sourceUid, reason });
            }
          }
        }
      });
    }
    return result;
  }

  // —— 切片 9：系统日历导入（repository.md「系统日历导入接口（v0.9，切片 9 落地）」）——

  /**
   * 切片 9 系统日历导入管线：
   * reader 读取 → startDate 不可解析分流 failed → 范围过滤（overlapsRange 语义）→
   * 按 100 条/批分批（沿用 importItemsInBatches 约束），批内逐条：
   * 映射（sourceUid 解析）→ (system-calendar, uid) 去重查询 →
   * 命中且 sourceReadOnly=true 计 skippedDuplicate；命中且 sourceReadOnly=false 计
   * skippedReadOnlyConflict（不覆盖本地项）；未命中 → 落库（type='event'/
   * sourceType='system-calendar'/sourceReadOnly=true，allDay 归一化与 ICS 共用预处理）。
   * 批内单条失败只记入 failed，不影响其他条落库。
   */
  async importSystemCalendarEvents(input: SystemCalendarImportInput): Promise<SystemImportResult> {
    const { calendarIds, rangeStartMs, rangeEndMs } = input;
    if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs)) {
      throw new Error('importSystemCalendarEvents: rangeStartMs/rangeEndMs must be finite numbers');
    }
    if (rangeStartMs >= rangeEndMs) {
      throw new Error('importSystemCalendarEvents: rangeStartMs must be earlier than rangeEndMs');
    }
    const distinctCalendarIds = [
      ...new Set(calendarIds.filter((id) => typeof id === 'string' && id.length > 0)),
    ];

    const events: SystemCalendarEvent[] =
      distinctCalendarIds.length === 0
        ? []
        : await this.systemCalendar.reader.getEvents(distinctCalendarIds, rangeStartMs, rangeEndMs);

    const result: SystemImportResult = {
      imported: 0,
      skippedDuplicate: 0,
      skippedReadOnlyConflict: 0,
      failed: [],
      totalRead: events.length,
      outOfRangeCount: 0,
      sourceUidStrategies: { 'event-id': 0, 'content-hash': 0 },
    };

    // 切片 14：导入项落默认分类 'other'，先保证预置行就位。
    await this.ensureSeeded();

    // startDate 不可解析的事件无法参与范围过滤与去重 → 直接分流 failed。
    const parseable: SystemCalendarEvent[] = [];
    for (const event of events) {
      if (event.startDate === null || !Number.isFinite(event.startDate)) {
        result.failed.push({
          externalId: event.externalId,
          title: systemEventDisplayTitle(event.title),
          reason: '事件缺少有效的开始时间（startDate 不可解析）',
        });
      } else {
        parseable.push(event);
      }
    }

    const inRange = filterEventsInRange(parseable, rangeStartMs, rangeEndMs);
    result.outOfRangeCount = parseable.length - inRange.length;

    for (let offset = 0; offset < inRange.length; offset += IMPORT_BATCH_SIZE) {
      const batch = inRange.slice(offset, offset + IMPORT_BATCH_SIZE);
      await this.db.write(async () => {
        for (const event of batch) {
          try {
            const mapped = await mapSystemEventToImportedItem(event, this.systemCalendar.sha256);
            // 去重键复用 findItemBySource 的 (source_type, source_uid) 查询结构，
            // 与落库同事务执行（防并发窗口，与 assertNoDuplicateSourceUid 同一原则）。
            const existing = await this.findSystemCalendarDuplicateInTransaction(mapped.sourceUid);
            if (existing !== null) {
              if (existing.sourceReadOnly === true) {
                result.skippedDuplicate += 1;
              } else {
                result.skippedReadOnlyConflict += 1;
              }
            } else {
              await this.insertSystemCalendarItemInTransaction(mapped.input);
              result.imported += 1;
            }
            result.sourceUidStrategies[mapped.strategy] += 1;
          } catch (error) {
            result.failed.push({
              externalId: event.externalId,
              title: systemEventDisplayTitle(event.title),
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }
      });
    }
    return result;
  }

  /**
   * (source_type='system-calendar', source_uid) 去重查询（必须已在 db.write 事务内）。
   * 查询结构与 findItemBySource 一致（契约「去重键复用 findItemBySource」）；
   * 硬编码 sourceType 以免放宽后的参数被误用为任意来源探测。
   */
  private async findSystemCalendarDuplicateInTransaction(
    sourceUid: string,
  ): Promise<ItemWithRelations | null> {
    const found = await loadItemsWithRelationsByItemQuery(
      this.db,
      this.db
        .get<ItemModel>(ITEMS_TABLE)
        .query(Q.where('source_type', 'system-calendar'), Q.where('source_uid', sourceUid)),
    );
    return found[0] ?? null;
  }

  /** 系统日历项落库（调用方必须已处于 db.write 事务内）；type='event'/status='active' 为契约固定值。 */
  private async insertSystemCalendarItemInTransaction(input: ImportedItemInput): Promise<void> {
    const prepared = this.prepareImportedItem(input);
    await this.db.get<ItemModel>(ITEMS_TABLE).create((record) => {
      record.type = 'event';
      record.title = prepared.title;
      record.content = prepared.content;
      record.status = 'active';
      record.startAt = prepared.startAt;
      record.endAt = prepared.endAt;
      record.allDay = prepared.allDay;
      // 契约固定（AGENTS.md §7.15）：系统日历导入项 sourceType='system-calendar'、sourceReadOnly=true。
      record.sourceType = 'system-calendar';
      record.sourceUid = prepared.sourceUid;
      record.sourceReadOnly = true;
      // 切片 14（§7.22）：导入项固定默认分类与无优先级。
      record.categoryId = DEFAULT_CATEGORY_ID;
      record.priority = 0;
    });
  }

  // —— 切片 17 阶段 2：系统日历导入预览（repository.md v0.17 补记，契约外显式扩展）——

  /**
   * 读取 + 映射 + 标记去重，纯读不写：与 importSystemCalendarEvents 共用同一套
   * 校验/分流/映射管道（不含落库与事务），确认导入走 importSystemCalendarEntries。
   * 去重标记为无事务纯读（预览与确认之间的竞态由确认落库时的同键重查兜底，
   * 与 generateIcsPreview 同一原则）。
   */
  async generateSystemCalendarPreview(
    input: SystemCalendarImportInput,
  ): Promise<SystemCalendarPreviewResult> {
    const { calendarIds, rangeStartMs, rangeEndMs } = input;
    if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs)) {
      throw new Error(
        'generateSystemCalendarPreview: rangeStartMs/rangeEndMs must be finite numbers',
      );
    }
    if (rangeStartMs >= rangeEndMs) {
      throw new Error(
        'generateSystemCalendarPreview: rangeStartMs must be earlier than rangeEndMs',
      );
    }
    const distinctCalendarIds = [
      ...new Set(calendarIds.filter((id) => typeof id === 'string' && id.length > 0)),
    ];

    const events: SystemCalendarEvent[] =
      distinctCalendarIds.length === 0
        ? []
        : await this.systemCalendar.reader.getEvents(distinctCalendarIds, rangeStartMs, rangeEndMs);

    const result: SystemCalendarPreviewResult = {
      entries: [],
      failures: [],
      totalRead: events.length,
      outOfRangeCount: 0,
    };

    // startDate 不可解析的事件无法参与范围过滤与去重 → 直接分流 failed（与导入一致）。
    const parseable: SystemCalendarEvent[] = [];
    for (const event of events) {
      if (event.startDate === null || !Number.isFinite(event.startDate)) {
        result.failures.push({
          externalId: event.externalId,
          title: systemEventDisplayTitle(event.title),
          reason: '事件缺少有效的开始时间（startDate 不可解析）',
        });
      } else {
        parseable.push(event);
      }
    }

    const inRange = filterEventsInRange(parseable, rangeStartMs, rangeEndMs);
    result.outOfRangeCount = parseable.length - inRange.length;

    for (const event of inRange) {
      try {
        const mapped = await mapSystemEventToImportedItem(event, this.systemCalendar.sha256);
        // 查询结构与 findSystemCalendarDuplicateInTransaction 一致；预览阶段无写事务。
        const found = await loadItemsWithRelationsByItemQuery(
          this.db,
          this.db
            .get<ItemModel>(ITEMS_TABLE)
            .query(
              Q.where('source_type', 'system-calendar'),
              Q.where('source_uid', mapped.sourceUid),
            ),
        );
        const existing = found[0] ?? null;
        result.entries.push({
          input: mapped.input,
          isDuplicate: existing !== null,
          existingItemId: existing?.id ?? null,
          externalId: event.externalId,
        });
      } catch (error) {
        result.failures.push({
          externalId: event.externalId,
          title: systemEventDisplayTitle(event.title),
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return result;
  }

  /**
   * 按预览勾选结果落库（切片 17 阶段 2）：只消费调用方传入的 inputs，不做读取/映射。
   * 与 importSystemCalendarEvents 同纪律：IMPORT_BATCH_SIZE 分批、事务内同键重查去重
   * （覆盖预览与确认之间的并发窗口）、§7.15 固定列由 insertSystemCalendarItemInTransaction
   * 写入。确认时新出现的重复与非只读冲突统一计入 skippedDuplicateCount（一次性确认
   * 流程中两者对用户的呈现语义相同：该 UID 本地已有，跳过）。
   */
  async importSystemCalendarEntries(inputs: ImportedItemInput[]): Promise<ImportBatchResult> {
    const result: ImportBatchResult = { createdCount: 0, skippedDuplicateCount: 0, failures: [] };
    // 切片 14：导入项落默认分类 'other'，先保证预置行就位（与既有导入路径一致）。
    await this.ensureSeeded();
    for (let offset = 0; offset < inputs.length; offset += IMPORT_BATCH_SIZE) {
      const batch = inputs.slice(offset, offset + IMPORT_BATCH_SIZE);
      await this.db.write(async () => {
        for (const item of batch) {
          try {
            if (item.sourceUid !== null) {
              const existing = await this.findSystemCalendarDuplicateInTransaction(item.sourceUid);
              if (existing !== null) {
                result.skippedDuplicateCount += 1;
                continue;
              }
            }
            await this.insertSystemCalendarItemInTransaction(item);
            result.createdCount += 1;
          } catch (error) {
            result.failures.push({
              title: item.title,
              sourceUid: item.sourceUid,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }
      });
    }
    return result;
  }

  // —— 切片 7：视图查询（repository.md「视图查询接口（v0.7）」，签名冻结）——
  // 三个查询构建器为 list* 与 observe* 共用（同一份条件，保证两种入口结果一致）。
  // 全部条件落 WatermelonDB 查询（SQLite），不做内存全表过滤；不加新索引。

  /**
   * 已安排：startAt ∈ [rangeStartMs, rangeEndMs)，或 startAt < rangeStartMs 且
   * endAt ≠ null 且 endAt > rangeStartMs（跨天项）。status ∈ {active, done}（非 archived）。
   * end_at / start_at 为可空列：与数值比较时 SQL 的 NULL 判定天然为假，无需显式非空条件。
   */
  private scheduledInRangeQuery(rangeStartMs: number, rangeEndMs: number): Query<ItemModel> {
    return this.db
      .get<ItemModel>(ITEMS_TABLE)
      .query(
        Q.where('status', Q.oneOf(['active', 'done'])),
        Q.or(
          Q.and(
            Q.where('start_at', Q.gte(rangeStartMs)),
            Q.where('start_at', Q.lt(rangeEndMs)),
          ),
          Q.and(
            Q.where('start_at', Q.lt(rangeStartMs)),
            Q.where('end_at', Q.gt(rangeStartMs)),
          ),
        ),
        Q.sortBy('start_at', 'asc'),
        Q.sortBy('created_at', 'asc'),
      );
  }

  /** 过期：endAt ≠ null 且 endAt < nowMs 且 status = active（archived/done 均排除）。 */
  private overdueQuery(nowMs: number): Query<ItemModel> {
    return this.db
      .get<ItemModel>(ITEMS_TABLE)
      .query(
        Q.where('end_at', Q.lt(nowMs)),
        Q.where('status', 'active'),
        Q.sortBy('end_at', 'asc'),
        Q.sortBy('created_at', 'asc'),
      );
  }

  /**
   * 全部待办（阶段 7a，小组件数据源）：startAt = null 且 status = active，
   * 不限创建窗口（区别于 unscheduledCreatedInRangeQuery 的「今日创建」口径），
   * createdAt 降序（新建的在前）。
   */
  private unscheduledQuery(): Query<ItemModel> {
    return this.db
      .get<ItemModel>(ITEMS_TABLE)
      .query(
        Q.where('start_at', null),
        Q.where('status', 'active'),
        Q.sortBy('created_at', 'desc'),
      );
  }

  /** 今日创建：startAt = null 且 createdAt ∈ [rangeStartMs, rangeEndMs) 且 status = active。 */
  private unscheduledCreatedInRangeQuery(
    rangeStartMs: number,
    rangeEndMs: number,
  ): Query<ItemModel> {
    return this.db
      .get<ItemModel>(ITEMS_TABLE)
      .query(
        Q.where('start_at', null),
        Q.where('status', 'active'),
        Q.where('created_at', Q.gte(rangeStartMs)),
        Q.where('created_at', Q.lt(rangeEndMs)),
        Q.sortBy('created_at', 'desc'),
      );
  }

  async listScheduledItemsInRange(
    rangeStartMs: number,
    rangeEndMs: number,
  ): Promise<ItemWithRelations[]> {
    return loadItemsWithRelationsByItemQuery(this.db, this.scheduledInRangeQuery(rangeStartMs, rangeEndMs));
  }

  async listOverdueItems(nowMs: number): Promise<ItemWithRelations[]> {
    return loadItemsWithRelationsByItemQuery(this.db, this.overdueQuery(nowMs));
  }

  async listUnscheduledItemsCreatedInRange(
    rangeStartMs: number,
    rangeEndMs: number,
  ): Promise<ItemWithRelations[]> {
    return loadItemsWithRelationsByItemQuery(
      this.db,
      this.unscheduledCreatedInRangeQuery(rangeStartMs, rangeEndMs),
    );
  }

  /**
   * 全部待办（阶段 7a，契约外显式扩展，先例同 observe*）：无时间纯待办快照数据源。
   * 语义 = unscheduledQuery（startAt null + active，不限创建窗口，createdAt 降序）。
   */
  async listUnscheduledItems(): Promise<ItemWithRelations[]> {
    return loadItemsWithRelationsByItemQuery(this.db, this.unscheduledQuery());
  }

  observeScheduledItemsInRange(
    rangeStartMs: number,
    rangeEndMs: number,
    onNext: (items: ItemWithRelations[]) => void,
  ): () => void {
    return combineLatest4(
      // ITEM_WATCH_COLUMNS（含 category_id / title）列订阅：Query.observe() 只在匹配集合
      // 成员变化时发射（processChangeSet），行内字段级更新（改分类/改标题/status 在
      // active|done 间翻转——后者不改变 scheduled 成员资格但改变 done-last 排序与行展示）
      // 必须按列订阅才能捕获（阶段 5h 实锤；阶段 6 补 category_id，改分类后小组件快照
      // 与视图色条才能刷新）。
      this.scheduledInRangeQuery(rangeStartMs, rangeEndMs).observeWithColumns(
        ITEM_WATCH_COLUMNS,
      ),
      this.itemTagsJoinQuery().observe(),
      this.allTagsQuery().observeWithColumns(TAG_WATCH_COLUMNS),
      this.allCategoriesQuery().observeWithColumns(CATEGORY_WATCH_COLUMNS),
      joinItemsWithRelations,
      onNext,
    );
  }

  observeOverdueItems(nowMs: number, onNext: (items: ItemWithRelations[]) => void): () => void {
    return combineLatest4(
      // 同上改 ITEM_WATCH_COLUMNS 列订阅（阶段 6 补 category_id / title）：end_at 在过期
      // 集合内变化（仍是过去时刻）不改变成员资格但改变 endAt↑ 排序；status 翻转虽会移出
      // 集合（成员变化必发射），列订阅保证一致语义。
      this.overdueQuery(nowMs).observeWithColumns(ITEM_WATCH_COLUMNS),
      this.itemTagsJoinQuery().observe(),
      this.allTagsQuery().observeWithColumns(TAG_WATCH_COLUMNS),
      this.allCategoriesQuery().observeWithColumns(CATEGORY_WATCH_COLUMNS),
      joinItemsWithRelations,
      onNext,
    );
  }

  observeUnscheduledItemsCreatedInRange(
    rangeStartMs: number,
    rangeEndMs: number,
    onNext: (items: ItemWithRelations[]) => void,
  ): () => void {
    return combineLatest4(
      // 本查询 status 仅取 active：翻转即成员变化，observe() 本就会发射；
      // 仍统一用 observeWithColumns 与另两个视图订阅保持同一语义口径（防御性）。
      this.unscheduledCreatedInRangeQuery(rangeStartMs, rangeEndMs).observeWithColumns(['status']),
      this.itemTagsJoinQuery().observe(),
      this.allTagsQuery().observeWithColumns(TAG_WATCH_COLUMNS),
      this.allCategoriesQuery().observeWithColumns(CATEGORY_WATCH_COLUMNS),
      joinItemsWithRelations,
      onNext,
    );
  }

  /**
   * 全部待办观察（阶段 7a，契约外显式扩展，先例同 observe*）：小组件快照桥订阅，
   * 待办增删/行内字段变更时重发射。列清单沿用 ITEM_WATCH_COLUMNS（阶段 6 起的统一口径：
   * 水合所需字段 + 阶段 6 教训——行内 categoryId/title 更新必须显式监听才发射）。
   */
  observeUnscheduledItems(onNext: (items: ItemWithRelations[]) => void): () => void {
    return combineLatest4(
      this.unscheduledQuery().observeWithColumns(ITEM_WATCH_COLUMNS),
      this.itemTagsJoinQuery().observe(),
      this.allTagsQuery().observeWithColumns(TAG_WATCH_COLUMNS),
      this.allCategoriesQuery().observeWithColumns(CATEGORY_WATCH_COLUMNS),
      joinItemsWithRelations,
      onNext,
    );
  }

  /**
   * 创建 Reminder（AGENTS.md §4.17/§4.18；切片 6 §4.25 白名单）：
   * - 宿主 Item 必须存在（提醒一律经 reminders 表关联，Item 上不加字段）；
   * - tzid 必须在时区白名单内（§4.25），白名单外抛明确错误；
   * - 规则字段经 normalizeReminderRuleFields 归一化校验；
   * - lastFiredOccurrenceKey / lastReconciledAt 初始化为 null（§4.18）。
   * 切片 16（§7.26）：frequency='once' 时 onceAt 必填（resolveOnceAt 运行时强制，
   * 输入为可选字段的编译期缺口）。切片 18（§7.29）：多渠道 channels/channelConfigs
   * 经 normalizeReminderChannelFields 归一化（缺省 ['system-notification']；
   * expo 互斥；channelConfigs 仅网络渠道条目，channels_json 恒写非 null）。
   */
  async createReminder(input: CreateReminderInput): Promise<Reminder> {
    const owner = await this.getItem(input.itemId);
    if (!owner) {
      throw new Error(`createReminder: item not found: ${input.itemId}`);
    }
    assertWhitelistedReminderTz(input.tzid);
    const startAt = normalizeStartAt(input.startAt);
    const fields = normalizeReminderRuleFields({
      frequency: input.frequency,
      localTimeHour: input.localTimeHour,
      localTimeMinute: input.localTimeMinute,
      weekdays: input.weekdays,
      dayOfMonth: input.dayOfMonth,
    });
    const onceAt = resolveOnceAt(fields.frequency, input.onceAt);
    const channelFields = normalizeReminderChannelFields({
      channels: input.channels,
      channelConfigs: input.channelConfigs,
    });

    const created = await this.db.write(async () =>
      this.db.get<ReminderModel>(REMINDERS_TABLE).create((record) => {
        record.itemId = owner.id;
        record.frequency = fields.frequency;
        record.localTimeHour = fields.localTimeHour;
        record.localTimeMinute = fields.localTimeMinute;
        record.weekdaysJson = serializeWeekdays(fields.weekdays);
        record.dayOfMonth = fields.dayOfMonth;
        record.onceCivilJson = onceAt === null ? null : serializeOnceCivilJson(onceAt);
        record.tzid = input.tzid;
        record.startAt = startAt;
        record.enabled = input.enabled;
        record.channelsJson = serializeReminderChannels(channelFields.channels);
        record.channelConfigsJson = serializeReminderChannelConfigs(channelFields.channelConfigs);
        record.lastFiredOccurrenceKey = null;
        record.lastReconciledAt = null;
      }),
    );

    return toDomainReminder(created);
  }

  /**
   * 更新 Reminder：规则字段、enabled 与 tzid（切片 6）可更新；itemId / id / createdAt
   * 不可更新。tzid 仅接受白名单值（§4.25；任务卡实现要求 5 允许在两个白名单值间切换），
   * §4.17 的“不随系统时区自动改写”仅禁自动改写。lastFiredOccurrenceKey /
   * lastReconciledAt 只经 markReminderFired / markReminderReconciled 写入。
   * 切片 16（§7.26）：onceAt 以「patch 合并后的最终 frequency」判定——once 必须有时刻
   * （patch 显式提供，或现状已是非空 onceAt），否则抛明确错误；切回重复频率由
   * resolveOnceAt 强制置 null（落库清空 once_civil_json）。切片 18（§7.29）：channels
   * 为整体替换语义、channelConfigs 为 per-key merge（null=清除，提案 §5）——
   * 归一化基于 patch 合并后的 current 展开，结果恒写新列；旧 channel/channel_config
   * 列不再写入（仅读层 legacy bridge 数据源）。
   */
  async updateReminder(id: string, patch: UpdateReminderInput): Promise<Reminder> {
    if (patch.tzid !== undefined) {
      assertWhitelistedReminderTz(patch.tzid);
    }
    return this.db.write(async () => {
      const record = await this.db.get<ReminderModel>(REMINDERS_TABLE).find(id);
      const current = toDomainReminder(record);
      // 以 patch 合并后的「最终规则」做整体归一化校验，frequency 切换时自动归零非本 frequency 字段。
      const fields = normalizeReminderRuleFields({
        frequency: patch.frequency ?? current.frequency,
        localTimeHour: patch.localTimeHour ?? current.localTimeHour,
        localTimeMinute: patch.localTimeMinute ?? current.localTimeMinute,
        weekdays: patch.weekdays ?? current.weekdays,
        dayOfMonth: patch.dayOfMonth ?? current.dayOfMonth,
      });
      const startAt =
        patch.startAt !== undefined ? normalizeStartAt(patch.startAt) : current.startAt;
      const onceAt = resolveOnceAt(
        fields.frequency,
        patch.onceAt !== undefined ? patch.onceAt : current.onceAt,
      );
      const channelFields = normalizeReminderChannelFields(
        {
          channels: patch.channels,
          channelConfigs: patch.channelConfigs,
        },
        {
          channels: current.channels,
          channelConfigs: current.channelConfigs,
        },
      );

      const updated = await record.update((draft) => {
        draft.frequency = fields.frequency;
        draft.localTimeHour = fields.localTimeHour;
        draft.localTimeMinute = fields.localTimeMinute;
        draft.weekdaysJson = serializeWeekdays(fields.weekdays);
        draft.dayOfMonth = fields.dayOfMonth;
        draft.onceCivilJson = onceAt === null ? null : serializeOnceCivilJson(onceAt);
        draft.startAt = startAt;
        draft.channelsJson = serializeReminderChannels(channelFields.channels);
        draft.channelConfigsJson = serializeReminderChannelConfigs(channelFields.channelConfigs);
        if (patch.enabled !== undefined) {
          draft.enabled = patch.enabled;
        }
        if (patch.tzid !== undefined) {
          draft.tzid = patch.tzid;
        }
      });

      return toDomainReminder(updated);
    });
  }

  /**
   * 删除 Reminder（物理删除关联行）。
   * 已调度的系统通知不由 Repository 清理——由 ReminderScheduler.reconcile 对账取消。
   */
  async deleteReminder(id: string): Promise<void> {
    await this.db.write(async () => {
      const record = await this.db.get<ReminderModel>(REMINDERS_TABLE).find(id);
      await record.destroyPermanently();
    });
  }

  async listRemindersByItem(itemId: string): Promise<Reminder[]> {
    const models = await this.db
      .get<ReminderModel>(REMINDERS_TABLE)
      .query(Q.where('item_id', itemId), Q.sortBy('created_at', 'asc'))
      .fetch();
    return models.map(toDomainReminder);
  }

  async listEnabledReminders(): Promise<Reminder[]> {
    const models = await this.db
      .get<ReminderModel>(REMINDERS_TABLE)
      .query(Q.where('enabled', true), Q.sortBy('created_at', 'asc'))
      .fetch();
    return models.map(toDomainReminder);
  }

  /**
   * 全库 Reminder 读取（契约外显式扩展，见 ItemRepository.ts 文件头）：
   * 切片 12 数据导出的提醒概览入口（决策 A-1）。不过滤 enabled/status，
   * 返回原始领域对象（调度器内部字段由导出序列化层负责剔除）。
   */
  async listAllReminders(): Promise<Reminder[]> {
    const models = await this.db
      .get<ReminderModel>(REMINDERS_TABLE)
      .query(Q.sortBy('created_at', 'asc'))
      .fetch();
    return models.map(toDomainReminder);
  }

  /** 对账完成时间戳（§4.19 窗口起点）。 */
  async markReminderReconciled(id: string, lastReconciledAt: number): Promise<void> {
    await this.db.write(async () => {
      const record = await this.db.get<ReminderModel>(REMINDERS_TABLE).find(id);
      await record.update((draft) => {
        draft.lastReconciledAt = lastReconciledAt;
      });
    });
  }

  /** missed 去重游标：推进到窗口内最后一个 missed occurrenceKey（§4.19）。 */
  async markReminderFired(id: string, occurrenceKey: string): Promise<void> {
    await this.db.write(async () => {
      const record = await this.db.get<ReminderModel>(REMINDERS_TABLE).find(id);
      await record.update((draft) => {
        draft.lastFiredOccurrenceKey = occurrenceKey;
      });
    });
  }

  // —— 切片 14：分类与全局设置（repository.md「Category 与标签接口（v0.14）」）——

  /** 分类列表：priority 升序（并列时按 id 升序，保证顺序确定）。 */
  async getCategories(): Promise<Category[]> {
    await this.ensureSeeded();
    const models = await this.db
      .get<CategoryModel>(CATEGORIES_TABLE)
      .query(Q.sortBy('priority', 'asc'), Q.sortBy('id', 'asc'))
      .fetch();
    return models.map(toDomainCategory);
  }

  /**
   * 更新分类视觉字段（颜色/Emoji）。预置分类不可删除，仅允许改视觉（repository.md v0.14）。
   * patch 中未出现的字段保持不变（undefined 不写入）。
   */
  async updateCategoryVisuals(id: string, patch: VisualPatch): Promise<Category> {
    return this.db.write(async () => {
      const models = await this.db
        .get<CategoryModel>(CATEGORIES_TABLE)
        .query(Q.where('id', id))
        .fetch();
      const model = models[0];
      if (!model) {
        throw new Error(`updateCategoryVisuals: category not found: ${id}`);
      }
      const updated = await model.update((draft) => {
        if (patch.color !== undefined) {
          draft.color = patch.color;
        }
        if (patch.emoji !== undefined) {
          draft.emoji = patch.emoji;
        }
      });
      return toDomainCategory(updated);
    });
  }

  /** 更新标签视觉字段（颜色/Emoji）；addTagToItem/removeTagFromItem 语义不变。 */
  async updateTagVisuals(id: string, patch: VisualPatch): Promise<Tag> {
    return this.db.write(async () => {
      const models = await this.db
        .get<TagModel>(TAGS_TABLE)
        .query(Q.where('id', id))
        .fetch();
      const model = models[0];
      if (!model) {
        throw new Error(`updateTagVisuals: tag not found: ${id}`);
      }
      const updated = await model.update((draft) => {
        if (patch.color !== undefined) {
          draft.color = patch.color;
        }
        if (patch.emoji !== undefined) {
          draft.emoji = patch.emoji;
        }
      });
      return toDomainTag(updated);
    });
  }

  /**
   * 全局设置：单行（id='global'）。无记录时返回默认值并静默补插（repository.md v0.14，
   * 不得抛错）。实现选择在返回前同步完成补插（静默 = 不向上抛错/不打日志），保证
   * 紧随其后的 updateSettings 无需再做兜底判断；库中非法枚举值防御性回退默认。
   */
  async getSettings(): Promise<AppSettings> {
    await this.ensureSeeded();
    return this.db.write(async () => {
      const models = await this.db.get<AppSettingsModel>(APP_SETTINGS_TABLE).query().fetch();
      if (models.length === 0) {
        await this.db.get<AppSettingsModel>(APP_SETTINGS_TABLE).create((record) => {
          record._raw.id = APP_SETTINGS_ROW_ID;
          record.tagDisplayMode = DEFAULT_APP_SETTINGS.tagDisplayMode;
          // 阶段 7a（schema v7）：补插默认行时一并写小组件显示开关默认值。
          record.widgetShowOverdue = DEFAULT_APP_SETTINGS.widgetShowOverdue;
          record.widgetShowTodos = DEFAULT_APP_SETTINGS.widgetShowTodos;
          record.widgetShowCategoryEmoji = DEFAULT_APP_SETTINGS.widgetShowCategoryEmoji;
          record.widgetShowTags = DEFAULT_APP_SETTINGS.widgetShowTags;
          // 切片 18（schema v10）：补插默认行时写 chips 默认值（读层有回退，此处求自描述）。
          record.chipsIncrementsJson = serializeChipsIncrements(
            DEFAULT_APP_SETTINGS.chipsIncrements,
          );
          // 切片 19（schema v11）：补插默认行时写默认渠道（读层有回退，此处求自描述）。
          record.defaultChannelsJson = serializeDefaultChannels(
            DEFAULT_APP_SETTINGS.defaultChannels,
          );
          // 切片 25（schema v12）：补插默认行时写认真模式默认值（读层有归一，此处求自描述）。
          record.carefulMode = DEFAULT_APP_SETTINGS.carefulMode;
          // 切片 26（schema v13）：补插默认行时写用量展示开关默认值（读层有归一，此处求自描述）。
          record.showAiUsage = DEFAULT_APP_SETTINGS.showAiUsage;
          // 切片 27（schema v14）：补插默认行时写日历显示开关默认值 '[]'
          // （读层有归一，此处求自描述；[] = 功能关闭）。
          record.displayCalendarIdsJson = serializeDisplayCalendarIds(
            DEFAULT_APP_SETTINGS.displayCalendarIds,
          );
          // 切片 30（schema v15）：补插默认行时写重试次数/已删除卡显示默认值
          // （读层有归一，此处求自描述）。
          record.aiRetryMax = DEFAULT_APP_SETTINGS.aiRetryMax;
          record.flashDeletedCardDisplay = DEFAULT_APP_SETTINGS.flashDeletedCardDisplay;
          // 切片 32（schema v16）：补插默认行时写调试查看器开关默认值
          //（读层有归一，此处求自描述）。
          record.showAiRequest = DEFAULT_APP_SETTINGS.showAiRequest;
          record.showAiResponse = DEFAULT_APP_SETTINGS.showAiResponse;
        });
        return { ...DEFAULT_APP_SETTINGS };
      }
      return toDomainSettings(models[0]);
    });
  }

  /**
   * 更新全局设置（阶段 7a 扩展：tagDisplayMode + 小组件显示开关 4 项；
   * 切片 18（§7.29）：chipsIncrements 写路径 validateChipsIncrements 严格校验
   * （1–4 项、每项 1–10080 整数分钟，违反抛错）；
   * 切片 19（§7.30）：defaultChannels 写路径 validateDefaultChannels 严格校验
   * （非法渠道/空/expo 家族双开抛错，返回 canonical 序标准化拷贝）；
   * 切片 25（§7.37）：carefulMode boolean 无枚举语义，直接写（非 boolean 理论上
   * 不可能出现——类型系统已约束，无独立校验函数）；
   * 切片 26（§7.38）：showAiUsage 同 carefulMode 先例，boolean 直接写；
   * 切片 27（§7.39）：displayCalendarIds 写路径 validateDisplayCalendarIds 严格校验
   * （仅非空字符串、去重抛错；空数组 = 功能关闭，合法写入 '[]'）；
   * 切片 32（§7.44）：showAiRequest/showAiResponse 同 carefulMode 先例，boolean 直接写；
   * 行不存在时以 patch 值（缺省用默认值）建行。
   * 改动小组件显示开关后，调用方需自行触发一次小组件快照刷新
   * （桥不订阅 app_settings；设置页负责）。
   */
  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    await this.ensureSeeded();
    if (patch.tagDisplayMode !== undefined && !isTagDisplayMode(patch.tagDisplayMode)) {
      throw new Error('updateSettings: invalid tagDisplayMode');
    }
    const chipsIncrements =
      patch.chipsIncrements !== undefined
        ? serializeChipsIncrements(validateChipsIncrements(patch.chipsIncrements))
        : undefined;
    const defaultChannels =
      patch.defaultChannels !== undefined
        ? serializeDefaultChannels(validateDefaultChannels(patch.defaultChannels))
        : undefined;
    const displayCalendarIds =
      patch.displayCalendarIds !== undefined
        ? serializeDisplayCalendarIds(validateDisplayCalendarIds(patch.displayCalendarIds))
        : undefined;
    // 切片 30（§7.41）：aiRetryMax 写路径严格校验（0–5 整数，违反抛错）；
    // flashDeletedCardDisplay 枚举校验（'mark'|'remove' 之外抛错）。
    const aiRetryMax = patch.aiRetryMax !== undefined ? validateAiRetryMax(patch.aiRetryMax) : undefined;
    if (patch.flashDeletedCardDisplay !== undefined && !isFlashDeletedCardDisplay(patch.flashDeletedCardDisplay)) {
      throw new Error('updateSettings: invalid flashDeletedCardDisplay');
    }
    await this.db.write(async () => {
      const models = await this.db.get<AppSettingsModel>(APP_SETTINGS_TABLE).query().fetch();
      const model = models[0];
      if (!model) {
        await this.db.get<AppSettingsModel>(APP_SETTINGS_TABLE).create((record) => {
          record._raw.id = APP_SETTINGS_ROW_ID;
          record.tagDisplayMode = patch.tagDisplayMode ?? DEFAULT_APP_SETTINGS.tagDisplayMode;
          record.widgetShowOverdue = patch.widgetShowOverdue ?? DEFAULT_APP_SETTINGS.widgetShowOverdue;
          record.widgetShowTodos = patch.widgetShowTodos ?? DEFAULT_APP_SETTINGS.widgetShowTodos;
          record.widgetShowCategoryEmoji =
            patch.widgetShowCategoryEmoji ?? DEFAULT_APP_SETTINGS.widgetShowCategoryEmoji;
          record.widgetShowTags = patch.widgetShowTags ?? DEFAULT_APP_SETTINGS.widgetShowTags;
          record.chipsIncrementsJson =
            chipsIncrements ?? serializeChipsIncrements(DEFAULT_APP_SETTINGS.chipsIncrements);
          record.defaultChannelsJson =
            defaultChannels ?? serializeDefaultChannels(DEFAULT_APP_SETTINGS.defaultChannels);
          record.carefulMode = patch.carefulMode ?? DEFAULT_APP_SETTINGS.carefulMode;
          record.showAiUsage = patch.showAiUsage ?? DEFAULT_APP_SETTINGS.showAiUsage;
          record.displayCalendarIdsJson =
            displayCalendarIds ??
            serializeDisplayCalendarIds(DEFAULT_APP_SETTINGS.displayCalendarIds);
          record.aiRetryMax = aiRetryMax ?? DEFAULT_APP_SETTINGS.aiRetryMax;
          record.flashDeletedCardDisplay =
            patch.flashDeletedCardDisplay ?? DEFAULT_APP_SETTINGS.flashDeletedCardDisplay;
          record.showAiRequest = patch.showAiRequest ?? DEFAULT_APP_SETTINGS.showAiRequest;
          record.showAiResponse = patch.showAiResponse ?? DEFAULT_APP_SETTINGS.showAiResponse;
        });
        return;
      }
      await model.update((draft) => {
        if (patch.tagDisplayMode !== undefined) {
          draft.tagDisplayMode = patch.tagDisplayMode;
        }
        if (patch.widgetShowOverdue !== undefined) {
          draft.widgetShowOverdue = patch.widgetShowOverdue;
        }
        if (patch.widgetShowTodos !== undefined) {
          draft.widgetShowTodos = patch.widgetShowTodos;
        }
        if (patch.widgetShowCategoryEmoji !== undefined) {
          draft.widgetShowCategoryEmoji = patch.widgetShowCategoryEmoji;
        }
        if (patch.widgetShowTags !== undefined) {
          draft.widgetShowTags = patch.widgetShowTags;
        }
        if (chipsIncrements !== undefined) {
          draft.chipsIncrementsJson = chipsIncrements;
        }
        if (defaultChannels !== undefined) {
          draft.defaultChannelsJson = defaultChannels;
        }
        if (patch.carefulMode !== undefined) {
          draft.carefulMode = patch.carefulMode;
        }
        if (patch.showAiUsage !== undefined) {
          draft.showAiUsage = patch.showAiUsage;
        }
        if (displayCalendarIds !== undefined) {
          draft.displayCalendarIdsJson = displayCalendarIds;
        }
        if (aiRetryMax !== undefined) {
          draft.aiRetryMax = aiRetryMax;
        }
        if (patch.flashDeletedCardDisplay !== undefined) {
          draft.flashDeletedCardDisplay = patch.flashDeletedCardDisplay;
        }
        if (patch.showAiRequest !== undefined) {
          draft.showAiRequest = patch.showAiRequest;
        }
        if (patch.showAiResponse !== undefined) {
          draft.showAiResponse = patch.showAiResponse;
        }
      });
    });
  }

  // —— 切片 17 阶段 1：渠道预设（repository.md v0.17，契约外显式扩展，先例见接口文件）——

  /** 全部预设，created_at 降序（新建的在前）；created_at 并列无业务语义，不追加次级排序。 */
  async listChannelPresets(): Promise<ChannelPreset[]> {
    const models = await this.db
      .get<ChannelPresetModel>(CHANNEL_PRESETS_TABLE)
      .query(Q.sortBy('created_at', 'desc'))
      .fetch();
    return models.map(toDomainChannelPreset);
  }

  async createChannelPreset(input: CreateChannelPresetInput): Promise<ChannelPreset> {
    const name = input.name.trim();
    if (name.length === 0) {
      throw new Error('createChannelPreset: name must not be blank');
    }
    if (!isChannelPresetType(input.type)) {
      throw new Error(`createChannelPreset: invalid preset type: ${String(input.type)}`);
    }
    assertValidChannelPresetConfig(input.type, input.configJson, 'createChannelPreset');
    return this.db.write(async () => {
      const created = await this.db.get<ChannelPresetModel>(CHANNEL_PRESETS_TABLE).create((record) => {
        record.name = name;
        record.type = input.type;
        record.configJson = input.configJson;
        // 切片 18（§7.29）：is_default 列，v9 行经 migration 回填 false（提案 §3.3）。
        record.isDefault = input.isDefault === true;
        // createdAt 由 WatermelonDB 自动写入（Model/helpers.js createTimestampsFor）。
      });
      // 切片 18（提案 §3.3）：设为默认时，同 type 其余预设自动取消默认——同一 db.write
      // 事务内完成，保证「同 type 至多一个 is_default=true」不变量。
      if (created.isDefault) {
        await unsetOtherDefaultPresets(this.db, input.type, created.id);
      }
      return toDomainChannelPreset(created);
    });
  }

  /**
   * 更新预设（patch 合并语义；type 不可更新——改类型等于换配置语义，应删除重建）。
   * configJson 按该预设的既有 type 重新过守卫（type 未变，校验口径不变）。
   * 切片 18（§7.29）：isDefault 可 patch——true 时同事务内取消同 type 其余预设的
   * 默认标记（不变量同 createChannelPreset）。
   */
  async updateChannelPreset(id: string, patch: UpdateChannelPresetInput): Promise<ChannelPreset> {
    if (patch.name === undefined && patch.configJson === undefined && patch.isDefault === undefined) {
      throw new Error(
        'updateChannelPreset: patch must contain at least one of name / configJson / isDefault',
      );
    }
    if (patch.name !== undefined && patch.name.trim().length === 0) {
      throw new Error('updateChannelPreset: name must not be blank');
    }
    return this.db.write(async () => {
      const models = await this.db
        .get<ChannelPresetModel>(CHANNEL_PRESETS_TABLE)
        .query(Q.where('id', id))
        .fetch();
      const model = models[0];
      if (!model) {
        throw new Error(`updateChannelPreset: channel preset not found: ${id}`);
      }
      const type = toDomainChannelPreset(model).type; // 非法 type 即抛（数据异常显性化）
      if (patch.configJson !== undefined) {
        assertValidChannelPresetConfig(type, patch.configJson, 'updateChannelPreset');
      }
      await model.update((draft) => {
        if (patch.name !== undefined) {
          draft.name = patch.name.trim();
        }
        if (patch.configJson !== undefined) {
          draft.configJson = patch.configJson;
        }
        if (patch.isDefault !== undefined) {
          draft.isDefault = patch.isDefault;
        }
      });
      if (patch.isDefault === true) {
        await unsetOtherDefaultPresets(this.db, type, id);
      }
      return toDomainChannelPreset(model);
    });
  }

  /** 删除预设；不存在时抛明确错误。删除不影响已引用其 configJson 的既有提醒（复制值语义）。 */
  async deleteChannelPreset(id: string): Promise<void> {
    await this.db.write(async () => {
      const models = await this.db
        .get<ChannelPresetModel>(CHANNEL_PRESETS_TABLE)
        .query(Q.where('id', id))
        .fetch();
      const model = models[0];
      if (!model) {
        throw new Error(`deleteChannelPreset: channel preset not found: ${id}`);
      }
      await model.destroyPermanently();
    });
  }

  // —— 切片 17 阶段 1：导入预览（repository.md v0.17「导入预览接口」，纯读不写）——

  /**
   * 解析 ICS 文本（复用 parseIcs，不复制解析逻辑）并标记本地去重状态：
   * 一次查询 source_type='ics' 的 items 建 uid→id 映射（N 条事件不查 N 次），
   * 判定键与 assertNoDuplicateSourceUid / importItemsInBatches 的 skippedDuplicate
   * 完全同键，保证「预览标记 = 实际落库行为」。sourceUid=null 恒 false（无 UID 不去重）。
   */
  async generateIcsPreview(icsText: string, deviceTzid: string): Promise<IcsPreviewResult> {
    const parsed = parseIcs(icsText, deviceTzid);
    const icsItemModels = await this.db
      .get<ItemModel>(ITEMS_TABLE)
      .query(Q.where('source_type', 'ics'))
      .fetch();
    const uidToItemId = new Map<string, string>();
    for (const model of icsItemModels) {
      if (model.sourceUid !== null && !uidToItemId.has(model.sourceUid)) {
        uidToItemId.set(model.sourceUid, model.id);
      }
    }
    const entries: IcsPreviewEntry[] = parsed.events.map((event) => {
      const uid = event.input.sourceUid;
      const existingItemId = uid === null ? null : (uidToItemId.get(uid) ?? null);
      return {
        input: event.input,
        floating: event.floating,
        isDuplicate: existingItemId !== null,
        existingItemId,
      };
    });
    return {
      entries,
      failures: parsed.failures,
      sameFileDuplicates: parsed.sameFileDuplicates,
      duplicateCount: entries.filter((entry) => entry.isDuplicate).length,
    };
  }

  /**
   * 切片 14：全新安装预置数据兜底（migration 只在升级安装时执行）。
   * 数据库实例首次调用时执行一次 seedPresetData（幂等），后续调用直接复用同一 promise。
   */
  private ensureSeeded(): Promise<void> {
    if (!this.seedPromise) {
      this.seedPromise = seedPresetData(this.db).catch((error) => {
        // 失败时重置缓存，允许下次写路径重试（database.ts 模块级 kick 失败后的兜底）。
        this.seedPromise = undefined;
        throw error;
      });
    }
    return this.seedPromise;
  }

  /** categoryId 存在性校验（必须在 db.write 事务内调用；预置行由 ensureSeeded/migration 保证）。 */
  private async assertCategoryExistsInTransaction(categoryId: string, context: string): Promise<void> {
    const count = await this.db
      .get<CategoryModel>(CATEGORIES_TABLE)
      .query(Q.where('id', categoryId))
      .fetchCount();
    if (count === 0) {
      throw new Error(`${context}: category not found: ${categoryId}`);
    }
  }
}
