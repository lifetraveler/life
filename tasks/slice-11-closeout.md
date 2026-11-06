# 切片 11 收尾移交（Reliability：时区来源修正 + force-stop 后通知重排）

状态：变更 A / 变更 B 均已实现、提交并通过真机验收。
提交链：`d088618`（提案+任务卡+AGENTS §7.17）→ `ee39526`（变更 A）→ `4d237f6`（变更 B）→ 本 closeout。
分支：`task/slice-11`（自 main @ `ba4b96c`）。

## 1. 环境事实

- 构建：变更 A 引入新原生模块 expo-localization ~17.0.9，按流程重建 dev client：
  `rm -rf node_modules/expo/android/build` → `:expo:generatePackagesList`（45s）→
  `:app:assembleDebug`（49s 增量，BUILD SUCCESSFUL，APK 179MB）。gradlew 在 `android/` 子目录
  （workdir 必须是 `F:\code\vibecoding\life\android`，rm 路径带 `../`）；
  `JAVA_HOME='D:/enviroment/java/jdk/oracle-jdk-17.0.10'`。
- 变更 B 纯 JS，未重建 APK；metro reload 生效。
- 设备：MuMu 实例 `127.0.0.1:16416`（**隔夜重启后实例地址从 16384 变 16416，且 adb daemon 重启
  必须重新 `adb connect` + 重设 `adb reverse tcp:8081 tcp:8081`**——reverse 丢失的症状是
  dev client 部分链路坏而 bundle 已在内存，tap 活、部分回调死，极具迷惑性）。
- metro 规则重申：改 src 前必须停 metro；本切片两次均遵守（变更 B 前确认 metro 已停）。
- UI 自动化：uiautomator dump → `adb exec-out cat` → 本地 python 脚本
  （`.tmp-session-log/parse_ui.py`、`find_node.py`，gitignore 不入库）。find_node 多模式参数用
  `;` 分隔（`|` 会被 cmd 包装器当管道拆断）；中文参数用 `\uXXXX` 转义。

## 2. 数据库 / 构建事实

- **无 schema 变更**（仍 v5）；未新增 migration。
- expo-localization 在 Android 返回真实时区（MuMu 上 `Asia/Shanghai`），提案中"模拟器可能仍异常"
  的担忧未发生；`Intl.DateTimeFormat().resolvedOptions().timeZone` 恒 'UTC'（@formatjs 接管），
  dev 期对比 warn 每会话打印一次（预期内）。
- 直写 DB 种测试数据可行：`/data/data/com.vibecoding.life/life.db`（app 根目录），
  `adb shell "run-as com.vibecoding.life sqlite3 life.db '...'"`；reminders 表字段
  `_changed/_status/_status='created'`、时间列 float 毫秒。种子在重启 JS 后由冷启 reconcile
  自动调度（无需手动触发）。
- 幽灵注册表量化证据（变更 B 的实验夹具）：force-stop 后 `dumpsys alarm` 中本 App 闹钟 = 0，
  expo SharedPreferences 注册表残留 89 条 → 纯 diff 误判一致。与切片 7/8 的发现完全吻合。

## 3. 代码地图

变更 A（`ee39526`，9 files，只碰 deviceTimezone/timeFormat 链路）：
- `src/data/deviceTimezone.ts`：重写。`getDeviceTzid() = Localization.getCalendars()[0]?.timeZone ?? 'UTC'`，
  try/catch 回退 UTC；`__DEV__` 且每会话一次 Intl 对比 warn（前缀 `[slice-11]`）。
- `src/ui/timeFormat.ts`：`export { getDeviceTzid } from '../data/deviceTimezone'`（唯一改动点收口，
  8 处消费方 import 不变）。
- `src/app/item/[id].tsx`：reminder 行对 `tzid === 'UTC'` 渲染「创建于时区修正前（UTC）」标注。
- `src/data/WidgetSnapshotWriter.ts`、`docs/contracts/ui.md`（围栏修复）、测试（jest.mock expo-localization 2 用例）。

变更 B（`4d237f6`，4 files，只碰 ReminderScheduler/_layout）：
- `src/notifications/ReminderScheduler.ts`：
  - 冻结接口 `reconcile(options?: { forceRebuild?: boolean }): Promise<ReconcileResult>`
    （notifications.md v0.11 允许）；
  - forceRebuild=true：`Notifications.cancelAllScheduledNotificationsAsync()` → actual 视为空集
    → 全量重排；missed 逻辑不变（仍基于 lastFiredOccurrenceKey）；缺省/false 与 v0.5 完全一致；
  - 新增非冻结类方法 `getLastReconciledAt(): Promise<number | null>`（enabled reminder 的
    lastReconciledAt 最大值）。
- `src/app/_layout.tsx`：`FORCE_REBUILD_THRESHOLD_MS = 60_000`；cold start 读
  getLastReconciledAt，`null 或 Date.now()-last > 60s` → `reconcile({ forceRebuild: true })`，
  读取失败 warn 后保守走默认 diff；前台恢复 / 数据变更路径不变（diff）。
- `src/notifications/__tests__/ReminderScheduler.test.ts`：+5 用例（幽灵注册表下 forceRebuild
  全量重排且幽灵不进 toCancel；缺省不调 cancelAll；连续两次 forceRebuild 第二次 missed 为空；
  getLastReconciledAt null/最大值）。

