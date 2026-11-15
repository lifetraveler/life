# AGENTS.md — 项目契约与 AI 协作规则

版本：v0.25

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

正文已拆分至 docs/contracts/（仅迁移，语义与措辞未变）。按需加载：先读本索引，再读对应契约文件全文；摘要与正文不一致时以正文为准并报告缺陷。

| 契约文件 | 覆盖原条款 |
| --- | --- |
| docs/contracts/data-model.md | 4.1、4.4、4.6、4.10、4.17、4.23 |
| docs/contracts/repository.md | 4.2、4.5、4.7、4.8、4.9、4.18、4.24 |
| docs/contracts/recurrence.md | 4.11–4.15 |
| docs/contracts/notifications.md | 4.3、4.16、4.19–4.22、4.26 |
| docs/contracts/ui.md | 4.25、4.27–4.29 |
| docs/contracts/build-and-deps.md | 4.30（§5 构建配置约束仍在本文 §5，未迁移） |

核心不可违反项（摘要素引，正文以契约文件为准）：
- 数据只能经 Repository 访问；UI/domain 不得直接 import WatermelonDB 或 expo-notifications。
- schema 变更必须升版本并追加 migration step；不得清库、不得修改已发布 step。
- 已冻结接口签名（4.5/4.7/4.16/4.18/4.24）与冻结枚举（type；daily/weekly/monthly）不得改动。
- DST：gap 跳过不平移、fold 取较早瞬间；occurrenceKey 必须确定性，禁止纯 UTC 标识。
- Reminder tzid 白名单仅 Asia/Shanghai、America/New_York；通知 identifier 必须为 occurrenceKey。
- missed 不得用 AsyncStorage 临时凑合；§5 构建配置不得删除或“简化”。

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
12. 上下文加载规则：docs/contracts/ 下的契约文件是受保护契约的正文，AGENTS.md §4 只是索引与不可违反摘要。新会话除 §7.1 要求外：开始切片前，按任务卡涉及的范围先读对应契约文件全文（数据模型/Repository/重复规则/通知/UI/构建）；§4 摘要与契约正文出现不一致时，以契约正文为准，并把不一致作为缺陷报告，不得静默采信任一方。
### 7.13 任务卡“禁改”清单措辞
- 涉及源码冻结时，清单写“实现文件为空”，不写“目录为空”；
  测试夹具补 stub（如 FakeRepository 新增接口方法）属于编译必需，不属实现改动。
- 若某切片需要改动冻结区的实现文件，必须先出变更提案，不得借测试夹具扩展绕过。

### 7.14 切片路线（v0.8 冻结）
切片 8：ICS 导入导出 + schema v5 外部来源字段
切片 9：系统日历单向导入（Android）
切片 10：Android 桌面小组件
切片 11：可靠性切片（force-stop 后通知重排，需改 src/notifications/ 冻结区，先出变更提案）
切片 11 之前不得改 src/notifications/ 实现文件。
切片 11 为可靠性切片，开工前必须先提交变更提案并通过用户确认；提案未确认前，禁止修改 src/notifications/ 实现文件。
切片 12：搜索增强 + 已归档视图 + 数据导出 + 快速记录优化（纯功能层，不碰冻结区）

### 7.15 系统日历来源契约（v0.9，切片 9 冻结）
- sourceType 扩展为 'local' | 'ics' | 'system-calendar'。
- 系统日历导入项：sourceReadOnly=true；sourceUid 优先使用 expo-calendar 返回的 event.id；
  若 event.id 为空或不稳定，使用 (calendarId|title|startAt|endAt) 的 SHA-256 前 16 位作为 sourceUid，
  并在导入结果页标注“基于内容去重，系统事件修改后可能产生重复”。
- 系统日历导入不写回系统日历，不调用任何系统日历写入 API（无 createEvent/updateEvent/deleteEvent
  等写回调用路径）。读取权限经 expo-calendar 申请：该库 Android 读取路径（requestCalendarPermissionsAsync）
  实现为单一系统弹窗同时请求 READ_CALENDAR 与 WRITE_CALENDAR，且要求两者均授予才放行读取
  （expo-calendar 15.0.8 库实现所限，切片 9 方案 A 如实记录）；本应用自身不实现系统日历写入
  功能，除该库读取 API 附带的权限请求外不请求任何日历权限。
- allDay 归一化沿用切片 8 的 normalizeAllDayTimestamps；时区伪影（getDeviceTzid 返回 UTC）
  不在本切片修复，接受 UTC 坐标系下自洽。


  ### 7.16 Android 桌面小组件契约（v0.10，切片 10 冻结）

