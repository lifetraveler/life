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