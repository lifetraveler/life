# AGENTS.md — 项目契约与 AI 协作规则

版本：v0.20

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


## 8. 当前切片
tasks/slice-19.md（已完成阶段 1–3 与真机验收：延迟提醒意图补全 + 默认渠道偏好 + Chip 临时编辑——schema v11（app_settings.default_channels_json）、AI 契约 reminderDelayMinutes（ai.md v0.17，prompt 判定规则节防静默丢失）、localFallback 延迟槽、savePlan 落库（now+delay*60000 生成 once + 渠道跟随默认 + 网络渠道自动取默认/第一条预设）、默认提醒方式设置页 + 表单接入 + 长按 Chip 临时改增量；真机验收 4 轮反馈全过（验收修正 5ef51d0/210c5b3）；closeout 见 tasks/slice-19-closeout.md。下一候选：网络渠道后台送达可靠性提案 docs/proposals/slice-20-network-channel-reliability.md（电池优化白名单 + 前台服务），待用户确认后按 §7.17 惯例开工）



