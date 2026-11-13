# 契约：数据模型与 Schema / Migration

> 适用范围：Item / Tag / ItemTag / Reminder 的字段、枚举与规则；WatermelonDB schema 版本与 migration 纪律。
> 最后更新切片：切片 6（v0.6）
> 来源：原 AGENTS.md 4.1、4.4、4.6、4.10、4.17、4.23（2026-11 由 AGENTS.md §4 拆分迁移至此，正文逐字保留，仅标题层级调整，语义未变）
> 相关契约：repository.md（Repository 签名与规则字段互转职责）、notifications.md（调度器不得自行解析字符串化规则）

## 4.1 数据模型：Item

字段：

- id: string
- type: 'note' | 'task' | 'event'
- title: string
- content: string
- status: 'active' | 'done' | 'archived'
- createdAt: number（毫秒时间戳）
- updatedAt: number（毫秒时间戳）

规则：

- type 枚举不得随意增加或重命名。
- 标签不存为 Item 的逗号分隔字符串；后续使用 Tag / ItemTag 关联表。
- 修改 schema 必须提供 WatermelonDB migration，不得直接改表结构后要求用户重装。

## 4.4 数据模型：Tag / ItemTag（v0.2 新增）
Tag 字段：
- id: string
- name: string（全局唯一，大小写不敏感去重）
- createdAt: number

ItemTag 字段：
- id: string
- itemId: string
- tagId: string
- createdAt: number

规则：
- 标签不得存为 Item 的逗号分隔字符串。
- Tag.name 唯一性由 Repository 层保证；UI 不得自行拼标签字符串写库。
- Item 与 Tag 为多对多关系，通过 ItemTag 关联。

## 4.6 Schema 变更与 Migration 规则（v0.2 新增）
- 每次 WatermelonDB schema 变更必须提升 version，并新增 migration step。
- 不得修改已发布的 migration step；只能在末尾追加。
- 新增表/字段必须在 migration 中显式创建，不得依赖“删库重装”。
- 切片 2 的 schema version 从 1 升至 2，新增 tags、item_tags 表。
- AI 不得以“开发阶段可以清库”为由跳过 migration。

## 4.10 Schema 变更（v0.3）
- 切片 3 不需要 schema 变更。Item.status 已包含 'archived'，不得为此新增字段或表。
- 不得新增 migration。若 AI 认为需要改 schema，必须先输出变更提案并暂停。

## 4.17 Reminder 数据模型与 schema v3（v0.5 冻结）
WatermelonDB schema 版本 2→3，新增 `reminders` 表：
- id: string
- itemId: string
- frequency: 'daily' | 'weekly' | 'monthly'
- localTimeHour: number（0–23）
- localTimeMinute: number（0–59）
- weekdays: string（JSON 数组，1–7；仅 weekly 使用，其他为空字符串）
- dayOfMonth: number（1–31；仅 monthly 使用，其他为 0）
- tzid: string（IANA 名称，创建时写入，不随后续系统时区变化自动改写）
- startAt: number（绝对毫秒时间戳）
- enabled: boolean
- lastFiredOccurrenceKey: string | null
- lastReconciledAt: number | null
- createdAt: number
- updatedAt: number

规则：
- 不得在 Item 上新增提醒字段；提醒一律通过 reminders 表关联。
- 规则字段与切片 4 的 `RecurrenceRule` 一一映射，Repository 负责两者互转；ReminderScheduler 不得自行解析字符串化规则。
- migration 必须为追加 step，不得修改 v2 migration；不得清库。
- `weekdays` 用 JSON 字符串存储是冻结决定；AI 不得改为逗号分隔或其他格式。

## 4.23 Item 时间字段与 schema v4（v0.6 冻结）
- schema 版本 3→4，Item 新增字段：
  - startAt: number | null（绝对毫秒时间戳；null 表示未安排）
  - endAt: number | null（绝对毫秒时间戳；null 表示无结束时间）
  - allDay: boolean（默认 false）
- 这三个字段供切片 7 的今日/本周视图分组使用；切片 6 只做数据模型与编辑入口。
- migration 追加 `toVersion: 4`；v3 step 不动；不得清库。
- Item 既有字段（id/type/title/content/status/createdAt/updatedAt）不变；type 枚举不变。
- 时间字段的时区语义：startAt/endAt 是绝对时刻；分组展示时按设备当前 IANA 时区解释（切片 7 契约）。
- allDay=true 时 startAt 表示设备时区当天 00:00；endAt 可为 null。

## Item 外部来源字段（v0.8，切片 8 落地）

### Schema v4 → v5
Item 新增字段：
- sourceType: 'local' | 'ics' | 'system-calendar'，默认 'local'
- sourceUid: string | null，默认 null
- sourceReadOnly: boolean，默认 false

规则：
- migration 追加 toVersion: 5；用 addColumns；不得重建表；不得清库；v4 step 不动。
- 既有 Item 迁移后为 ('local', null, false)。
- 唯一性：同一 (sourceType, sourceUid) 组合在本地库内唯一；sourceUid 为 null 时不做唯一约束。
  唯一性由 Repository 层保证（导入时先查后写），不依赖 SQLite 唯一索引；若后续需真索引，以独立 schema 变更提案处理。
