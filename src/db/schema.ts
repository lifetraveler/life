import { appSchema, tableSchema } from '@nozbe/watermelondb';

/**
 * schema 版本号：任何表/列变更必须 +1 并提供 migration（AGENTS.md §4.1 / §4.6）。
 */
export const SCHEMA_VERSION = 3;

export const schema = appSchema({
  version: SCHEMA_VERSION,
  tables: [
    tableSchema({
      name: 'items',
      columns: [
        { name: 'type', type: 'string', isIndexed: true },
        { name: 'title', type: 'string' },
        { name: 'content', type: 'string' },
        { name: 'status', type: 'string', isIndexed: true },
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
