import { Model } from '@nozbe/watermelondb';
import { date, readonly, text } from '@nozbe/watermelondb/decorators';

import type { ItemStatus, ItemType } from '../../domain/item';

/**
 * Item 表的 WatermelonDB model。
 * 字段与 src/domain/item.ts 的 Item 一一对应（AGENTS.md §4.1 受保护契约）。
 * created_at / updated_at 由 @readonly @date 在 create 时自动写入（毫秒时间戳）。
 */
export default class ItemModel extends Model {
  static table = 'items';

  @text('type') type!: ItemType;

  @text('title') title!: string;

  @text('content') content!: string;

  @text('status') status!: ItemStatus;

  @readonly @date('created_at') createdAt!: Date;

  @readonly @date('updated_at') updatedAt!: Date;
}
