# AGENTS.md — 项目契约与 AI 协作规则

版本：v0.43（v0.40 历史条款精简为冻结要点+指针，原文存档 docs/agents-history.md）

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
- 版本号策略（v0.42 注记，用户 2026-11-23 定案）：android `versionCode` = 切片号、
  `versionName` = `0.<切片号>.0`，随切片真机出包 bump；`app.json` 的 `version` 与
  build.gradle `versionName` 保持一致。溯源：切片 23 曾 bump 至 v10，切片 24–36 期间
  仅 `adb install -r` 覆盖安装未 bump（跨 13 片停在同一版本号，closeout 曾披露），
  自切片 36 出包 0.36.0/v36 起恢复随片对齐。

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
- sourceType 扩展 'system-calendar'：导入项 sourceReadOnly=true；sourceUid 优先 expo-calendar event.id，
  空/不稳定 → (calendarId|title|startAt|endAt) SHA-256 前 16 位，导入结果页标注「基于内容去重，
  系统事件修改后可能产生重复」。
- 冻结：不写回系统日历、不调用任何系统日历写入 API；日历权限仅经 expo-calendar 读取 API
  （库实现单一弹窗同时请求 READ_CALENDAR 与 WRITE_CALENDAR，15.0.8 所限，切片 9 方案 A 如实记录）。
- allDay 归一化沿用切片 8 normalizeAllDayTimestamps；时区伪影（getDeviceTzid 返回 UTC）不在导入侧修复，
  接受 UTC 坐标系自洽。
- 细节：tasks/slice-9-closeout.md；原文：docs/agents-history.md §7.15。

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

### 7.17 可靠性切片闸门（v0.11，切片 11 已完成）
- src/polyfill.ts 时区来源与 src/notifications/ reconcile 变更经提案 docs/proposals/slice-11-reliability.md
  确认后实施，时区/通知分两次提交（独立回滚）。闸门已履行完毕；后续改冻结区仍按 §7.5 变更提案流程。

### 7.18 搜索与数据导出约束（v0.12）
- 冻结：WatermelonDB 不引入 FTS5，搜索保持 LIKE 语义（切片 3 契约）；增强只做 UI 层与查询范围扩展。
- 数据导出复用切片 8 expo-file-system + expo-sharing；不新增原生依赖、不改 package.json native 依赖。
- quick-add deep link `life://quick-add` 不变；落点为全屏新建页 item/new（切片 14 阶段 5 起内嵌录入框
  已移除，详见 docs/contracts/ui.md「快速记录落点」）。

### 7.20 鸿蒙评估切片（v0.13，已完成）
- 纯文档评估，未改源码/未升 SDK；结论见 docs/proposals/harmony-assessment.md。

### 7.21 UI 视图架构与筛选（v0.14）
- 首页四视图：日程 Agenda / 周（今日起 7 天）/ 月（富月历）/ 日（时间轴）；「今日」视图选项已移除
  （切片 14 阶段 5b；/today、/week 独立页面契约不变）。视图内按日期分组。
- 筛选面板承载多选过滤（分类/日历源/标签/状态）+ 视图切换，点选即时生效。
- 小组件展示需含分类颜色点与具体时间。

### 7.22 Item、Category、Tag 扩展字段及 schema v6（v0.14）
- schema v5→v6：items 加 categoryId/priority（颜色统一由 Category 提供，Item 无 color 字段）；
  新增 categories（预置 work/personal/study/health/other）；tags 加 color/emoji；
  新增 app_settings 单行（id='global'，tagDisplayMode）。migration 严禁重建表/清库。
- 字段权威定义以 src/db/schema.ts 为准。

### 7.23 关系水合与模型查询（v0.14）
- WatermelonItemRepository 查询必须水合关联；领域对象 ItemWithRelations = Item & {tags, category | null}；
  UI 只消费 ItemWithRelations，不得自行查 Category/Tag 表。

### 7.24 AI 解析层与 Provider 架构（v0.15）
- 接口抽象 AiParser（parse 冻结签名）；支持用户自定义 API Key（OpenAI/DeepSeek 兼容），官方代理预留。
- 降级：无 Key/断网 → LocalFallbackProvider（本地正则提取基础时间）。
- 安全：API Key 只存 expo-secure-store，严禁明文写入 WatermelonDB。
- AI 返回 JSON 必须过严格类型守卫（手写 guard），严禁直接 as 强转。

### 7.25 闪电添加 UI 交互（v0.15）
- 路由 src/app/(tabs)/flash.tsx（底部闪电 Tab）；Chat UI + 结构化预览卡；卡片可点改字段、输入框继续
  对话纠正；「确认保存」才调 Repository.createItem/createReminder 落库。

