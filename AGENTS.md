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

### 4.11 重复规则模块的定位（v0.4）
- 切片 4 新增 `src/domain/recurrence/`，为纯 TypeScript 模块，不得 import React、React Native、WatermelonDB、expo-notifications、UI 组件或任何数据库代码。
- 该模块是后续 `ReminderScheduler`（切片 5）的唯一重复规则来源；UI 和通知层不得自行实现重复计算。
- 不得引入 `rrule` 或任何依赖 floating-time 语义的日历库。rrule 的日期应被视为“floating times wearing UTC clothing”，其 DST 行为不可靠且上游长期未修复。

### 4.12 重复规则的计算模型（v0.4）
重复提醒的本质是“民用时间规则”，不是“固定间隔的 UTC 瞬间”。必须同时存储：
- `localTime`：用户本地民用时间（小时、分钟）；
- `tzid`：IANA 时区标识（如 `Asia/Shanghai`、`America/New_York`）。

规则类型（MVP 冻结，不得扩展）：
- `daily`：每天 `localTime`；
- `weekly`：每周指定星期几（1–7）的 `localTime`；
- `monthly`：每月指定“日”（1–31）的 `localTime`；该“日”超过当月天数时，**固定回退到当月最后一天**，不采用 RFC 5545 `SKIP=BACKWARD` 的“回退到最近有效日”语义。

时间范围：
- 以 `startAt`（绝对时刻，毫秒）作为规则生效起点；`startAt` 本身不一定是 occurrence。
- 输出未来 N 个 occurrence，默认 N=30；不得一次性展开全年或无限展开。
- 该模块不感知“错过补提醒”；补提醒由切片 5 的调度器基于实际触发记录判断。

### 4.13 DST 处理契约（v0.4）
- 模块内部不得使用 `new Date(y, m, d, h, min)` 这类依赖系统本地时区的构造方式；所有“民用时间 → 绝对时刻”的解析必须显式传入 IANA `tzid`。
- 春季时钟前拨导致的 **不存在本地时间**（gap）：该 occurrence 跳过，不向前后平移。
- 秋季时钟后拨导致的 **重复本地时间**（fold）：取较早的瞬间（第一次出现），不生成两个 occurrence。
- 时区规则以运行时 IANA 数据库为准；不得硬编码任何时区的 DST 起止日期。

### 4.14 Occurrence key 契约（v0.4）
- 每个 occurrence 必须携带 `occurrenceKey: string`，由确定性字段拼接生成，至少包含：`scheduleId`、`localDate`（YYYY-MM-DD）、`localTime`（HH:mm）、`tzid`。
- `occurrenceKey` 在规则编辑、DST 变化、重新展开后，对同一“民用时间 occurrence”必须保持不变。
- 禁止用 UTC 时间戳单独作为 occurrence 的唯一标识；UTC 时间戳会随 DST 规则或时区数据更新而变化。

### 4.15 测试时区约定（v0.4）
- 该模块的单元测试必须在显式指定 IANA 时区的上下文中运行，不得依赖开发机或 CI 的默认系统时区。
- Jest 运行该模块测试时，建议通过 `process.env.TZ` 或测试内显式 `tzid` 参数隔离时区影响；涉及 DST 的用例必须使用真实 IANA 时区标识（如 `America/New_York`），不得用固定偏移冒充时区。
- 测试文件不得修改全局时区后不恢复；如确需修改，必须在 `afterEach` / `afterAll` 中还原。

### 4.16 ReminderScheduler 接口契约（v0.5 冻结）
新增 `src/notifications/ReminderScheduler`，接口签名冻结：
- `scheduleForReminder(reminderId: string): Promise<void>`
  - 读取 Reminder + Item，若 Item 已完成/已归档或 Reminder.enabled=false，等价于 cancel；
  - 调用 `expandOccurrences({ scheduleId: reminderId, rule, startAt, tzid, count: 30 })`；
  - 过滤 `instant > now` 且 `instant <= now + 30 天` 的 occurrence；
  - 以 `occurrenceKey` 作为 notification identifier 调用 expo-notifications 的 `scheduleNotificationAsync`；
  - 已存在同 identifier 的通知不重复注册。
- `cancelForReminder(reminderId: string): Promise<void>`
  - 取消该 reminder 名下所有已调度通知；identifier 前缀为 `recurrence:v1|<encodeURIComponent(reminderId)>|`。
- `cancelAll(): Promise<void>`
  - 取消本 App 调度过的所有通知；不得取消非本 App 前缀的通知。
- `reconcile(): Promise<ReconcileResult>`
  - 幂等；可在启动、回前台、任意时刻多次调用；
  - 返回 `{ newlyScheduled: string[]; cancelled: string[]; missed: Occurrence[] }`；
  - 更新每个 Reminder 的 `lastReconciledAt`。

`ReconcileResult.missed` 为本次对账新发现的错过 occurrence；同一 occurrence 不得在后续对账中重复计入。

### 4.17 Reminder 数据模型与 schema v3（v0.5 冻结）
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

