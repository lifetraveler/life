# 切片 5：ReminderScheduler 接入本地通知

## 目标
在切片 4 的 `expandOccurrences` 之上实现 `ReminderScheduler`，把未来 30 天的 occurrence 注册为本地通知，并实现启动/回前台对账与错过补提醒。
本切片新增 reminders 表（schema v2→v3），不实现正式 UI，只提供 dev-only 调试页用于真机验收。

## 允许修改/新增的范围
- `src/db/`：Reminder model、schema v3、migration step（追加）
- `src/data/`：Repository 实现新增 reminders 相关方法与 Reminder↔RecurrenceRule 互转
- `src/notifications/`：`ReminderScheduler` 接口与 expo-notifications 实现、对账 diff 纯逻辑
- `src/domain/`：仅允许新增 Reminder 相关纯类型（如 ReconcileResult），不得改 `recurrence/`
- `src/app/`：新增 dev-only 调试页；app 入口补 FormatJS polyfill；启动/回前台挂载 `reconcile()`
- `app.config.*` / `app.json`：expo-notifications plugin、Android 权限声明
- `package.json`：FormatJS polyfill 依赖
- 测试：`src/notifications/__tests__/` 与对账 diff 的纯函数单测

## 禁止修改/实现
- 不修改 `src/domain/recurrence/` 的任何文件与测试
- 不重新实现重复规则计算；规则只来自 `expandOccurrences`
- 不实现正式 UI（列表、详情、编辑页）、今日/本周视图
- 不实现云同步、推送服务、多设备
- 不引入 Redux/MobX/Zustand、不引入 rrule
- 不修改 v2 migration；不得删库重装
- 不在 `src/notifications/` 之外 import expo-notifications
- 不把 notification identifier 改成 occurrenceKey 以外的值
- 不实现“missed 的正式 UI 列表”；只实现对账返回 + dev 调试页可触发聚合通知

## 实现要求

### 1. Schema v2→v3
- 新增 `reminders` 表，字段严格按 AGENTS.md 4.17。
- migration 追加 `toVersion: 3`；v2 step 不动。
- Reminder model 与 Item 建立 `@relation`；Item 侧可加 `@children('reminders')`，但不得改变 Item 既有字段语义。

### 2. Repository 与规则互转
- 按 AGENTS.md 4.18 实现方法。
- 新增 `toRecurrenceRule(reminder): RecurrenceRule` 与 `fromRecurrenceRule`，纯函数，放 `src/data/reminderRuleMapping.ts`，可单测。
- weekly 的 weekdays JSON 解析失败时抛明确错误，不得静默当空数组。

### 3. ReminderScheduler
- 按 AGENTS.md 4.16 实现 `scheduleForReminder / cancelForReminder / cancelAll / reconcile`。
- 对账 diff 抽成纯函数：
  `diffNotifications(expectedKeys: Set<string>, actualKeys: Set<string>) => { toSchedule: string[]; toCancel: string[] }`
  放 `src/notifications/reconcileDiff.ts`，必须单测。
- 错过判定抽成纯函数：
  `computeMissed(occurrences: Occurrence[], lastFiredKey: string | null, now: number) => Occurrence[]`
  按 instant 升序，取 lastFiredKey 之后且 instant <= now 的项。
- `reconcile()` 流程：
  1. `getAllScheduledNotificationsAsync()` 取现网 identifier 集合；
  2. 对每个 enabled reminder：展开 30 个 + 过滤 30 天窗口，得到期望 keys；
  3. 对账 diff，调用 schedule/cancel；
  4. 对每个 reminder 计算 missed；有 missed 则 `markReminderFired` 到最后一个 missed key；
  5. `markReminderReconciled` 更新 lastReconciledAt=now；
  6. 汇总返回。
- `scheduleForReminder` 遇 Item 已 done/archived 或 Reminder.enabled=false，等价 cancel 并返回。

### 4. expo-notifications 集成
- app 入口申请权限；Android 13+ 显式请求 POST_NOTIFICATIONS。
- 通知内容：title=Item.title，body 取 Item.content 前 60 字符（空则用类型文案），data 带 `{ occurrenceKey, reminderId, itemId }`。
- 拒绝通知权限时：scheduler 仍可被调用，但 `scheduleNotificationAsync` 失败必须捕获并记录，不得抛到 UI。

### 5. Hermes polyfill
- 在 app 入口最早处引入 FormatJS polyfill，覆盖 `Intl.DateTimeFormat`（timeZone）、`Intl.Locale`、`Intl.getCanonicalLocales`，加载 `Asia/Shanghai`、`America/New_York`。
- polyfill 只在 RN 入口生效；Jest 现有测试不受影响。
- 真机验收必须包含一条 `America/New_York` 规则的调度，验证 `expandOccurrences` 在 Hermes 下结果正确。

