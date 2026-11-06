import type {
  CreateItemInput,
  ImportedItemInput,
  Item,
  ItemSourceType,
  UpdateItemInput,
} from '../domain/item';
import type {
  CreateReminderInput,
  Reminder,
  UpdateReminderInput,
} from '../domain/reminder';
import type { ItemWithTags, Tag } from '../domain/tag';

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
 * 观察方法的返回值均为退订函数。
 */
export interface ItemRepository {
  createItem(input: CreateItemInput): Promise<Item>;
  listItems(): Promise<Item[]>;
  observeItems(onNext: (items: Item[]) => void): () => void;
  updateItem(id: string, patch: UpdateItemInput): Promise<Item>;
  addTagToItem(itemId: string, tagName: string): Promise<Tag>;
  removeTagFromItem(itemId: string, tagId: string): Promise<void>;
  listItemsWithTags(): Promise<ItemWithTags[]>;
  searchItems(keyword: string): Promise<ItemWithTags[]>;
  archiveItem(id: string): Promise<void>;
  unarchiveItem(id: string): Promise<void>;
  listArchivedItems(): Promise<ItemWithTags[]>;
  // —— v0.12：归档视图查询（repository.md「搜索与归档增强接口（v0.12）」明文新增，
  //    切片 12 落地；与 v0.3 listArchivedItems 并存，后者保留不删）——
  listArchivedItemsWithTags(): Promise<ItemWithTags[]>;
  observeItemsWithTags(onNext: (items: ItemWithTags[]) => void): () => void;
  observeTags(onNext: (tags: Tag[]) => void): () => void;
  getItem(id: string): Promise<Item | null>;

  // —— 切片 6：Item 时间字段（AGENTS.md §4.24，签名冻结）——
  getItemById(id: string): Promise<ItemWithTags | null>;
  updateItemTime(
    id: string,
    patch: { startAt?: number | null; endAt?: number | null; allDay?: boolean },
  ): Promise<Item>;

  // —— 切片 7：视图查询（repository.md「视图查询接口（v0.7）」，签名冻结）——
  listScheduledItemsInRange(rangeStartMs: number, rangeEndMs: number): Promise<ItemWithTags[]>;
  listOverdueItems(nowMs: number): Promise<ItemWithTags[]>;
  listUnscheduledItemsCreatedInRange(rangeStartMs: number, rangeEndMs: number): Promise<ItemWithTags[]>;

  // —— 切片 7：视图响应式扩展（契约外显式扩展，语义与对应 list* 一致）——
  observeScheduledItemsInRange(
    rangeStartMs: number,
    rangeEndMs: number,
    onNext: (items: ItemWithTags[]) => void,
  ): () => void;
  observeOverdueItems(nowMs: number, onNext: (items: ItemWithTags[]) => void): () => void;
  observeUnscheduledItemsCreatedInRange(
    rangeStartMs: number,
    rangeEndMs: number,
    onNext: (items: ItemWithTags[]) => void,
  ): () => void;

  // —— 切片 5：reminders（AGENTS.md §4.18，签名冻结）——
  createReminder(input: CreateReminderInput): Promise<Reminder>;
  updateReminder(id: string, patch: UpdateReminderInput): Promise<Reminder>;
  deleteReminder(id: string): Promise<void>;
  listRemindersByItem(itemId: string): Promise<Reminder[]>;
  listEnabledReminders(): Promise<Reminder[]>;
  markReminderReconciled(id: string, lastReconciledAt: number): Promise<void>;
  markReminderFired(id: string, occurrenceKey: string): Promise<void>;

  // —— 切片 8：ICS 导入导出（repository.md「ICS 导入导出接口（v0.8，切片 8 落地）」，签名冻结）——
  createImportedItem(input: ImportedItemInput): Promise<ItemWithTags>;
  // v0.9：sourceType 参数放宽为 ItemSourceType（AGENTS.md §7.15，切片 9 以 'system-calendar' 调用）。
  findItemBySource(sourceType: ItemSourceType, sourceUid: string): Promise<ItemWithTags | null>;
  listItemsForExport(filter: { includeArchived: false; includeDone: true }): Promise<ItemWithTags[]>;
  updateImportedItemTime(
    id: string,
    patch: { startAt?: number | null; endAt?: number | null; allDay?: boolean },
  ): Promise<Item>;

  // —— 切片 8：契约外显式扩展（先例依据见文件头 doc）——
  deleteItem(id: string): Promise<void>;
  importItemsInBatches(inputs: ImportedItemInput[]): Promise<ImportBatchResult>;

  // —— 切片 9：系统日历导入（repository.md「系统日历导入接口（v0.9，切片 9 落地）」，签名冻结）——
  importSystemCalendarEvents(input: SystemCalendarImportInput): Promise<SystemImportResult>;
}