- 小组件方案：`react-native-android-widget`，不选 `expo-widgets`（其 Android updateTimeline 为 no-op、
  updatePeriodMillis 硬编码 0，无法满足待办小组件跨天更新需求）。
- 数据桥接：小组件进程不直接读取 WatermelonDB SQLite；App 在以下时机将“今日待办快照”序列化为
  JSON 写入 SharedPreferences（键：`widget_today_snapshot_v1`）：
  1. App 启动后；
  2. App 回前台后；
  3. Item/Reminder 数据变更后（通过切片 7 已有响应式查询的变更通知触发，不新增轮询）；
  4. 手动刷新小组件时（WIDGET_UPDATE action 内先写快照再渲染）。
- 快照内容冻结：today 分组（过期 + 已安排）的 top 5 条，每项含 id、title、type、时间标签文本、
  status；不含 content、tags、reminders 细节。allDay 项时间标签为“全天”；过期项标签为“已过期”。
- 小组件类型：一个 4x2 或 4x3 小组件，包含“今日待办列表（最多 5 条）+ 底部快速记录按钮”。
  不在 MVP 做多个小组件类型。
- 快速记录入口：点击小组件底部按钮，通过 deep link `life://quick-add` 唤起 App 的快速记录入口。
  如果 App 未运行，冷启动后导航到快速记录；如果已运行，直接前置并聚焦输入。
- 刷新机制：小组件不依赖 updatePeriodMillis；依赖 App 主动写入快照 + `requestWidgetUpdate`。
  不引入 AlarmManager 或 WorkManager 做后台定时刷新（留给后续切片）。
- 小组件点击条目：导航到对应 Item 详情页（复用切片 6 的 item/[id] 路由）。
- 不得在小组件内实现完成/取消完成操作（避免在原生侧写 DB 的跨进程复杂度）；
  完成操作仍需进入 App。
- （v0.14 阶段 7 注记，tasks/slice-14，提案 docs/proposals/slice-14-widget-phase7.md
  已确认）：top 5 → 滚动列表护栏 50（超出组件可视高度由原生 ListView 滚动浏览）；
  today 快照三段式（已安排在前、过期/待办可配置置底，开关 widgetShowOverdue/
  widgetShowTodos）；新增 widget_week_snapshot_v1（今天起 7 天按天分组）与
  widget_page_state_v1（「今日 | 周」点击页签，左右滑平台不可行）；显示配置落
  app_settings schema v7（4 个开关列）；快照条目扩 categoryColor/categoryEmoji/
  tags 最小子集，「不含 tags 细节」条款随之修订（展示与否由渲染侧读当下设置，
  快照恒携带）。

### 7.17 可靠性切片闸门（v0.11）
- 切片 11 涉及两处冻结区变更：`src/polyfill.ts` 的时区来源、`src/notifications/` 的
  reconcile 策略。
- 开工顺序固定：先写变更提案（docs/proposals/slice-11-reliability.md），
  列出影响范围、回滚方案、旧数据兼容路径，用户确认后再改实现。
- 提案未确认前，不得修改 ReminderScheduler / reconcileDiff / computeMissed /
  polyfill 四个实现文件；可以先写测试与纯函数草案，但不得合入。
- 两处变更必须分两次提交：先时区、后通知。不得混在一个 commit 里，便于独立回滚。

### 7.18 搜索与数据导出约束（v0.12）
- WatermelonDB 不引入 FTS5；搜索继续保持 LIKE 语义（切片 3 契约不变）。
  搜索增强只做 UI 层与查询范围扩展，不改变匹配方式。
- 数据导出复用切片 8 的 expo-file-system + expo-sharing 基础设施；
  不新增原生依赖，不修改 package.json 的 native 依赖。
- 快速记录增强不修改 quick-add 路由的 deep link 约定（`life://quick-add`），
  只增加输入后行为（如保存后留在输入框、支持连续创建）。
- （v0.14 阶段 5 注记，tasks/slice-14）内嵌录入框移除后，quick-add 落点改为
  全屏新建页 `item/new`；上条「输入后行为」条款随之失效，deep link 约定不变，
  详见 docs/contracts/ui.md「快速记录落点（v0.14，切片 14 阶段 5）」。

