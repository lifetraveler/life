import { Database, Q, Query } from '@nozbe/watermelondb';

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
} from '../domain/settings';
import type { AppSettings } from '../domain/settings';
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
  serializeOnceCivilJson,
  serializeWeekdays,
} from './reminderRuleMapping';
import { assertWhitelistedReminderTz } from './reminderTzWhitelist';
import { DEFAULT_REMINDER_CHANNEL, isReminderChannel } from '../domain/reminder';

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
  };
}

/**
 * reminders 行 → 领域 Reminder；weekdays / once_civil_json JSON 解析失败在此抛错
 * （不得静默，§4.18/任务卡）。
 *
 * channel 读取防御（切片 16）：读到非法值（含 LokiJS 测试适配器忽略 v8 'sql' 回填步骤
 * 产生的 ''）时回退 DEFAULT_REMINDER_CHANNEL，不抛错——对齐 toDomainSettings 枚举读取
 * 先例：读取行为即 migration 回填意图（'system-notification'，行为与升级前一致）；
 * 写路径仍严格校验（normalizeReminderChannelFields）。
 */
function toDomainReminder(model: ReminderModel): Reminder {
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
    channel: isReminderChannel(model.channel) ? model.channel : DEFAULT_REMINDER_CHANNEL,
    channelConfig: model.channelConfig ?? null,
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
   * 输入为可选字段的编译期缺口）；channel / channelConfig 经 normalizeReminderChannelFields
   * 归一化（缺省 'system-notification'，渠道无关时 channelConfig 强制 null）。
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
      channel: input.channel,
      channelConfig: input.channelConfig,
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
        record.channel = channelFields.channel;
        record.channelConfig = channelFields.channelConfig;
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
   * resolveOnceAt 强制置 null（落库清空 once_civil_json）。channel / channelConfig
   * 按 patch 合并后归一化：切到渠道无关渠道时旧配置强制清空。
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
      const channelFields = normalizeReminderChannelFields({
        channel: patch.channel ?? current.channel,
        channelConfig:
          patch.channelConfig !== undefined ? patch.channelConfig : current.channelConfig,
      });

      const updated = await record.update((draft) => {
        draft.frequency = fields.frequency;
        draft.localTimeHour = fields.localTimeHour;
        draft.localTimeMinute = fields.localTimeMinute;
        draft.weekdaysJson = serializeWeekdays(fields.weekdays);
        draft.dayOfMonth = fields.dayOfMonth;
        draft.onceCivilJson = onceAt === null ? null : serializeOnceCivilJson(onceAt);
        draft.startAt = startAt;
        draft.channel = channelFields.channel;
        draft.channelConfig = channelFields.channelConfig;
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
        });
        return { ...DEFAULT_APP_SETTINGS };
      }
      return toDomainSettings(models[0]);
    });
  }

  /**
   * 更新全局设置（阶段 7a 扩展：tagDisplayMode + 小组件显示开关 4 项）；
   * 行不存在时以 patch 值（缺省用默认值）建行。
   * 改动小组件显示开关后，调用方需自行触发一次小组件快照刷新
   * （桥不订阅 app_settings；设置页负责）。
   */
  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    await this.ensureSeeded();
    if (patch.tagDisplayMode !== undefined && !isTagDisplayMode(patch.tagDisplayMode)) {
      throw new Error('updateSettings: invalid tagDisplayMode');
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
        // createdAt 由 WatermelonDB 自动写入（Model/helpers.js createTimestampsFor）。
      });
      return toDomainChannelPreset(created);
    });
  }

  /**
   * 更新预设（patch 合并语义；type 不可更新——改类型等于换配置语义，应删除重建）。
   * configJson 按该预设的既有 type 重新过守卫（type 未变，校验口径不变）。
   */
  async updateChannelPreset(id: string, patch: UpdateChannelPresetInput): Promise<ChannelPreset> {
    if (patch.name === undefined && patch.configJson === undefined) {
      throw new Error('updateChannelPreset: patch must contain at least one of name / configJson');
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
      });
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
