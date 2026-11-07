import { Model, Query, associations } from '@nozbe/watermelondb';
import { children, date, field, readonly, text } from '@nozbe/watermelondb/decorators';

import type { ItemSourceType, ItemStatus, ItemType } from '../../domain/item';
import ItemTagModel from './ItemTagModel';
import ReminderModel from './ReminderModel';

/**
 * Item 表的 WatermelonDB model。
 * 字段与 src/domain/item.ts 的 Item 一一对应（AGENTS.md §4.1 受保护契约）。
 * created_at / updated_at 由 @readonly @date 在 create 时自动写入（毫秒时间戳），
 * update 时 updated_at 由 WatermelonDB prepareUpdate 内部自动刷新。
 */
export default class ItemModel extends Model {
  static table = 'items';

  // @children 要求宿主 model 显式声明 has_many association（WatermelonDB 0.28 不自动收集）。
  static associations = associations(
    ['item_tags', { type: 'has_many', foreignKey: 'item_id' }],
    // 切片 5（AGENTS.md §4.17）：Item 与 reminders 一对多；写路径仍只经 Repository。
    ['reminders', { type: 'has_many', foreignKey: 'item_id' }],
  );

  @text('type') type!: ItemType;

  @text('title') title!: string;

  @text('content') content!: string;

  @text('status') status!: ItemStatus;

  // 切片 6（AGENTS.md §4.23）：绝对毫秒时间戳；null 表示未安排 / 无结束时间。
  // migration addColumns 不回填，v4 之前创建的行读到 null。
  @field('start_at') startAt!: number | null;

  @field('end_at') endAt!: number | null;

  // all_day 列 isOptional：既有行读到 null，读取层（toDomainItem）归一为 false。
  @field('all_day') allDay!: boolean | null;

  // 切片 8（data-model.md v0.8）：外部来源字段，schema v5。
  // 三列 isOptional：迁移不回填，既有行读到 null，读取层（toDomainItem）归一
  // 为 ('local', null, false)；新行由 Repository 写入显式值。
  @text('source_type') sourceType!: ItemSourceType | null;

  @text('source_uid') sourceUid!: string | null;

  @field('source_read_only') sourceReadOnly!: boolean | null;

  // 切片 14（AGENTS.md §7.22，schema v6）：分类关联与优先级。
  // category_id 列 isOptional：升级安装迁移用 SQL 回填 'other'，全新安装 seed 保证默认分类存在；
  // 域层经 toDomainItem 以 'other' 归一（与 sourceType ?? 'local' 同一模式）。
  // 注意：本 model 不声明 categories association——按任务卡要求，Category 由 Repository
  // 批量水合（Q.oneOf 一次查询 + 内存合并，避免 N+1），UI 不得经 model 关联自查（§7.23）。
  @text('category_id') categoryId!: string | null;

  // priority 非可选：迁移对既有行回填 0（=无优先级）；新行由 Repository 写入显式值（0..3）。
  @field('priority') priority!: number;

  @readonly @date('created_at') createdAt!: Date;

  @readonly @date('updated_at') updatedAt!: Date;

  // 本 Item 的全部标签关联（AGENTS.md §4.4 多对多经 item_tags 表）。
  @children('item_tags') itemTags!: Query<ItemTagModel>;

  // 切片 5（AGENTS.md §4.17）：本 Item 的提醒规则；Item 侧不新增任何提醒字段。
  @children('reminders') reminders!: Query<ReminderModel>;
}
