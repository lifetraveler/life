import type { CreateItemInput, Item, UpdateItemInput } from '../domain/item';
import type {
  CreateReminderInput,
  Reminder,
  UpdateReminderInput,
} from '../domain/reminder';
import type { ItemWithTags, Tag } from '../domain/tag';

/**
 * Repository 接口（AGENTS.md §4.2 / §4.5 / §4.7）。
 *
 * - createItem / listItems：切片 1 契约签名，不得变更。
 * - updateItem / addTagToItem / removeTagFromItem / listItemsWithTags：§4.5 冻结签名。
 * - searchItems / archiveItem / unarchiveItem / listArchivedItems：§4.7 冻结签名。
 *   listItemsWithTags 语义按 §4.7 明确为「未归档 + 未删除」的默认列表。
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
 * - getItem：契约外显式扩展（与 observe* 同一先例）：ReminderScheduler 需要按 id
 *   读取 Item（完成/归档判定与通知文案），Item 不存在时返回 null。
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
  observeItemsWithTags(onNext: (items: ItemWithTags[]) => void): () => void;
  observeTags(onNext: (tags: Tag[]) => void): () => void;
  getItem(id: string): Promise<Item | null>;

  // —— 切片 5：reminders（AGENTS.md §4.18，签名冻结）——
  createReminder(input: CreateReminderInput): Promise<Reminder>;
  updateReminder(id: string, patch: UpdateReminderInput): Promise<Reminder>;
  deleteReminder(id: string): Promise<void>;
  listRemindersByItem(itemId: string): Promise<Reminder[]>;
  listEnabledReminders(): Promise<Reminder[]>;
  markReminderReconciled(id: string, lastReconciledAt: number): Promise<void>;
  markReminderFired(id: string, occurrenceKey: string): Promise<void>;
}
