import { appSchema, tableSchema } from '@nozbe/watermelondb';

/**
 * schema 版本号：任何表/列变更必须 +1 并提供 migration（AGENTS.md §4.1 / §4.6）。
 * v7（切片 14 阶段 7a）：app_settings 新增小组件显示开关 4 列（docs/proposals/slice-14-widget-phase7.md）。
 */
export const SCHEMA_VERSION = 7;

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
        // 切片 14（AGENTS.md §7.22，schema v6）：分类关联与优先级。
        // category_id isOptional：迁移不回填 'other' 零值（string 非可选列会回填 ''），
        // 迁移用 unsafeExecuteSql UPDATE 既有行 SET category_id='other'（§7.22 默认分类）。
        // isIndexed：阶段 4 筛选按 categoryId 过滤（add_columns 迁移会同步建索引）。
        { name: 'category_id', type: 'string', isOptional: true, isIndexed: true },
        // priority 非可选：add_columns 对既有行回填类型零值 0 =「无优先级」（§7.22 默认），
        // 正是需要的行为；新行由 Repository 写入显式值（0..3）。
        { name: 'priority', type: 'number' },
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
        // 切片 14（AGENTS.md §7.22，schema v6）：标签视觉字段；isOptional 迁移回填 null，
        // 既有标签 color/emoji 为 null，UI 回退默认样式。
        { name: 'color', type: 'string', isOptional: true },
        { name: 'emoji', type: 'string', isOptional: true },
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
    // 切片 14（AGENTS.md §7.22，schema v6）：分类独立表。
    // 预置 5 条（work/personal/study/health/other，数据源 src/domain/category.ts PRESET_CATEGORIES）：
    // 升级安装经 migration SQL 插入，全新安装经 src/db/seed.ts 幂等 seed。
    // 不支持自定义新增/删除分类（本切片），仅允许改颜色/Emoji（updateCategoryVisuals）。
    tableSchema({
      name: 'categories',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'color', type: 'string', isOptional: true },
        { name: 'emoji', type: 'string', isOptional: true },
        { name: 'priority', type: 'number' },
      ],
    }),
    // 切片 14（AGENTS.md §7.22，schema v6）：全局设置单行表（id 固定 'global'）。
    // getSettings 无记录时兜底返回默认值（repository.md v0.14），seed/migration 均会插入默认行。
    // v7（阶段 7a）：小组件显示开关 4 列（非可选 boolean，列名 widget_show_*）。
    tableSchema({
      name: 'app_settings',
      columns: [
        { name: 'tag_display_mode', type: 'string' },
        { name: 'widget_show_overdue', type: 'boolean' },
        { name: 'widget_show_todos', type: 'boolean' },
        { name: 'widget_show_category_emoji', type: 'boolean' },
        { name: 'widget_show_tags', type: 'boolean' },
      ],
    }),
  ],
});
