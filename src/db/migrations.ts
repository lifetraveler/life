import { createTable, schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

/**
 * WatermelonDB schema migrations。
 *
 * - v1：items 表（切片 1 初始 schema，无需迁移步骤）
 * - v2：新增 tags、item_tags 表（切片 2）
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
  ],
});
