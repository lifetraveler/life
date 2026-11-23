import { Model } from '@nozbe/watermelondb';
import { date, readonly, text } from '@nozbe/watermelondb/decorators';

/**
 * spark_items join 表 model（切片 37 schema v19，AGENTS.md §7.49）。
 * 灵感↔计划一对多关联：一个灵感可关联多个计划；不做计划侧反查入口（提案 D8）。
 * 不用 @relation（ItemTagModel join 模型同款纪律）：写路径只经 Repository，
 * 查询经 Q.oneOf 批量水合避免 N+1；item_id 存在性校验在 Repository 写路径。
 */
export default class SparkItemModel extends Model {
  static table = 'spark_items';

  @text('spark_id') sparkId!: string;

  @text('item_id') itemId!: string;

  @readonly @date('created_at') createdAt!: Date;
}
