import {
  addColumns,
  createTable,
  schemaMigrations,
  unsafeExecuteSql,
} from '@nozbe/watermelondb/Schema/migrations';

import { PRESET_CATEGORIES } from '../domain/category';
import { APP_SETTINGS_ROW_ID, DEFAULT_APP_SETTINGS } from '../domain/settings';

/**
 * WatermelonDB schema migrations。
 *
 * - v1：items 表（切片 1 初始 schema，无需迁移步骤）
 * - v2：新增 tags、item_tags 表（切片 2）
 * - v3：新增 reminders 表（切片 5，AGENTS.md §4.17）
 * - v4：items 新增 start_at / end_at / all_day 列（切片 6，AGENTS.md §4.23）
 * - v5：items 新增 source_type / source_uid / source_read_only 列（切片 8，data-model.md v0.8）
 * - v6：新增 categories / app_settings 表；items 新增 category_id / priority；
 *        tags 新增 color / emoji（切片 14，AGENTS.md §7.22）
 * - v7：app_settings 新增小组件显示开关 4 列（切片 14 阶段 7a，
 *        docs/proposals/slice-14-widget-phase7.md）
 * - v8：reminders 新增 once_civil_json / channel / channel_config 列，
 *        channel 全表回填 'system-notification'（切片 16 阶段 1，AGENTS.md §7.26，
 *        docs/proposals/slice-16-reminder-channels.md）
 * - v9：新增 channel_presets 表（切片 17 阶段 1，AGENTS.md §7.27 渠道配置中心）
 *
 * 规则（AGENTS.md §4.6）：已发布的 migration step 不得修改，只能在末尾追加；
 * 新增表必须在 migration 中显式创建，不得依赖“删库重装”。
 */

