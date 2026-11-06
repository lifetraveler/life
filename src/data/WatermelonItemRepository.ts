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
import { normalizeTagName } from '../domain/tag';
import type { ItemWithTags, Tag } from '../domain/tag';
import ItemModel from '../db/models/ItemModel';
import ItemTagModel from '../db/models/ItemTagModel';
import ReminderModel from '../db/models/ReminderModel';
import TagModel from '../db/models/TagModel';
import { normalizeAllDayTimestamps } from './allDayNormalize';
import { getDeviceTzid } from './deviceTimezone';
import { assertValidItemTimePatch, assertValidItemTimeRange } from './itemTimeRules';
import type {
  ImportBatchResult,
  ItemRepository,
  SystemCalendarImportInput,
  SystemImportResult,
} from './ItemRepository';
import { defaultSystemCalendarDeps } from './systemCalendarAdapters';
import type { SystemCalendarDeps } from './systemCalendarAdapters';
import {
  normalizeReminderRuleFields,
  normalizeStartAt,
  parseWeekdaysJson,
  serializeWeekdays,
} from './reminderRuleMapping';
import { assertWhitelistedReminderTz } from './reminderTzWhitelist';

const ITEMS_TABLE = 'items';
const TAGS_TABLE = 'tags';
const ITEM_TAGS_TABLE = 'item_tags';
const REMINDERS_TABLE = 'reminders';

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
    createdAt: model.createdAt.getTime(),
    updatedAt: model.updatedAt.getTime(),
  };
}

function toDomainTag(model: TagModel): Tag {
  return {
    id: model.id,
    name: model.name,
    createdAt: model.createdAt.getTime(),
  };
}

/** reminders 行 → 领域 Reminder；weekdays JSON 解析失败在此抛错（不得静默，§4.18/任务卡）。 */
function toDomainReminder(model: ReminderModel): Reminder {
  return {
    id: model.id,
    itemId: model.itemId,
    frequency: model.frequency,
    localTimeHour: model.localTimeHour,
    localTimeMinute: model.localTimeMinute,
    weekdays: parseWeekdaysJson(model.weekdaysJson),
    dayOfMonth: model.dayOfMonth,
    tzid: model.tzid,
    startAt: model.startAt,
    enabled: model.enabled,
    lastFiredOccurrenceKey: model.lastFiredOccurrenceKey,
    lastReconciledAt: model.lastReconciledAt,
    createdAt: model.createdAt.getTime(),
    updatedAt: model.updatedAt.getTime(),
  };
}

/** 内存连接：Item × ItemTag × Tag → ItemWithTags（tags 按 join 的 created_at 升序，即绑定顺序） */
function joinItemsWithTags(
  itemModels: ItemModel[],
  joinModels: ItemTagModel[],
  tagModels: TagModel[],
): ItemWithTags[] {
  const tagsById = new Map<string, Tag>();
  for (const tagModel of tagModels) {
    tagsById.set(tagModel.id, toDomainTag(tagModel));
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
  }));
}

