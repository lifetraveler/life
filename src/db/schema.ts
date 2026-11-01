import { appSchema, tableSchema } from '@nozbe/watermelondb';

/**
 * schema 版本号：任何表/列变更必须 +1 并提供 migration（AGENTS.md §4.1）。
 */
export const SCHEMA_VERSION = 1;

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
  ],
});
