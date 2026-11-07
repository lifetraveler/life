import type { Category } from '../domain/category';
import type {
  CreateItemInput,
  ImportedItemInput,
  Item,
  ItemSourceType,
  UpdateItemInput,
} from '../domain/item';
import type { AppSettings } from '../domain/settings';
import type {
  CreateReminderInput,
  Reminder,
  UpdateReminderInput,
} from '../domain/reminder';
import type { ItemWithRelations } from '../domain/relations/itemWithRelations';
import type { ItemWithTags, Tag } from '../domain/tag';

/**
 * v0.14：分类/标签视觉更新入参（repository.md「Category 与标签接口（v0.14）」明文形状）。
 * color / emoji 可独立更新，显式 null 表示清除。
 */
export interface VisualPatch {
  color?: string | null;
  emoji?: string | null;
}

/**
 * 切片 8：批量导入的单条失败记录
 * （repository.md v0.8「失败清单作为返回值上报」）。
 */
export interface ImportBatchFailure {
  title: string;
  sourceUid: string | null;
  reason: string;
}

/**
 * 切片 8：批量导入结果（repository.md v0.8 批量导入约束）。
 */
/**
 * 切片 9：系统日历导入输入（repository.md「系统日历导入接口（v0.9）」冻结）。
 */
export interface SystemCalendarImportInput {
  /** 要读取的系统日历 id 列表（expo-calendar Calendar.id）。 */
  calendarIds: string[];
  /** 范围起点（含），绝对毫秒。 */
  rangeStartMs: number;
  /** 范围终点（不含），绝对毫秒。 */
  rangeEndMs: number;
}

/** 系统日历导入的单条失败记录（repository.md v0.9 冻结形状）。 */
export interface SystemImportFailure {
  /** 系统事件 id（expo-calendar event.id；缺失为 null）。 */
  externalId: string | null;
  title: string;
  reason: string;
}

/**
 * 切片 9：系统日历导入结果。
 * 前四个字段为 repository.md v0.9 冻结语义；totalRead / outOfRangeCount /
 * sourceUidStrategies 为契约外显式扩展（先例：deleteItem / observe*）——
 * 任务卡实现要求 4 要求结果页展示读取总数与 sourceUid 策略条数，
 * 这些数据只在导入过程中可得，不属于冻结四字段。
 */
export interface SystemImportResult {
  imported: number;
  skippedDuplicate: number;
  skippedReadOnlyConflict: number;
  failed: SystemImportFailure[];
  /** 读取到的事件总数（reader 返回的全部事件，含范围外与解析失败）。 */
  totalRead: number;
  /** 被所选时间范围排除的事件数（startDate 不可解析的事件不计入，已入 failed）。 */
  outOfRangeCount: number;
  /** sourceUid 策略条数分布（对进入导入管线的事件计数，含因重复/冲突跳过的事件）。 */
  sourceUidStrategies: { 'event-id': number; 'content-hash': number };
}

export interface ImportBatchResult {
  createdCount: number;
  skippedDuplicateCount: number;
  failures: ImportBatchFailure[];
}