- sourceReadOnly=true 的 Item：不可编辑时间/标题/内容；可完成/取消完成；可归档/删除（删除即从本地库移除，不影响外部来源）。
- 只读项转为本地（sourceReadOnly=false）在 MVP 不做；若后续需要，以独立切片设计“解绑”流程。

### allDay 归一化（v0.8）
- allDay=true 的 Item，startAt 必须是设备当前 IANA 时区当天 00:00 的绝对毫秒值。
- 归一化职责：Repository.createItem / updateItemTime 中统一执行；UI 不得自行归一化。
- 编辑页选择 allDay 时只提供日期，不提供时刻；Repository 收到日期后按设备时区 00:00 落库。
- 导入 ICS 的 VALUE=DATE 事件：解析出的 startAt 是“当天 00:00 在 ICS 声明时区”的绝对时刻；
  落库前按“该绝对时刻在设备时区对应的日期”的 00:00 重新归一化，保证与本地 allDay 语义一致。

## Category 实体与 Item 关联（v0.14）

### Category 预置数据
应用启动/迁移时，必须预置以下分类（不可删除，允许用户修改颜色和 Emoji）：
- id: 'work', name: '工作', color: '#E57373', emoji: '💼', priority: 1
- id: 'personal', name: '个人', color: '#64B5F6', emoji: '🏠', priority: 2
- id: 'study', name: '学习', color: '#FFB74D', emoji: '📚', priority: 3
- id: 'health', name: '健康', color: '#81C784', emoji: '🏃', priority: 4
- id: 'other', name: '其他', color: '#9E9E9E', emoji: '📌', priority: 5

### 数据结构关系
- Item 通过 `category_id` 关联 Category。
- 任何查询 Item 的接口（如今日视图、搜索、Agenda）必须返回完整的 Category 对象，以便 UI 渲染颜色条和 Emoji。

## Reminder 一次性频率与多渠道字段（v0.16，切片 16 阶段 1；遵循 docs/proposals/slice-16-reminder-channels.md）

§4.17 的 frequency 三值冻结由本节扩展：'daily' | 'weekly' | 'monthly' | 'once'。其余 §4.17 规则（weekdays JSON 字符串、tzid 白名单、migration 纪律）不变。

### Schema v7 → v8
reminders 表在 `enabled` 之后追加 3 列（addColumns，严禁重建表/清库，v7 step 不动）：
- once_civil_json: string | null（单列 JSON；v8 前存量行与重复规则为 null）
- channel: string（NOT NULL；addColumns 自动回填类型零值 ''，随后同迁移事务内 `UPDATE "reminders" SET "channel" = 'system-notification';` 无条件回填）
- channel_config: string | null

### once 频率语义
- 一次性提醒的时刻存于 once_civil_json：固定键序 `{year,month,day,hour,minute}` 的单列 JSON 字符串（民用时刻，按 tzid 解释；提案 §2.2 拍板，否决 5 列 INTEGER 方案）。
- 校验范围：year 1–9999、month 1–12、day 1–31、hour 0–23、minute 0–59；day 的月内日历有效性（如 2 月 30 日）在阶段 2 civil→epoch 换算时判定。
- frequency='once' 时 once_civil_json 必填（Repository 写路径强制）；localTimeHour/localTimeMinute/weekdays/dayOfMonth 为 NOT NULL 列，落占位零值 0/0/''/0，不承载语义；切回重复频率时 once_civil_json 清 null。
- localTime/weekdays/dayOfMonth 与 once 的占位零值映射由 Repository 归一化统一执行，调度器不得自行解析 once_civil_json 以外的规则字段推断 once 时刻。
- startAt 语义不变（绝对毫秒时间戳）；once 的绝对触发时刻以 onceAt+tzid 换算为准（阶段 2），occurrenceKey 规则见 notifications.md（阶段 2 追加）。

### 渠道字段语义
- channel ∈ 'system-notification' | 'alarm' | 'webhook' | 'apprise'，缺省 'system-notification'。
- channel_config：webhook/apprise 渠道存非空白配置字符串（trim 后落库）；system-notification/alarm 渠道强制 null。
- 读取层防御：库中 channel 为非法值（含 LokiJS 忽略 'sql' 迁移步骤产生的 ''）时回退默认 'system-notification'，不抛错；once_civil_json 坏 JSON 读回抛明确错误，不静默（对齐 weekdays 纪律）。
- 回滚：v8 为加列迁移，回滚丢弃 3 新列，无数据保全要求（提案 §4）。
## Reminder 多渠道并行与偏好设置字段（v0.18，切片 18 阶段 1；遵循 docs/proposals/slice-18-multi-channel.md）