### 7.20 鸿蒙评估切片（v0.13）
- 切片 13 为纯文档评估，不修改任何源码、不升级 SDK、不引入鸿蒙依赖。
- 产出报告：docs/proposals/harmony-assessment.md。
- 评估结论将决定后续是否投入资源做鸿蒙原生适配。

### 7.21 UI 视图架构与筛选（v0.14）
- 首页支持切换视图：日程（Agenda，图3风格）、周（今日起 7 天滑动窗口）、月（富月历）、日（单日时间轴）。
  切片 14 阶段 5b 起收敛为 4 视图，「今日」视图选项移除（/today、/week 独立页面契约不变）。
- 视图内必须按日期分组（如“周五 6”、“周六 7”）。
- 筛选面板支持按“分类（Category）”、“日历源（sourceType）”、“标签（Tag）”、“状态”进行多选过滤，并承载视图切换（点选即时生效）。
- 小组件展示信息需包含：分类颜色点、具体时间。

### 7.22 Item、Category、Tag 扩展字段及 schema v6（v0.14）
schema 版本 5→6，新增/修改如下：
1. `items` 表：
   - 新增 `categoryId: string | null`（关联 categories 表，默认 'other'）
   - 新增 `priority: number`（默认 0；0=无，1=低，2=中，3=高）
   - **注意**：Item 本身不再有 color 字段，颜色统一由 Category 提供。
2. `categories` 表（新增）：
   - `id: string`（主键，预置：'work', 'personal', 'study', 'health', 'other'）
   - `name: string`（分类名称）
   - `color: string | null`（分类颜色）
   - `emoji: string | null`（分类图标）
   - `priority: number`（展示排序权重）
3. `tags` 表：
   - 新增 `color: string | null`
   - 新增 `emoji: string | null`
4. 新增 `app_settings` 表（单行，id 固定为 'global'）：
   - `tagDisplayMode: 'text' | 'emoji' | 'both'`（默认 'text'）
- 必须提供 migration v5→v6：新增表和字段，并插入预置分类数据。严禁重建表或清库。

### 7.23 关系水合与模型查询（v0.14）
- `WatermelonItemRepository` 的查询必须水合（Hydrate）关联的 Category 和 Tags。
- 领域对象扩展为 `ItemWithRelations = Item & { tags: Tag[], category: Category | null }`。
- 视图和 UI 层只消费 `ItemWithRelations`，不得在 UI 层自己去查 Category 或 Tag 表。

### 7.24 AI 解析层与 Provider 架构（v0.15）
- 闪电添加（AI 解析）的接口必须抽象为 `AiParser`。
- 架构必须支持：用户自定义 API Key（兼容 OpenAI/DeepSeek 等），并为未来的官方代理服务预留 Provider。
- 降级机制：当无 Key 或断网时，必须触发 `LocalFallbackProvider`，仅用本地正则提取基础时间（如“明天”、“下午3点”）。
- 安全隐私：API Key 必须存储在 `expo-secure-store` 中，严禁明文写入 WatermelonDB。
- 结构约束：AI 返回的 JSON 必须经过严格的类型守卫（如手写 `isParsedItemDraft` 或使用 Zod）校验，通过后才允许转成内部模型，严禁直接 `as` 强转。

### 7.25 闪电添加 UI 交互（v0.15）
- 路由挂载在 `src/app/(tabs)/flash.tsx`（即点击底部闪电 Tab）。
- 交互模式：Chat UI + 结构化卡片。
- 用户输入自然语言后，AI 返回一张“预览卡片”（展示标题、时间、分类、标签等）。
- 用户可直接点击卡片修改字段，或在底部输入框继续对话纠正（如“改成明天”），AI 更新卡片。
- 点击“确认保存”后，才调用 `Repository.createItem` 及 `createReminder` 落库。


### 7.26 提醒能力升级（一次性 + 多渠道）（v0.16）
- 遵循变更提案 `docs/proposals/slice-16-reminder-channels.md`。
- **模型扩展**：Reminder 新增 `once` 频率，时间存为 `once_civil_json`（单列 JSON，存 `{year,month,day,hour,minute}`）。
- **渠道扩展**：Reminder 新增 `channel` (system-notification / alarm / webhook / apprise) 和 `channel_config` (JSON 字符串)。
- **冻结区解禁**：本切片经用户授权，允许修改 `src/notifications/` 实现文件，以支持渠道抽象（ReminderChannel 接口）。
- **渠道实现约束**：
  1. 闹钟渠道：采用 expo-notifications 的高优先级全屏通知模拟，不引入原生 Schedule Exact Alarm 模块。
  2. Webhook/Apprise 渠道：前台直接 fetch，不引入后台常驻任务。UI 必须注明“仅 App 存活时保证推送”。
  3. 若开启多渠道，本地系统通知和网络推送可同时触发（互不干扰）。

