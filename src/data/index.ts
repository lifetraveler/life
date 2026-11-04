import { database } from '../db/database';
import type { ItemRepository } from './ItemRepository';
import { WatermelonItemRepository } from './WatermelonItemRepository';
import { WidgetSnapshotWriter } from './WidgetSnapshotWriter';

/**
 * 模块级单例：UI 只从这里拿 Repository，不接触 WatermelonDB。
 */
export const itemRepository: ItemRepository = new WatermelonItemRepository(database);

/**
 * 模块级单例（切片 10）：今日待办小组件快照写入/读取器。
 * 消费 itemRepository 的视图查询（切片 7），经 WidgetSnapshotStore 原生模块写 SharedPreferences；
 * 不改 Repository 接口（repository.md 冻结）。
 */
export const widgetSnapshotWriter: WidgetSnapshotWriter = new WidgetSnapshotWriter(
  itemRepository,
);

export type { ItemRepository } from './ItemRepository';
export { WidgetSnapshotWriter } from './WidgetSnapshotWriter';
