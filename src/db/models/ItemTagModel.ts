import { Model } from '@nozbe/watermelondb';
import { date, readonly, text } from '@nozbe/watermelondb/decorators';

/**
 * ItemTag 关联表的 WatermelonDB model（AGENTS.md §4.4，Item 与 Tag 多对多）。
 * item_id / tag_id 为普通字符串列，关联查询用 Q.where 按列过滤即可，
 * 不使用 @relation 装饰器（避免为写路径引入 Relation 惰性对象）。
 * created_at 由 @readonly @date 在 create 时自动写入（毫秒时间戳）。
 */
export default class ItemTagModel extends Model {
  static table = 'item_tags';

  @text('item_id') itemId!: string;

  @text('tag_id') tagId!: string;

  @readonly @date('created_at') createdAt!: Date;
}
