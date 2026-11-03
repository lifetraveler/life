# 切片 6 收尾移交（closeout）

> 写于 2026-11-03。切片 6 全部 16 条验收（任务卡 1–14 + 分支提交 15–16）已完成并通过。
> 本文档是切片 6 的收尾移交：环境事实、数据库/构建事实、代码地图、踩坑教训、遗留披露。

## 一句话状态

切片 6（Item 时间字段 schema v4 + 详情/编辑页 + Reminder 正式入口 + 通知点击跳转 + 时区白名单）代码完成、静态验证全绿、真机验收 16/16 通过，已按 §7.9 完成分支提交与合并。

## 环境事实

- 仓库 `F:\code\vibecoding\life`，切片分支 `task/slice-06`（基于 main@7a86776）。
- 设备 `adb -s 127.0.0.1:16384`（MuMu 模拟器，Android 15 x86_64，900x1600）；同设备另一 transport `emulator-5554`，指定 serial 操作。
- App 包名 `com.vibecoding.life`，深链 scheme `life`；metro 8081（`node node_modules/expo/bin/cli start --dev-client --port 8081`，**勿用 `bin/cli.js`，MODULE_NOT_FOUND**）+ `adb reverse tcp:8081 tcp:8081`。
- gradle 直构：`JAVA_HOME=D:\enviroment\java\jdk\oracle-jdk-17.0.10`，`ANDROID_HOME=D:\Android\Sdk`，APK `android/app/build/outputs/apk/debug/app-debug.apk`（176,345,880 bytes）。
- npm 装/跑一律 `--cache .npm-cache`（全局 cache 目录 EPERM）；已把 `.npm-cache/` 加入 .gitignore。
- push 遇 Connection reset 先 `git -c http.version=HTTP/1.1 ...` 再试（代理 172.16.100.254:7893 时好时坏）。
- bash 偶发 exit 139 中断 `&&` 长链——拆短调用重试即可。

### ⏰ MuMu 时区真相（推算验收时间的唯一依据）

- 设备**系统时区 = Asia/Shanghai(+8)**（状态栏/AlarmManager 按此墙钟），但 App 内 `Intl.DateTimeFormat().resolvedOptions().timeZone` = **UTC**。二者错位是 MuMu 特有，真机不会发生。
- 真实 UTC = 主机时钟(+08 表示) − 8h。
- Material picker 选 "14:00" 按**系统墙钟(+8)**解释 = UTC 06:00；详情页（Intl UTC）显示 06:00——这是契约正确行为（开始/结束时间按设备当前 IANA 时区解释，MuMu 的设备时区就是 UTC），验收 7 按此核对通过。
- 详情页 Reminder 行"生效起点"用 `reminder.tzid` 渲染（Asia/Shanghai 行显示正确）；Europe/London 行因 polyfill 无该 tz 数据**回退系统时区(+8)显示**（仅显示层限制，见遗留披露）。

## 数据库/构建事实

