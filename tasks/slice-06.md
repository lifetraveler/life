# 切片 6：Item 时间字段 + 详情/编辑页 + Reminder 正式入口 + 通知跳转

## 目标
在切片 5 之上落地 schema v4（Item 时间字段），提供正式的 Item 详情页与编辑页，把 Reminder 的创建/编辑/删除从 dev 调试页迁到详情页，并实现通知点击跳转到详情页。
本切片不实现今日/本周视图；该视图在切片 7，依赖本切片的时间字段与详情页。

## 允许修改/新增的范围
- `src/db/`：Item model 新增 startAt/endAt/allDay；schema v4；migration 追加 step
- `src/data/`：Repository 实现 getItemById、updateItemTime；CreateItemInput 扩展为可带 startAt/endAt/allDay（默认为 null/false）
- `src/domain/reminder.ts` 或等价文件：仅允许新增 CreateReminderInput/UpdateReminderInput 的类型收敛（若尚未集中定义），不得改 ReconcileResult 与 Occurrence
- `src/app/`：Item 详情页、编辑页、导航注册、通知 response listener 注册
- `src/ui/`：时间选择器封装、Reminder 表单、时区选择器、详情页信息区块
- `src/notifications/`：仅允许新增通知点击响应的注册与导航桥接；**不得修改 ReminderScheduler、reconcileDiff、computeMissed、polyfill**
- `app.config.*` / `app.json`：如需，补 notification response 相关配置（不得改 notification icon 等既有配置以外的内容）
- `package.json`：允许新增日期时间选择器依赖，需在报告中说明理由
- 测试：详情页/编辑页的纯逻辑（如时间格式化、Reminder 表单校验、白名单校验）单测

## 禁止修改/实现
- 不实现今日/本周视图（切片 7）
- 不实现 missed 正式展示；不得用 AsyncStorage 临时存 missed
- 不修改 `src/domain/recurrence/` 任何文件与测试
- 不修改 v3 migration；不得清库
- 不换 `add-golden-tz` / 不引入 `add-all-tz`；不改 polyfill
- 不修改 ReminderScheduler 的四个方法签名与对账语义
- 不引入 Redux/MobX/Zustand、重量级 UI 框架、rrule
- 不把通知 data 字段改名；不把 notification identifier 改成 occurrenceKey 以外
- 不实现“通知点击自动完成 Item”或“通知点击自动 acknowledge missed”
- 不修改 AGENTS.md 4.1–4.22 的既有契约

## 实现要求

### 1. Schema v3→v4
- Item 新增 `startAt: number | null`、`endAt: number | null`、`allDay: boolean`（默认 false）。
- migration 追加 `toVersion: 4`；用 `addColumns` 或等价方式，不得重建表、不得清库。
- 既有 Item 迁移后 startAt/endAt 为 null、allDay 为 false。
- Reminder 表不动。

### 2. Repository
- `createItem` 的输入扩展为可选 startAt/endAt/allDay；未传时落 null/false。
- `updateItemTime` 校验 endAt >= startAt（两者非 null 时）；更新 updatedAt。
- `getItemById` 返回 ItemWithTags（含 tags）；不存在返回 null。
- 所有新方法不得绕过 WatermelonDB 的 writer 直接改字段。

### 3. 详情页
- 路由 `src/app/item/[id].tsx`，从列表或通知进入。
- 展示：title、type、content、tags chip、startAt/endAt（设备时区格式化，allDay 显示“全天”）、status、reminders 列表。
- reminders 列表每项展示：frequency、localTime、weekdays 或 dayOfMonth、tzid、enabled、lastReconciledAt（若 null 显示“未对账”）。
- 白名单外 tzid 的 reminder：只读展示 + “该时区暂不支持编辑”，不提供编辑/删除按钮。
- 提供“编辑”入口跳编辑页；提供“新增提醒”入口打开 Reminder 表单；每条 reminder 提供编辑/删除。
- 删除 reminder 必须调用 `cancelForReminder(reminderId)` 后再 `deleteReminder`；顺序不可颠倒。
- 页面提供 dev-only 信息区（仅 `__DEV__`）：显示 `getLastAutoReconcileResult()` 摘要。

