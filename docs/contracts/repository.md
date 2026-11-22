# 契约：Repository 接口与语义

> 适用范围：Repository 作为唯一数据入口的接口签名、各版本扩展方法、列表/搜索/归档/排序语义。
> 最后更新切片：切片 6（v0.6）
> 来源：原 AGENTS.md 4.2、4.5、4.7、4.8、4.9、4.18、4.24（2026-11 由 AGENTS.md §4 拆分迁移至此，正文逐字保留，仅标题层级调整，语义未变）
> 相关契约：data-model.md（数据模型字段与 migration 纪律）、ui.md（UI 层不得自行拼查询）

## 4.2 Repository 接口

UI 和业务层只能通过 Repository 访问数据，不得直接 import WatermelonDB 的 database 或 model。
初始接口（切片 1 实现）：

- createItem(input: CreateItemInput): Promise<Item>
- listItems(): Promise<Item[]>

后续可扩展 updateItem、searchItems、archiveItem 等。接口签名变更必须走变更提案。

## 4.5 Repository 接口扩展（v0.2）
在切片 1 已实现的 createItem / listItems 基础上，新增以下方法，签名冻结：
- updateItem(id: string, patch: UpdateItemInput): Promise<Item>
- addTagToItem(itemId: string, tagName: string): Promise<Tag>
- removeTagFromItem(itemId: string, tagId: string): Promise<void>
- listItemsWithTags(): Promise<ItemWithTags[]>

类型约定：
- UpdateItemInput 允许更新 title、content、type、status；不允许更新 id、createdAt。
- ItemWithTags = Item & { tags: Tag[] }
- 保留 listItems(): Promise<Item[]> 不变，避免破坏切片 1 验收；切片 2 的 UI 改用 listItemsWithTags。

## 4.7 Repository 接口扩展（v0.3）
在 v0.2 基础上新增，签名冻结：
- searchItems(keyword: string): Promise<ItemWithTags[]>
- archiveItem(id: string): Promise<void>
- unarchiveItem(id: string): Promise<void>
- listArchivedItems(): Promise<ItemWithTags[]>

规则：
- searchItems 的空字符串或纯空白输入必须返回空数组，不得返回全部数据。
- archiveItem / unarchiveItem 只改 Item.status，不得级联删除标签关系、不得删除 Item。
- 保留 v0.2 的 listItemsWithTags 不变，语义为“未归档 + 未删除”的默认列表。

## 4.8 列表与搜索排序约定（v0.3）
- listItemsWithTags、listArchivedItems、searchItems 均按 updatedAt 降序。
- 搜索不做相关性排序；MVP 不引入 FTS5 或额外索引。
- 该排序约定同时适用于切片 1/2 已有的列表；这是对既有行为的明确化，不属于破坏性变更。