### 7.26 提醒能力升级（一次性 + 多渠道）（v0.16）
- Reminder 加 once 频率（once_civil_json 单列 {year,month,day,hour,minute}）与渠道 channel/
  channel_config；渠道抽象 ReminderChannel（本切片经授权改 src/notifications/）。
- 闹钟渠道 = expo-notifications 高优先级全屏通知模拟（不引原生 Schedule Exact Alarm 模块）；
  webhook/apprise = 前台直接 fetch（不引后台常驻任务），UI 注明「仅 App 存活时保证推送」；
  多渠道可同开互不干扰。

### 7.27 提醒渠道配置中心（v0.17）
- webhook/apprise 常用配置抽到 channel_presets 全局表，详情页只做选择；webhook 载荷支持模板配置
  （适配 Zulip/企业微信/钉钉：JSON 外包装特定 key 或纯文本 POST）。

### 7.28 交互打磨与导入预览（v0.17）
- once 时间录入必须日期/时间 Picker + 快捷 Chips（+10m/+1h），生成的 {year,month,day,hour,minute}
  必定合法（拦截 02-30）。
- ICS/系统日历导入必须先进预览页（默认勾选新增项，确认后才落库）。

### 7.29 多渠道并行与偏好设置（v0.18）
- Reminder 升级 channels: string[] + channel_configs（schema v10 迁移，单渠道转多渠道路径兼容）。
- chips 增量持久化入 app_settings；channel_presets 加 is_default（详情页表单默认选中）。

### 7.30 延迟提醒意图与默认渠道（v0.19）
- reminderDelayMinutes：相对当前时刻 X 分钟后提醒；落库时存在该字段且 recurrence 为空 → 直接以
  now+delay 创建 once 提醒（无需 startAt）。Prompt 必须给出该字段明确示例与边界。
- app_settings default_channels_json（默认 ["system-notification"]），遵守 expo 家族互斥校验。
- Chip 临时编辑仅本次生效不覆盖全局；schema v11。

### 7.31 网络渠道后台可靠性（v0.20）
- Android 电池优化白名单申请（REQUEST_IGNORE_BATTERY_OPTIMIZATIONS 权限）+ 设置页「后台运行权限」
  入口（状态展示+一键跳系统设置/直接唤起弹窗）。
- 约束：仅解决省电策略杀进程，不引 WorkManager/前台服务，不改「App 进程存活则保证送达」边界。

### 7.32 界面体验修补（v0.21）
- Tab 挂载页（特别是 flash.tsx）顶部必须 useSafeAreaInsets() 增 padding，防状态栏遮挡。
- 横向多选项 Chip 容器必须 flexWrap + 自适应宽度，禁强行 flex:1 导致折行截断。
- Agenda 空态卡仅保留文案提示（FAB 已是常驻新建入口：短按新建 /item/new，长按跳闪电录入 tab）。
- 网络渠道并发补发与 reconcile 必须加 in-flight 防重，避免同 occurrenceKey 双发。

### 7.33 阶段反馈总结文件惯例（v0.22 成文，v0.23 修订适用时机）
- 定位：tasks/slice-NN-phaseM-feedback.md 用于切片未一口气做完的暂停点移交（无 fallback 变体命名）。
  完成节奏三选一：① 全部阶段一次连续完成 → 不写，成果直接进 closeout（阶段粒度由 closeout 交付
  清单/代码地图承载）；② 一次连续完成两个及以上阶段后暂停 → 写一份覆盖这批阶段（头部记录完成的
  阶段集合，逐阶段提交 hash 与验收结果）；③ 单个阶段完成后暂停 → 按阶段写 phaseM-feedback。
- 结构：头部（日期/阶段范围/分支基点/各阶段提交/状态）→ 成果定性表（tsc/jest 基线对照/expo-doctor/
  真机/APK）→ 范围落点表 → 关键设计落点 → 真机验收清单 → 教训索引（指向 closeout 对应小节，
  不整段复制）。真机反馈修补发生在阶段之间的，记录在所属 UI/功能阶段的总结里。
- 提交纪律：反馈文件必须纳入 git 提交（阶段提交或收尾 docs(sNN) 补充提交）；收尾时在 closeout §0
  引用；「一口气全完成」时核对 closeout 已完整承载即可。

### 7.34 闪电录入结果卡片化与快捷操作（v0.24）
- 保存成功后 AI 回复用 kind:'card' 消息载荷（Item 摘要/分类色/时间/提醒快照）；卡片必须展示分类色条
  （含 Emoji）、标题、日期行（含具体时间）、提醒行（若配置）；点击卡片主体导航 item/[id]。
