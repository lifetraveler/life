import { Database, Q, Query } from '@nozbe/watermelondb';

import type { CreateItemInput, Item, UpdateItemInput } from '../domain/item';
import type {
  CreateReminderInput,
  Reminder,
  UpdateReminderInput,
} from '../domain/reminder';
import { assertValidTimeZone } from '../domain/recurrence/civilTime';
import { escapeLikePattern, normalizeSearchKeyword } from '../domain/search';
import { normalizeTagName } from '../domain/tag';
import type { ItemWithTags, Tag } from '../domain/tag';
import ItemModel from '../db/models/ItemModel';
import ItemTagModel from '../db/models/ItemTagModel';
import ReminderModel from '../db/models/ReminderModel';
import TagModel from '../db/models/TagModel';
import type { ItemRepository } from './ItemRepository';
import {
  normalizeReminderRuleFields,
  normalizeStartAt,
  parseWeekdaysJson,
  serializeWeekdays,
} from './reminderRuleMapping';

const ITEMS_TABLE = 'items';
const TAGS_TABLE = 'tags';
const ITEM_TAGS_TABLE = 'item_tags';
const REMINDERS_TABLE = 'reminders';

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

  constructor(db: Database) {
    this.db = db;
  }

  async createItem(input: CreateItemInput): Promise<Item> {
    const title = input.title.trim();
    if (title.length === 0) {
      throw new Error('createItem: title is required');
    }

    const created = await this.db.write(async () => {
      const item = await this.db.get<ItemModel>(ITEMS_TABLE).create((record) => {
        record.type = input.type;
        record.title = title;
        record.content = input.content ?? '';
        record.status = 'active';
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

  observeItemsWithTags(onNext: (items: ItemWithTags[]) => void): () => void {
    return combineLatest3(
      this.db
        .get<ItemModel>(ITEMS_TABLE)
        // 与 listItemsWithTags 同语义：默认列表（§4.7 未归档 + 未删除，§4.8 updatedAt 降序），
        // 否则归档后行内仍滞留在观察列表中。
        .query(NOT_ARCHIVED, SORT_BY_UPDATED_DESC)
        .observe(),
      this.db
        .get<ItemTagModel>(ITEM_TAGS_TABLE)
        .query(Q.sortBy('created_at', 'asc'))
        .observe(),
      this.db
        .get<TagModel>(TAGS_TABLE)
        .query()
        .observe(),
      joinItemsWithTags,
      onNext,
    );
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

  /**
   * 创建 Reminder（AGENTS.md §4.17/§4.18）：
   * - 宿主 Item 必须存在（提醒一律经 reminders 表关联，Item 上不加字段）；
   * - tzid 经 assertValidTimeZone 校验（只读复用切片 4 的纯函数，不改 recurrence/）；
   * - 规则字段经 normalizeReminderRuleFields 归一化校验；
   * - lastFiredOccurrenceKey / lastReconciledAt 初始化为 null（§4.18）。
   */
  async createReminder(input: CreateReminderInput): Promise<Reminder> {
    const owner = await this.getItem(input.itemId);
    if (!owner) {
      throw new Error(`createReminder: item not found: ${input.itemId}`);
    }
    assertValidTimeZone(input.tzid);
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
   * 更新 Reminder：仅规则字段与 enabled；tzid / itemId / id / createdAt 不可更新
   * （tzid 为创建时写入语义，§4.17）；lastFiredOccurrenceKey / lastReconciledAt
   * 只经 markReminderFired / markReminderReconciled 写入。
   */
  async updateReminder(id: string, patch: UpdateReminderInput): Promise<Reminder> {
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
