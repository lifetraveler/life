import { Model } from '@nozbe/watermelondb';
import { date, readonly, text } from '@nozbe/watermelondb/decorators';

/**
 * Tag 表的 WatermelonDB model。
 * 字段与 src/domain/tag.ts 的 Tag 一一对应（AGENTS.md §4.4 受保护契约）。
 * name 唯一性（trim + 大小写不敏感）由 Repository 层保证，schema 不加冗余列。
 * created_at 由 @readonly @date 在 create 时自动写入（毫秒时间戳）。
 */
export default class TagModel extends Model {
  static table = 'tags';

  @text('name') name!: string;

  @readonly @date('created_at') createdAt!: Date;
}