- 快捷推迟 chips（+15m/+1h）：更新 startAt 时必须同步顺延绑定 once 提醒的 onceAt。
- 约束：只做 UI 状态机与数据更新，不碰 src/notifications/ 调度投递逻辑；无新第三方 UI 依赖。

### 7.35 AI 澄清与渠道智能推荐（v0.25）
- 强提醒场景（起床/吃药/开会/抢购）识别：用户未明确指定时自动用 alarm 渠道；普通提醒不带渠道字段，
  落库走全局默认渠道。
- 主动澄清：输入含动作但缺关键属性且无其他可推断语义 → 不落库，返回 clarification 状态 + 提示文本，
  允许快速回复补充；带完整时刻的叫醒类输入（「明天上午8点叫我」）不反问，默认事由直接出卡
  （v0.25 切片 23 修订）。
- 远端支持上下文编辑（history 摘要块承载上一张卡）；本地降级补全「叫我起床/响铃」→ once + alarm。

### 7.36 主题与视觉规范（v0.26）
- src/ui/theme.ts 全局颜色 Token（背景/卡片/主次文字/边框/危险色）；所有页面与组件必须用 Token 或
  useColorScheme() 适配深浅色，禁止硬编码十六进制颜色；深色模式对比度达标；StatusBar 跟随主题。

### 7.37 闪电录入认真模式（v0.27）
- app_settings careful_mode（默认 false），schema v11→v12 addColumns；profile.tsx AI 配置区块开关，
  即时生效重启保持。
- 拦截范围冻结：仅拦「编辑意图导致 title 或 content 变化」的轮次；时间/提醒/渠道/标签修改与全新
  建卡不拦，按默认模式处理（与切片 24 行为一致）。
- 交互：拦截轮不出新卡、草稿保持旧状态，Chat 追加 kind:'confirm'（含拟改字段摘要与新值）+ 快捷
  选项（应用/放弃）；title 与 content 同轮双改合并一条；选项点击本地处理不发起 AI 轮次；待确认
  期间任何新输入取消待确认按普通轮处理。
- 实现边界：守卫在 useFlashChat 层（对比上一张展示卡与本轮解析结果）；AiParser.parse 冻结签名不动，
  ai.md 零改动。域规则（切片 25）：标题保护仅适用编辑词轮与澄清续答轮（与 inheritTags 同谓词）；
  全新意图不复用上一张卡标题。

### 7.38 AI 透明度（v0.28；v0.29/v0.30 注记，切片 26）
- 提示词查看：设置页只读展示 AI_SYSTEM_PROMPT（src/domain/ai/prompt.ts 静态规则串）；动态拼接
  （时间事实/多轮摘要）不展示且页面注明；只读，不提供编辑/复制/导出。
- 用量展示：app_settings show_ai_usage（默认 false，schema v13）；开启后远端轮 AI 回复尾追加用量行
  （输入/输出 tokens、缓存命中、估算费用，段缺失自动省略）；本地降级轮无 usage 不展示。
- usage 传输边界（冻结）：usage 取自 chat-completions 信封（非模型 JSON），经 provider lastUsage
  副通道 + FlashTurnResult 域内字段携带；不进 ParsedItemDraft、不进 history JSON、不触碰
  RemoteDraftWire/isRemoteDraftWire；AiParser.parse 冻结签名与返回类型不变。
- 单价与平台：AiProviderConfig priceInputPerMillion/priceOutputPerMillion（正数有效留空不估算；
  全价上界不区分缓存折扣）。platform 槽模型（v0.30）：AiConfig.slots 每平台独立配置 +
  activePlatform，active 恒等 slots[activePlatform]；UI「保存即激活」（平台 chips 点选仅切换编辑视图）。
  platform==='deepseek' 估算走 isPeakBeijing（北京时间周一至五 9–12/14–18 高峰）+
  readAiUsageSnapshotTiered（输入段拆缓存命中/未命中逐段取价）；其余平台全价上界两价。已知限制：
  法定节假日不做识别（按高峰计，误差方向高估），backlog 候选。AI_PLATFORM_PRESETS 预设表
  （deepseek/volcano/bailian/xiaomi/custom，集合外丢弃为 undefined 等价 custom，不整包拒绝）。

### 7.39 系统日历 live 直读显示（v0.31）
- 方案 C live 直读（不落库）：选中系统日历的事件实时合并进四视图渲染。开关 app_settings
  display_calendar_ids_json（isOptional，空/缺省=功能关闭，schema v14）；入口=计划页筛选面板
  「日历显示」区（按账户分组 + 色点 + 显隐开关；取消独立设置页，权限拒绝态与说明文案在面板区底）。
  SystemCalendarReader.getCalendars 扩 color/sourceName（端口契约外显式扩展先例）。
