import type { Category } from '../domain/category';
import type { ChannelPreset, CreateChannelPresetInput, UpdateChannelPresetInput } from '../domain/channelPreset';
import type {
  CreateItemInput,
  ImportedItemInput,
  Item,
  ItemSourceType,
  UpdateItemInput,
} from '../domain/item';
import type { IcsParseFailure } from '../domain/ics/parseIcs';
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
 * 切片 17 阶段 1：ICS 导入预览单条（repository.md v0.17「导入预览」节）。
 * 确认导入时 entries 里被勾选的 input 可直接喂 importItemsInBatches——
 * isDuplicate 判定与 importItemsInBatches 的 skippedDuplicate 同键
 * （(sourceType='ics', sourceUid)），保证「预览标记 = 实际落库行为」。
 */
export interface IcsPreviewEntry {
  /** parseIcs 原样透传；确认导入时直接使用 */
  input: ImportedItemInput;
  /** floating date-time 标记（parseIcs 原样透传，预览页信息性提示用） */
  floating: boolean;
  /** (sourceType='ics', sourceUid) 已存在本地库；sourceUid=null（无 UID）恒 false */
  isDuplicate: boolean;
  /** 命中的本地项 id（预览页跳转/查看已导入项用）；isDuplicate=false 时为 null */
  existingItemId: string | null;
}

/**
 * 切片 17 阶段 1：ICS 导入预览结果（纯读不写——生成预览不落库，
 * 确认导入走既有 importItemsInBatches）。
 */
export interface IcsPreviewResult {
  entries: IcsPreviewEntry[];
  /** parseIcs 原样透传：单事件解析失败清单（SUMMARY + 原因） */
  failures: IcsParseFailure[];
  /** parseIcs 原样透传：同文件重复 UID（保留第一条，其余计入此处） */
  sameFileDuplicates: Array<{ uid: string; summary: string }>;
  /** entries 中 isDuplicate=true 的条数（预览页信息性计数） */
  duplicateCount: number;
}

/**
 * 切片 17 阶段 2：系统日历导入预览单条（契约外显式扩展，repository.md v0.17 补记）。
 * 与 IcsPreviewEntry 同构思路；确认导入时勾选的 input 直接喂
 * importSystemCalendarEntries——isDuplicate 判定键与该方法的落库去重键一致
 * （(sourceType='system-calendar', source_uid)），保证「预览标记 = 实际落库行为」。
 */
export interface SystemCalendarPreviewEntry {
  /** mapSystemEventToImportedItem 的映射结果原样透传（确认导入时直接使用）。 */
  input: ImportedItemInput;
  /**
   * (sourceType='system-calendar', source_uid) 已存在本地库（sourceReadOnly=true
   * 计重复；非只读命中同键，见 importSystemCalendarEvents 的冲突语义）。
   */
  isDuplicate: boolean;
  /** 命中的本地项 id；isDuplicate=false 时为 null。 */
  existingItemId: string | null;
  /** 系统事件 id（expo-calendar event.id；与 failed 清单的 externalId 同源）。 */
  externalId: string | null;
}

/**
 * 切片 17 阶段 2：系统日历导入预览结果（纯读不写——生成预览不落库，
 * 确认导入走本切片新增的 importSystemCalendarEntries）。
 * sourceUid 策略计数不在预览期重复透出（preview 页不展示；确认导入的结果页语义不变）。
 */
export interface SystemCalendarPreviewResult {
  entries: SystemCalendarPreviewEntry[];
  /** startDate 不可解析等无法进入映射的事件（与 importSystemCalendarEvents 同分流语义）。 */
  failures: SystemImportFailure[];
  /** 读取到的事件总数（reader 返回的全部事件，含范围外与解析失败）。 */
  totalRead: number;
  /** 被所选时间范围排除的事件数（startDate 不可解析的不计入，已入 failures）。 */
  outOfRangeCount: number;
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
 *   { tagDisplayMode: 'text' } 并静默写入，不得抛错；updateSettings 随阶段 7a
 *   扩展支持小组件显示开关 4 项（docs/proposals/slice-14-widget-phase7.md，
 *   schema v7）。本切片不支持自定义新增/删除分类，仅允许改颜色/Emoji。
 * - 切片 14 阶段 7a：listUnscheduledItems / observeUnscheduledItems（契约外显式扩展，
 *   先例同 deleteItem / observe*）：小组件「待办组」数据源（无时间纯待办，
 *   不限创建窗口，区别于切片 7 的 listUnscheduledItemsCreatedInRange「今日创建」口径）。
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
  /** 切片 14 阶段 3（契约外文档化扩展，先例同 getCategories）：一次性取全部标签（created_at 升序）。 */
  listTags(): Promise<Tag[]>;
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

