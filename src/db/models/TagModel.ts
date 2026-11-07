import { Model } from '@nozbe/watermelondb';
import { date, field, readonly, text } from '@nozbe/watermelondb/decorators';

/**
 * Tag 表的 WatermelonDB model。
 * 字段与 src/domain/tag.ts 的 Tag 一一对应（AGENTS.md §4.4 受保护契约）。
 * name 唯一性（trim + 大小写不敏感）由 Repository 层保证，schema 不加冗余列。
 * created_at 由 @readonly @date 在 create 时自动写入（毫秒时间戳）。
 */
export default class TagModel extends Model {
  static table = 'tags';

  @text('name') name!: string;

  // 切片 14（AGENTS.md §7.22，schema v6）：标签视觉字段；列 isOptional，既有行读到 null，
  // 读取层（toDomainTag）保持 null，UI 回退默认样式。
  @field('color') color!: string | null;

  @field('emoji') emoji!: string | null;

  @readonly @date('created_at') createdAt!: Date;
}