- 数据流：SystemCalendarReader.getEvents + filterEventsInRange（窗口外扩沿用）；刷新=窗口变化防抖 +
  AppState 回前台 + useFocusEffect，不做后台轮询。live 事件经合成视图条目在「filterItems 之后、
  分组/布局之前」并入（筛选谓词与分组逻辑零改动），渲染日历色条 + 只读徽标 + sourceName，
  点击只读弹层。
- 冻结：live 事件不落库、不参与提醒调度/搜索/筛选谓词/小组件快照/闪电录入/ICS 与数据导出；
  不调用任何系统日历写入 API（§7.15 不变）。重叠去重：live 事件隐藏 ⟺ 存在 sourceType=
  'system-calendar' 已导入项 sourceUid 相同且 startAt 相同（resolveSystemEventSourceUid 复用）。
  写回（D1）如立项须独立变更提案修订 §7.15「不写回」与 repository.md 冻结语义。

### 7.40 闪电录入对话能力强化（v0.32）
- 口语纠正短句（prompt 成文）：history/摘要块存在时，不含新事由名词的短纠正句（仅时间/属性修正 +
  语气结构）默认视为对上一张卡的编辑（以摘要为基准修正被提及字段、其余照抄禁止新建）；含新事由
  名词的短句仍为全新意图照常新建（反向边界防误伤）。
- 本地兜底否决：本地降级不做编辑意图兜底改写（远端 prompt 为主路径）；editIntent.ts 窄规则不扩展。
- 推迟语义（prompt 成文）：「推迟/延后 X 分钟」=以上一张卡摘要当前时间为基准平移；「X 分钟后」=
  以说话时刻为基准（reminderDelayMinutes 语义不变）；两者可同现互不覆盖；禁止把原文写入
  title/content。
- 保存后 history 播种：保存时播种本次草稿 JSON（serializeDraftForHistory 格式）替代清空；摘要块
  保存后仍存在；「每存一张=新对话」设计不变（不携带更早对话）。
- 历史结果卡视觉区分：聊天列表最后一条 kind:'card'=当前卡，其余降透明度 + 「历史」角标
  （FlashResultCard historical prop）；历史卡快捷推迟 chips 保留可用；ChatMessage kind 不新增。

### 7.41 草稿放弃、已删除卡联动与 AI 重试（v0.33，切片 30）
- 草稿放弃：第三条本地操作「放弃」——原地置灰 + 「已放弃」角标，清空当前草稿与待确认；不落库、
  不播种 history，下一轮按全新意图处理。
- 已删除条目联动：卡对应条目被删后标记已删除（置灰+角标+点击禁用+chips 隐藏）或移除，由
  flash_deleted_card_display 枚举配置（默认 'mark'，读层回退）；存在性查询经 Repository 只读批量
  扩展（端口外显式扩展先例），useFocusEffect 批量查询不轮询；card 消息内存态重启清空。
- AI 服务重试：可重试=网络错误/超时/5xx/429/响应 JSON 解析失败；不可重试=401/403/400 立即降级；
  固定间隔 1000ms 不做指数退避；次数 ai_retry_max（0–5 整数，UI 档 0/1/3/5，0=关闭，默认 3，越界
  回退 3）；重试提示「AI 服务异常，正在重试（n/N）…」即时展示不留历史；耗尽披露「（已重试 N 次）」
  仅实际重试过才带；usage 只报成功轮。schema v15 两列（ai_retry_max number / flash_deleted_card_display
  string 均 isOptional，读层回退默认）。

### 7.42 配置备份 WebDAV（v0.34，切片 28）
- 范围冻结：仅配置备份——app_settings 全字段 + categories（预置 5 条）+ tags；快照
  {version:1, kind:'config', exportedAt, appSettings, categories, tags}（isConfigSnapshotWire 整包
  拒绝、条目级宽容跳过+计数披露）。数据备份与双向同步留切片 31/35。
- 连接配置（baseUrl/basePath/username/password）存 SecureStore 独立键 webdav_backup_config_v1，
  不入 app_settings、不入快照（恢复全列覆盖 app_settings 的自引用防护）。
- 恢复语义（冻结）：增量覆盖——appSettings 全列覆盖（快照缺列保留本地）；categories 按 id 命中
  覆盖/未命中保留；tags 按 name（trim+大小写不敏感归一）命中覆盖/未命中创建/本地独有保留；
  单 writer 事务原子完成；不做恢复前本地兜底快照。
- WebDAV：自写 fetch 客户端（PROPFIND/GET/PUT/MKCOL/DELETE，Basic Auth，15s AbortController 超时，
  零新依赖）；life-config-YYYYMMDD-HHmmss.json 上传后滚动保留最近 10 份（删除失败仅披露）；
  仅手动触发；全量明文（快照不含 API Key/channel_presets 等凭据面）。