### 7.27 提醒渠道配置中心（v0.17）
- 允许将 Webhook/Apprise 的常用配置抽取到全局（`app_settings` 或新表 `channel_presets`），在详情页只做选择，不强迫用户每次输入长 URL。
- Webhook 载荷适配：支持模板配置，允许适配如 Zulip、企业微信、钉钉等特定格式（在 JSON 外包装特定的 key，或支持纯文本 POST）。

### 7.28 交互打磨与导入预览（v0.17）
- **once 时间录入**：废弃手输格式，必须使用日期/时间 Picker，且提供“+10分钟/+1小时”等快捷 Chips，确保生成的 `{year,month,day,hour,minute}` 必定合法（拦截 02-30）。
- **导入预览**：ICS 和系统日历导入时必须先进入预览页，展示解析结果，默认勾选新增项，确认后才落库。

### 7.29 多渠道并行与偏好设置（v0.18）
- **多渠道同开**：一个 Reminder 可同时配置多个通知渠道（如既发系统通知，又发 Webhook）。Reminder 模型升级为 `channels: string[]` 和 `channel_configs: Record<string, string>`（或等价结构）。需经变更提案确认。
- **Chips 增量持久化**：onceAt 的快捷增量（默认 +10m/+1h）允许用户在 App 设置中修改，存入 `app_settings`。
- **渠道预设默认值**：`channel_presets` 表增加 `is_default` 字段，详情页表单默认选中默认预设。
- **Schema v10 迁移**：完成上述模型变更，旧数据平滑升级（单渠道转多渠道路径兼容）。

### 7.30 延迟提醒意图与默认渠道（v0.19）
- **延迟提醒（Delay Reminder）**：AI 解析层与本地降级层必须支持 `reminderDelayMinutes`（相对当前时刻 X 分钟后提醒）。Prompt 中必须给出该字段的明确示例与边界。落库时若存在该字段且 `recurrence` 为空，直接以 `now + delay` 为触发时刻创建 once 提醒（无需 startAt）。
- **默认渠道偏好**：`app_settings` 新增 `default_channels_json`（JSON 数组，默认 `["system-notification"]`）。必须遵守 expo 家族互斥校验。
- **Chip 临时编辑**：once 表单的长按快捷 Chip，允许临时修改增量值，仅本次生效，不持久化覆盖全局设置。
- **Schema v11**：完成 `app_settings` 的 addColumns 迁移，旧数据默认回退。