### 4.18 Repository 扩展（v0.5 冻结）
新增方法，签名冻结：
- `createReminder(input: CreateReminderInput): Promise<Reminder>`
- `updateReminder(id: string, patch: UpdateReminderInput): Promise<Reminder>`
- `deleteReminder(id: string): Promise<void>`
- `listRemindersByItem(itemId: string): Promise<Reminder[]>`
- `listEnabledReminders(): Promise<Reminder[]>`
- `markReminderReconciled(id: string, lastReconciledAt: number): Promise<void>`
- `markReminderFired(id: string, occurrenceKey: string): Promise<void>`

CreateReminderInput 不含 lastFiredOccurrenceKey / lastReconciledAt，由 Repository 初始化为 null。

### 4.19 对账与补提醒语义（v0.5 冻结）
- 对账窗口：`[lastReconciledAt ?? startAt, now]`。
- 该窗口内的 occurrence 若满足：`instant <= now` 且 `occurrenceKey > lastFiredOccurrenceKey`（按 occurrence 生成顺序比较，不按字符串字典序；实现上以“窗口内按 instant 升序取 lastFiredOccurrenceKey 之后的项”为准），计入 `missed`。
- `missed` 去重依赖 `markReminderFired`：对账报告 missed 后必须把该 reminder 的 `lastFiredOccurrenceKey` 更新为窗口内最后一个 missed occurrenceKey；同一 occurrence 不会在下次对账重复进入 missed。
- 系统已调度通知的 diff 以 `occurrenceKey` 集合为准；不比对通知的触发时间字段。
- 本切片不实现“missed 聚合通知”的 UI 展示；是否弹通知由调用方决定。调试入口可在对账后立即调用 `expo-notifications.presentNotificationAsync` 发一条聚合提示，仅用于真机验收。

### 4.20 expo-notifications 使用约束（v0.5 冻结）
- 只有 `src/notifications/` 下的文件可以 import `expo-notifications`；UI、domain、data 层不得直接 import。
- 必须在 app 入口（`app.config.*` / `app.json`）配置 expo-notifications plugin；不得依赖运行期申请权限的隐式行为。
- Android 13+ 的 POST_NOTIFICATIONS 权限必须显式申请，拒绝后必须能降级为“无通知”而不是崩溃。
- notification identifier 必须是 `occurrenceKey`，不得另造 ID；这样对账可以纯靠 identifier 前缀和集合 diff 完成。
- 单条 reminder 最多调度 30 个通知；`listEnabledReminders` 规模 × 30 若超过 500，需在 reconcile 中对最远的一批跳过并记录 warning，不得静默截断。

### 4.21 Hermes Intl polyfill（v0.5 必须处理）
- 切片 4 遗留风险：`@date-fns/tz` 依赖完整 `Intl.DateTimeFormat` 的 `timeZone` 支持；Hermes 默认不保证。
- 切片 5 必须在 app 入口最早处引入 FormatJS polyfill，至少覆盖：`Intl.DateTimeFormat`（含 `timeZone`）、`Intl.Locale`、`Intl.getCanonicalLocales`，并加载 `Asia/Shanghai`、`America/New_York` 所需 locale data。
- 该 polyfill 不得影响 Jest 环境；Jest 已有显式 tzid 隔离，polyfill 只应在 RN 入口生效。
- 真机验收必须包含一条 DST 时区的规则（建议 `America/New_York`），验证 `expandOccurrences` 在 Hermes 下的结果与 Jest 一致。

### 4.22 调试入口约定（v0.5 新增）
- 允许在 `src/app/` 下新增一个仅 `__DEV__` 可见的调试页，用于：创建/删除 reminder、手动触发 `reconcile()`、查看 `getAllScheduledNotificationsAsync()` 结果、触发一次聚合补提醒通知。
- 调试页不是正式 UI，不得被正式导航入口引用；切片 6 正式 UI 完成后可保留在 dev 菜单。
- 调试页不得绕过 Repository 直接写库。

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
8. 每个新切片必须先从最新 `main` 新建切片分支（命名 `task/slice-<编号>`，如 `task/slice-04`），不得在 `main` 上直接开发。
9. 切片验收通过后按以下顺序收尾：
   1. 在切片分支提交本切片全部改动（含任务卡、AGENTS.md 必要更新与 closeout）；
   2. `git push -u origin <切片分支>`；
   3. 切回 `main`，用 `git merge --no-ff <切片分支>` 合并；
   4. `git push origin main`。
   不得使用强制推送改写已推送历史；合并后保留切片分支以便追溯。
10. 每个切片结束必须在 `tasks/slice-<编号>-closeout.md` 提交收尾移交，至少包含：环境事实、数据库/构建事实、代码地图、踩坑教训、遗留披露。closeout 必须纳入该切片提交，不能只留在会话里。
11. 切片提交信息格式：`完成切片 N：<一句话摘要>`；closeout 可并入该提交，但必须能从 `git log` 追溯到对应切片。

## 8. 当前切片

切片 5 已完成并通过验收，收尾移交见 tasks/slice-05-closeout.md。
下一片任务卡待创建；任务卡创建前不得开始切片 6 的实现。