- Repository 扩展 createConfigSnapshot/applyConfigSnapshot 契约外显式扩展成对（repository.md 注记节，
  冻结签名零 diff）。

### 7.43 数据备份 WebDAV（v0.35，切片 31）
- 数据快照六块：items（全字段）+ tags（含 id）+ reminders（v10 语义列全量，不含调度态
  last_fired_occurrence_key/last_reconciled_at 与 deprecated channel/channel_config）+
  channel_presets（进快照，config_json 明文上云知情）+ itemTags join 依据；格式
  {version:1, kind:'data', exportedAt, items, tags, reminders, channelPresets, itemTags}
  （isDataSnapshotWire 整包拒绝+条目级 skipped 计数披露）；独立 life-data-*.json 滚动 10 份，
  与 config 互不相认。
- id 保真与恢复语义（冻结）：新建行 _raw.id 写快照 id、created_at/updated_at 经 _raw 保真；
  items 按 id 命中覆盖/未命中创建/本地独有保留（categoryId 悬挂→skipped）；tags 按 name 归一命中
  /未命中创建（带快照 id）；reminders 按 id 命中覆盖（调度态两列不动）/未命中创建（item_id 解析
  失败→skipped；channel='system-notification' 兜底）；channelPresets 按 id 命中覆盖/未命中创建
  （同 type 单 default 规范化）；itemTags 对快照 item 删除重建 join（tagId 解析失败→skipped）。
- 事务与调度联动：单 db.write + prepareUpdate/prepareCreate 同步收集 + 单次 db.batch（两遍法）；
  恢复成功后 reminderScheduler.reconcile() 显式一次（失败不阻断仅披露）。
- 切片 12 导出保留不动（version=1 无 kind 文件不进恢复链路，数据恢复只认 kind:'data'）。
- Repository 扩展 createDataSnapshot/applyDataSnapshot 成对（repository.md 注记节）。

### 7.44 闪电录入多提醒（wire reminders）与 AI 调试查看器（v0.36，切片 32）
- wire v0.23：RemoteDraftWire 加可选键 reminders?: RemoteDateTimeField[]（民用时刻数组，time 必非
  null）；键可缺省宽容、值出现即从严整体拒绝（非数组/元素坏/超 8 条 WIRE_REMINDERS_MAX）；
  wireToParsedItemDraft 本地换算 epoch ms 升序排序 + 同 epoch 去重，DST gap 条目丢弃不炸整体
  （全 gap → reminders undefined）。
- ParsedItemDraft.reminders?: number[]（空数组按 reminderChannels 先例拒绝——「无提醒」由缺省表达）；
  merge.ts DraftField 扩 'reminders'（掩码命中防御拷贝、显式 expressed 且 undefined = 清除语义）。
- savePlan 多计划（F1+L5 关闭）：FlashSavePlan.reminderPlans[]/reminderNotices[]；每条 toOncePlan
  （epoch ≤ now 不落库 + 披露）；offset/delay 各自独立落库；强提醒锚点分支在 reminders 已表达时不
  触发（渠道经覆盖循环带给 reminders 计划）；recurrence 非空时 reminders/offset/delay 全披露不落
  一次性计划；渠道覆盖/预设回填循环应用每条计划。
- 执行链：createReminder 逐条顺序 await，单条失败 warn+披露不中断不回滚 item；reconcile 成功后
  显式一次；FlashCardPayload.reminders 快照数组（空数组不渲染提醒行）；快捷推迟 chips 对条目全部
  once 提醒联动顺延。
- prompt：字段定义加 reminders 行 + 「绝对时刻提醒判定规则」节（禁止把绝对时刻换算成
  reminderOffsetMinutes/reminderDelayMinutes——F1 根因封堵）；buildHistoryBriefing 加 reminders 行。
- AI 调试查看器：schema v16 两列 show_ai_request/show_ai_response（非可选 boolean 回退 false）；
  provider lastDebug 副通道（parse 进入清空、每轮尝试覆盖、成功失败均保留、重试取最后一次；
  request=实际发送请求体不含 HTTP headers——Authorization 不采集；response 成功轮信封原文失败轮
  错误文本）；FlashTurnResult.debug 恒携带（含失败降级轮，与 usage 只报成功轮刻意不同）；
  UI 入口消息 + Modal 三节（request 随 show_ai_request、response/draft 随 show_ai_response）。

### 7.45 deepseek-flash 解析适配（v0.37，切片 33）
- 捆绑修复（L8 根因）：deepseek-flash 思维链纯散文无 <think> 标签直接拼进 content（JSON.parse 失败
  → schema-mismatch 降级）+ history 毫秒/键名 few-shot 同化（模型照抄输出与 wire 必填键冲突），
  两修复必须捆绑。