### 7.31 网络渠道后台可靠性（v0.20）
- 遵循提案 `docs/proposals/slice-20-network-channel-reliability.md`。
- **电池优化白名单**：在 Android 上，允许用户申请忽略电池优化，以保障网络渠道（Webhook/Apprise）的 `setTimeout` 定时器在后台存活。
- **原生配置**：在 AndroidManifest 中声明 `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 权限。
- **UI 引导**：在“我的 -> 设置”页面增加“后台运行权限”入口，展示当前白名单状态，并提供一键跳转系统设置或直接唤起系统弹窗的能力。
- **约束**：本切片仅解决“系统由于省电策略杀进程”的问题，不引入 WorkManager 或前台服务（Foreground Service），不改变“App 进程存活则保证送达”的核心边界。

### 7.32 界面体验修补（v0.21）
- **Safe Area**：所有通过 Tab 挂载的页面（特别是 `flash.tsx` 聊天页），顶部必须使用 `useSafeAreaInsets()` 增加 padding，避免被系统状态栏遮挡。
- **高分屏响应**：包含横向多选项的 Chip 容器（如提醒渠道），必须使用 `flexWrap` 和自适应宽度，禁止强行使用 `flex: 1` 导致文字折行或截断。
- **空态引导**：日程视图（Agenda）在“今天”无数据时，必须展示空态卡与“快速安排”按钮，并打通 deep link 跳转。
  （v0.21 注记，切片 21 修补：按钮移除——右下角 FAB 已是常驻新建入口，空态卡仅保留文案提示；FAB 长按跳转闪电录入 tab，短按仍新建条目 /item/new）
- **网络渠道防重发**：在并发补发和 reconcile 时，必须增加 in-flight 状态防重，避免同一 occurrenceKey 发生双发。

### 7.33 阶段反馈总结文件惯例（v0.22 成文，v0.23 修订适用时机）
- **定位**：阶段反馈总结文件（`tasks/slice-NN-phaseM-feedback.md`，沿 slice-14 phase1–5 / slice-16 phase1–2 / slice-17 phase1 / slice-21 phase1 惯例；无 fallback 变体命名）用于**切片不是一口气做完**的场合——在暂停点移交状态，供下一会话/下一阶段接续。按完成节奏三选一：
  1. 切片**全部阶段一次连续完成** → **不写**阶段反馈文件，成果直接在 closeout 总结（阶段粒度内容由 closeout 交付清单/代码地图承载）；
  2. **一次连续完成了部分阶段（两个及以上）后暂停** → 写**一份**阶段反馈文件覆盖这批阶段，头部明确记录「完成了哪几个阶段」（如 Phase 2–3 / 共 4），并逐阶段给出提交 hash 与验收结果；
  3. **单个阶段完成后暂停等待下一阶段** → 按阶段写 phaseM-feedback。
- 结构（多阶段合并时按阶段分小节，各小节内容对应该阶段）：
  1. 头部：日期、阶段范围（Phase M[-K] / 共 N + 一句话）、分支（基点 main @ hash）、各阶段提交（hash + 文件数/增删行 + 一句话）、状态（完成/暂停等待下一阶段 + 遗留项）；
  2. 成果定性表：tsc、jest（套件/用例数，含基线对照）、expo-doctor（对照预存基线失败）、真机/模拟器验收、（如已交付）APK 版本号；
  3. 范围落点表：文件 → 修补 → 解决的问题；
  4. 关键设计落点（后续阶段/切片的消费面）；
  5. 真机验收清单 + 装真机核对点（如适用）；
  6. 教训索引（指向 closeout 对应小节，不整段复制）。
- 真机反馈修补若发生在阶段之间，在所属 UI/功能阶段的总结里记录演化（如 slice-21-phase1）。
- 提交纪律：反馈文件必须纳入 git 提交（阶段提交，或收尾时 docs(sNN) 补充提交），不得只留在会话里；写了的反馈文件在切片收尾时在 closeout §0 交付清单引用；收尾前按适用时机核对——该写的没写要补齐，「全部阶段一口气完成」的确认 closeout 已完整承载阶段粒度内容。
- 版本：v0.22 成文；v0.23 按 2026-11-15 用户澄清修订适用时机（一口气全完成 → closeout 即可；一次完成多个阶段 → 一份反馈文件记录完成的阶段集合；阶段反馈本质是「未做完切片」的暂停移交）。

### 7.34 闪电录入结果卡片化与快捷操作（v0.24）
- **消息类型扩展**：闪电录入的 Chat 消息列表中，成功保存后的 AI 回复不再使用纯文本，而是新增 `kind: 'card'` 类型的消息载荷。该载荷应包含展示所需的快照数据（如 Item 摘要、分类色、时间、提醒）。
- **卡片内容**：必须展示分类色条（含 Emoji）、标题、日期行（含具体时间）、提醒行（若配置了提醒）。
- **点击去向**：点击卡片主体，导航至该条目的详情页（`item/[id]`）。
- **快捷延迟操作**：若条目包含具体时间（非 allDay，非无时间待办），卡片底部展示「+15分钟」和「+1小时」快捷 Chips。
- **联动更新规则**：点击快捷推迟后，不仅更新 Item 的 `startAt`，如果该 Item 绑定了 `once` 类型的提醒，**必须同步顺延该提醒的 `onceAt`**。
- **约束**：本切片只做 UI 状态机和数据更新，不得触碰 `src/notifications/` 底层的调度与投递逻辑；无需新增第三方 UI 依赖。

## 8. 当前切片
tasks/slice-22.md（已完成阶段 1–4 全部：闪电录入结果卡片化、快捷推迟与「修改成X点」编辑窄规则。准备 commit 78f02c0——任务卡 + §7.34 成文（v0.24）；阶段 1 commit 02444a0——ChatMessage 加可选 kind:'text'|'card'/cardPayload（非判别联合，既有构造点 chat.ts historyAppend 零改动）+ FlashCardCategory/Reminder/Payload 快照三接口 + buildFlashCardPayload 纯函数（src/domain/ai/cardPayload.ts 新：timePatch 落库终值透传、weekdays/onceAt 防御拷贝、categoryId 未命中→category null）+ useFlashChat pushCard/categoriesRef 兜底/confirmSave 保存成功出卡（reminderNotice≠null 补纯文本，Alert 行为不变）+ docs/contracts/ai.md v0.18 变更记录 + 单测 6 用例；阶段 2 commit 88fa7b2——FlashResultCard.tsx（新：左 4px 分类色条 fallback 灰/分类行 emoji+名/标题 17-700 两行/📅 行 formatAgendaTimeRange/🔔 行 formatReminderRuleSummary 现算/推迟 chips 占位/maxWidth 320，describeCardDate/describeCardTimeLine 纯函数导出）+ flash.tsx kind==='card'&&cardPayload!==undefined 分支渲染 + useRouter 点卡跳 /item/[id]；塌缩缺陷修复 61cc489——cardRow wrapper flexDirection:'row' 内 flex:1 body 塌缩 0 宽只剩色条，卡片直接作 FlatList 单元勿套水平容器（教训入 closeout）；版本 4f710f0——0.22.0/versionCode 3（MuMu 误装 0.1.0 旧包排查后提升 build.gradle L95-96 + app.json L5）；阶段 3（用户 2026-11-15 确认折叠问题 2 窄规则，任务卡范围注记）commit 59876aa——postpone.ts（computePostponedStartAt 绝对毫秒平移天然 DST 安全；computePostponedOnceAt 经 resolveCivilTimeToInstant→+Δ→getZonedParts 民用归位，解析失败 null 跳过联动）+ editIntent.ts（编辑窄规则：EDIT_VERB_PATTERN 动宾短语后紧跟时间 token 才判定防误伤「修改简历下午3点」、parseEditTimeRequest 半点/午别/全角数字、resolveEditStartAt dayShift 相对今天经 civilAddDays（addOneDay 逐日，不改 recurrence/）民用日算术、时刻缺省保目标时刻日期缺省保目标日期、gap→null）+ postpone.test 8/editIntent.test 33 用例；commit 8461034——useFlashChat postponeCard（updateItemTime startAt+Δ、endAt 有值同 Δ 保时长；shiftOnceReminders once 提醒 updateReminder({onceAt}) 联动顺延 Map 收集；reconcile catch warn；updateCard 原地刷新含 reminder 快照）+ send() 编辑路径（草稿→改草稿请核对卡片；最近结果卡→改时间+「已改为」文案+history 追加；失败/不适用引导文案不落回解析）+ messagesRef 镜像/getLastCardPayload/patchReminderSnapshot + flash.tsx onPostpone 接通 chips。验证：tsc 0 错、jest 74 套件/973 用例全过（切片前基线 71/926）、expo-doctor 2 项预存基线失败无新增、无 as any、src/notifications/ 与 src/domain/recurrence/ 零 diff、无新依赖。MuMu 实测（0.22.0/versionCode 3，a11y dump+截图驱动）：保存出卡（15:00/14:50）✓、点卡跳详情 ✓、+15分钟→卡片 15:15 提醒 15:05 原地刷新 ✓、「修改成7点半吧」→卡片 07:30 提醒 07:20「已改为 2026-11-16 07:30」未建新事项 ✓、详情页 DB 真值 startAt 07:30/onceAt 07:20/上次对账 15:02 ✓；真机清单 3/4/5（allDay 卡「全天」无 chips/无时间待办无日期行/保存失败纯文本不出卡，均有单测覆盖）与两条 once 提醒（11-16 07:20、14:50）实际触发留用户观察；测试条目「开周会」×2 暂留 MuMu 兼作触发素材，不需要时详情页删除。反馈文件 tasks/slice-22-phase1-2-feedback.md（Phase 1–3/共 4：Phase 1–2 曾暂停移交、Phase 3 续作后终态更新）；closeout 见 tasks/slice-22-closeout.md。**push/merge 收尾已完成：closeout 提交时网络曾不可达（Connection was reset），恢复后已按 §7.9 补 push -u origin task/slice-22 → 切 main merge --no-ff（merge commit 7a47187）→ push origin main（076d291..7a47187），分支 task/slice-22 保留。下一候选：闪电录入解析澄清与渠道建议切片提案（问题 1：AI 判断提醒方式建议+询问交互、远端路径编辑意图，含 ai.md 契约变更；用户确认紧随 slice-22）→ slice-23 夜间模式 → slice-24 数据备份 JSON+WebDAV【提案先行】；变更B 网络渠道后台送达为插队候选，确认前不修改 src/notifications/ 实现文件；开工按 §7.1 逐切片确认）