/**
 * Repository 接口（AGENTS.md §4.2 / §4.5 / §4.7）。
 *
 * - createItem / listItems：切片 1 契约签名，不得变更。
 * - updateItem / addTagToItem / removeTagFromItem / listItemsWithTags：§4.5 冻结签名。
 * - searchItems / archiveItem / unarchiveItem / listArchivedItems：§4.7 冻结签名。
 *   listItemsWithTags 语义按 §4.7 明确为「未归档 + 未删除」的默认列表。
 * - listArchivedItemsWithTags：repository.md v0.12「搜索与归档增强接口」明文新增
 *   （切片 12），归档视图页的查询入口；与 v0.3 的 listArchivedItems 并存，
 *   后者保留不删（既有调用方不改）。语义与 listArchivedItems 一致：
 *   status='archived'，updatedAt 降序，返回 ItemWithTags。
 * - observeItems / observeItemsWithTags / observeTags：契约外显式扩展
 *   （与切片 1 observeItems 同一先例）：状态管理锁定为 WatermelonDB 响应式查询，
 *   而 UI 层不得直接访问 WatermelonDB，因此观察入口只能由 data 层提供。
 *   切片 2 新增 observeItemsWithTags / observeTags，供列表即时刷新与「已有标签」复用建议；
 *   listItemsWithTags 本身仍按 §4.5 实现与保留。
 *   observeItemsWithTags 与 listItemsWithTags 同语义（默认列表），见 §4.7/§4.8。
 * - createReminder / updateReminder / deleteReminder / listRemindersByItem /
 *   listEnabledReminders / markReminderReconciled / markReminderFired：
 *   切片 5（§4.18）冻结签名。lastFiredOccurrenceKey / lastReconciledAt 由
 *   Repository 初始化为 null，仅调度器经 mark* 方法写入。
 * - listAllReminders：契约外显式扩展（与 observe* / getItem 同一先例）：切片 12
 *   数据导出需要全库 Reminder 概览（tasks/slice-12.md 实现要求 3，决策 A-1）；
 *   不过滤 enabled/status，返回领域对象（调度器内部字段由导出序列化层剔除）。
 * - getItemById / updateItemTime：切片 6（§4.24）冻结签名。getItemById 返回
 *   ItemWithTags | null；updateItemTime 只动时间字段并同时刷新 updatedAt，
 *   startAt/endAt 同时非 null 时 endAt < startAt 抛明确错误。
 * - getItem：契约外显式扩展（与 observe* 同一先例）：ReminderScheduler 需要按 id
 *   读取 Item（完成/归档判定与通知文案），Item 不存在时返回 null。
 * - listScheduledItemsInRange / listOverdueItems / listUnscheduledItemsCreatedInRange：
 *   切片 7（docs/contracts/repository.md「视图查询接口（v0.7）」）签名冻结。
 * - observeScheduledItemsInRange / observeOverdueItems / observeUnscheduledItemsCreatedInRange：
 *   契约外显式扩展（与 observeItemsWithTags 同一先例）：切片 7 视图页要求 WatermelonDB
 *   响应式查询自动刷新（ui.md「刷新」节），而 UI 层不得直接访问 WatermelonDB，
 *   因此观察入口只能由 data 层提供；语义与对应 list* 方法完全一致。返回退订函数。
 * - createImportedItem / findItemBySource / listItemsForExport / updateImportedItemTime：
 *   切片 8（docs/contracts/repository.md「ICS 导入导出接口（v0.8，切片 8 落地）」）签名冻结。
 *   createImportedItem 对 (sourceType='ics', sourceUid) 重复抛 DuplicateSourceUid，
 *   不做 upsert；updateImportedItemTime 与 updateItemTime 同语义（含只读拒绝，
 *   source_read_only=true 抛明确错误）。
 * - deleteItem：契约外显式扩展（与 observe* 同一先例）：切片 8 只读项需要
 *   「删除本地副本」（repository.md v0.8 只删本地行、不影响源 ICS；关联 reminders
 *   与 item_tags 一并物理删除，tags 保留）。随本扩展在文件头记录先例依据。
 * - importItemsInBatches：契约外显式扩展（与 observe* 同一先例）：repository.md v0.8
 *   要求「Repository 层分批写入（每批 100 条）、单条失败不整批回滚、失败清单作为
 *   返回值上报」，故批量写入辅助归入 Repository 接口。
 * - v0.14 分类与全局设置（repository.md「Category 与标签接口（v0.14）」明文新增）：
 *   getCategories（priority 升序）/ updateCategoryVisuals / updateTagVisuals /
 *   getSettings / updateSettings。getSettings 无记录时必须返回默认值
 *   { tagDisplayMode: 'text' } 并静默写入，不得抛错；updateSettings 目前仅支持
 *   tagDisplayMode。本切片不支持自定义新增/删除分类，仅允许改颜色/Emoji。
 * - v0.14 关系水合（AGENTS.md §7.23）：所有原先返回 Item[] 或 ItemWithTags[] 的
 *   查询接口统一升级为 ItemWithRelations[]（含 observe* 回调参数与
 *   getItemById / findItemBySource），必须水合完整 Category 对象与 Tags 数组，
 *   UI 层不得自查 Category/Tag 表。getItem（调度器用）保持 Item | null；
 *   createItem / createImportedItem / updateItem / updateItemTime /
 *   updateImportedItemTime 保持冻结写返回。createItem / updateItem 入参增加
 *   categoryId?: string | null（repository.md v0.14 明文）与 priority?: number
 *   （契约外文档化扩展，先例同 deleteItem / observe*，供阶段 3 编辑页使用）。
 * 观察方法的返回值均为退订函数。
 */
export interface ItemRepository {
  createItem(input: CreateItemInput): Promise<Item>;
  listItems(): Promise<ItemWithRelations[]>;
  observeItems(onNext: (items: ItemWithRelations[]) => void): () => void;
  updateItem(id: string, patch: UpdateItemInput): Promise<Item>;
  addTagToItem(itemId: string, tagName: string): Promise<Tag>;
  removeTagFromItem(itemId: string, tagId: string): Promise<void>;
  listItemsWithTags(): Promise<ItemWithRelations[]>;
  searchItems(keyword: string): Promise<ItemWithRelations[]>;
  archiveItem(id: string): Promise<void>;
  unarchiveItem(id: string): Promise<void>;
  listArchivedItems(): Promise<ItemWithRelations[]>;
  // —— v0.12：归档视图查询（repository.md「搜索与归档增强接口（v0.12）」明文新增，
  //    切片 12 落地；与 v0.3 listArchivedItems 并存，后者保留不删）——
  listArchivedItemsWithTags(): Promise<ItemWithRelations[]>;
  observeItemsWithTags(onNext: (items: ItemWithRelations[]) => void): () => void;
  observeTags(onNext: (tags: Tag[]) => void): () => void;
  getItem(id: string): Promise<Item | null>;