- 尾部平衡 JSON 提取：openAiCompatible.ts 导出 extractLastBalancedJson（从末尾向前扫描配平 {}[]，
  字符串字面量与转义感知）；解析链序 extractContent → stripCodeFence → extractLastBalancedJson →
  JSON.parse。
- history assistant 序列化民用化：prompt.ts 导出 serializeDraftForHistory(draft, tzid, itemId?)——
  epoch→民用 {date,time}|null、时间键名输出 wire 键名 start/end（键名同化修复，真机矩阵 #3 定性）、
  reminders epoch[]→[{date,time}]、itemId 键注入；写入点四处（chat.ts 两处 historyAppend +
  useFlashChat 保存播种/本地编辑回写）。
- tryParseBriefingDraft/renderBriefing 三形状兼容（number=legacy 毫秒换算、startAt 键={date,time}、
  start/end 键=现产物，解析 start 优先回退 startAt）；prompt「history 一律民用、摘要块唯一基准、
  严禁输出毫秒」。
- 契约面：ai.md v0.24 变更记录；RemoteDraftWire 键纪律与 12 必填键清单零改动；不消费
  reasoning_content 字段。

### 7.46 已保存条目对话式编辑（v0.38，切片 34）
- wire 可选键 targetItemId（ai.md v0.25）：键可缺省宽容（reminders v0.23 同构）、值出现即从严整体
  拒绝（非串/空串）、不校验存在性（落库层校验）；ParsedItemDraft.targetItemId?: string 同纪律；
  不纳入 merge 掩码（路由信号非内容字段，直接透传）。
- 播种 JSON 带条目 id：serializeDraftForHistory 输出追加 itemId 键（保存链传 created.id、本地编辑
  回写传基线 id、chat.ts historyAppend 场景缺省）；renderBriefing 摘要块加「关联条目 id」行。
- update 落库链（handleConfirmSave 分支）：plan.targetItemId 非空且条目存在且非 sourceReadOnly
  （拒绝转披露降级 create）→ updateItem 全量 patch + updateItemTime → tags 差异 add/removeTagToItem
  逐个 → once 提醒集合全量替换（listRemindersByItem 按 frequency==='once' 分组按 epoch 对比：
  增 create/减 delete/同 epoch 不动；reminders 缺省=不动；offset/delay 产物经摘要块照抄保留）→
  reconcile 显式一次（失败不阻断）→ 结果卡措辞「已更新《title》」→ 播种更新后草稿（itemId 保持，
  基线连续）。
- 边界：仅当前基线可编辑（更早历史卡保持切片 29 视觉区分、点击跳详情页）；认真模式 confirm 守卫
  零改动复用；本地降级链路零改动（降级轮无 targetItemId 走 create）；不支持重复提醒对话式增删与
  「删除全部 once 提醒」（wire 空数组仍拒绝，全删场景披露走详情页）。

### 7.47 双向同步 WebDAV（v0.39，切片 35）
- 快照交换式形态（冻结）：每设备固定名快照 life-sync-<deviceId>.json（覆盖写，非滚动保留）；
  同步 = 上传本地快照 → 列出对端快照（排除自己）→ 逐个下载合流（纯函数幂等，updated_at 全局
  比较）→ 本地落库 → 上传合并结果；支持 ≥2 台设备；仅手动触发。
- 行级 LWW + 墓碑（冻结）：items/reminders 冲突按 updated_at 晚者赢（prepareUpdate 自动维护，
  写路径零侵入）；删除传播 = 新表 sync_tombstones（schema v17：kind 'item'|'reminder'|'channel_preset'
  / entity_id isIndexed / deleted_at）——deleteItem/deleteReminder/deleteChannelPreset 三处同事务记
  墓碑，墓碑随快照携带；对方墓碑命中本地行→本地删；本地墓碑命中对方行→不创建不更新；同步成功后
  按对端 exportedAt 最小值裁剪。
- 无时间戳表 union 合流（冻结）：tags 按 name / categories、channel_presets 按 id——命中保留本地、
  未命中创建（_raw.id 保真）；item_tags 并集重建（悬挂 skipped）；app_settings 整行按快照
  exportedAt LWW（缺列保留）。已知限制：无时间戳表命中行不覆盖（跨设备修改既有标签颜色/分类
  Emoji/预设字段不传播）；tags/categories 删除不传播（union 复活为设计选择）。
