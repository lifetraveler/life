import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

import type { SyncTombstoneKind } from '../../domain/syncSnapshot';

/**
 * sync_tombstones 表的 WatermelonDB model（切片 35 阶段 1，AGENTS.md §7.47，schema v17）。
 *
 * - 删除传播墓碑：deleteItem / deleteReminder / deleteChannelPreset 三处删除路径
 *   在同一事务内追加一行墓碑（kind + entity_id + deleted_at），随同步快照携带到
 *   对端（对方墓碑命中本地行 → 本地删；本地墓碑命中对方行 → 不创建不更新）。
 * - kind 仅 'item' | 'reminder' | 'channel_preset'（写路径 Repository 层保证）。
 * - entity_id 建索引（isIndexed）：合流与删除路径按 (kind, entity_id) 查存在性。
 * - deleted_at 为毫秒时间戳（删除时刻）：快照按 exportedAt 最小值裁剪墓碑
 *   （deleted_at 严格早于全部对端 exportedAt 才可删）。
 * - 无 created_at / updated_at 列（schema v17 三列，与 schema.ts 逐字段一致）；
 *   行 id 由 WatermelonDB create 时自动生成 uuid。
 */
export default class SyncTombstoneModel extends Model {
  static table = 'sync_tombstones';

  /** 仅 'item' | 'reminder' | 'channel_preset'（写路径守卫，读取层防御） */
  @text('kind') kind!: SyncTombstoneKind;

  /** 被删实体 id（items.id / reminders.id / channel_presets.id），建索引 */
  @text('entity_id') entityId!: string;

  /** 删除时刻毫秒时间戳（recordTombstoneInTransaction 写入；合流写远端墓碑时保真） */
  @field('deleted_at') deletedAt!: number;
}
