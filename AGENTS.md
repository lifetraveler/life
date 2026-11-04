# AGENTS.md — 项目契约与 AI 协作规则

版本：v0.10

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

## 8. 当前切片
tasks/slice-10.md
（切片 10 进行中：Android 桌面小组件；切片 9 收尾移交见 tasks/slice-09-closeout.md）

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