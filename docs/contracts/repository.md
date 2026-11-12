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
