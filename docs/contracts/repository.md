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