### 4. 编辑页
- 路由 `src/app/item/[id]/edit.tsx`（或等价 modal）。
- 可编辑：title、content、type、startAt、endAt、allDay、tags。
- 时间选择器：开始/结束时间 + 全天开关；关闭全天时 endAt 必须 >= startAt，否则阻止保存并提示。
- 保存走 `updateItem`（title/content/type/tags）与 `updateItemTime`（时间字段）；两者都成功后再返回详情页。
- 保存后若 type 变为 task/event 或时间变更，触发一次 `reconcile()`；失败不阻断保存，记录日志。

### 5. Reminder 表单
- 字段：frequency（daily/weekly/monthly）、localTime（时/分）、weekdays（weekly 时多选 1–7）、dayOfMonth（monthly 时 1–31）、tzid（仅 Asia/Shanghai、America/New_York）、startAt（日期时间选择器）、enabled 开关。
- 校验：frequency 与 weekdays/dayOfMonth 的一致性；dayOfMonth 1–31；tzid 白名单。
- 保存走 `createReminder` / `updateReminder`，随后调用 `scheduleForReminder` 或 `reconcile()`；失败不阻断保存，记录日志。
- 编辑 reminder 时 tzid 允许切换（仅两个白名单值）；切换后旧 tzid 的通知必须被 `cancelForReminder` 清理。

### 6. 通知点击跳转
- 在 app 入口注册 `expo-notifications` 的 response listener（仅 `src/notifications/` 下）。
- 前台、后台、冷启动三种路径都导航到 `item/[id]`；冷启动需等待导航就绪后再跳转。
- Item 不存在时导航到占位页，文案“条目已删除”，提供返回。
- 不得在跳转前自动完成 Item 或 acknowledge missed。

### 7. 导航与列表入口
- 现有列表项点击进入详情页；dev 调试页保留在 dev 菜单，不接入正式导航。

### 8. 依赖
- 如新增 `@react-native-community/datetimepicker`，在报告中说明为什么不用 expo 内置能力（若 expo 已有可用组件则优先用 expo）。

## 验收标准（逐条执行并报告）

### 静态与单测
1. `npx tsc --noEmit` 零错误。
2. `npx jest --runInBand` 全部通过，且至少包含：
   - `updateItemTime` 的 endAt >= startAt 校验（合法/非法各一）。
   - Reminder 表单校验纯函数：daily/weekly/monthly 各自合法与非法用例；tzid 白名单外拒绝。
   - 时间格式化纯函数：allDay=true 与 false 两种展示；设备时区切换时格式化结果变化（用显式 tzid 参数测试，不依赖系统时区）。
3. `npx expo-doctor` 与切片 5 基线对比：不得新增阻塞项；既有 2 项信息级失败允许保留。
4. 代码检查：
   - `git diff -- src/domain/recurrence` 为空；
   - `git diff -- src/notifications` 仅含 response listener 与导航桥接，不含 ReminderScheduler/reconcileDiff/computeMissed/polyfill 改动；
   - `expo-notifications` 仅出现在 `src/notifications/`；
   - 无 `any` / `as any`；无新增状态库；无 rrule。

### 真机（development build，Android）
5. 覆盖安装，确认 migration v3→v4 执行：切片 1–5 的 items/tags/item_tags/reminders 数量不变；Item 的新字段为 null/null/false。
6. 详情页：
   - 从列表进入任一切片 1–5 的 Item，详情页展示 title/type/content/tags/status；无 startAt 时显示“未安排”。
   - 若存在切片 5 调试页创建的 reminder，详情页可见其 frequency/localTime/tzid/enabled/lastReconciledAt。