- 同步快照 wire：{version:1, kind:'sync', deviceId, exportedAt, items, tags, reminders,
  channelPresets, itemTags, tombstones}——条目形状复用 dataSnapshot.ts 守卫，顶层 isSyncSnapshotWire
  整包拒绝+条目级 skipped 计数；SYNC_SNAPSHOT_FILE_PATTERN 与 kind:'config'/'data' 互不相认；
  落点 src/domain/syncSnapshot.ts + src/domain/syncMerge.ts（合流纯函数）+ deviceId uuid v4 域内
  自写（SecureStore 键 sync_device_id_v1）。
- 落库与 Repository 扩展：createSyncSnapshot/applySyncMerge 契约外显式扩展成对——单 writer 事务
  （两遍法+_raw.id 保真+单次 db.batch）；reminders 孤儿（基线 item 被墓碑删）→ skipped；本地新增
  墓碑事务内合入（防回流复活）；reconcile 显式一次失败不阻断。
- 边界：不做手动冲突选择 UI（LWW 无感合流+计数披露）；UI 落 backup.tsx「同步」区块（连接复用
  webdav_backup_config_v1）；切片 28/31 备份功能与文件保留不动；LWW 设备时钟回拨敏感披露为
  已知限制。

### 7.48 AI 日程查询/记忆检索（v0.40，切片 36）

- **范围与路由（冻结，Q1 定案）**：闪电录入对话支持查询意图——本地预路由（src/domain/ai/queryIntent.ts
  matchesScheduleQueryIntent：保守疑问词表+显式排除表，先排除后疑问；漏判走录入、用户重述兜底）→ 独立查询
  分支（检索→注入→模型回答）；查询轮不走 AiParser.parse/RemoteDraftWire，**ai.md 契约正文零改动**、
  AiParser.parse 冻结签名不变；误判接受（用户重述）。提案 docs/proposals/slice-36-ai-schedule-query.md
  （用户 2026-11-23 四问定案：本地预路由/模型解析自然语言窗口/自然语言摘要/全域+开关默认开）。
- **两段式远端（Q2/Q3 定案）**：第一段窗口解析（queryPrompt.ts buildQueryWindowResolutionPrompt → 轻独立
  JSON {start:{date},end:{date}} 民用；queryGuard.ts isQueryWindowWire 独立守卫不触碰 RemoteDraftWire；
  非法/失败回退今天起 7 天并披露）+ 第二段回答生成（buildQueryAnswerPrompt → 自然语言摘要纯文本，否决
  结构化卡片）。复用 OpenAICompatibleProvider 传输层（重试/超时/lastDebug/lastUsage）；不修改
  AI_SYSTEM_PROMPT（闪电解析域隔离，ai-prompt 只读页不变）。
- **全域检索（Q4 定案）**：retrieval.ts buildScheduleRetrievalContext——检索域=未归档∪已归档全部条目
  （listItemsWithTags ∪ listArchivedItemsWithTags 全量读取，Repository 零改动无新方法无注记节）；窗口
  相交过滤（allDay 归一、无时刻待办单列节）+ content 80 字截断 + 上限 50 条 truncated 披露；不做向量
  检索/FTS5（§2 技术栈锁定）。
- **开关与 schema v18**：app_settings 新列 ai_schedule_query_enabled（**isOptional boolean 回填 null +
  读层归一 null→true 默认开**——非可选 boolean 回填 false 与默认开冲突，切片 30 教训同构；
  parseAiScheduleQueryEnabled 非 boolean→true）；profile.tsx「对话式查询」Switch（widgetToggleRow，
  settingsSavingKey 互斥）；关闭时查询轮本地提示不发远端。
- **消息流与边界**：查询轮产出 user+assistant 纯文本消息（ChatMessage kind 不新增）；不产卡/不落库/不播种
  草稿 JSON；history append 照常（buildHistoryBriefing 对非 JSON 条目跳过，切片 33/34 编辑语义不受影响）；
  查询轮=新输入取消 §7.37 待确认；降级=本地行式列表回答+degraded 披露（无 usage）；lastDebug/lastUsage
  被查询轮覆盖为已知行为；schema v18 仅一列（v15–v17 step 不动）；无新依赖；冻结区三目录零改动；
  候选①剩余「保存后提示语轻改法」随本片顺带处置为正向文案（切片 34 已使保存后输入=编辑已保存条目）。

### 7.49 Spark 灵感火花（v0.43，切片 37）

