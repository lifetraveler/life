import type { CreateItemInput, Item } from '../domain/item';

/**
 * Repository 接口（AGENTS.md §4.2）。
 *
 * createItem / listItems 为契约规定的初始签名，不得变更；
 * observeItems 为本切片的显式扩展：状态管理锁定为 WatermelonDB 响应式查询，
 * 而 UI 层不得直接访问 WatermelonDB，因此观察入口只能由 data 层提供。
 * 返回值为退订函数。
 */
export interface ItemRepository {
  createItem(input: CreateItemInput): Promise<Item>;
  listItems(): Promise<Item[]>;
  observeItems(onNext: (items: Item[]) => void): () => void;
}