## 4. 验收结果（可观察证据）

静态：`npx tsc --noEmit` 零错；`npx jest --runInBand` 24 suites / 310 用例全过；
`npx expo-doctor` 16/18，两个失败项与切片 10 基线一致（non-CNG config 不同步提示、
RN Directory 元数据 watermelondb/widget-snapshot-store/@nozbe/simdjson），无新增阻塞；
禁改区（`src/domain`、`src/polyfill.ts`、`src/db`、及变更 A 后的 `src/ui`/`src/data`）
`git diff` 全空。

真机（MuMu `127.0.0.1:16416`，设备时区 Asia/Shanghai）：
1. getDeviceTzid 修正：logcat `[slice-11] getDeviceTzid=Asia/Shanghai 与 Intl=UTC 不一致…以
   expo-localization 为准`（多会话复现）；详情页「按设备时区 Asia/Shanghai 显示」。
2. 北京 00:30 错日回归：今日视图在 00:30 显示 09:00 项（伪影下会归前日隐藏）。
3. 非 allDay 系统日历：syncadapter URI 直插日历事件 09:00+08 → 导入 → 今日视图 `09:00`
   （修复前 01:00）。
4. 小组件快照：`widget_today_snapshot_v1` JSON `tzid=Asia/Shanghai`、timeLabel 均 `09:00`。
5. 新建 reminder 默认 tzid：表单路径创建 → DB `Asia/Shanghai`。
6. 旧 UTC reminder：详情页双标注（只读 + 创建于时区修正前），occurrence 仍按 UTC 展开。
7. 通知管道实弹：00:45 通知真实送达，identifier=`recurrence:v1|<reminderId>|2026-11-06|00:45|Asia/Shanghai`，
   `last_fired_occurrence_key` 落库（markReminderFired 链路完好）。
8. forceRebuild 实弹：force-stop（dumpsys alarm=0、注册表残留 89）→ 冷启（距上次对账 10h+）→
   logcat `reconcile: forceRebuild — cancelled ALL app notifications, rebuilding` →
   重排 89 条（00:45 AS 29 + UTC 30 + NY 30；AS 的 Nov 6 00:45 已过期被窗口过滤，算术吻合），
   `dumpsys alarm` 89 条恢复，详情页「新调度 89 · 取消 0 · missed 0」。
9. <60s 二次冷启走 diff：forceRebuild 0 行、新调度 0（阈值保护生效；见遗留披露 2 的边界）。
10. >60s 第三次冷启自愈：forceRebuild 再触发、89 条闹钟恢复，触发时刻与变更 A 阶段一致
    （NY 02:30=15:30+08、UTC 08:00=16:00+08）。

## 5. 踩坑教训

1. adb daemon 重启（隔夜/断连恢复）必丢 `adb reverse`，且 MuMu 实例地址可能变化——验收前先
   `adb devices` + 重设 reverse。
2. 深链直挂的 debug 页（`life://debug-reminders`）ScrollView 卡死（reload 可解），下方按钮
   tap 无响应。替代方案：直写 DB 种 reminder + 重启 JS 让冷启 reconcile 调度，更可控。
3. 首页列表顺序随数据变化（导入事件排在种子任务前），坐标自动化前必须重新 dump 确认目标。
4. keyevent 数字可直接输入原生 DatePicker 时间拨盘（四位补齐自动确认）。

## 6. 遗留披露（风险与超范围观察）

1. **forceRebuild 的 cancelAll 范围 = 本 App 全部通知**（`cancelAllScheduledNotificationsAsync`
   不辨前缀）。当前 App 只有 reminder 前缀（`recurrence:v1|`）通知，可接受；**后续若新增任何
   非 reminder 通知类型（如导入完成提示、系统通知），必须改为按前缀取消**（循环
   `cancelScheduledNotificationAsync`），否则 forceRebuild 会把非 reminder 通知一并清掉。
   `ReminderScheduler.reconcile` 内已留注释标注。
2. **60s 阈值窗口内的边界（设计内，实测确认）**：force-stop 后 60s 内冷启，diff 被幽灵注册表
   误导、闹钟不重排（实验 2 实测 `dumpsys alarm` = 0），需等下一次 >60s 冷启自愈。这是
   「避免每次冷启全量重建」的代价：真实世界中 force-stop 后重开基本 >60s，系统回收
   （am kill / LMK）不清闹钟不受影响。
3. tzid='UTC' 历史数据**不迁移**（契约决定）：occurrence 仍按 UTC 展开、详情页双标注。
   批量修正入口本切片不做。
4. 超范围观察（只披露，未改）：`src/app/debug-reminders.tsx:48` 存在第三份 Intl 时区回退
   （debug 页 tzid 输入框预填 'UTC'）；`src/ui/display.ts` formatTimestamp 用 toISOString
   渲染 createdAt（文档注明的既定 UTC 行为，切片 1/2 一致性）。
5. `docs/contracts/ui.md` 的 ```json 围栏缺失（切片 10 遗留）已随变更 A 修复；
   AGENTS.md 版本行 v0.10→v0.11 随提案 commit `d088618`。
6. 测试种子留在设备 DB（SLICE11-TODAY / SLICE11-CAL-EVENT / 3 条 reminder；MuMu 无实机日历，
   日历事件经 syncadapter URI 直插）——复现验收可直接用，正式环境不影响。
