import { appSchema, tableSchema } from '@nozbe/watermelondb';

/**
 * schema 版本号：任何表/列变更必须 +1 并提供 migration（AGENTS.md §4.1 / §4.6）。
 * v7（切片 14 阶段 7a）：app_settings 新增小组件显示开关 4 列（docs/proposals/slice-14-widget-phase7.md）。
 * v8（切片 16 阶段 1）：reminders 新增 once_civil_json / channel / channel_config 列
 * （AGENTS.md §7.26，docs/proposals/slice-16-reminder-channels.md）。
 * v9（切片 17 阶段 1）：新增 channel_presets 表（AGENTS.md §7.27 渠道配置中心）。
 * v10（切片 18 阶段 1）：reminders 新增 channels_json / channel_configs_json（多渠道），
 * app_settings 新增 chips_increments，channel_presets 新增 is_default
 * （AGENTS.md §7.29，docs/proposals/slice-18-multi-channel.md）。
 * v11（切片 19 阶段 1）：app_settings 新增 default_channels_json
 * （AGENTS.md §7.30 延迟提醒意图与默认渠道）。
 */
export const SCHEMA_VERSION = 11;

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
    // v8（切片 16 阶段 1，AGENTS.md §7.26 / docs/proposals/slice-16-reminder-channels.md）：
    // - once_civil_json：once 一次性提醒的民用触发时刻，单列 JSON
    //   {"year":…,"month":…,"day":…,"hour":…,"minute":…}；仅 frequency='once' 非空，
    //   其他频率恒为 null（写路径归一）。isOptional：存量重复规则行回填 null。
    // - channel：提醒渠道（非可选）。addColumns 对既有行自动回填类型零值 ''，
    //   同一 migration step 内 unsafeExecuteSql UPDATE 全表回填 'system-notification'
    //   （v7 widget_show_overdue 同款先例），行为与升级前一致。
    // - channel_config：webhook URL / apprise 配置 JSON；system-notification / alarm 渠道恒为 null。
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
        { name: 'once_civil_json', type: 'string', isOptional: true },
        { name: 'channel', type: 'string' },
        { name: 'channel_config', type: 'string', isOptional: true },
        // v10（切片 18 阶段 1，AGENTS.md §7.29 / docs/proposals/slice-18-multi-channel.md）：
        // 多渠道列。均 isOptional：既有行回填 null，读取层经 legacy bridge 归一
        // （resolveReminderChannelRow：channels_json 为空 → 由旧 channel/channel_config
        // 推导单元素数组/字典；channels_json 非空 → 只认新列，绝不回头读旧列）。
        // 旧 channel / channel_config 两列保留但 deprecated：v10 写路径不再更新它们，
        // 仅作为 legacy bridge 数据源（WatermelonDB 无 dropColumn，见提案 §3.1）。
        // - channels_json：JSON 字符串数组，如 ["system-notification","webhook"]；
        //   ≥1 个渠道、至多一个 expo 渠道、去重 + REMINDER_CHANNELS canonical 序（写路径保证）。
        // - channel_configs_json：JSON 对象，键为网络渠道 id，值为渠道配置原文
        //   （如 {"webhook":"{\"url\":...}"}，双编码属正常）；expo 渠道不得有条目。
        { name: 'channels_json', type: 'string', isOptional: true },
        { name: 'channel_configs_json', type: 'string', isOptional: true },
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
    // v10（切片 18 阶段 1，AGENTS.md §7.29）：chips_increments——once 快捷 Chips 增量
    // （分钟）的 JSON 数字数组，默认 [10,60]；isOptional 回填 null，读取层防御归一
    // （坏 JSON/空/越界 → 默认值），写路径校验 1–4 项、每项 1–10080 整数。
    // v11（切片 19 阶段 1，AGENTS.md §7.30）：default_channels_json——新建提醒表单的
    // 默认渠道集合，JSON 字符串数组，默认 ["system-notification"]；isOptional 回填 null，
    // 读取层防御归一（parseDefaultChannels：坏值/空/expo 双开 → 回退或丢弃），写路径
    // 校验（validateDefaultChannels：非法渠道/空/expo 双开抛错）。
    tableSchema({
      name: 'app_settings',
      columns: [
        { name: 'tag_display_mode', type: 'string' },
        { name: 'widget_show_overdue', type: 'boolean' },
        { name: 'widget_show_todos', type: 'boolean' },
        { name: 'widget_show_category_emoji', type: 'boolean' },
        { name: 'widget_show_tags', type: 'boolean' },
        { name: 'chips_increments', type: 'string', isOptional: true },
        { name: 'default_channels_json', type: 'string', isOptional: true },
      ],
    }),
    // 切片 17 阶段 1（AGENTS.md §7.27 渠道配置中心，schema v9）：渠道预设表。
    // 把 Webhook/Apprise 的常用配置抽为全局预设，详情页只做选择（阶段 2 UI），不必每次输长 URL。
    // - type 仅 'webhook' | 'apprise'：只给“有配置”的渠道建预设，
    //   system-notification / alarm 无配置可预设，不进枚举（AGENTS.md §7.27）。
    // - config_json 存渠道配置 JSON 原文：webhook → WebhookChannelConfig（url/mode/headers/
    //   payloadTemplate，见 notifications.md v0.17），apprise → AppriseChannelConfig（baseUrl+key/urls）。
    //   选中预设时整串复制进 reminders.channel_config；写路径经对应渠道守卫校验后才落库
    //   （webhook → parseWebhookChannelConfig，apprise → parseAppriseChannelConfig）。
    // - name 不强制唯一（trim 非空由 Repository 层保证，不建 SQLite 唯一约束，同 tags.name 先例）。
    // - created_at 供预设列表稳定排序（created_at 降序），对齐 tags 表先例；
    //   预设支持编辑（阶段 2）但 MVP 不需要 updated_at（同 categories 无时间戳先例）。
    // - 无预置数据、无 seed：预设全部由用户在设置页创建（阶段 2）。
    // v10（切片 18 阶段 1，AGENTS.md §7.29）：is_default——详情页表单默认选中的预设；
    // 非可选 boolean，addColumns 对既有行自动回填 false（v7 widget 开关先例，无需 UPDATE）；
    // 「同 type 至多一个 true」由 Repository 写路径在同事务内保证（提案 §3.3）。
    tableSchema({
      name: 'channel_presets',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'type', type: 'string', isIndexed: true },
        { name: 'config_json', type: 'string' },
        { name: 'is_default', type: 'boolean' },
        { name: 'created_at', type: 'number' },
      ],
    }),
  ],
});