- schema `user_version=4`；覆盖安装迁移真机证据 logcat：`[SQLite] Database needs migrations` → `Migrating from version 3 to 4...` → `Migration successful`。item_cols 12 列含 start_at/end_at/all_day；切片 1–5 数据（items/tags/item_tags/reminders 数量）迁移后不变；旧数据新列为 NULL，读取层归一 `allDay=false`。
- **migration 后 Item 时间字段值分布（切片 7 决策输入）**：迁移时刻 3 条既有 Item（SeedItemA/SeedItemB/NotifyHost）全部 startAt=null、endAt=null、allDay=false。验收过程中 SeedItemA 被赋值（start_at=1793685600000，all_day=1，+08 午夜墙钟语义）；SeedItemB 保持三列 NULL；NotifyHost 在验收 11d 中删除。即真实旧数据迁移后 100% 无时间，"无时间 Item 是否进入今日视图"的兜底规则必须在切片 7 任务卡决定（§4.29 已预冻结"无 startAt 不进今日/本周"）。
- FormatJS polyfill 启动 WARN「invalid package.json exports」为已知信息级（文件级回退解析成功，polyfill 生效），非缺陷。
- identifier 契约实证：`recurrence:v1|<reminderId>|<localDate>|<localTime>|<tzid>`（logcat scheduled 行）。
- **DB 终态基线**（本 closeout 提交时的设备库）：items 2（`N5TDgJ0FA0K5NXnW`=SeedItemA note/active/all_day=1/start_at=1793685600000；`QrZWyM395z7tLBwr`=SeedItemB task/active/三列 NULL）；reminders 6（`yykDspfiyowpUMPX`=London seed + 5 条指向已删 item `pSlMwVd6IlAm0Lkh` 的孤儿，enabled=1 但通知已被启动对账 cancel——§4.16 item null→cancel 路径真机实证）；tags=0、item_tags=0。
- **通知点击三路径脆弱度（切片 7 决策输入）**：最脆弱=**冷启动**（11c）——`useRootNavigationState().key` 出现早于 expo-router 内部 `navigationRef.isReady()`，导致「Attempted to navigate before mounting the Root Layout component」；已用重试机制修复（见踩坑）。前台（11a）与后台（11b）路径健壮。

## 验收对照（任务卡 15 项全过）

- 1 tsc 零错误 ✅　2 jest 12 suites/134 tests 全过 ✅　3 expo-doctor 16/18（2 项失败=切片 5 基线既有信息级，无新增阻塞）✅
- 4/14 代码检查：`git diff -- src/domain/recurrence` 为空；src/notifications 改动仅 response listener 与导航桥接；`expo-notifications` 仅出现在 `src/notifications/`（data/domain 中的 3 处为契约注释非 import）；无 `any`/`as any`、无新状态库、无 rrule ✅
- 5 migration v3→v4 ✅　6 详情页（全天/普通/无结束/"未安排"四种状态齐；白名单外只读行可见）✅　7 编辑时间（保存/非法 endAt 阻止红字/allDay）✅　8 Reminder 正式入口（创建+编辑重调度+冷启动留存 lastReconciledAt 非空）✅
- 9 白名单（a 选择器恰两项；b 调试页造 Europe/London → Repository 抛 `tzid "Europe/London" is not supported. Allowed: Asia/Shanghai, America/New_York` 且未落库；c 既有白名单外行只读）✅　10 删除 reminder 后通知消失且重开不复活 ✅
- 11 通知点击：a 前台 ✅　b 后台 ✅　c 冷启动（修复后 `am kill`→点通知直达详情）✅　d 占位页（见下）✅　12 保存对账 dev 面板 ✅　13 Hermes DST 回归 ✅
- **11d 等价性论证**：占位分支由渲染层实现（`src/app/item/[id].tsx:175-185`，item null → 「条目已删除」+返回），通知→data.itemId→navigate 桥接已被 11a/b/c 三条真实通知路径验证；本验收用深链 `life://item/<已删id>` 驱动**同一渲染分支**，结果占位页正常、无 FATAL。"已 posted 通知指向已删 item"因 force-stop 会清 posted 通知的平台限制无法真机复现，如实披露。
- **13 用 daily 而非任务卡字面的 weekly**：weekly 指定星期几在 30 项窗口内可能不覆盖 2027-03-14（gap 日）；daily 30 项（startAt=2027-03-01 NY 02:30 起）必覆盖。实测预览 30 项 = 03-01…03-13 + 03-15…03-31，**2027-03-14 缺席**，gap 日不平移不回退，与切片 5 结论一致。测试意图（Hermes 与 Jest 一致性、gap 日缺席）完全满足。
- **missed 语义真机证据**（§4.19）：上海 05:48 的当天 occurrence（21:48:00Z）过期后（保存时刻 21:48:39Z）对账计入 missed 1 并更新 lastFiredOccurrenceKey；通知 posted 但无人确认时，下次对账同样计入 missed（06:17 对账 missed 1）。dedup 生效，未重复计入。