## 4.9 搜索语义（v0.3）
- 搜索范围：Item.title、Item.content、关联 Tag.name。
- 匹配方式：大小写不敏感的子串匹配。
- LIKE 特殊字符转义：关键词中的 `%`、`_`、`\` 必须转义后再用于 Q.like；不得直接拼接原始关键词。
- 跨表查询限制：WatermelonDB 不支持单条查询里跨表 OR。标签名匹配必须分步实现：
  1. 查 tags 表匹配 name，得到 tagIds；
  2. 用 tagIds 查 item_tags 得到 itemIds；
  3. 查 title/content 命中的 itemIds；
  4. 合并去重后按 updatedAt 降序返回。
- UI 层不得自行拼查询；搜索只走 Repository.searchItems。

## 4.18 Repository 扩展（v0.5 冻结）
新增方法，签名冻结：
- `createReminder(input: CreateReminderInput): Promise<Reminder>`
- `updateReminder(id: string, patch: UpdateReminderInput): Promise<Reminder>`
- `deleteReminder(id: string): Promise<void>`
- `listRemindersByItem(itemId: string): Promise<Reminder[]>`
- `listEnabledReminders(): Promise<Reminder[]>`
- `markReminderReconciled(id: string, lastReconciledAt: number): Promise<void>`
- `markReminderFired(id: string, occurrenceKey: string): Promise<void>`

CreateReminderInput 不含 lastFiredOccurrenceKey / lastReconciledAt，由 Repository 初始化为 null。

## 4.24 Repository 扩展（v0.6 冻结）
新增方法，签名冻结：
- getItemById(id: string): Promise<ItemWithTags | null>
- updateItemTime(id: string, patch: { startAt?: number | null; endAt?: number | null; allDay?: boolean }): Promise<Item>

规则：
- 保留 v0.2/v0.3 的 updateItem 不变；时间字段只走 updateItemTime，避免与 title/content patch 混淆。
- updateItemTime 必须同时更新 updatedAt；不得改 createdAt。
- startAt 与 endAt 同时非 null 时，endAt 必须 >= startAt，否则抛明确错误。


## 视图查询接口（v0.7，切片 7 落地）

签名冻结：

- `listScheduledItemsInRange(rangeStartMs: number, rangeEndMs: number): Promise<ItemWithTags[]>`
  - 命中条件：startAt 非 null 且 startAt ∈ [rangeStartMs, rangeEndMs)；或 startAt < rangeStartMs 且 endAt 非 null 且 endAt > rangeStartMs（跨天）。
  - status 为 'active' 或 'done'；不返回 'archived'。
  - 按 startAt 升序返回；startAt 相同时 createdAt 升序。

- `listOverdueItems(nowMs: number): Promise<ItemWithTags[]>`
  - 命中条件：endAt 非 null 且 endAt < nowMs 且 status='active'。
  - 按 endAt 升序返回。

- `listUnscheduledItemsCreatedInRange(rangeStartMs: number, rangeEndMs: number): Promise<ItemWithTags[]>`
  - 命中条件：startAt 为 null 且 createdAt ∈ [rangeStartMs, rangeEndMs) 且 status='active'。
  - 按 createdAt 降序返回。

### 约束
- 必须通过 WatermelonDB 查询实现，不得内存全表过滤。
- 不新增 schema 索引；MVP 数据量下不加。后续若数据量 > 1000 且视图卡顿，以独立 schema 变更提案处理。
- 跨天判定抽成纯函数 `overlapsRange(item, rangeStart, rangeEnd)`，Repository 与视图共用，不得各写一份。
- 范围计算抽成纯函数 `getTodayRange(nowMs, tzid)` / `getWeekRange(nowMs, tzid)`，必须显式传 tzid，不得读设备默认时区。

## ICS 导入导出接口（v0.8，切片 8 落地）

签名冻结：

- `createImportedItem(input: ImportedItemInput): Promise<ItemWithTags>`
  - 输入含 title、content、startAt、endAt、allDay、sourceUid，sourceType 固定 'ics'，sourceReadOnly 固定 true。
  - 内部执行 allDay 归一化（见 data-model.md v0.8）。
  - 若 sourceUid 非 null 且库内已存在 (sourceType='ics', sourceUid) 项，抛明确错误 `DuplicateSourceUid`；调用方负责跳过或更新，Repository 不做 upsert。

- `findItemBySource(sourceType: 'ics', sourceUid: string): Promise<ItemWithTags | null>`

- `listItemsForExport(filter: { includeArchived: false; includeDone: true }): Promise<ItemWithTags[]>`
  - MVP 只支持上述固定 filter；参数显式列在签名里是为了未来扩展，不接受任意组合。

- `updateImportedItemTime(id: string, patch): Promise<Item>`
  - 与 updateItemTime 同语义，但 sourceReadOnly=true 时抛明确错误。

### 约束
- 导入去重以 (sourceType, sourceUid) 为键；sourceUid 为 null 的 ICS 事件（无 UID）每次都作为新项插入，不做去重。
- 导出范围固定为“未归档 + active 与 done”；不做自定义筛选。
- 批量导入在事务内完成：任一条解析失败不影响已成功项落库；失败清单作为返回值上报。
- 导入超过 500 条时，Repository 层必须分批写入（每批 100 条），避免一次事务过大。

## 系统日历导入接口（v0.9，切片 9 落地）

签名冻结：

- `importSystemCalendarEvents(input: { calendarIds: string[]; rangeStartMs: number; rangeEndMs: number }): Promise<SystemImportResult>`

SystemImportResult：
- `imported: number`
- `skippedDuplicate: number`
- `skippedReadOnlyConflict: number`（如果 sourceUid 命中的本地项 sourceReadOnly=false，跳过并记录）
- `failed: Array<{ externalId: string | null; title: string; reason: string }>`

约束：
- 去重键复用 findItemBySource(sourceType='system-calendar', sourceUid)。
- 批量写入沿用 importItemsInBatches（100/批），单条失败不影响其他条。
- 不调用任何写入系统日历的 API。

## 搜索与归档增强接口（v0.12，切片 12 落地）

### 搜索范围扩展
`searchItems(keyword: string)` 的签名不变，但匹配范围新增：
- Item.startAt / Item.endAt 的格式化日期字符串（YYYY-MM-DD，设备时区）
- 不新增参数；匹配范围由 Repository 内部实现决定。

规则：
- LIKE 转义逻辑不变（`%`、`_`、`\`）。
- 跨表查询仍分步：先查 tags，再查 title/content/日期。
- 排序不变：updatedAt 降序。

### 归档视图查询
新增：
- `listArchivedItemsWithTags(): Promise<ItemWithTags[]>`
  - 返回 status='archived' 的 Item，按 updatedAt 降序。
  - 与 v0.3 的 listArchivedItems 并存；后者保留不删（既有调用方不改）。
  - 标签关系保留，返回 ItemWithTags。

## Category 与标签接口（v0.14，切片 14 落地）

### Category 接口
- `getCategories(): Promise<Category[]>`
  - 按 priority 升序返回所有分类。
- `updateCategoryVisuals(id: string, patch: { color?: string | null; emoji?: string | null }): Promise<Category>`
  - 更新分类的颜色和表情。

### Tag 接口扩展
- `updateTagVisuals(id: string, patch: { color?: string | null; emoji?: string | null }): Promise<Tag>`
  - 更新标签的颜色和表情。
- （保留既有 `addTagToItem` / `removeTagFromItem` 等接口不变）

### AppSettings 接口（新增）
- `getSettings(): Promise<AppSettings>`
  - 读取全局设置。若库中无记录（例如初次启动），必须返回默认值 `{ tagDisplayMode: 'text' }`，并静默在后台插入该记录，不得抛错。
- `updateSettings(patch: Partial<AppSettings>): Promise<void>`
  - 更新全局设置。目前仅支持传入 `tagDisplayMode`。

### Item 接口扩展（水合 ItemWithRelations）
- `createItem` / `updateItem` 的入参增加 `categoryId?: string | null`。
- 所有原先返回 `Item[]` 或 `ItemWithTags[]` 的查询接口（如 `listItems`、`searchItems`、`listScheduledItemsInRange` 等），统一升级为返回 `ItemWithRelations[]`。
  - `ItemWithRelations` 定义为：`Item & { tags: Tag[], category: Category | null }`。
- 若关联的 Category 未被找到（数据异常），`category` 字段返回 null，由 UI 层回退到默认灰色和无 Emoji 的展示。
## 渠道预设与导入预览接口（v0.17，切片 17 阶段 1/2 落地）

> 依据：AGENTS.md §7.27（渠道配置中心）与 §7.28（导入预览）的仓库层支撑；先例为
> 「Category 与标签接口（v0.14）」的契约外显式扩展风格。

### 渠道预设（channel_presets，schema v9）

- `listChannelPresets(): Promise<ChannelPreset[]>`
  - 按 created_at 降序（新建的在前）。created_at 并列无业务语义，不追加次级排序。
- `createChannelPreset(input: { name: string; type: ChannelPresetType; configJson: string }): Promise<ChannelPreset>`
  - name trim 后必须非空；type 枚举外抛错；configJson 经对应渠道守卫校验后才落库
    （webhook → WebhookChannelConfig 守卫、apprise → AppriseChannelConfig 守卫，
    错误消息原样抛出，保证「存进预设的配置必然能被渠道投递解析」）。
  - createdAt 由 WatermelonDB 自动写入，输入不提供。
- `updateChannelPreset(id: string, patch: { name?: string; configJson?: string }): Promise<ChannelPreset>`
  - patch 合并语义（仅提供要改的字段）；type 创建后不可变（改类型等于换配置语义，
    应删除重建）；configJson 按该预设的既有 type 重新过守卫；name trim 后非空。
  - 空 patch（两个字段都缺省）抛错；预设不存在抛 `updateChannelPreset: channel preset not found: <id>`。
- `deleteChannelPreset(id: string): Promise<void>`
  - 预设不存在抛明确错误。删除预设不影响已引用其 configJson 的既有提醒
    （详情页选用预设是整串复制进 reminders.channel_config 的值语义，无外键引用）。
- 读取层防御：channel_presets 行 type 非法（绕过 Repository 的外部直写、未来版本回退）
  时抛错不静默（weekdays 同款纪律）。

### ICS 导入预览（v0.17，切片 17 阶段 1；阶段 3 落 UI）

- `generateIcsPreview(icsText: string, deviceTzid: string): Promise<IcsPreviewResult>`
  - 纯读不写：解析复用 parseIcs（不复制解析逻辑），不落库。
  - `IcsPreviewEntry = { input: ImportedItemInput; floating: boolean; isDuplicate: boolean; existingItemId: string | null }`
  - `IcsPreviewResult = { entries: IcsPreviewEntry[]; failures: IcsParseFailure[]; sameFileDuplicates: SameFileDuplicate[]; duplicateCount: number }`
  - 去重判定：一次查询 source_type='ics' 的 items 建 uid→id 映射，判定键与
    assertNoDuplicateSourceUid / importItemsInBatches 的 skippedDuplicate 完全同键，
    保证「预览标记 = 实际落库行为」；sourceUid=null 恒 isDuplicate=false（无 UID 不去重）。
  - 确认导入时 entries 里被勾选的 input 可直接喂 importItemsInBatches（不新增导入路径）。

### 系统日历导入预览与确认（v0.17，切片 17 阶段 2 落地）

> §7.28 要求系统日历导入与 ICS 一致「先预览、默认勾选新增项、确认后才落库」；
> 原 importSystemCalendarEvents（v0.9，签名冻结、保留不动）一体化读取+落库，
> 无法支撑「取消勾选不落库」，故按契约外显式扩展补两个方法（先例同 deleteItem / observe*）。

- `generateSystemCalendarPreview(input: SystemCalendarImportInput): Promise<SystemCalendarPreviewResult>`
  - 纯读不写：与 importSystemCalendarEvents 共用同一套校验/分流/映射管道
    （range 有限且 start<end 否则抛错；startDate 不可解析入 failures；范围外计入
    outOfRangeCount；映射复用 mapSystemEventToImportedItem，不复制逻辑）。
  - `SystemCalendarPreviewEntry = { input: ImportedItemInput; isDuplicate: boolean; existingItemId: string | null; externalId: string | null }`
  - 去重标记为无事务纯读（竞态由确认落库时的同键重查兜底，与 generateIcsPreview 同一原则）；
    判定键 (sourceType='system-calendar', source_uid) 与落库去重完全同键，
    保证「预览标记 = 实际落库行为」。
  - sourceUid 策略计数不在预览期透出（确认导入的结果页语义不变）。
- `importSystemCalendarEntries(inputs: ImportedItemInput[]): Promise<ImportBatchResult>`
  - 只消费调用方传入的 inputs（必须来自 generateSystemCalendarPreview 产出的
    entry.input），不做读取/映射；落库固定 §7.15 语义（type='event'/
    sourceType='system-calendar'/sourceReadOnly=true，allDay 归一化与既有路径共用预处理）。
  - 与 importItemsInBatches 同纪律：IMPORT_BATCH_SIZE 分批、事务内同键重查去重
    （覆盖预览与确认之间的并发窗口）；sourceUid=null 不去重直接落库（与 ICS 一致）。
  - 预览后新出现的重复与非只读冲突统一计入 skippedDuplicateCount（一次性确认
    流程中两者对用户的呈现语义相同：该 UID 本地已有，跳过）。
  - 确认导入后的 reconcile 触发与结果页复用 /import-result（fileName='系统日历'），
    属 UI 层职责，不在本接口约束内。

## Reminder 多渠道并行与偏好设置接口（v0.18，切片 18 阶段 1 落地）

> 依据：AGENTS.md §7.29 与 docs/proposals/slice-18-multi-channel.md（已确认）。
> 领域模型 Reminder 的 channel/channelConfig 单渠道字段删除，改为 channels/channelConfigs
> （语义见 data-model.md「Reminder 多渠道并行与偏好设置字段」v0.18 节）；本节只记录
> Repository 接口面的变化。

### Reminder 创建/更新（createReminder / updateReminder）
- `createReminder` 输入：`channels?: ReminderChannel[]`（缺省 `['system-notification']`）、
  `channelConfigs?: Partial<Record<ReminderChannel, string>>`（仅网络渠道条目）；原单渠道
  `channel`/`channelConfig` 输入字段删除。
- `updateReminder` patch：`channels?` 整体替换、`channelConfigs?: Partial<Record<ReminderChannel,
  string | null>>` per-key merge（显式 null 清除该键，未提及键保留）；current 由读取层
  legacy bridge 解析后参与 merge。校验失败的抛错文案同 data-model.md v0.18 节
  （空数组 / expo 互斥 / 空白 config 等）。
- 落库写 channels_json（恒非 null）与 channel_configs_json（空对象落 null）；旧列
  channel/channel_config 不再写入。

### 渠道预设扩展（is_default）
- `createChannelPreset` 输入增加 `isDefault?: boolean`（缺省 false）。
- `updateChannelPreset` patch 扩为 `{ name?; configJson?; isDefault? }`，至少一项（空 patch
  抛错文案更新为 name / configJson / isDefault）；`isDefault: true` 时同 type 其余预设的
  is_default 在同一 db.write 事务内自动置 false（同 type 至多一个默认，不变量）；
  isDefault=false 只取消自身不产生连锁。
- `ChannelPreset` 领域对象增加 `isDefault: boolean`；读取层 false 回填由 v10 addColumns
  自动完成（NOT NULL boolean）。

### 全局设置扩展（chipsIncrements）
- `AppSettings` 领域对象增加 `chipsIncrements: number[]`（once 快捷增量分钟数组）。
- `getSettings` 兜底建行时写入默认 `[10, 60]`（seed 与 ensure 路径一致）。
- `updateSettings` patch 增加 `chipsIncrements?`：写前经严格校验（1–4 项、每项 1–10080
  整数分钟，越界/非整数/空/超限抛明确错误），通过后序列化落库；读层防御归一规则见
  data-model.md v0.18 节（读宽松、写严格）。

### 全局设置扩展（defaultChannels，v0.19，切片 19 阶段 1 落地）
- `AppSettings` 领域对象增加 `defaultChannels: ReminderChannel[]`（新建提醒表单
  默认勾选的渠道集合；AGENTS.md §7.30 第二条）。
- `getSettings` 兜底建行时写入默认 `["system-notification"]`（serializeDefaultChannels
  落库，seed 与 ensure 路径一致）；存量行 default_channels_json 为 null（v10 旧行升级
  或省列）时读层经 parseDefaultChannels 回退同款默认，不抛错。
- `updateSettings` patch 增加 `defaultChannels?`：写前经 validateDefaultChannels 严格
  校验（非空数组、元素全部为合法渠道 id、expo 家族 system-notification/alarm 至多一个，
  违反抛明确错误），通过后去重 + REMINDER_CHANNELS canonical 序排列序列化落库；
  行不存在时以 patch 值（缺省用默认值）建行。读层防御归一规则见 data-model.md v0.19 节。

## 全局设置扩展（displayCalendarIds）与系统日历 live 直读（v0.31，切片 27 阶段 1 落地）

> 依据：AGENTS.md §7.39（系统日历 live 直读显示，方案 C）；先例为「全局设置扩展
> （defaultChannels，v0.19）」同款结构。v0.9「系统日历导入接口」冻结条款
> （含「不调用任何写入系统日历的 API」）一字未动，本节不修改其语义。

### 全局设置扩展（displayCalendarIds）
- `AppSettings` 领域对象增加 `displayCalendarIds: string[]`（系统日历 live 直读显示
  开关：选中显示的系统日历 id 集合；AGENTS.md §7.39）。
- 语义与 defaultChannels 不同：**空数组是合法状态（= 功能关闭），不存在「空回退
  默认值」分支**；默认值 `[]`。
- schema v14：app_settings 新增 `display_calendar_ids_json`（isOptional string，
  JSON 字符串数组）；存量行回填 null，读层经 parseDisplayCalendarIds 防御归一
  （null/''/坏 JSON/非数组 → []；元素非字符串或 trim 空串剔除；去重保序；不抛错）。
- `getSettings` 兜底建行时写入默认 `[]`（serializeDisplayCalendarIds 落库，seed 与
  ensure 路径一致）。
- `updateSettings` patch 增加 `displayCalendarIds?`：写前经 validateDisplayCalendarIds
  严格校验（必须为数组、每项非空字符串，违反抛明确错误；空数组 = 关闭，合法写入
  `'[]'`），通过后去重保序序列化落库；行不存在时以 patch 值（缺省用默认值）建行。

### SystemCalendarReader 端口扩展（D5，契约外显式扩展）
- `SystemCalendarInfo` 增加 `color: string | null`（Android CALENDAR_COLOR，expo-calendar
  原生序列化 '#RRGGBB'；缺失/空串为 null）与 `sourceName: string | null`（Android
  ACCOUNT_NAME，即 expo-calendar `Calendar.source.name`；缺失/空串为 null）。
- 先例：observeItemsWithTags 端口扩展（切片 12）；导入接口 importSystemCalendarEvents
  签名与去重键语义不变，getEvents 不变。
- 端口读取仍只读：本节不引入任何系统日历写入 API 调用路径（§7.15 冻结语义不变）。

### live 直读数据流边界（冻结）
- live 事件由 UI 层 hook 直接消费 SystemCalendarReader.getEvents + 领域
  filterEventsInRange 合成为只读视图条目，**不经过 Repository 写路径、不落库**；
  不参与提醒调度、搜索、筛选谓词、小组件快照、闪电录入、ICS 与数据导出。
- live 视图条目在视图数据管线「filterItems 之后、分组/布局之前」并入；视图查询
  接口签名不变。

## 配置备份快照接口（v0.34，切片 28 阶段 1 落地）

> 依据：AGENTS.md §7.42（配置备份 WebDAV）；先例为 filterExistingItemIds
> （切片 18）与 SystemCalendarReader.getCalendars color 扩展（切片 27）的
> 契约外显式扩展成对模式。既有全部冻结签名零 diff，本节为追加性注记。

### ItemRepository 成对扩展（createConfigSnapshot / applyConfigSnapshot）
- `createConfigSnapshot(): Promise<ConfigSnapshot>`：只读组包（getSettings +
  getCategories + listTags），返回
  `{version: 1, kind: 'config', exportedAt, appSettings, categories, tags}`；
  exportedAt 为本地时区 ISO 8601 含 ±HH:MM 偏移；**不包含任何凭据面**
  （AI Provider 配置存 SecureStore、channel_presets、WebDAV 连接配置均不入快照
  ——恢复对 app_settings 全列覆盖，连接配置若入快照会被旧快照回滚，自引用防护）。
- `applyConfigSnapshot(snapshot: ConfigSnapshot): Promise<ConfigSnapshotApplyResult>`：
  增量覆盖恢复，返回 `{applied, skipped}` 计数。非 ConfigSnapshot 结构
  （isConfigSnapshotWire 不过）抛错，库零变化。语义冻结：
  - **appSettings**：全列覆盖，快照缺列保留本地同列值；逐字段经既有归一/校验
    （tagDisplayMode/flashDeletedCardDisplay 枚举、chipsIncrements/
    defaultChannels/displayCalendarIds 走 parse* 防御归一坏值回退默认、
    aiRetryMax 越界回退 3），JSON 列宽容串/值两种形态。
  - **categories**：按 id 命中覆盖 color/emoji/priority；本地不存在该 id
    保留不建、不计数；条目形状不符（isConfigSnapshotCategoryEntry 不过）跳过
    计入 skipped。
  - **tags**：按 normalizeTagName 归一键（trim + 大小写不敏感，既有唯一入口）
    命中覆盖 color/emoji；未命中创建（name/color/emoji）；本地独有保留；
    同快照重复名后者覆盖前者；条目形状不符跳过计入 skipped。
  - **计数口径**：applied = appSettings 块计 1 + 实际写入的 categories/tags
    条目数（同快照重复 tag 名按条目累计）；skipped = 形状不符条目数；
    category id 未命中本地不计入任一计数。UI 披露「已应用 N 项，跳过 M 项
    （形状不符）」。
  - **事务原子**：全部读取先行，随后同步 prepareUpdate/prepareCreate 收集，
    最后单次 `db.batch(...)` 适配器级原子提交（逐 model.update/create 不构成
    事务）；任一失败整体不落库。tags 采用两遍法（先按归一键归并再统一
    prepare），避免对同批 prepareCreate 记录调用 prepareUpdate。
- 配套域层：src/domain/configSnapshot.ts（isConfigSnapshotWire 整包守卫 +
  isConfigSnapshotCategoryEntry / isConfigSnapshotTagEntry 条目级宽容谓词 +
  parseConfigSnapshot + 文件名正则 `^life-config-\d{8}-\d{6}\.json$`）。

> 注记节版本标签披露：任务卡（tasks/slice-28.md D6）与提案
> （docs/proposals/slice-28-config-backup-webdav.md §6）原文标注「v0.22」，
> 与本文件既有节按 AGENTS.md 版本标注的惯例不一致；本节按惯例标 v0.34
> （切片 28），语义以本节为准。

## 数据备份快照接口（v0.35，切片 31 阶段 1 落地）

> 依据：AGENTS.md §7.43（数据备份 WebDAV）；先例为 createConfigSnapshot /
> applyConfigSnapshot（切片 28，本文件 v0.34 注记节）的契约外显式扩展成对模式。
> 既有全部冻结签名零 diff，本节为追加性注记。

### ItemRepository 成对扩展（createDataSnapshot / applyDataSnapshot）
- `createDataSnapshot(): Promise<DataSnapshot>`：只读组包（listItemsWithTags ∪
  listArchivedItemsWithTags 全库含 archived/done + listAllReminders + listTags +
  listChannelPresets + item_tags 直查），返回
  `{version: 1, kind: 'data', exportedAt, items, tags, reminders, channelPresets, itemTags}`；
  items 全字段 id 保真；tags 含 id（供 itemTags join 直连）；reminders 仅 v10 语义列
  （不含调度态 last_fired_occurrence_key/last_reconciled_at 与 deprecated
  channel/channel_config）；channelPresets 含 configJson 明文（用户定案）；
  exportedAt 本地时区 ISO 8601 含 ±HH:MM 偏移。
- `applyDataSnapshot(snapshot: DataSnapshot): Promise<DataSnapshotApplyResult>`：
  增量覆盖恢复，返回 `{applied, skipped}` 计数。非 DataSnapshot 结构
  （isDataSnapshotWire 不过）抛错，库零变化。语义冻结：
  - **items**：按 id 命中覆盖全字段写穿（createdAt 不动、updatedAt 自动刷新）/
    未命中创建（`prepareCreateFromDirtyRaw` 保真 id 与 created_at/updated_at）/
    本地独有保留；categoryId 悬挂引用跳过计 skipped。
  - **tags**：按 normalizeTagName 归一键命中覆盖 color/emoji（name 业务键不写）/
    未命中创建（id 取快照值、created_at 恢复时刻）；快照内重复名 **first-wins**
    （与 v0.34 配置快照「后者覆盖」刻意不同——数据快照 tag id 是 itemTags join
    锚点；重复名条目计 skipped 但其 id 仍映射首条解析行保 join 可解析）。
  - **reminders**：按 id 命中覆盖写穿 v10 语义列（item_id 不改；调度态两列不写，
    防丢本地调度状态）/ 未命中创建（item_id 须解析到本轮已解析 item，失败计
    skipped；deprecated 两列兜底 channel='system-notification' + channel_config=null；
    created_at/updated_at 恢复时刻）。恢复前逐条深层校验（防读路径抛错）：
    weekdaysJson/onceCivilJson 可解析、frequency 规则一致性
    （normalizeReminderRuleFields）、once 必携带 onceCivilJson、channelsJson 非空
    合法渠道数组且 expo ≤1、channelConfigsJson null 或字符串字典、tzid 白名单；
    失败计 skipped。
  - **channelPresets**：按 id 命中覆盖 name/configJson/isDefault（type 与本地行
    不匹配计 skipped——type 创建后不可变）/ 未命中创建（id 取快照值）；
    configJson 经既有渠道配置守卫（assertValidChannelPresetConfig）校验失败计
    skipped；事务内同 type 单 default 规范化（快照序最后一个声明 default 的行生效，
    同 type 其余行含本地独有收敛为 false；快照未声明 default 的 type 不动本地）。
  - **itemTags**：对每个已解析快照 item 删除现有全部 join + 按快照重建（删除不计
    applied、新建 join 各计 1）；itemId/tagId 解析失败计 skipped；重复 join 声明
    first-wins。
  - **快照内重复 id 统一 first-wins**（items/reminders/channelPresets 同纪律：
    后续重复条目计 skipped——防同模型二次 prepareUpdate on pending 与同 id 双建）。
  - **计数口径**：applied = items/tags/reminders/channelPresets 每个实际写入
    （覆盖或创建）条目计 1 + 每个新建 itemTags join 计 1；skipped = 形状不符 +
    深层校验失败 + 悬挂引用（categoryId/item_id/tagId）+ first-wins 丢弃 dup。
    UI 披露「已应用 N 项，跳过 M 项」。恢复成功后的
    reminderScheduler.reconcile() 由调用方显式执行一次（失败不阻断仅披露），
    本方法不触碰 src/notifications/。
  - **事务原子**：单 db.write 事务，事务内全量读六表 → operations 同步收集 →
    单次 `db.batch(...)`（切片 28 两遍法照抄）；任一失败整体不落库。
- 配套域层：src/domain/dataSnapshot.ts（isDataSnapshotWire 整包守卫 + 五个条目级
  宽容谓词 + parseDataSnapshot/DataSnapshotParseError + 文件名正则
  `^life-data-\d{8}-\d{6}\.json$` + dataSnapshotFileName）。序列化无缩进
  （提案 §7 体积优先，与配置快照 2 空格缩进刻意不同）。
- WebDAV 客户端配套（src/data/webdav/WebdavClient.ts）：SnapshotFileNameFilter
  谓词类型，listSnapshots/uploadSnapshot/downloadSnapshot/deleteSnapshot 方法级
  可选参数缺省 isConfigSnapshotFileName（切片 28 调用面零改动）；数据快照经
  isDataSnapshotFileName 传入，独立列表/裁剪/下载/删除，与配置快照互不挤占。

## 双向同步快照接口（v0.39，切片 35 阶段 1 落地）

> 依据：AGENTS.md §7.47（双向同步 WebDAV）；提案
> docs/proposals/slice-35-two-way-sync-webdav.md（2026-11-22 三问定案：行级
> LWW+墓碑 / 集合级 union / 仅手动）。先例为 createDataSnapshot /
> applyDataSnapshot（切片 31，本文件 v0.35 注记节）的契约外显式扩展成对模式。
> 既有全部冻结签名零 diff，本节为追加性注记。

### ItemRepository 成对扩展（createSyncSnapshot / applySyncMerge）
- `createSyncSnapshot(deviceId: string): Promise<SyncSnapshot>`：只读组包
  （getSettings + getCategories + listItemsWithTags ∪ listArchivedItemsWithTags +
  listAllReminders + listTags + listChannelPresets + item_tags 直查 +
  sync_tombstones 全量），返回 `{version: 1, kind: 'sync', deviceId, exportedAt,
  appSettings, categories, items, tags, reminders, channelPresets, itemTags,
  tombstones}`。items 全字段 id 保真（含 archived/done 全库）；tags 含 id；
  reminders 为 v10 语义列 **+ createdAt/updatedAt 两毫秒时间戳**
  （SyncReminderEntry = DataSnapshotReminder + 两键——LWW 决胜判据；切片 31
  DataSnapshotReminder 冻结形状不含 updated_at，故 sync wire 条目不复用其形状）；
  tombstones 投影 `{kind, entityId, deletedAt}`；exportedAt 本地时区 ISO 8601
  含 ±HH:MM 偏移（formatExportedAt 同款）。
- `applySyncMerge(result: SyncMergeResult): Promise<SyncMergeApplyResult>`：
  接收合流纯函数 mergeSyncSnapshots（src/domain/syncMerge.ts）产出的待执行集，
  单事务落库，返回 `{applied, skipped, conflictsResolved, tombstonesPropagation}`。
  语义冻结：
  - **处理序（先删后建）**：toDelete*Ids 直删（缺行静默容错；item 删除级联其
    reminders 与 joins，不新增墓碑——墓碑仅由三删除方法与 tombstonesToAdd
    合入产生）→ items 命中 prepareUpdate 11 字段写穿（updatedAt 自动刷新，
    prepareUpdate 语义零侵入）/ 未命中 prepareCreateFromDirtyRaw（id 与
    created_at/updated_at 保真）→ reminders（isValidDataSnapshotReminderEntry
    深层校验失败计 skipped；itemId 防御复核失败计 skipped；命中写穿 v10 语义列
    且 item_id 不改、调度态两列不写 / 未命中 prepareCreate id 保真，deprecated
    两列兜底 channel='system-notification' + channel_config=null，落库时间戳为
    本机时刻）→ channelPresets（assertValidChannelPresetConfig 校验失败计
    skipped；id 命中本地一律保留计 skipped——preset union 无覆盖；未命中创建 +
    同 type 单 default 规范化 last-wins，同 applyDataSnapshot）→ tags
    （normalizeTagName 归一键：本地命中或本轮已建一律保留计 skipped——tag union
    无覆盖；未命中创建，id 取快照值）→ categories（id 命中保留 / 未命中创建 id
    保真）→ itemTags（并集增补：本地已有或本轮已发静默去重；itemId/tagId
    解析失败计 skipped；**不删除本地既有 join**）→ tombstonesToAdd（与本地
    sync_tombstones 去重后合入，deletedAt 保真，不计 applied）→ appSettings
    （appliedAppSettings 非 null 时整行 prepareUpdate 14 列写穿——列映射同
    updateSettings；行缺失 prepareCreate id='global'）。
  - **LWW 锚定最终写入**：行级冲突由合流层按 wire updatedAt 晚者胜出判定；
    胜出行经 prepareUpdate 落库时 updated_at 自动刷新为本机合流写入时刻
    （列 readonly 零侵入）。多设备部分拓扑下（A、B 各自只在部分轮次相遇）
    以最终写入时刻为准可能与全局 updated_at 最大值存在偏差——已知限制，接受。
  - **计数口径**：applied = item/reminder 实际写入（覆盖或创建）+ tag/category/
    preset 创建 + join 创建 + app_settings 块命中计 1（墓碑合入不计 applied）；
    skipped = 合流层计数 + 仓库层深层校验追加计数；conflictsResolved /
    tombstonesPropagation 透传合流层计数。UI 披露「已合流 N 项，冲突解决 X 项，
    删除传播 Y 项，跳过 M 项」。
  - **事务原子**：单 db.write 事务，事务内全量读八表 → operations 同步收集 →
    单次 `db.batch(...)`（两遍法）；任一失败整体不落库。
- `pruneSyncTombstones(minRemoteExportedAtMs: number): Promise<number>`
  （单方法契约外扩展，filterExistingItemIds 先例）：删除 deleted_at **严格早于**
  minRemoteExportedAtMs 的墓碑，返回删除数；由调用方（同步编排层）在成功上传
  合并快照后执行，min 值取全部对端快照 exportedAt 的最小毫秒值；无对端快照时
  不调用。
- **三删除方法墓碑副作用（签名与外部行为不变，仅新增注记）**：deleteItem /
  deleteReminder / deleteChannelPreset 在各自既有的 db.write 事务内、实体销毁后
  调用私有 helper 于 sync_tombstones 表记录 `{kind, entityId, deletedAt=now}`
  （同 kind+entity_id 已有墓碑则幂等跳过，不刷新 deleted_at）。deleteItem 级联
  销毁的 reminders **不**逐条记墓碑（item 墓碑表达整棵子树）。同步链路之外
  （备份恢复 applyDataSnapshot / 数据导出 / 清库）不产生墓碑。
- 配套域层：src/domain/syncSnapshot.ts（SyncSnapshot / SyncReminderEntry /
  SyncTombstoneEntry 形状 + isSyncSnapshotWire 整包守卫（坏 tombstones 元素
  整包拒绝；items/categories 条目级形状不符由合流层计 skipped）+
  serializeSyncSnapshot/parseSyncSnapshot（无缩进）+ 文件名正则
  `^life-sync-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.json$` +
  syncSnapshotFileName/deviceIdFromSyncFileName）；src/domain/syncMerge.ts
  （mergeSyncSnapshots(local, remoteSnapshots, localTombstones, options) 纯函数：
  远端快照按 (exportedAt 升序, deviceId 升序) 排序保证确定性；items/reminders
  行级 LWW（updatedAt 最大者胜，平局远端 deviceId 字典序最大，与本地平局本地赢）；
  tags/categories/channelPresets 集合级 union；itemTags 并集增补；appSettings
  按 exportedAt 会话基线 LWW（SyncMergeOptions.settingsBaselineExportedAt，
  缺列保留本地经 normalizeSnapshotAppSettings）；墓碑键 `kind:entityId`，
  tombstonesToAdd = 远端有本地缺的全部）；src/domain/syncDevice.ts
  （generateDeviceId uuid v4 零依赖 + SyncDeviceStore 端口）+ SecureStore 实现
  src/data/SecureSyncDeviceStore.ts（键 `sync_device_id_v1`）。
- WebDAV 客户端配套（切片 31 SnapshotFileNameFilter 模式延续）：同步编排层以
  isSyncSnapshotFileName 传入 listSnapshots/downloadSnapshot，与
  kind:'config'/'kind:'data' 快照互不相认；固定名覆盖写上传不使用
  uploadSnapshot（其内置 10 份滚动裁剪对固定名快照不适用），由编排层专用
  无裁剪 PUT 路径承担。
