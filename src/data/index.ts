import { database } from '../db/database';
import type { ItemRepository } from './ItemRepository';
import { WatermelonItemRepository } from './WatermelonItemRepository';
import { WidgetSnapshotWriter } from './WidgetSnapshotWriter';
import type { SparkRepository } from './SparkRepository';
import { WatermelonSparkRepository } from './WatermelonSparkRepository';
import { defaultSparkAttachmentIo } from './sparkAttachmentIo';

/**
 * 模块级单例：UI 只从这里拿 Repository，不接触 WatermelonDB。
 * 第 4 参注入附件 IO（切片 37 §7.49 D5）：数据快照恢复时事务外补链 Spark 附件文件；
 * 单测可不注入（null 默认）避免引入 expo-file-system。
 */
export const itemRepository: ItemRepository = new WatermelonItemRepository(
  database,
  undefined,
  undefined,
  defaultSparkAttachmentIo(),
);

/**
 * 模块级单例（切片 37，AGENTS.md §7.49 D3）：Spark 灵感火花。
 * 附件文件/远端 IO 在此装配默认实现（expo-file-system + WebdavClient 60s +
 * SecureWebdavConfigStore）；单测直接构造 WatermelonSparkRepository 注入 stub。
 */
export const sparkRepository: SparkRepository = new WatermelonSparkRepository(
  database,
  defaultSparkAttachmentIo(),
);

/**
 * 模块级单例（切片 10）：今日待办小组件快照写入/读取器。
 * 消费 itemRepository 的视图查询（切片 7），经 WidgetSnapshotStore 原生模块写 SharedPreferences；
 * 不改 Repository 接口（repository.md 冻结）。
 */
export const widgetSnapshotWriter: WidgetSnapshotWriter = new WidgetSnapshotWriter(
  itemRepository,
);

export type { ItemRepository } from './ItemRepository';
export type { SparkRepository } from './SparkRepository';
export { WidgetSnapshotWriter } from './WidgetSnapshotWriter';