§7.29：单渠道升级为多渠道并行（一个 Reminder 可同时配置多个通知渠道）。本节覆盖
v0.16「渠道字段语义」中单渠道（channel/channel_config）的领域语义；旧列仅作 legacy
bridge 数据源保留（见下），域模型不再暴露。

### Schema v9 → v10（3 个 addColumns，严禁重建表/清库，v9 step 不动）
- reminders.channels_json: string | null（isOptional TEXT；已迁移行存 `ReminderChannel[]` 数组 JSON，写路径恒写非 null）
- reminders.channel_configs_json: string | null（isOptional TEXT；仅网络渠道条目的 JSON 对象，空对象落 null）
- app_settings.chips_increments: string | null（isOptional TEXT；once 快捷增量分钟数组 JSON，默认 [10,60]）
- channel_presets.is_default: boolean（NOT NULL；addColumns 自动回填 false，写路径显式赋值）

### 多渠道字段语义（决策点①②⑤见提案 §1，均已确认）
- channels：元素 ∈ 'system-notification' | 'alarm' | 'webhook' | 'apprise'，去重后按
  canonical 序（system-notification, alarm, webhook, apprise）存储；至少 1 项（空数组抛错）；
  至多一个 expo 渠道（system-notification/alarm 互斥，写路径抛错，决策点①——expo 渠道
  共享 expo-notifications 的 identifier 命名空间，同时调度会互相覆盖）。
- channelConfigs：仅含网络渠道（webhook/apprise）键；值 trim 后非空白（空白抛错）；
  落库前按生效 channels prune（未启用渠道的配置不落库）。
- 写路径 patch 语义：channels 整体替换（不与 current 并集）；channelConfigs 按 per-key
  merge（patch 未提及的键保留），显式 null 清除该键（决策点④）。
- 旧列 channel/channel_config 保留（迁移层无 dropColumn），写路径不再写入；schema v8
  的「channel NOT NULL」由 WatermelonDB sanitizedRaw 类型零值 '' 回填（新行），读层 bridge
  视 '' 为「无 legacy 渠道」。

### 读取层 legacy bridge（决策点③）
- channels_json 为 null / '' / 坏 JSON / 非 JSON 数组 → 视为 v9 存量行：以旧列
  channel/channel_config 构造单元素渠道集合（channel 非法或 '' 回退 'system-notification'，
  与 v0.16 读取层防御同款纪律；网络渠道且 config 非空白时才生成 configs 条目，否则空对象）。
- channels_json 为合法数组 → 只认新列（旧列值忽略，即使非空）；数组内非法元素丢弃、
  去重、canonical 序；空数组/全非法回退默认渠道 ['system-notification']。
- channel_configs_json 为 null / '' / 坏 JSON / 非 JSON 对象 → 空对象；非枚举键、不在生效
  channels 的键、expo 渠道键、非字符串值一律丢弃，不抛错。

### chips_increments 与 is_default
- chips_increments：1–4 项（CHIPS_MIN/MAX_ITEMS）、每项 1–10080 整数分钟
  （CHIPS_MIN/MAX_MINUTES）。读层防御归一：坏项丢弃、超 4 项截断、空/坏 JSON 回退默认
  [10,60]，不抛错；写路径严格校验抛明确错误（读宽松、写严格的既有纪律）。
- is_default：同 type 至多一个 true，由 Repository 在同一 db.write 事务内保证
  （新默认写入时同 type 其余行自动取消）。
- 回滚：v10 均为加列迁移，回滚丢弃新列，无数据保全要求（提案 §9）。

## 默认渠道偏好设置字段（v0.19，切片 19 阶段 1，AGENTS.md §7.30）

### Schema v10 → v11（1 个 addColumns，严禁重建表/清库，v10 step 不动）
- app_settings.default_channels_json: string | null（isOptional TEXT；
  `ReminderChannel[]` 数组 JSON，默认 `["system-notification"]`——复用
  DEFAULT_REMINDER_CHANNELS）。零 unsafeExecuteSql：可空列对既有行回填 null，
  读层归一兜底（v10 chips_increments 同款先例）。

### default_channels 语义
- 元素 ∈ 'system-notification' | 'alarm' | 'webhook' | 'apprise'；去重后按
  REMINDER_CHANNELS canonical 序（system-notification, alarm, webhook, apprise）
  存储；含义是「新建提醒表单默认勾选的渠道集合」（阶段 3 UI 接入）。
- 读层防御归一（parseDefaultChannels，永不抛错）：null/''/坏 JSON/非数组 → 回退默认；
  非法元素丢弃；去重；expo 家族双开（system-notification+alarm，只可能来自手工改库）
  → 保留 canonical 序靠前者、丢弃靠后的（读层不抛错）；结果为空 → 回退默认。
- 写路径严格校验（validateDefaultChannels，抛明确错误）：必须是非空数组、元素全部
  合法、expo 家族至多一个（与提醒写路径同一互斥纪律）；通过后返回去重 + canonical
  序标准化拷贝。serializeDefaultChannels 恒写 JSON 数组。
- 回滚：加列迁移，回滚丢弃新列，无数据保全要求。
