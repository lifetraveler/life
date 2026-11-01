import { database } from '../db/database';
import type { ItemRepository } from './ItemRepository';
import { WatermelonItemRepository } from './WatermelonItemRepository';

/**
 * 模块级单例：UI 只从这里拿 Repository，不接触 WatermelonDB。
 */
export const itemRepository: ItemRepository = new WatermelonItemRepository(database);

export type { ItemRepository } from './ItemRepository';