- **范围（冻结，五问定案 2026-11-23）**：事项 Tab 占位页（L1）改造为灵感页——Tab 改名「灵感」+ bulb 图标（路由 items→sparks，唯一引用 _layout.tsx）；文字/录音/拍照+相册 capture；灵感↔计划一对多关联（spark_items 表）；提案 docs/proposals/slice-37-spark-inspiration.md。capture=Tab 页内速记条+流式列表（Keep 式，Q1）；录音仅存文件+回放不做 AI 转写（Q2）；转化=详情页「转计划」→item/new 预填→保存后关联，AI 拆解留二期（Q3）；新依赖 expo-audio + expo-image-picker（Q4，用户明确允许，dev client 重建）；附件 v1 即上云 WebDAV（Q5）。
- **schema v19 三新表**：sparks（title/content 双可空——纯录音灵感/created_at/updated_at）、spark_attachments（spark_id isIndexed/kind 'audio'|'image'/uri/remote_path?/sha256?/file_size/duration_ms?/width?/height?/created_at）、spark_items（spark_id/item_id isIndexed/created_at）；deleteSpark 级联删附件与关联行。
- **SparkRepository 端口**：src/data/SparkRepository.ts + WatermelonSparkRepository.ts（ItemRepository 分层同构）；CRUD/listSparks 倒序/附件/linkSparkToItem（item_id 存在性校验）/listItemsForSpark；repository.md 注记节（冻结签名零 diff）。
- **附件存储与上云（Q5）**：本地 documentDirectory/sparks/<uuid>.<ext>；远端 <basePath>/life-attachments/<sha256前16>-<名>；即时上传（录入后立即 PUT，附件专用 60s 超时；失败「未备份」徽标+详情页重传）；删除联动远端 DELETE（失败仅披露）；上限每灵感 20 附件/单文件 25MB。
- **数据快照扩展（向后兼容）**：kind:'data' version 1 不变+可选三块 sparks/sparkAttachments/sparkItems（缺块跳过；旧 App 读新快照忽略未知键恢复六块——isDataSnapshotWire 只查必需键已核对）；恢复同构（_raw.id 保真/悬挂 skipped）；附件文件下载在事务外逐个执行（失败披露可后补）。**Spark 不进 sync 快照/ICS 导出/小组件/闪电录入/AI 查询检索域/切片 12 导出**（多设备灵感同步留候选）。
- **边界**：AI 转写与 AI 拆解留二期候选；灵感归档/计划侧反查/灵感搜索不做；冻结区三目录零改动；app_settings 零迁移；无新设置开关；APK bump 0.37.0/versionCode 37（§5 版本号策略）。
- **真机落地披露（2026-11-24，closeout §五）**：expo-audio 1.1.1 Android `Property("currentTime")` 返回 recorder.startTime（epoch ms，库缺陷 expo/expo#39646+修复 PR #40239 未进 SDK 54 补丁线）——录音计时与 durationMs 落库改本地 wall-clock 累计（recordStartRef，sparks.tsx 弃读该属性；SDK 55 升级 L13 时回归）；sparkItems 快照恢复为 pair 语义 upsert（LokiJS batch 两遍法先 create 后 update/destroy，同批 destroy+create 同 id 撞 Duplicate key——SQLite 无此问题）；附件远端 URL 分段拼装（buildWebdavAttachmentDirUrl/buildWebdavAttachmentUrl，buildWebdavUrl 整段编码会把 dir/name 变 %2F）；新依赖经 `npx expo install` 对齐（npm 直装跨大版本拖入重复原生包+缺 peer，expo-doctor 失败）。

## 8. 当前切片

- **已完成**：切片 1–37 全部收尾合并（main @ 见 git log；schema v19，版本 0.37.0/versionCode 37）。
  v0.41 起本节不再逐片罗列提交链与验收终态——一律以对应 `tasks/slice-NN-closeout.md` 为准
  （v0.40 的逐片明细原文存档 `docs/agents-history.md` §8）。最近三片速览：切片 35 双向同步
  WebDAV（e0e6fee→2e1a85c→d3fee74，schema v17，jest 104/1559）；切片 36 AI 日程查询/记忆检索
  （8a21db0→8ce958b，merge a630447，schema v18，jest 110/1619，真机矩阵 10/10）；切片 37 Spark
  灵感火花（a68cc86→c6dc0d1，schema v19，jest 119/1707，真机矩阵 12/12，APK 0.37.0/v37）。
- **当前切片**：无（切片 37 已完成收尾合并；下一片候选=闪电对话持久化 F4/时间解析消歧 F5/
  系统日历写回/变更 B/theme_mode/F3 闹钟可见性，见 `tasks/backlog.md`）。
- **未完成项以 `tasks/backlog.md` 为准**（2026-11-16 起的惯例）：候选排序、遗留 L1–L13（L5 已随
  切片 32 关闭）、手验项 U1–U4、契约化已知限制均记录在 backlog，本节不再罗列候选清单。每切片
  closeout 同步更新 backlog.md（划掉完成项并注明关闭切片号）并保持本节精简。