/** §4.8：updatedAt 降序；updatedAt 并列时按 id 升序，保证合并去重后的顺序确定。 */
function sortByUpdatedAtDesc(items: ItemWithTags[]): ItemWithTags[] {
  return [...items].sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) {
      return b.updatedAt - a.updatedAt;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** 给定 items 查询，取回三表数据并在内存完成 ItemWithTags 投影（join 顺序 = created_at 升序）。 */
async function loadItemsWithTagsByItemQuery(
  db: Database,
  itemQuery: Query<ItemModel>,
): Promise<ItemWithTags[]> {
  const itemModels = await itemQuery.fetch();
  const [joinModels, tagModels] = await Promise.all([
    db.get<ItemTagModel>(ITEM_TAGS_TABLE).query(Q.sortBy('created_at', 'asc')).fetch(),
    db.get<TagModel>(TAGS_TABLE).query().fetch(),
  ]);
  return joinItemsWithTags(itemModels, joinModels, tagModels);
}

/** 三路 observe 的最小 combineLatest：三者都到达后才投影 onNext；无需引入 rxjs */
function combineLatest3<T1, T2, T3, R>(
  source1: Subscribable<T1>,
  source2: Subscribable<T2>,
  source3: Subscribable<T3>,
  project: (value1: T1, value2: T2, value3: T3) => R,
  onNext: (value: R) => void,
): () => void {
  let value1: T1 | undefined;
  let value2: T2 | undefined;
  let value3: T3 | undefined;
  let ready1 = false;
  let ready2 = false;
  let ready3 = false;

  const emit = (): void => {
    if (
      ready1 && ready2 && ready3
      && value1 !== undefined && value2 !== undefined && value3 !== undefined
    ) {
      onNext(project(value1, value2, value3));
    }
  };

  const sub1 = source1.subscribe((value) => { value1 = value; ready1 = true; emit(); });
  const sub2 = source2.subscribe((value) => { value2 = value; ready2 = true; emit(); });
  const sub3 = source3.subscribe((value) => { value3 = value; ready3 = true; emit(); });

  return (): void => {
    sub1.unsubscribe();
    sub2.unsubscribe();
    sub3.unsubscribe();
  };
}

/**
 * ItemRepository 的 WatermelonDB 实现。UI 与业务层不得直接使用本类之外的 WatermelonDB API。
 * Tag.name 唯一性（trim + 大小写不敏感）在本层保证（AGENTS.md §4.4）。
 */
export class WatermelonItemRepository implements ItemRepository {
  private readonly db: Database;

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

    const created = await this.db.write(async () => {
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
      });
      return item;
    });

    return toDomainItem(created);
  }

  async listItems(): Promise<Item[]> {
    const models = await this.db.get<ItemModel>(ITEMS_TABLE).query().fetch();
    return models.map(toDomainItem);
  }

  observeItems(onNext: (items: Item[]) => void): () => void {
    const subscription = this.db
      .get<ItemModel>(ITEMS_TABLE)
      .query(Q.sortBy('created_at', 'desc'))
      .observe()
      .subscribe((models) => {
        onNext(models.map(toDomainItem));
      });

    return (): void => {
      subscription.unsubscribe();
    };
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

  async listItemsWithTags(): Promise<ItemWithTags[]> {
    // §4.7：默认列表语义 = 未归档 + 未删除；§4.8：按 updatedAt 降序。
    return loadItemsWithTagsByItemQuery(
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
   * 4. 合并去重，取回完整 ItemWithTags，按 updatedAt 降序返回。
   * 空关键词（trim 后为空）直接返回 []，不查库。
   */
  async searchItems(keyword: string): Promise<ItemWithTags[]> {
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

    // 第 4 步：合并去重 → 完整投影 → updatedAt 降序
    if (matchedItemIds.size === 0) {
      return [];
    }
    const itemModels = await this.db
      .get<ItemModel>(ITEMS_TABLE)
      .query(Q.where('id', Q.oneOf([...matchedItemIds])))
      .fetch();
    const [joinModels, tagModels] = await Promise.all([
      this.db.get<ItemTagModel>(ITEM_TAGS_TABLE).query(Q.sortBy('created_at', 'asc')).fetch(),
      this.db.get<TagModel>(TAGS_TABLE).query().fetch(),
    ]);
    return sortByUpdatedAtDesc(joinItemsWithTags(itemModels, joinModels, tagModels));
  }

  /** 归档：只改 status（AGENTS.md §4.7），不级联改动标签关系，不删除 Item。 */
  async archiveItem(id: string): Promise<void> {
    await this.updateItem(id, { status: 'archived' });
  }

  /** 取消归档：只改 status，恢复进默认列表（MVP 不追踪归档前状态，统一恢复为 active）。 */
  async unarchiveItem(id: string): Promise<void> {
    await this.updateItem(id, { status: 'active' });
  }

  async listArchivedItems(): Promise<ItemWithTags[]> {
    return loadItemsWithTagsByItemQuery(
      this.db,
      this.db
        .get<ItemModel>(ITEMS_TABLE)
        .query(Q.where('status', 'archived'), SORT_BY_UPDATED_DESC),
    );
  }

  /**
   * 归档视图查询（repository.md v0.12「搜索与归档增强接口」）：status='archived'，
   * updatedAt 降序，返回 ItemWithTags。与 v0.3 的 listArchivedItems 同语义并存，
   * 切片 12 决策 C：归档页换调本方法；listArchivedItems 保留不删。
   */
  async listArchivedItemsWithTags(): Promise<ItemWithTags[]> {
    return loadItemsWithTagsByItemQuery(
      this.db,
      this.db
        .get<ItemModel>(ITEMS_TABLE)
        .query(Q.where('status', 'archived'), SORT_BY_UPDATED_DESC),
    );
  }

  observeItemsWithTags(onNext: (items: ItemWithTags[]) => void): () => void {
    return combineLatest3(
      this.db
        .get<ItemModel>(ITEMS_TABLE)
        // 与 listItemsWithTags 同语义：默认列表（§4.7 未归档 + 未删除，§4.8 updatedAt 降序），
        // 否则归档后行内仍滞留在观察列表中。
        .query(NOT_ARCHIVED, SORT_BY_UPDATED_DESC)
        .observe(),
      this.itemTagsJoinQuery().observe(),
      this.allTagsQuery().observe(),
      joinItemsWithTags,
      onNext,
    );
  }

  /** join 投影辅助：全量 item_tags，join 顺序 = created_at 升序（与 loadItemsWithTagsByItemQuery 一致）。 */
  private itemTagsJoinQuery(): Query<ItemTagModel> {
    return this.db.get<ItemTagModel>(ITEM_TAGS_TABLE).query(Q.sortBy('created_at', 'asc'));
  }

  /** join 投影辅助：全量 tags。 */
  private allTagsQuery(): Query<TagModel> {
    return this.db.get<TagModel>(TAGS_TABLE).query();
  }

  observeTags(onNext: (tags: Tag[]) => void): () => void {
    const subscription = this.db
      .get<TagModel>(TAGS_TABLE)
      .query(Q.sortBy('created_at', 'asc'))
      .observe()
      .subscribe((models) => {
        onNext(models.map(toDomainTag));
      });

    return (): void => {
      subscription.unsubscribe();
    };
  }

  /** 契约外扩展（见接口注释）：按 id 取 Item，不存在返回 null（调度器用于完成/归档判定）。 */
  async getItem(id: string): Promise<Item | null> {
    const models = await this.db
      .get<ItemModel>(ITEMS_TABLE)
      .query(Q.where('id', id))
      .fetch();
    return models.length > 0 ? toDomainItem(models[0]) : null;
  }

  /** 切片 6（§4.24 冻结）：按 id 取 ItemWithTags，不存在返回 null（详情页用）。 */
  async getItemById(id: string): Promise<ItemWithTags | null> {
    const found = await loadItemsWithTagsByItemQuery(
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
    });
    return { ...toDomainItem(created), tags: [] };
  }

  async createImportedItem(input: ImportedItemInput): Promise<ItemWithTags> {
    const prepared = this.prepareImportedItem(input);
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
  ): Promise<ItemWithTags | null> {
    const found = await loadItemsWithTagsByItemQuery(
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
  }): Promise<ItemWithTags[]> {
    // MVP 只支持固定 filter（repository.md v0.8）；运行时显式拒绝其他组合。
    if (filter.includeArchived !== false || filter.includeDone !== true) {
      throw new Error(
        'listItemsForExport: only the fixed MVP filter {includeArchived: false, includeDone: true} is supported',
      );
    }
    return loadItemsWithTagsByItemQuery(
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
  ): Promise<ItemWithTags | null> {
    const found = await loadItemsWithTagsByItemQuery(
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
  ): Promise<ItemWithTags[]> {
    return loadItemsWithTagsByItemQuery(this.db, this.scheduledInRangeQuery(rangeStartMs, rangeEndMs));
  }

  async listOverdueItems(nowMs: number): Promise<ItemWithTags[]> {
    return loadItemsWithTagsByItemQuery(this.db, this.overdueQuery(nowMs));
  }

  async listUnscheduledItemsCreatedInRange(
    rangeStartMs: number,
    rangeEndMs: number,
  ): Promise<ItemWithTags[]> {
    return loadItemsWithTagsByItemQuery(
      this.db,
      this.unscheduledCreatedInRangeQuery(rangeStartMs, rangeEndMs),
    );
  }

  observeScheduledItemsInRange(
    rangeStartMs: number,
    rangeEndMs: number,
    onNext: (items: ItemWithTags[]) => void,
  ): () => void {
    return combineLatest3(
      this.scheduledInRangeQuery(rangeStartMs, rangeEndMs).observeWithColumns([
        // Query.observe() 只在匹配集合成员变化时发射（processChangeSet），status 在
        // active|done 之间翻转不改变成员资格（仍匹配 scheduled 条件），但会改变
        // done-last 排序与行展示——必须按列订阅才能捕获字段级变化。
        'status',
        'start_at',
        'end_at',
        'all_day',
      ]),
      this.itemTagsJoinQuery().observe(),
      this.allTagsQuery().observe(),
      joinItemsWithTags,
      onNext,
    );
  }

  observeOverdueItems(nowMs: number, onNext: (items: ItemWithTags[]) => void): () => void {
    return combineLatest3(
      // end_at 在过期集合内变化（仍是过去时刻）不改变成员资格但改变 endAt↑ 排序；
      // status 翻转虽会移出集合（成员变化必发射），列订阅保证一致语义。
      this.overdueQuery(nowMs).observeWithColumns(['status', 'end_at']),
      this.itemTagsJoinQuery().observe(),
      this.allTagsQuery().observe(),
      joinItemsWithTags,
      onNext,
    );
  }

  observeUnscheduledItemsCreatedInRange(
    rangeStartMs: number,
    rangeEndMs: number,
    onNext: (items: ItemWithTags[]) => void,
  ): () => void {
    return combineLatest3(
      // 本查询 status 仅取 active：翻转即成员变化，observe() 本就会发射；
      // 仍统一用 observeWithColumns 与另两个视图订阅保持同一语义口径（防御性）。
      this.unscheduledCreatedInRangeQuery(rangeStartMs, rangeEndMs).observeWithColumns(['status']),
      this.itemTagsJoinQuery().observe(),
      this.allTagsQuery().observe(),
      joinItemsWithTags,
      onNext,
    );
  }

  /**
   * 创建 Reminder（AGENTS.md §4.17/§4.18；切片 6 §4.25 白名单）：
   * - 宿主 Item 必须存在（提醒一律经 reminders 表关联，Item 上不加字段）；
   * - tzid 必须在时区白名单内（§4.25），白名单外抛明确错误；
   * - 规则字段经 normalizeReminderRuleFields 归一化校验；
   * - lastFiredOccurrenceKey / lastReconciledAt 初始化为 null（§4.18）。
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

    const created = await this.db.write(async () =>
      this.db.get<ReminderModel>(REMINDERS_TABLE).create((record) => {
        record.itemId = owner.id;
        record.frequency = fields.frequency;
        record.localTimeHour = fields.localTimeHour;
        record.localTimeMinute = fields.localTimeMinute;
        record.weekdaysJson = serializeWeekdays(fields.weekdays);
        record.dayOfMonth = fields.dayOfMonth;
        record.tzid = input.tzid;
        record.startAt = startAt;
        record.enabled = input.enabled;
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

      const updated = await record.update((draft) => {
        draft.frequency = fields.frequency;
        draft.localTimeHour = fields.localTimeHour;
        draft.localTimeMinute = fields.localTimeMinute;
        draft.weekdaysJson = serializeWeekdays(fields.weekdays);
        draft.dayOfMonth = fields.dayOfMonth;
        draft.startAt = startAt;
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
}
