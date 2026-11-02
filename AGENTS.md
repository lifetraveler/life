# AGENTS.md — 项目契约与 AI 协作规则

## 1. 项目概览

本项目是一个本地优先的灵感记录、任务日程与生活安排应用。
当前阶段目标：Android 本地 MVP 跑通。
技术栈：Expo + React Native + TypeScript，Web/Android/iOS 共用代码。
当前不接后端，不登录，不做云同步；为未来云同步预留 Repository / SyncAdapter 接口。

## 2. 技术栈锁定（不得擅自替换）

- 客户端框架：Expo（React Native）+ TypeScript
- 本地数据库：WatermelonDB（SQLite）
- 状态管理：使用 WatermelonDB 的响应式查询；不引入 Redux/MobX/Zustand 等全局状态库
- 通知：当前切片未实现；后续通过 ReminderScheduler 抽象，UI 不得直接 import expo-notifications
- 导航：Expo Router（如已选用，以实际工程为准）
- 测试：Jest
- 包管理：npm（或 pnpm，以工程 lockfile 为准，不得混用）

## 3. 目录约定

src/
  app/          页面与导航
  domain/       纯 TypeScript 领域逻辑（不依赖 React Native / WatermelonDB）
  data/         Repository 接口与实现
  db/           WatermelonDB schema、model、migrations
  ui/           通用组件
  notifications/ ReminderScheduler 接口与实现（后续切片）
tasks/          切片任务卡
AGENTS.md       本文件

## 4. 受保护契约（AI 不得自行修改；如需变更必须输出变更提案并暂停）

### 4.1 数据模型：Item

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

### 4.2 Repository 接口

UI 和业务层只能通过 Repository 访问数据，不得直接 import WatermelonDB 的 database 或 model。
初始接口（切片 1 实现）：

- createItem(input: CreateItemInput): Promise<Item>
- listItems(): Promise<Item[]>

后续可扩展 updateItem、searchItems、archiveItem 等。接口签名变更必须走变更提案。

### 4.3 ReminderScheduler 接口

当前切片不实现。后续所有提醒调度必须通过该接口，UI 不得直接调用 expo-notifications。
接口签名在切片 5 前冻结。

### 4.4 数据模型：Tag / ItemTag（v0.2 新增）
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

### 4.5 Repository 接口扩展（v0.2）
在切片 1 已实现的 createItem / listItems 基础上，新增以下方法，签名冻结：
- updateItem(id: string, patch: UpdateItemInput): Promise<Item>
- addTagToItem(itemId: string, tagName: string): Promise<Tag>
- removeTagFromItem(itemId: string, tagId: string): Promise<void>
- listItemsWithTags(): Promise<ItemWithTags[]>

类型约定：
- UpdateItemInput 允许更新 title、content、type、status；不允许更新 id、createdAt。
- ItemWithTags = Item & { tags: Tag[] }
- 保留 listItems(): Promise<Item[]> 不变，避免破坏切片 1 验收；切片 2 的 UI 改用 listItemsWithTags。

### 4.6 Schema 变更与 Migration 规则（v0.2 新增）
- 每次 WatermelonDB schema 变更必须提升 version，并新增 migration step。
- 不得修改已发布的 migration step；只能在末尾追加。
- 新增表/字段必须在 migration 中显式创建，不得依赖“删库重装”。
- 切片 2 的 schema version 从 1 升至 2，新增 tags、item_tags 表。
- AI 不得以“开发阶段可以清库”为由跳过 migration。

### 4.7 Repository 接口扩展（v0.3）
在 v0.2 基础上新增，签名冻结：
- searchItems(keyword: string): Promise<ItemWithTags[]>
- archiveItem(id: string): Promise<void>
- unarchiveItem(id: string): Promise<void>
- listArchivedItems(): Promise<ItemWithTags[]>

规则：
- searchItems 的空字符串或纯空白输入必须返回空数组，不得返回全部数据。
- archiveItem / unarchiveItem 只改 Item.status，不得级联删除标签关系、不得删除 Item。
- 保留 v0.2 的 listItemsWithTags 不变，语义为“未归档 + 未删除”的默认列表。

### 4.8 列表与搜索排序约定（v0.3）
- listItemsWithTags、listArchivedItems、searchItems 均按 updatedAt 降序。
- 搜索不做相关性排序；MVP 不引入 FTS5 或额外索引。
- 该排序约定同时适用于切片 1/2 已有的列表；这是对既有行为的明确化，不属于破坏性变更。

### 4.9 搜索语义（v0.3）
- 搜索范围：Item.title、Item.content、关联 Tag.name。
- 匹配方式：大小写不敏感的子串匹配。
- LIKE 特殊字符转义：关键词中的 `%`、`_`、`\` 必须转义后再用于 Q.like；不得直接拼接原始关键词。
- 跨表查询限制：WatermelonDB 不支持单条查询里跨表 OR。标签名匹配必须分步实现：
  1. 查 tags 表匹配 name，得到 tagIds；
  2. 用 tagIds 查 item_tags 得到 itemIds；
  3. 查 title/content 命中的 itemIds；
  4. 合并去重后按 updatedAt 降序返回。
- UI 层不得自行拼查询；搜索只走 Repository.searchItems。

### 4.10 Schema 变更（v0.3）
- 切片 3 不需要 schema 变更。Item.status 已包含 'archived'，不得为此新增字段或表。
- 不得新增 migration。若 AI 认为需要改 schema，必须先输出变更提案并暂停。
## 5. 构建与配置约束（不得“优化”或删除）

- WatermelonDB 在 Expo 下需要 custom development client，不能用 Expo Go 完整验证。
- Babel decorators 配置、WatermelonDB 相关 Babel 插件、expo-build-properties 的 Android simdjson 相关配置、app.json 中的 WatermelonDB Expo plugin，均属于受保护配置。
- AI 不得为了“简化构建”而删除上述配置，也不得建议退回 Expo Go 验证数据库功能。
- 如配置确实无法构建，AI 应输出错误日志与最小变更提案，而不是自行重写构建配置。
- WatermelonDB 的 @relation / @children 装饰器与 Babel decorators 配置强相关；AI 修改 model 时必须保持装饰器写法，不得改写为普通字段或运行时报错后再“简化”。
- 新增表后必须运行 `npx expo-doctor` 与真机重启验收，确认 migration 实际执行。

## 6. 验证命令（每次切片结束必须执行）

- `npx tsc --noEmit`
- `npx expo-doctor`
- 如有测试：`npx jest --runInBand`
- Android 真机验收：使用 development build 安装并执行任务卡中的手动步骤

## 7. AI 工作规则

1. 每次新会话，先读 AGENTS.md 和当前切片任务卡，输出你理解的修改范围、验收命令、明确不做的事项；用户确认后再写代码。
2. 一次只做一个切片，不提前实现后续切片功能。
3. 不引入新依赖，除非任务卡明确允许；引入前先说明理由和替代方案。
4. 新增文件不得使用 `any`；不得用 `as any` 绕过类型错误。
5. 不修改受保护契约。需要修改时，先输出“变更提案”，包含原因、影响范围、迁移方案。
6. 验收标准必须可执行或可观察；不得用“功能正常”作为完成依据。
7. 切片完成后输出：修改文件列表、执行的验证命令及结果、未完成/风险项。

## 8. 当前切片

见 tasks/slice-01.md。