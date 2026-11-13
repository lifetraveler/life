/**
 * 切片 16 阶段 1（AGENTS.md §7.26）：schema v7→v8 迁移结构断言。
 *
 * LokiJS 适配器（仅测试用）忽略 'sql' 步骤、SQLite 行为只能在真机验证，因此本文件
 * 对 migration step 做结构级断言（v6/v7 同款先例思路）：
 * - addColumns 三列的表/列名/类型/isOptional 与提案 §2.2 一一对应；
 * - unsafeExecuteSql 的 SQL 原文精确匹配（channel 全表回填 'system-notification'）；
 * - schema.ts 全新安装路径的 reminders 表声明包含同样三列。
 * 运行时形状已实测：schemaMigrations → { sortedMigrations, minVersion, maxVersion }，
 * step 标签为 add_columns / sql（create_table 为 { type, schema }）。
 */
import { SCHEMA_VERSION, schema } from '../schema';
import migrations from '../migrations';

const CHANNEL_BACKFILL_SQL = 'UPDATE "reminders" SET "channel" = \'system-notification\';';

describe('schema v8（切片 16 阶段 1）', () => {
  it('SCHEMA_VERSION = 11 且 migrations 链 maxVersion = 11（切片 19 追加 v11 后例行更新）', () => {
    expect(SCHEMA_VERSION).toBe(11);
    expect(schema.version).toBe(11);
    expect(migrations.maxVersion).toBe(11);
    expect(migrations.minVersion).toBe(1); // 最早 step 是 toVersion 2，minVersion = 2 - 1 = 1
  });

  it('migration 链 toVersion 从 2 连续递增到 11，无跳号（已发布 step 未回改）', () => {
    const versions = migrations.sortedMigrations.map((entry) => entry.toVersion);
    expect(versions).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('v8 step：reminders addColumns 三列（once_civil_json / channel / channel_config）', () => {
    const step8 = migrations.sortedMigrations.find((entry) => entry.toVersion === 8);
    expect(step8).toBeDefined();

    const addColumnsSteps = (step8?.steps ?? []).filter(
      (step) => step.type === 'add_columns',
    );
    expect(addColumnsSteps).toHaveLength(1);

    const addColumnsStep = addColumnsSteps[0];
    expect(addColumnsStep).toEqual({
      type: 'add_columns',
      table: 'reminders',
      columns: [
        { name: 'once_civil_json', type: 'string', isOptional: true },
        { name: 'channel', type: 'string' },
        { name: 'channel_config', type: 'string', isOptional: true },
      ],
    });
  });

  it('v8 step：channel 全表回填 UPDATE，SQL 原文精确匹配（真机行为级验收的静态锚点）', () => {
    const step8 = migrations.sortedMigrations.find((entry) => entry.toVersion === 8);
    const sqlSteps = (step8?.steps ?? []).filter((step) => step.type === 'sql');
    expect(sqlSteps).toEqual([{ type: 'sql', sql: CHANNEL_BACKFILL_SQL }]);
  });

  it('全新安装路径：schema.ts reminders 表声明包含 v8 三列且列属性一致', () => {
    // appSchema 将 tables 数组转为按表名索引的 map（AppSchema.tables: TableMap）。
    const reminders = schema.tables.reminders;
    expect(reminders).toBeDefined();
    const byName = new Map(reminders.columnArray.map((column) => [column.name, column]));

    expect(byName.get('once_civil_json')).toEqual({
      name: 'once_civil_json',
      type: 'string',
      isOptional: true,
    });
    expect(byName.get('channel')).toEqual({ name: 'channel', type: 'string' });
    expect(byName.get('channel_config')).toEqual({
      name: 'channel_config',
      type: 'string',
      isOptional: true,
    });
  });

  it('v2–v7 step 不含 reminders 的 addColumns（已发布 step 冻结，只允许末尾追加）', () => {
    const legacyAddColumns = migrations.sortedMigrations
      .filter((entry) => entry.toVersion < 8)
      .flatMap((entry) => entry.steps)
      .filter((step) => step.type === 'add_columns' && step.table === 'reminders');
    expect(legacyAddColumns).toEqual([]);
  });
});