## 代码地图

- **修改**：`AGENTS.md`（v0.6：§4.23–4.30 新契约 + §8 指向本 closeout）、`package.json`/`package-lock.json`（新增 `@react-native-community/datetimepicker` ^8.4.4）、`src/app/_layout.tsx`（挂载通知 response listener）、`src/app/index.tsx`/`src/app/archived.tsx`（列表项 Pressable→`/item/[id]`）、`src/data/ItemRepository.ts`、`src/data/WatermelonItemRepository.ts`（getItemById/updateItemTime）、`src/db/schema.ts`（SCHEMA_VERSION=4）、`src/db/migrations.ts`（追加 toVersion:4 addColumns，v3 step 未动）、`src/db/models/ItemModel.ts`（+startAt/endAt/allDay，装饰器写法保持）、`src/domain/item.ts`、`src/domain/reminder.ts`（CreateReminderInput/UpdateReminderInput 类型收敛，任务卡允许）、`src/notifications/__tests__/ReminderScheduler.test.ts`（+2 例）。
- **新增**：
  - 页面：`src/app/item/[id].tsx`（详情+reminder 表单+删除+占位分支 :175-185+dev 信息区）、`src/app/item/[id]/edit.tsx`。
  - UI：`src/ui/ReminderFormEditor.tsx`、`src/ui/DateTimeField.tsx`、`src/ui/TzPicker.tsx`、`src/ui/timeFormat.ts`、`src/ui/reminderForm.ts` 及 `src/ui/__tests__/{reminderForm,timeFormat}.test.ts`。
  - data：`src/data/itemTimeRules.ts`（endAt>=startAt 校验）、`src/data/reminderTzWhitelist.ts`（白名单断言）及各自测试。
  - notifications：`src/notifications/notificationResponse.ts`（前台/后台 listener + 冷启动 getLastNotificationResponse + navigationReady flush + **导航重试**：`NAVIGATE_RETRY_MS=100`、`NAVIGATE_RETRY_MAX=50`，flush 失败保留 pending setTimeout 重试，超限 console.warn 放弃）+ `src/notifications/__tests__/notificationResponse.test.ts`（8 例）。
  - 任务卡 `tasks/slice-06.md`；本 closeout。
- **新增依赖理由**：Expo SDK 54 无官方内置日期时间选择器组件，`@react-native-community/datetimepicker` 是 RN 社区官方维护的标准选择器，与 custom dev client autolinking 兼容；仅用于编辑页与 Reminder 表单（§4.30 允许范围）。未引入 UI 框架/状态库/rrule。

## 踩坑教训

- **冷启动导航 bug（本切片修复的真缺陷）**：点通知冷启动偶发 `Render Error: Attempted to navigate before mounting the Root Layout component`（assertIsReady ← linkTo ← navigateToItem）。根因：`useRootNavigationState().key` 出现早于 expo-router 内部 `navigationRef.isReady()`。修复：`notificationResponse.ts` 的 `navigateToItem` try/catch 返回 boolean，冲刷失败保留 pending 并 `setTimeout(100ms)` 重试上限 50 次；handleResponse/markNotificationNavigationReady 走 flushPending 统一路径。测试注意：`beforeEach` 必须 `mockNavigate.mockReset()`（非 mockClear），否则超限用例的 throw implementation 污染后续用例。
- **`am kill` 保留 alarms；force-stop 清 alarms+posted 通知**。冷启动测试 = Home 键 + `am kill com.vibecoding.life`。
- **MuMu freezer**：App 后台 ~40s 进程冻结，alarm 广播延迟到解冻补发；进程死时 alarm 拉起进程 post（logcat `Start proc ... for broadcast NotificationsService`），延迟 50s~2.5min。**通知没准时出现先查 logcat，不是代码问题**。dev-client keep-awake 会产生噪音日志，忽略。
- **keyevent 111(ESC) 在 MuMu 被系统当 back** 转给 react-navigation → 常驻 GO_BACK toast 挡住底部按钮（toast ✕ 在 (807,1502)，先点 ✕）。
- **设备侧 adb shell 的 glob 由外层 sh（cwd=/）展开**：`run-as ... ls life.db*` 按字面传→误报 no such file；用显式文件名。
- **python `sqlite3.connect("")` 静默开临时空库**（报 no such table: items 误导诊断）；连接串必须非空。
- uiautomator XML 属性顺序：text= 在 class= 之前，grep 用 `text="[^"]*"[^>]*class="android.widget.EditText"`。
- ScrollView 快 swipe 无效，需慢速长距（`input swipe 750 1100 750 250 900`）；滚到底后顶部节点被裁剪出 dump，grep 不到要滚回顶部再 dump。
- 大数换算：118 天 = 169,920 分钟（勿 ×60 两次）。
- MuMu 冷启动 `am start -a VIEW -d life://...` 会先落 dev launcher 首页再透传进 app（正常）。
- 实测坐标（MuMu 900x1600，详见 handoff 存档——已删，关键项留此）：调试页创建表单 hour(341,1097)/minute(468,1097)/tzid(605,1197)/startAt偏移(492,1297)/创建(188,1550)；深链冷启动的栈只有 [item/...]，back 会退出 App，回列表用 `monkey -p com.vibecoding.life -c android.intent.category.LAUNCHER 1`。

