import { appSchema, tableSchema } from '@nozbe/watermelondb';

/**
 * schema 版本号：任何表/列变更必须 +1 并提供 migration（AGENTS.md §4.1 / §4.6）。
 */
export const SCHEMA_VERSION = 5;

export const schema = appSchema({
  version: SCHEMA_VERSION,
  tables: [
    // 切片 6（AGENTS.md §4.23）：items 新增时间字段，schema v4。
    // start_at / end_at 为绝对毫秒时间戳，null 表示未安排/无结束时间；all_day 默认 false。
    // v1→v3 的列定义保持原样（AGENTS.md §4.6 已发布列不得修改）。
    tableSchema({
      name: 'items',
      columns: [
        { name: 'type', type: 'string', isIndexed: true },
        { name: 'title', type: 'string' },
        { name: 'content', type: 'string' },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'start_at', type: 'number', isOptional: true },
        { name: 'end_at', type: 'number', isOptional: true },
        { name: 'all_day', type: 'boolean', isOptional: true },
        // 切片 8（data-model.md v0.8）：外部来源字段，schema v5。
        // 三列全部 isOptional：WatermelonDB add_columns 迁移对非可选列会把既有行强制回填
        // 类型零值（string → ''），违反「既有行不回填、读取层 ?? 'local' 归一」的契约语义；
        // isOptional 列迁移时回填 null，既有行经 toDomainItem 归一为 ('local', null, false)。
        // (sourceType, sourceUid) 唯一性由 Repository 先查后写保证，不建 SQLite 唯一索引。
        { name: 'source_type', type: 'string', isOptional: true },
        { name: 'source_uid', type: 'string', isOptional: true },
        { name: 'source_read_only', type: 'boolean', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    // 切片 2（AGENTS.md §4.4）：标签不存 Item 字符串，用 tags / item_tags 两张表表达多对多。
    tableSchema({
      name: 'tags',
      columns: [
        // name 全局唯一（trim + 大小写不敏感）由 Repository 层保证，不依赖数据库约束。
        { name: 'name', type: 'string', isIndexed: true },
        { name: 'created_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'item_tags',
      columns: [
        { name: 'item_id', type: 'string', isIndexed: true },
        { name: 'tag_id', type: 'string', isIndexed: true },
        { name: 'created_at', type: 'number' },
      ],
    }),
    // 切片 5（AGENTS.md §4.17）：提醒规则表，schema v3。
    // weekdays 存 JSON 数组字符串（冻结决定）；last_* 两列 nullable（isOptional），
    // 由 Repository 初始化为 null，仅调度器经 markReminderFired / markReminderReconciled 写入。
    tableSchema({
      name: 'reminders',
      columns: [
        { name: 'item_id', type: 'string', isIndexed: true },
        { name: 'frequency', type: 'string' },
        { name: 'local_time_hour', type: 'number' },
        { name: 'local_time_minute', type: 'number' },
        { name: 'weekdays', type: 'string' },
        { name: 'day_of_month', type: 'number' },
        { name: 'tzid', type: 'string' },
        { name: 'start_at', type: 'number' },
        { name: 'enabled', type: 'boolean' },
        { name: 'last_fired_occurrence_key', type: 'string', isOptional: true },
        { name: 'last_reconciled_at', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
});
