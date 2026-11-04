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
