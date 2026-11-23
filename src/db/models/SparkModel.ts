import { Model } from '@nozbe/watermelondb';
import { date, readonly, text } from '@nozbe/watermelondb/decorators';

/**
 * sparks 表 model（切片 37 schema v19，AGENTS.md §7.49）。
 * title / content 双可空（isOptional 列）：纯录音灵感先建行后挂附件，两列可能
 * 同时为 null（录音流程合法状态，提案 D3）。
 * created_at / updated_at 由 @readonly @date 在 create 时自动写入（毫秒时间戳），
 * update 时 updated_at 由 WatermelonDB prepareUpdate 内部自动刷新。
 * 无 associations 声明：spark_items 关联经 Repository 批量水合（§7.23 同款纪律）。
 */
export default class SparkModel extends Model {
  static table = 'sparks';

  @text('title') title!: string | null;

  @text('content') content!: string | null;

  @readonly @date('created_at') createdAt!: Date;

  @readonly @date('updated_at') updatedAt!: Date;
}
