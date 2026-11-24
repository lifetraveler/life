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
 * v12（切片 25 阶段 1）：app_settings 新增 careful_mode
 * （AGENTS.md §7.37 闪电录入认真模式）。
 * v13（切片 26 阶段 1）：app_settings 新增 show_ai_usage
 * （AGENTS.md §7.38 AI 透明度——用量展示开关）。
 * v14（切片 27 阶段 1）：app_settings 新增 display_calendar_ids_json
 * （AGENTS.md §7.39 系统日历 live 直读显示——显示开关，空/缺省 = 功能关闭）。
 * v15（切片 30 阶段 1）：app_settings 新增 ai_retry_max / flash_deleted_card_display
 * （AGENTS.md §7.41 AI 重试次数与已删除卡显示配置）。
 * v16（切片 32 阶段 1）：app_settings 新增 show_ai_request / show_ai_response
 * （AGENTS.md §7.44 AI 调试查看器——请求/响应展示开关）。
 * v17（切片 35 阶段 1）：新增 sync_tombstones 表（AGENTS.md §7.47 双向同步
 * WebDAV——行级 LWW + 墓碑删除传播，docs/proposals/slice-35-two-way-sync-webdav.md）。
 * v18（切片 36 阶段 1）：app_settings 新增 ai_schedule_query_enabled
 * （AGENTS.md §7.48 AI 日程查询/记忆检索——查询分支总开关，默认开）。
 * v19（切片 37 阶段 1）：新增 sparks / spark_attachments / spark_items 三表
 * （AGENTS.md §7.49 Spark 灵感火花，docs/proposals/slice-37-spark-inspiration.md D2）。
 * v20（切片 38 阶段 1）：新增 flash_chat_messages 表
 * （AGENTS.md §7.50 闪电对话持久化，docs/proposals/slice-38-chat-persistence.md D1）。
 */
