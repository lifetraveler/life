import { schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

/**
 * migrations 占位（切片 1：schema v1，无历史迁移）。
 * 后续切片修改 schema 时：SCHEMA_VERSION +1，并在此追加对应 toVersion 步骤。
 */
export default schemaMigrations({
  migrations: [],
});