## 遗留披露（后续切片关注）

1. **missed 正式展示推迟**（§4.28 冻结决定）：切片 6 不实现 missed UI；已知缺口"用户可能错过提醒而不知道"。missed 持久化与展示必须在后续切片以 schema 变更正式设计，**不得**用 AsyncStorage 临时凑合。
2. **白名单外 tzid 的显示回退**：Europe/London reminder（切片 5 seed 数据）在详情页因 FormatJS polyfill（add-golden-tz，仅含 Asia/Shanghai、America/New_York）无该 tz 数据，回退设备系统时区渲染，"生效起点"显示的墙钟与 London 本地时间不符（只读行，不影响调度正确性——调度用 `@date-fns/tz` 的 tz 数据是完整的，受影响的仅 Intl 格式化显示）。扩展白名单必须先换 add-all-tz 并真机验证（§4.25）。
3. **MuMu Intl=UTC 错位**：模拟器特有（系统时区 +8，App Intl 报 UTC）。详情页时间按"设备当前 IANA 时区"（=UTC）显示，与状态栏墙钟差 8 小时是预期行为；真机不会出现。切片 7 的今日/本周分组同样按设备时区（=UTC）解释，在 MuMu 上验收时须用同一坐标系核对，勿与状态栏墙钟混比。
4. **切片 5 调试页既有 bug（未修，保持切片纪律）**：`src/app/debug-reminders.tsx:123-131` 计算绝对日期 startAt（TZDate 解析）是死代码，`:141` 实际传 `createReminder` 的仍是 `Date.now() + startAtOffsetMinutes * 60_000`；"填绝对日期时忽略偏移"的提示误导。切片 6 验收 13 用偏移法绕过。建议切片 7 任务卡顺手修或删该死代码。
5. **通知权限被拒时的编辑体验**未专项验证（编辑/建提醒可保存，调度静默降级，无崩溃）；POST_NOTIFICATIONS 拒绝路径的单测覆盖在 permissions 模块，真机拒绝后的 UX 未走查。
6. **通知 identifier 总量**：每 reminder 最多 30 条，reconcile 已有 500 上限跳过+warning 逻辑（切片 5）；切片 6 未新增规模压力，切片 7 引入今日/本周后数据量增长时复查。

## 收尾动作记录

- 本 closeout 与切片全部改动单提交：`完成切片 6：Item 时间字段(v4)、详情/编辑页、通知点击跳转与时区白名单`。
- `tasks/slice-06-handoff.md`（会话间临时移交文档）已删，不入库。
- 分支 `task/slice-06` push 后 `--no-ff` 合并回 main 并 push main；切片分支保留追溯。
