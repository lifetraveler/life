import { Model, Query, associations } from '@nozbe/watermelondb';
import { children, date, readonly, text } from '@nozbe/watermelondb/decorators';

import type { ItemStatus, ItemType } from '../../domain/item';
import ItemTagModel from './ItemTagModel';

/**
 * Item 表的 WatermelonDB model。
 * 字段与 src/domain/item.ts 的 Item 一一对应（AGENTS.md §4.1 受保护契约）。
 * created_at / updated_at 由 @readonly @date 在 create 时自动写入（毫秒时间戳），
 * update 时 updated_at 由 WatermelonDB prepareUpdate 内部自动刷新。
 */
export default class ItemModel extends Model {
  static table = 'items';

  // @children 要求宿主 model 显式声明 has_many association（WatermelonDB 0.28 不自动收集）。
  static associations = associations([
    'item_tags',
    { type: 'has_many', foreignKey: 'item_id' },
  ]);

  @text('type') type!: ItemType;

  @text('title') title!: string;

  @text('content') content!: string;

  @text('status') status!: ItemStatus;

  @readonly @date('created_at') createdAt!: Date;

  @readonly @date('updated_at') updatedAt!: Date;

  // 本 Item 的全部标签关联（AGENTS.md §4.4 多对多经 item_tags 表）。
  @children('item_tags') itemTags!: Query<ItemTagModel>;
}