### 6. 启动/回前台对账
- App 启动后调用一次 `reconcile()`；AppState 从 background/inactive 回到 active 时调用一次。
- `reconcile()` 失败（如权限未授予）必须被捕获，不得阻断启动；失败信息写日志，dev 调试页可见。

### 7. dev 调试页
- 路径 `src/app/debug-reminders.tsx`，仅 `__DEV__` 可见。
- 功能：选一个 Item、创建/删除 Reminder、手动 `reconcile()`、列出 `getAllScheduledNotificationsAsync()`、手动触发一次聚合补提醒通知。
- 不接入正式导航；通过开发者手势或 dev 菜单进入即可。

## 验收标准（逐条执行并报告）

### 静态与单测
1. `npx tsc --noEmit` 零错误。
2. `npx jest --runInBand` 全部通过，且至少包含：
   - `reconcileDiff`：期望与现网完全相同 → 无动作；期望多出 → toSchedule 正确；现网多出 → toCancel 正确；identifier 前缀过滤不误伤他 App。
   - `computeMissed`：lastFiredKey 为 null 时取窗口内全部已过期项；lastFiredKey 之后的项；instant 严格大于 now 的项不进入 missed；按 instant 升序。
   - `reminderRuleMapping`：三种 frequency 往返一致；weekdays 非法 JSON 抛错。
   - `ReminderScheduler.reconcile`（mock expo-notifications）：首次对账调度期望 keys；第二次对账无新增；删除 reminder 后对账取消其通知；Item 置为 done 后对账取消其通知；missed 只报告一次。
3. `npx expo-doctor` 与切片 4 基线对比：不得新增阻塞项；既有 2 项信息级失败允许保留。
4. 代码检查：`src/notifications/` 之外无 `expo-notifications` import；`src/domain/recurrence/` 无 diff；无 `rrule`；无 `any` / `as any`；无新增 migration 修改 v2 step。
5. `git diff -- src/domain/recurrence` 为空。

### 真机（development build，Android）
6. 覆盖安装，确认 migration v2→v3 执行且切片 1–4 数据仍在（items、tags、item_tags 数量不变，reminders 表存在且为空）。
7. 权限：首次启动触发通知权限请求；拒绝后 App 不崩溃，dev 调试页显示“通知权限未授予”。
8. 调度与触发：
   - 在调试页为一条 Item 创建 daily 规则，`startAt = now + 2min`，`localTime` 取当前时刻；
   - 立即手动 `reconcile()`，`getAllScheduledNotificationsAsync()` 中出现 identifier 以 `recurrence:v1|` 开头的项；
   - 锁屏等待 2 分钟，通知出现，点击不崩溃（本切片不要求跳转详情）。
9. 对账幂等：
   - 再次手动 `reconcile()`，无新增、无取消（`newlyScheduled` 与 `cancelled` 均为空）。
10. 取消路径：
    - 在调试页把该 Reminder 删除，`reconcile()` 后对应通知消失；
    - 或把 Item 标记 done（若切片 5 尚未有正式 UI，用调试页提供的按钮），`reconcile()` 后对应通知消失。
11. 错过补提醒：
    - 在调试页创建 daily 规则，`startAt = now - 5min`（或直接改系统时间向前 5 分钟再触发对账），不等待触发，直接 kill App；
    - 重开 App，启动对账返回 `missed` 非空，dev 调试页显示 missed 列表；
    - 再次重开，`missed` 为空（已 `markReminderFired` 去重）。
12. Hermes 与 DST：
    - 在调试页创建 `America/New_York` 的 daily 规则，`localTime=02:30`，`startAt` 落在 3 月第二个周日前一天；
    - 触发 `reconcile()`，检查该 reminder 的期望 keys 不包含 gap 当天的 occurrence，前后日期正常；
    - 记录 Hermes 下与 Jest 结果是否一致；不一致必须停下来报告，不得改切片 4 代码绕过。

### 分支与提交
13. 按 AGENTS.md §7.8–7.11：从最新 `main` 新建 `task/slice-05`，实现、验收、commit、push、`--no-ff` 合并到 `main`、push `main`；closeout 随切片提交。
14. push 若遇 `Recv failure`，先加 `-c http.version=HTTP/1.1` 重试。

## 完成后输出
- 修改/新增文件列表
- schema version 与 migration step 摘要；确认未修改 v2 step
- 新增依赖名称与理由（FormatJS 相关）
- 执行的命令及结果
- 每条验收标准对应的测试名称或真机观察
- `reconcile()` 实际返回的 `ReconcileResult` 示例（至少一次真机运行）
- Hermes DST 结果与 Jest 是否一致的结论
- 未完成项与风险（特别是通知权限被拒、通知数量上限、时区数据裁剪设备）
- 是否触碰受保护契约（应为“否”；若为“是”，附变更提案）
- 分支名、commit hash、merge hash、远端核对结果