export const SCHEMA_VERSION = 20;

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
    // v12（切片 25 阶段 1，AGENTS.md §7.37）：careful_mode——闪电录入认真模式开关
    // （默认 false = 默认模式）。非可选 boolean：addColumns 对既有行自动回填类型零值
    // false（v10 channel_presets.is_default 同款先例，无需 UPDATE）；新行由
    // Repository 写入显式值。
    // v13（切片 26 阶段 1，AGENTS.md §7.38）：show_ai_usage——AI 用量展示开关
    // （默认 false = 不显示）。非可选 boolean，addColumns 既有行回填 false，
    // careful_mode（v12）同款先例，无需 UPDATE。
    // v14（切片 27 阶段 1，AGENTS.md §7.39）：display_calendar_ids_json——系统日历
    // live 直读显示开关，JSON 字符串数组（选中日历 id），空串/null/缺省/[] =
    // 功能关闭（合法状态，非缺省回退语义）。isOptional：既有行回填 null，读取层
    // 防御归一（parseDisplayCalendarIds：坏 JSON/非串/空串剔除，不抛错回退 []），
    // 写路径校验（validateDisplayCalendarIds：仅非空字符串、去重；空数组 = 关闭）。
    // v15（切片 30 阶段 1，AGENTS.md §7.41）：ai_retry_max——AI 远端解析传输层
    // 自动重试次数（0–5 整数，0=关闭即现状，默认 3）。isOptional：既有行回填 null
    // 而非类型零值 0（非可选 number 会与「关闭」语义冲突），读取层归一
    // （parseAiRetryMax：null/越界/非整数 → 回退默认 3），写路径校验
    // （validateAiRetryMax：0–5 整数否则抛错）。
    // flash_deleted_card_display——已删除条目在聊天结果卡中的显示方式枚举
    // 'mark'（置灰+角标+禁用，默认）| 'remove'（从对话移除）。isOptional：既有行
    // 回填 null，读取层归一（非枚举值 → 'mark'），写路径校验（枚举外抛错）。
    // v16（切片 32 阶段 1，AGENTS.md §7.44）：show_ai_request / show_ai_response——
    // AI 调试查看器的请求体/响应体展示开关（各自独立控制弹层对应节，双关 = 只看
    // 本轮解析草稿）。非可选 boolean：addColumns 对既有行自动回填类型零值 false
    //（默认关闭，careful_mode/show_ai_usage 同款先例，无需 UPDATE）。
    // v18（切片 36 阶段 1，AGENTS.md §7.48）：ai_schedule_query_enabled——AI
    // 日程查询/记忆检索总开关（默认开，Q4 定案）。isOptional boolean：addColumns
    // 对既有行回填 null 而非类型零值——非可选 boolean 回填 false 与「默认开」
    // 定案冲突（切片 30 ai_retry_max 教训同构）；读取层归一
    //（parseAiScheduleQueryEnabled：null/非 boolean → true），写路径校验
    //（validateAiScheduleQueryEnabled：非 boolean 抛错）。
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
        { name: 'careful_mode', type: 'boolean' },
        { name: 'show_ai_usage', type: 'boolean' },
        { name: 'display_calendar_ids_json', type: 'string', isOptional: true },
        { name: 'ai_retry_max', type: 'number', isOptional: true },
        { name: 'flash_deleted_card_display', type: 'string', isOptional: true },
        { name: 'show_ai_request', type: 'boolean' },
        { name: 'show_ai_response', type: 'boolean' },
        { name: 'ai_schedule_query_enabled', type: 'boolean', isOptional: true },
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
    // v17（切片 35 阶段 1，AGENTS.md §7.47）：sync_tombstones——行级 LWW + 墓碑删除传播。
    // - deleteItem / deleteReminder / deleteChannelPreset 三处删除路径在同一事务内
    //   追加墓碑行；墓碑随同步快照携带到对端，对方墓碑命中本地行 → 本地删。
    // - kind 仅 'item' | 'reminder' | 'channel_preset'（Repository 写路径守卫）。
    // - entity_id 建索引：按 (kind, entity_id) 查存在性去重（同实体多次删除只记一行）。
    // - deleted_at 为删除时刻毫秒时间戳：同步成功收尾后按对端 exportedAt 最小值裁剪
    //   （严格早于才删，提案 D2）。
    // - 无 created_at / updated_at（墓碑非业务实体，无列表排序需求）；行 id 由
    //   WatermelonDB create 自动生成。
    tableSchema({
      name: 'sync_tombstones',
      columns: [
        { name: 'kind', type: 'string' },
        { name: 'entity_id', type: 'string', isIndexed: true },
        { name: 'deleted_at', type: 'number' },
      ],
    }),
    // v19（切片 37 阶段 1，AGENTS.md §7.49，docs/proposals/slice-37-spark-inspiration.md D2）：
    // sparks——灵感本体表。
    // - title / content 双 isOptional：纯录音灵感（Q2 仅存+回放，无转写）先建行后挂附件，
    //   两列可能同时为 null（录音流程合法状态，提案 D3 createSpark 允许双空）；
    // - created_at 供灵感流倒序展示（listSparks created_at 降序）；updated_at 供数据快照
    //   恢复命中覆盖语义（items 先例：命中覆盖由 prepareUpdate 自动刷新）。
    // - 不建 SQLite 唯一约束；无归档/搜索列（提案 D8 明确不做）。
    tableSchema({
      name: 'sparks',
      columns: [
        { name: 'title', type: 'string', isOptional: true },
        { name: 'content', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    // v19（切片 37 阶段 1）：spark_attachments——灵感附件元数据表。
    // - spark_id isIndexed：按灵感批量查附件（详情页/列表徽标）+ deleteSpark 级联删行；
    // - kind 仅 'audio' | 'image'（写路径守卫，枚举外抛错；schema 层不建 CHECK，
    //   与 reminders.frequency 等 Repository 层守卫先例一致）；
    // - uri 为本地文件绝对路径（documentDirectory/sparks/<uuid>.<ext>，提案 D4）；
    // - remote_path 存 life-attachments 内的远端文件名（不含目录前缀）：
    //   构建远端 URL 时拼接 WEBDAV_ATTACHMENTS_DIR，跨设备 basePath 可迁移（即改名即可）；
    //   即时上传失败时为 null（「未备份」徽标 + 详情页重传，提案 D4）；
    // - sha256 为上传时计算的文件摘要（hex 小写），供 hash 命名与重复上传对账；
    // - file_size 非可选（写路径必带，上限 25MB 守卫）；duration_ms 仅录音附件、
    //   width/height 仅图片附件，均为 isOptional number；
    // - created_at 供附件列表稳定排序（asc，同 item_tags join 先例）。
    tableSchema({
      name: 'spark_attachments',
      columns: [
        { name: 'spark_id', type: 'string', isIndexed: true },
        { name: 'kind', type: 'string' },
        { name: 'uri', type: 'string' },
        { name: 'remote_path', type: 'string', isOptional: true },
        { name: 'sha256', type: 'string', isOptional: true },
        { name: 'file_size', type: 'number' },
        { name: 'duration_ms', type: 'number', isOptional: true },
        { name: 'width', type: 'number', isOptional: true },
        { name: 'height', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
      ],
    }),
    // v19（切片 37 阶段 1）：spark_items——灵感↔计划一对多关联 join 表（提案 D3）。
    // - 一对多：一个灵感可关联多个计划；不做计划侧反查入口（提案 D8 明确不做）。
    // - spark_id / item_id 均 isIndexed：双向按 id 批量查 + deleteSpark 级联删行 +
    //   数据快照恢复按 resolved spark 删除重建（itemTags join 先例同构）。
    // - item_id 存在性校验在 Repository 写路径（link 前 getItemById 命中检查，
    //   不命中抛错——updateItem categoryId 校验同构），不建外键约束。
    tableSchema({
      name: 'spark_items',
      columns: [
        { name: 'spark_id', type: 'string', isIndexed: true },
        { name: 'item_id', type: 'string', isIndexed: true },
        { name: 'created_at', type: 'number' },
      ],
    }),
    // v20（切片 38 阶段 1，AGENTS.md §7.50，docs/proposals/slice-38-chat-persistence.md
    // D1）：flash_chat_messages——闪电录入对话持久化表（跨重启恢复 + 数据快照可选块
    // chatMessages，跨重装恢复）。
    // - seq 业务序号（isIndexed）：内存消息 id 即 seq（启动恢复按 seq 升序平铺、
    //   id=seq 延续、nextIdRef=maxSeq+1）。非主键——WatermelonDB 行 id 自动生成，
    //   seq 仅作排序与 upsert 业务键（唯一性由写路径保证，不建 SQLite 唯一索引）。
    // - role 仅 'user' | 'assistant'；kind 仅 'text' | 'card'（写路径守卫，枚举外
    //   抛错；schema 层不建 CHECK，与 reminders.frequency 等先例一致）。
    //   confirm / debug 瞬态交互态不落库（Q2 定案）：'confirm' 不进 kind 枚举，
    //   调试入口消息（挂 debugPayload 的 text 消息）在 persist 过滤层排除。
    // - card_payload_json：kind='card' 的 FlashCardPayload 序列化串（text 行恒
    //   null）；恢复 parse 失败降级为 text 消息展示（不炸列表）。
    // - seed_json：保存链播种的 serializeDraftForHistory 产物（末卡播种恢复
    //   historyRef，Q3「改一下刚才那个」跨重启可用）；仅 card 行可非 null。
    // - created_at：行创建时刻（WatermelonDB @readonly @date 自动写）；排序只认
    //   seq，created_at 不参与会话语义（数据快照恢复经 _raw 保真写入）。
    tableSchema({
      name: 'flash_chat_messages',
      columns: [
        { name: 'seq', type: 'number', isIndexed: true },
        { name: 'role', type: 'string' },
        { name: 'text', type: 'string' },
        { name: 'kind', type: 'string' },
        { name: 'card_payload_json', type: 'string', isOptional: true },
        { name: 'seed_json', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
      ],
    }),
  ],
});