/** SQL 字符串字面量：单引号成对转义（预置数据为可信常量，此处仅作防御） */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** v6 预置分类插入 SQL：数据源唯一取自 src/domain/category.ts 的 PRESET_CATEGORIES（防漂移） */
function presetCategoryInsertSql(category: {
  id: string;
  name: string;
  color: string | null;
  emoji: string | null;
  priority: number;
}): string {
  // _status='synced' / _changed=''：WatermelonDB 每表固定列（sanitizedRaw 读回时保留合法值）；
  // 预置数据视为已就位数据，不标记为本地新建。
  return (
    'INSERT OR IGNORE INTO "categories" ("id", "_status", "_changed", "name", "color", "emoji", "priority") VALUES (' +
    [
      sqlString(category.id),
      sqlString('synced'),
      sqlString(''),
      sqlString(category.name),
      category.color === null ? 'NULL' : sqlString(category.color),
      category.emoji === null ? 'NULL' : sqlString(category.emoji),
      String(category.priority),
    ].join(', ') +
    ');'
  );
}

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
    // 切片 8（data-model.md v0.8）：v5 items 追加外部来源三列；v2–v4 step 保持原样，不得修改。
    // 三列全部 isOptional：WatermelonDB add_columns 对非可选列会把既有行回填类型零值
    // （string → ''，见 adapters/sqlite/encodeSchema 与 lokijs DatabaseDriver），违反
    // 「既有行不回填、读取层 ?? 'local' 归一」的契约语义；isOptional 列回填 null，
    // 既有行经 toDomainItem 归一为 ('local', null, false)。
    {
      toVersion: 5,
      steps: [
        addColumns({
          table: 'items',
          columns: [
            { name: 'source_type', type: 'string', isOptional: true },
            { name: 'source_uid', type: 'string', isOptional: true },
            { name: 'source_read_only', type: 'boolean', isOptional: true },
          ],
        }),
      ],
    },
    // 切片 14（AGENTS.md §7.22）：v6 分类/设置底座；v2–v5 step 保持原样，不得修改。
    // - createTable categories / app_settings；
    // - items 加 category_id（isOptional，isIndexed）/ priority（非可选，既有行回填 0=无）；
    // - tags 加 color / emoji（isOptional，既有行回填 null）；
    // - unsafeExecuteSql：既有 items 行 category_id 回填 'other'（§7.22 默认分类），
    //   插入 5 条预置分类与 app_settings 默认行（数据源 PRESET_CATEGORIES，与全新安装 seed 共用）。
    // 注意：LokiJS 适配器（仅测试用）忽略 'sql' 步骤；行为级迁移验收依赖真机覆盖安装（任务卡阶段 1）。
    {
      toVersion: 6,
      steps: [
        createTable({
          name: 'categories',
          columns: [
            { name: 'name', type: 'string' },
            { name: 'color', type: 'string', isOptional: true },
            { name: 'emoji', type: 'string', isOptional: true },
            { name: 'priority', type: 'number' },
          ],
        }),
        createTable({
          name: 'app_settings',
          columns: [{ name: 'tag_display_mode', type: 'string' }],
        }),
        addColumns({
          table: 'items',
          columns: [
            { name: 'category_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'priority', type: 'number' },
          ],
        }),
        addColumns({
          table: 'tags',
          columns: [
            { name: 'color', type: 'string', isOptional: true },
            { name: 'emoji', type: 'string', isOptional: true },
          ],
        }),
        unsafeExecuteSql("UPDATE \"items\" SET \"category_id\" = 'other' WHERE \"category_id\" IS NULL;"),
        ...PRESET_CATEGORIES.map((category) => unsafeExecuteSql(presetCategoryInsertSql(category))),
        unsafeExecuteSql(
          'INSERT OR IGNORE INTO "app_settings" ("id", "_status", "_changed", "tag_display_mode") VALUES (' +
            `${sqlString(APP_SETTINGS_ROW_ID)}, ${sqlString('synced')}, ${sqlString('')}, ` +
            `${sqlString(DEFAULT_APP_SETTINGS.tagDisplayMode)});`,
        ),
      ],
    },
    {
      // 切片 14 阶段 7a：小组件显示开关（docs/proposals/slice-14-widget-phase7.md）。
      // WatermelonDB addColumns 对非可选 boolean 列自动回填 false（encodeAddColumnsMigrationStep）；
      // 过期组默认展示（widget_show_overdue 默认 true，保持升级前行为）需在此显式回填 1，
      // 其余三列默认 false 与自动回填一致，无需额外 UPDATE。
      toVersion: 7,
      steps: [
        addColumns({
          table: 'app_settings',
          columns: [
            { name: 'widget_show_overdue', type: 'boolean' },
            { name: 'widget_show_todos', type: 'boolean' },
            { name: 'widget_show_category_emoji', type: 'boolean' },
            { name: 'widget_show_tags', type: 'boolean' },
          ],
        }),
        unsafeExecuteSql('UPDATE "app_settings" SET "widget_show_overdue" = 1;'),
      ],
    },
    {
      // 切片 16 阶段 1（AGENTS.md §7.26）：once 一次性提醒 + 多渠道数据底座；
      // v2–v7 step 保持原样，不得修改。
      // - once_civil_json / channel_config 可空列：addColumns 自动回填 null，无需 UPDATE；
      // - channel 非可选：WatermelonDB addColumns 对既有行自动回填类型零值 ''（string），
      //   同 step 内 unsafeExecuteSql 无条件 UPDATE 回填 'system-notification'
      //   （v7 widget_show_overdue 同款先例；SQLite 下同一迁移事务内原子生效）。
      //   存量行均为重复规则、无渠道语义，无条件回填正确且幂等。
      // 注意：LokiJS 适配器（仅测试用）忽略 'sql' 步骤；channel 回填的行为级验收依赖
      // 真机覆盖安装（任务卡阶段 1 验收 2）+ migrationsV8 结构断言测试。
      toVersion: 8,
      steps: [
        addColumns({
          table: 'reminders',
          columns: [
            { name: 'once_civil_json', type: 'string', isOptional: true },
            { name: 'channel', type: 'string' },
            { name: 'channel_config', type: 'string', isOptional: true },
          ],
        }),
        unsafeExecuteSql('UPDATE "reminders" SET "channel" = \'system-notification\';'),
      ],
    },
    {
      // 切片 17 阶段 1（AGENTS.md §7.27 渠道配置中心）：v9 新增 channel_presets 表；
      // v2–v8 step 保持原样，不得修改。
      // - 仅 createTable，无回填、无 unsafeExecuteSql：预设无存量数据概念，全部由用户创建；
      // - 列定义与 schema.ts 的 channel_presets tableSchema 严格一致（两处漂移会被
      //   模式不匹配检测发现，WatermelonDB 在表不匹配时直接抛错）。
      toVersion: 9,
      steps: [
        createTable({
          name: 'channel_presets',
          columns: [
            { name: 'name', type: 'string' },
            { name: 'type', type: 'string', isIndexed: true },
            { name: 'config_json', type: 'string' },
            { name: 'created_at', type: 'number' },
          ],
        }),
      ],
    },
  ],
});