  // —— 切片 6：Item 时间字段（AGENTS.md §4.24，签名冻结）——
  getItemById(id: string): Promise<ItemWithRelations | null>;
  updateItemTime(
    id: string,
    patch: { startAt?: number | null; endAt?: number | null; allDay?: boolean },
  ): Promise<Item>;

  // —— 切片 7：视图查询（repository.md「视图查询接口（v0.7）」，签名冻结）——
  listScheduledItemsInRange(rangeStartMs: number, rangeEndMs: number): Promise<ItemWithRelations[]>;
  listOverdueItems(nowMs: number): Promise<ItemWithRelations[]>;
  listUnscheduledItemsCreatedInRange(rangeStartMs: number, rangeEndMs: number): Promise<ItemWithRelations[]>;

  // —— 切片 7：视图响应式扩展（契约外显式扩展，语义与对应 list* 一致）——
  observeScheduledItemsInRange(
    rangeStartMs: number,
    rangeEndMs: number,
    onNext: (items: ItemWithRelations[]) => void,
  ): () => void;
  observeOverdueItems(nowMs: number, onNext: (items: ItemWithRelations[]) => void): () => void;
  observeUnscheduledItemsCreatedInRange(
    rangeStartMs: number,
    rangeEndMs: number,
    onNext: (items: ItemWithRelations[]) => void,
  ): () => void;

  // —— 切片 5：reminders（AGENTS.md §4.18，签名冻结）——
  createReminder(input: CreateReminderInput): Promise<Reminder>;
  updateReminder(id: string, patch: UpdateReminderInput): Promise<Reminder>;
  deleteReminder(id: string): Promise<void>;
  listRemindersByItem(itemId: string): Promise<Reminder[]>;
  listEnabledReminders(): Promise<Reminder[]>;
  // —— 切片 12：数据导出（契约外显式扩展，理由见文件头 listAllReminders 条目）——
  listAllReminders(): Promise<Reminder[]>;
  markReminderReconciled(id: string, lastReconciledAt: number): Promise<void>;
  markReminderFired(id: string, occurrenceKey: string): Promise<void>;

  // —— 切片 8：ICS 导入导出（repository.md「ICS 导入导出接口（v0.8，切片 8 落地）」，签名冻结）——
  createImportedItem(input: ImportedItemInput): Promise<ItemWithTags>;
  // v0.9：sourceType 参数放宽为 ItemSourceType（AGENTS.md §7.15，切片 9 以 'system-calendar' 调用）。
  findItemBySource(sourceType: ItemSourceType, sourceUid: string): Promise<ItemWithRelations | null>;
  listItemsForExport(filter: { includeArchived: false; includeDone: true }): Promise<ItemWithRelations[]>;
  updateImportedItemTime(
    id: string,
    patch: { startAt?: number | null; endAt?: number | null; allDay?: boolean },
  ): Promise<Item>;

  // —— 切片 8：契约外显式扩展（先例依据见文件头 doc）——
  deleteItem(id: string): Promise<void>;
  importItemsInBatches(inputs: ImportedItemInput[]): Promise<ImportBatchResult>;

  // —— 切片 9：系统日历导入（repository.md「系统日历导入接口（v0.9，切片 9 落地）」，签名冻结）——
  importSystemCalendarEvents(input: SystemCalendarImportInput): Promise<SystemImportResult>;

  // —— 切片 14：分类与全局设置（repository.md「Category 与标签接口（v0.14）」明文新增）——
  /** 全部分类，按 priority 升序（预置 5 条；本切片不支持自定义新增/删除分类）。 */
  getCategories(): Promise<Category[]>;
  /** 更新分类视觉（颜色/Emoji）；分类不存在时抛明确错误。 */
  updateCategoryVisuals(id: string, patch: VisualPatch): Promise<Category>;
  /** 更新标签视觉（颜色/Emoji）；标签不存在时抛明确错误。 */
  updateTagVisuals(id: string, patch: VisualPatch): Promise<Tag>;
  /**
   * 全局设置；无记录时返回默认值 { tagDisplayMode: 'text' } 并静默写入，不得抛错
   * （repository.md v0.14）。库中读到非法枚举值时防御性回退默认值。
   */
  getSettings(): Promise<AppSettings>;
  /** 更新全局设置（目前仅支持 tagDisplayMode）。 */
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
}