  // —— 切片 14 阶段 7a：全部待办（契约外显式扩展，先例同 observe*）——
  /** 无时间纯待办（startAt null + active，不限创建窗口，createdAt 降序）；小组件快照数据源。 */
  listUnscheduledItems(): Promise<ItemWithRelations[]>;
  /** 全部待办的响应式版本（语义与 listUnscheduledItems 一致）；返回退订函数。 */
  observeUnscheduledItems(onNext: (items: ItemWithRelations[]) => void): () => void;

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
   * 阶段 7a（schema v7）：默认值扩展小组件显示开关（domain/settings.ts DEFAULT_APP_SETTINGS）。
   */
  getSettings(): Promise<AppSettings>;
  /**
   * 更新全局设置（阶段 7a 扩展：tagDisplayMode + 小组件显示开关 4 项，
   * docs/proposals/slice-14-widget-phase7.md）。改小组件开关后由调用方触发快照刷新。
   */
  updateSettings(patch: Partial<AppSettings>): Promise<void>;

  // —— 切片 17 阶段 1：渠道预设（repository.md v0.17「渠道预设接口」，契约外显式扩展，
  //    先例依据同 deleteItem / observe*：AGENTS.md §7.27 渠道配置中心要求预设存
  //    channel_presets 表（schema v9），写路径校验收敛在 Repository）——
  /** 全部预设，created_at 降序（新建的在前）。 */
  listChannelPresets(): Promise<ChannelPreset[]>;
  /**
   * 创建预设：name trim 后非空、type ∈ {webhook, apprise}、configJson 经对应渠道守卫
   * 校验（webhook → parseWebhookChannelConfig，apprise → parseAppriseChannelConfig），
   * 违规抛明确错误。type 创建后不可变（改类型等于换配置语义，应删除重建）。
   */
  createChannelPreset(input: CreateChannelPresetInput): Promise<ChannelPreset>;
  /** 更新预设（patch 合并语义，与 UpdateReminderInput 同纪律）；type 不可更新；预设不存在时抛明确错误。 */
  updateChannelPreset(id: string, patch: UpdateChannelPresetInput): Promise<ChannelPreset>;
  /** 删除预设；不存在时抛明确错误。删除预设不影响已引用其 configJson 的既有提醒。 */
  deleteChannelPreset(id: string): Promise<void>;

  // —— 切片 17 阶段 1：导入预览（repository.md v0.17「导入预览接口」）——
  /**
   * 解析 ICS 文本并标记本地去重状态，纯读不写（确认导入走 importItemsInBatches）。
   * deviceTzid 显式传参（与 parseIcs 一致，§4.9 视图函数同纪律：不读设备默认时区）。
   */
  generateIcsPreview(icsText: string, deviceTzid: string): Promise<IcsPreviewResult>;

  // —— 切片 17 阶段 2：系统日历导入预览（repository.md v0.17 补记，契约外显式扩展，
  //    先例依据同 deleteItem / observe*：AGENTS.md §7.28 导入预览要求系统日历导入
  //    与 ICS 一致先预览再确认，原 importSystemCalendarEvents 一体化读取+落库
  //    无法支撑「取消勾选不落库」）——
  /**
   * 读取系统日历事件并映射 + 标记本地去重状态，纯读不写。校验与分流语义与
   * importSystemCalendarEvents 一致（range 有限且 start<end 否则抛错；startDate
   * 不可解析入 failures；范围外计入 outOfRangeCount）。
   */
  generateSystemCalendarPreview(
    input: SystemCalendarImportInput,
  ): Promise<SystemCalendarPreviewResult>;
  /**
   * 按预览勾选结果落库系统日历条目：inputs 必须来自 generateSystemCalendarPreview
   * 产出的 entry.input（本方法不做读取/映射）。落库固定 type='event'/
   * sourceType='system-calendar'/sourceReadOnly=true（§7.15），allDay 归一化与
   * importSystemCalendarEvents 共用预处理。落库时在事务内按同键重查去重（防预览后
   * 并发写入的竞态窗口）：预览期标记的重复不应被再次传入；确认时新出现的重复与
   * 非只读冲突均计入 skippedDuplicateCount（结果页统一呈现为「跳过（重复）」）。
   */
  importSystemCalendarEntries(inputs: ImportedItemInput[]): Promise<ImportBatchResult>;
}