7. 编辑页：
   - 设置 startAt=今天 14:00、endAt=今天 15:00，保存后详情页显示正确（设备时区）。
   - 设置 endAt 早于 startAt，保存被阻止并提示。
   - 打开 allDay，startAt 显示为“全天”，endAt 不展示或标注“全天”。
8. Reminder 正式入口：
   - 在详情页新增 daily 提醒，localTime=当前+2 分钟，tzid=Asia/Shanghai，startAt=今天；
   - 保存后 `getAllScheduledNotificationsAsync()` 出现对应 identifier；
   - 杀掉 App 重开，详情页 reminders 列表仍在，`lastReconciledAt` 非空。
9. 白名单：
   - 时区选择器只有 Asia/Shanghai 与 America/New_York；
   - 尝试通过代码或调试页构造 Europe/London 的 reminder，Repository 抛错；
   - 若 DB 中已有白名单外 reminder（可用调试手段造一条），详情页只读展示且无编辑/删除按钮。
10. 删除 reminder：
    - 在详情页删除某 reminder，`getAllScheduledNotificationsAsync()` 中该 reminder 的通知消失；重开 App 不再出现。
11. 通知点击跳转：
    - 触发一条已调度通知（可用调试页把 startAt 设为 now+1min），分别验证：
      a. App 前台时点击通知 → 进入对应 Item 详情；
      b. App 后台时点击通知 → 进入对应 Item 详情；
      c. App 被杀死后点击通知 → 冷启动进入对应 Item 详情；
      d. 删除该 Item 后再点击其历史通知 → 进入“条目已删除”占位页，不崩溃。
12. 保存后对账：
    - 编辑 Item 时间为未来时间并保存，dev 信息区显示 reconcile 已触发；`newlyScheduled` 或 `cancelled` 至少一个非空（视数据而定），无异常日志。
13. Hermes 时区一致性（回归）：
    - 在详情页为 America/New_York 创建 daily 02:30 的 reminder，startAt 落在 2027-03-01；
    - 打开 dev 信息区的 `getLastAutoReconcileResult()`，确认 gap 日（2027-03-14）无 occurrence；与切片 5 的结论一致。
14. 代码检查：`src/domain/recurrence/` 无 diff；`src/notifications/` 改动仅限 response listener 与导航桥接。

### 分支与提交
15. 按 AGENTS.md §7.8–7.11：从最新 `main` 新建 `task/slice-06`，实现、验收、commit、push、`--no-ff` 合并到 `main`、push `main`；closeout 随切片提交。
16. push 若遇 `Recv failure`，先加 `-c http.version=HTTP/1.1` 重试。

## 完成后输出
- 修改/新增文件列表
- schema version 与 migration step 摘要；确认未修改 v3 step
- 新增依赖名称与理由（日期时间选择器、其他）
- 执行的命令及结果
- 每条验收标准对应的测试名称或真机观察（重点：三种通知点击路径、白名单拒绝、migration 后旧数据完整）
- 详情页/编辑页的截图或文字描述（至少覆盖：无 startAt、allDay、有 reminder、白名单外 reminder 四种状态）
- 与切片 5 的 `ReconcileResult` 交互记录：编辑页保存后 reconcile 的实际返回摘要
- Hermes DST 回归结论（与切片 5 一致 / 不一致）
- 未完成项与风险（特别是 missed 展示缺口、白名单外 tzid 的只读路径、通知权限被拒时的编辑体验）
- 是否触碰受保护契约（应为“否”；若为“是”，附变更提案）
- 分支名、commit hash、merge hash、远端核对结果
- 切片 6 最终报告里给出两件事：旧数据 migration 后 Item 时间字段的实际值分布（多少条 null、多少条有值），以及通知点击三条路径中哪条最脆弱。这两项会决定切片 7 是否需要补一条“无时间 Item 是否进入今日视图”的兜底规则