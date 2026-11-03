import { addColumns, createTable, schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

/**
 * WatermelonDB schema migrations。
 *
 * - v1：items 表（切片 1 初始 schema，无需迁移步骤）
 * - v2：新增 tags、item_tags 表（切片 2）
 * - v3：新增 reminders 表（切片 5，AGENTS.md §4.17）
 * - v4：items 新增 start_at / end_at / all_day 列（切片 6，AGENTS.md §4.23）
 *
 * 规则（AGENTS.md §4.6）：已发布的 migration step 不得修改，只能在末尾追加；
 * 新增表必须在 migration 中显式创建，不得依赖“删库重装”。
 */
export default schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        createTable({
          name: 'tags',
          columns: [
            { name: 'name', type: 'string', isIndexed: true },
            { name: 'created_at', type: 'number' },
          ],
        }),
        createTable({
          name: 'item_tags',
          columns: [
            { name: 'item_id', type: 'string', isIndexed: true },
            { name: 'tag_id', type: 'string', isIndexed: true },
            { name: 'created_at', type: 'number' },
          ],
        }),
      ],
    },
    // 切片 5（AGENTS.md §4.17）：v3 追加 reminders 表；v2 step 保持原样，不得修改。
    {
      toVersion: 3,
      steps: [
        createTable({
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
    },
    // 切片 6（AGENTS.md §4.23）：v4 items 追加三个时间列；v2/v3 step 保持原样，不得修改。
    // addColumns 对既有行不回填默认值（null/false 由读取层归一：toDomainItem `?? false` 等）。
    {
      toVersion: 4,
      steps: [
        addColumns({
          table: 'items',
          columns: [
            { name: 'start_at', type: 'number', isOptional: true },
            { name: 'end_at', type: 'number', isOptional: true },
            { name: 'all_day', type: 'boolean', isOptional: true },
          ],
        }),
      ],
    },
  ],
});
