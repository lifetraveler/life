# 切片 5 收尾移交（Close-out Handoff）

> 生成于切片 5 正式关闭时。切片 6 新会话按 AGENTS.md §7.1 读 AGENTS.md（v0.5）、tasks/slice-06.md（待创建）与本文件；本文件补充环境事实与教训，不改变任何契约。
> 验收结论：切片 5 全部验收标准通过。证据：`tsc` 0 错误 + Jest 7 suites/96 tests 全过 + expo-doctor 18 项（2 项既有信息级基线）+ 契约静态守卫全过 + **MuMu 模拟器真机验收 12 项全部通过（含 v2→v3 migration 实锤、missed 补提醒现场、DST gap 现场）**。

## 环境事实（实测，勿重查）

- 仓库：`F:\code\vibecoding\life`；remote `origin` = `https://github.com/lifetraveler/life.git`。
- 本切片分支：`task/slice-05`；基线：`main@7cebe4d`（切片 1–4 合并提交）。分支在建码前创建（§7.8 首次严格执行）。
- 工具：Node 24.15.0、npm 11.12.1、git 2.42.0.windows.2、Windows。
- **构建环境**：
  - 系统环境变量 `JAVA_HOME` 指向失效路径 `C:\code\runtime\java\jdk\jdk-17.0.8.1-full`（目录已删）；可用 JDK = `D:\enviroment\java\jdk\oracle-jdk-17.0.10`（jabba 安装；jabba 的 `system@17` 目录为空壳）。gradle 直构需显式 `JAVA_HOME=<上述路径>`。
  - `ANDROID_HOME`（用户级）= `D:\Android\Sdk`，但 expo CLI 不识别它（`npx expo run:android --device` 失败：要设备名不要 serial）。gradle 需要 `android/local.properties`（`sdk.dir=D:\\Android\Sdk`）——本切片已创建，`android/.gitignore:10` 已忽略该文件，不入库。
  - **gradle 直构命令**：`cd android && JAVA_HOME='D:\enviroment\java\jdk\oracle-jdk-17.0.10' ANDROID_HOME='D:\Android\Sdk' ./gradlew :app:assembleDebug` → BUILD SUCCESSFUL 1m45s / 391 tasks。全量构建未触发缺件（ShortcutBadger 等已在缓存）。
  - 网络封锁持续：代理 `172.16.100.254:7893` 不可达（fetch 超时）；`dl.google.com` DNS 污染。本切片构建全部靠本地 gradle 缓存 + maven.aliyun.com 可达（备用兜底通道，本次未用到 init 镜像）。
- **真机验收设备**：MuMu 模拟器 15.0（Netease），`adb connect 127.0.0.1:16384`；Android 15，abilist=x86_64。安装目录 `E:\Program Files\Netease\MuMu`。设备上有切片 4 版本 app + 切片 1–4 数据，本切片覆盖安装（`adb install -r`，APK 169549882 bytes）正好验证 v2→v3 migration。
- **MuMu 时区陷阱**：设备墙钟是 +8（04:00 CST = 20:00Z 前一天），但 app 内 `Intl.DateTimeFormat().resolvedOptions().timeZone` 返回 `UTC`——设备系统时区设置与 Intl 报告不一致。本切片所有 reminder 显式传 tzid，不受影响；切片 6 正式 UI 若要「用设备时区」需警惕此差异，建议默认 `Asia/Shanghai` 或让用户手填。

## 验收命令与结果

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过，0 错误 |
| `npx jest --runInBand` | 7 suites / 96 tests 全部通过（切片 4 基线 47 → 本切片新增 49） |
| `npx expo-doctor` | 18 项检查，2 项既有信息级失败（non-CNG 提示 + watermelondb/simdjson RN Directory 元数据），与切片 3/4 基线一致，无新增 |
| `git diff main -- src/domain/recurrence/` | 0 字节（recurrence 模块零改动） |
| `grep -rn "from 'expo-notifications'" src/`（排除 src/notifications） | 无匹配（UI/domain/data 均未 import；仅注释里出现「不得 import expo-notifications」字样） |
| `any` / `rrule` 静态检查 | 无匹配 |
| MuMu 真机手动验收 | 任务卡步骤 6–12 全过（见下表） |

### 真机验收证据（MuMu 127.0.0.1:16384）

| # | 步骤 | 结果 |
|---|---|---|
| 1 | migration v2→v3 | logcat：`Database needs migrations` → `Migrating from version 2 to 3...` → `Migration successful`；切片 1–4 数据完好；重启无重复 migration 日志 |
| 2 | POST_NOTIFICATIONS 显式申请 | 首次进调试页自动弹系统对话框；拒绝路径不崩溃（页面显示 denied）；调试页按钮重申后 granted；重启后持久 granted |
| 3 | daily 调度 30 条 | r1（每天 09:00 Asia/Shanghai）→ 系统侧 30 条，identifier 全部 `recurrence:v1|<reminderId>|<YYYY-MM-DD>|09:00|Asia/Shanghai` |
| 4 | 对账幂等 | 手动 reconcile 二次调用 → newlyScheduled=0, cancelled=0, missed=0；通知数不变 |
| 5 | missed 造场（启动对账） | r3 startAt 早于当前 2 天 → force-stop 重开 → 调试页「启动对账 missed=2」+ 两条 occurrence 列表（11-01、11-02 09:00）；再杀再开 missed=0（markReminderFired 去重） |
| 6 | missed + 聚合通知 | r4 同法 → 手动 reconcile missed=2 → 状态栏实拍「错过 2 条提醒」+ 两条 occurrenceKey |
| 7 | 删除 reminder 取消 | 删 r4 → 通知 114→86，r4 identifier 全消失 |
| 8 | Item done 取消 | 宿主 Item 标记 done → 重启 → 启动对账 cancelled=86 → 通知 0 条；二次对账 cancelled=0（幂等） |
| 9 | 恢复 active 重建 | Item 恢复 active → 重启 → 启动对账 newlyScheduled=86 → 通知 86 条 |
| 10 | 单 reminder 上限 30 | 86 = 30（r1 全未来）+ 28（r2）+ 28（r3）：过期 occurrence 占 expand 名额后被窗口过滤，上限不破 |
| 11 | DST gap（America/New_York） | r5（每天 02:30 America/New_York，startAt=2027-03-01T00:01Z）→ 展开预览 30 项：03-13 在、**03-14 缺**（春季 gap 跳过不平移）、03-15 起恢复，30 项补足到 03-31——与 Jest 期望一致（§4.21 真机 DST 验证完成） |
| 12 | 通知持久性 | force-stop 重开后系统侧已调度通知不丢（58/86 条均跨重启保持） |

## 依赖与构建事实

- 新增依赖（均任务卡允许范围）：
  - `expo-notifications@0.32.17`（SDK 54 配套版本；`trigger` 必须带 `type: SchedulableTriggerInputTypes.DATE`；`presentNotificationAsync` 在 SDK 54 已移除——立即展示用 `trigger: null` 的 `scheduleNotificationAsync` 替代）。
  - `@formatjs/intl-datetimeformat@^8.0.2`、`@formatjs/intl-getcanonicallocales@^3.3.0`、`@formatjs/intl-locale@^5.4.2`（npm 安装统一用 `--cache .npm-cache` + 装完删除，避开全局 cache EPERM）。
- `app.json` plugins 追加 `"expo-notifications"`（expo-router 之后、watermelondb plugin 之前的位置约束无要求）。
- `babel.config.js` plugins 追加 `'@babel/plugin-transform-class-static-block'`：`@formatjs/intl-locale/polyfill.js` 含 class static block 语法，babel-preset-expo 54 默认不带该 transform（依赖已在 node_modules，babel-preset-expo 传递依赖，零新装）。**清 metro 缓存重启后必报错，之前没报是 transform cache 命中**。
- Hermes polyfill（`src/polyfill.ts`）：getcanonicallocales → locale → datetimeformat 顺序导入 + `add-golden-tz`（784KB，含 Asia/Shanghai + America/New_York）+ zh/en locale-data。**放 `src/app/` 外**：expo-router 把 src/app 下文件当路由，报 missing default export。FormatJS 入口自带 `shouldPolyfill()` 守卫，Jest/Node 下 no-op，满足 §4.21「不影响 Jest」。
- schema v2→v3：`src/db/schema.ts` `SCHEMA_VERSION = 3` + reminders 表（13 列）；`src/db/migrations.ts` 追加 `{ toVersion: 3, steps: [createTable reminders] }`，v2 step 未动。
- app 体积：debug APK 144.5MB（切片 4）→ 169.5MB（本切片，增量 = expo-notifications native + FormatJS tz 数据）。

## 代码地图（切片 6 起点）

- `src/domain/reminder.ts`：`Reminder` / `ReminderFrequency` / `CreateReminderInput`（不含 last* 字段）/ `UpdateReminderInput`（无 tzid/itemId）/ `ReconcileResult`。纯类型，无逻辑。
- `src/data/reminderRuleMapping.ts`：规则字段 ↔ RecurrenceRule 互转（§4.17「Repository 负责互转」的实现）；`serializeWeekdays`/`parseWeekdaysJson`（JSON 数组字符串，非法抛错）/`normalizeReminderRuleFields`/`normalizeStartAt`/`toRecurrenceRule`/`fromRecurrenceRule`。纯函数。
- `src/db/models/ReminderModel.ts`：reminders 表 model；`weekdays` 列名 `weekdaysJson`（JS 属性名区分）；ItemModel.associations 加 has_many reminders + `@children('reminders')`。
- `src/data/ItemRepository.ts` + `WatermelonItemRepository.ts`：§4.18 七方法全实现 + `getItem(id)`（契约外扩展，先例注释已写明）；deleteReminder 用 `destroyPermanently`；`markReminderReconciled`/`markReminderFired` 单列 update。
- `src/notifications/reconcileDiff.ts`：`reminderIdentifierPrefix(id)` / `diffNotifications(expectedKeys, actualKeys)`（集合差）/ `computeMissed(occurrences, lastFiredKey, now)`（instant 升序，lastFiredKey 定位 +1 起，过滤 instant<=now）。纯函数，12 用例。
- `src/notifications/ReminderScheduler.ts`：`WatermelonReminderScheduler`。四冻结方法 + `getScheduledNotificationIdentifiers()` / `getPermissionState()` / `presentMissedSummary(missed)`（trigger:null 立即展示，identifier 不带 recurrence 前缀避免污染 diff）/ `getRecentLogs()`（环形 50 条）。常量：`MAX_SCHEDULED_PER_REMINDER=30`、`SCHEDULE_WINDOW_DAYS=30`、`RECONCILE_SCHEDULE_BUDGET=500`。reconcile 按「nextInstant 升序 + 预算 500」调度，超预算 reminder 跳过并 log warning（其现有通知不动——skippedPrefixes 过滤 toCancel）。
- `src/notifications/permissions.ts`：`getNotificationPermissionState()` / `ensureNotificationPermissions()`（granted 直通；`!canAskAgain` → 'denied' 不再弹；否则 requestPermissionsAsync）。
- `src/notifications/index.ts`：导出全部 + `reminderScheduler` 单例（注入 itemRepository）+ `initReminderNotifications()`（幂等 configure handler）+ `recordAutoReconcileResult` / `getLastAutoReconcileResult`（模块级观测口，_layout 写入、调试页读取）。
- `src/app/_layout.tsx`：第一行 `import '../polyfill'`；useEffect 权限申请（catch 降级 warn）+ reconcileNow + AppState active 时 reconcileNow。
- `src/app/debug-reminders.tsx`：调试页（§4.22；`__DEV__` 外 return null）。选 Item → 建/删 reminder（frequency/hour/minute/weekdays/dayOfMonth/tzid/startAt 全可配；startAt 支持偏移分钟或绝对日期）→ scheduleForReminder / deleteReminder+cancelForReminder；手动 reconcile（missed 非空自动 presentMissedSummary）；「展开预览 30 项」（expandOccurrences 不过滤窗口）；已调度 identifier 列表；再次弹聚合通知；Item 标记 done/恢复 active；显示启动对账结果。
- `src/notifications/__tests__/ReminderScheduler.test.ts`：12 用例。jest.mock('expo-notifications') 内存通知中心；FakeRepository 实现 21 方法接口（4 个真实现其余 throw）。
- `src/data/__tests__/reminderRuleMapping.test.ts`：mapping 纯函数用例。

## 关键设计决定（切片 6 勿重复实现）

- **identifier = occurrenceKey（§4.20）**：`recurrence:v1|<encodeURIComponent(reminderId)>|<YYYY-MM-DD>|<HH:mm>|<tzid>`。对账纯靠前缀 + 集合 diff，不比对触发时间字段。`reminderIdentifierPrefix` 只用 root 前缀匹配做 cancelAll（不误伤他 App 通知）。
- **missed 判定**：expandOccurrences(30) 输出（不止窗口内）→ `computeMissed` 按 instant 升序在 lastFiredKey 之后取，过滤 `instant <= now`；报告后 `markReminderFired(窗口内最后一个 key)` 推进，天然幂等。
- **过期 occurrence 占名额**：expandOccurrences count:30 从 startAt 起算，`instant <= now` 的 occurrence 也占 30 个名额，被窗口过滤后系统侧少于 30 条（如 28）。**这是契约语义的正确实现**（任务卡验收 6 通过），不要「聪明地」补足 30 条未来 occurrence——那会让 lastFiredKey 前的 occurrence 永远占据调度窗口。
- **调度顺序**：reconcile 内先 cancel（集合 diff 的 toCancel）后 schedule；同 identifier 不重复注册（diff 已保证，schedule 前无需再查）。
- **权限降级**：拒绝后所有 schedule 调用仍执行（系统静默丢弃），app 不崩溃；`ensureNotificationPermissions` 在 `!canAskAgain` 时直接返回 denied 不再弹窗。

## 踩坑教训（切片 5 新增）

1. **@formatjs polyfill 有 class static block**：metro 清缓存重启才暴露（`Static class blocks are not enabled`）；解法是 babel plugins 加 `@babel/plugin-transform-class-static-block`（零新装，babel-preset-expo 传递依赖）。
2. **expo-router 会把 src/app/*.ts 当路由**：非页面文件（polyfill 等）必须放 src/app 外，用相对路径导入。
3. **expo run:android 不接受 adb serial**：`--device` 要设备名。绕过方式 = gradle 直构（JAVA_HOME + local.properties 手动给）+ `npx expo start --dev-client` + `adb reverse tcp:8081 tcp:8081`。
4. **MuMu 设备时区陷阱**：墙钟 +8 但 Intl 报 UTC；`deviceTzid()` 不可信。验收 reminder 一律显式 tzid。
5. **adb 驱动 RN TextInput**：窄输入框（<100px）`input text` 丢字符（`2026-11-01` → `1-01`），逐字符+sleep 也丢；可靠做法 = 数字偏移框（宽度适中）或 keyevent 123(END)+67(DEL) 清空后逐字符输入 + sleep 0.25。
6. **tap 紧跟 swipe 会被吞**（画面字节级不变）：tap 与 swipe 必须分开 adb 命令且 tap 后 sleep ≥2.5s；纯 swipe 序列可靠。tap 按钮后偶发整页滚回顶部（RN 状态更新导致）。
7. **dev launcher 竞态**：force-stop 后 deep link 落 launcher 选择页；点 Connect 若 URL 空 → `Invalid URL host: ""`。需 tap 输入框手动填 `http://localhost:8081` 再 Connect。app 已加载后 `am start -a android.intent.action.VIEW -d "life://debug-reminders"` 直达路由。
8. **调试页快照时序**：页面 mount 时读的 scheduledIds 可能早于启动对账完成（显示旧值）；手动 reconcile 会刷新。读数前先点一次手动 reconcile。
9. **Windows watcher 竞态**：edit 工具写临时文件（`._layout.tsx.18800.*.tmpdir`）会触发 metro watcher ENOENT 崩溃；metro 死后用 `npx expo start --dev-client --port 8081 --clear` 重启即可，代码无需回滚。
10. **shell 0xC0000142 复发**（切片 4 教训重演）：会话开始 `git status` 报 exit 3221225794；用户修复环境后恢复。新会话首步先 `git status` 探测。
11. **push 时代理不可达**（本次实测）：全局 git `https.proxy=172.16.100.254:7893` 超时 → fetch/push 全挂。切片 4 的解法（`-c http.version=HTTP/1.1`）只在代理可达时有效；代理本身不可达时需要用户恢复代理或换网络。**本切片推送见「收尾事实」**。

## 遗留披露（带入切片 6）

- **polyfill 时区覆盖**：`add-golden-tz` 只含 Asia/Shanghai + America/New_York。用户若创建其他时区（如 Europe/London）的 reminder，Hermes 下 `TZDate` 行为未验证（`add-all-tz` 1.4MB 可选但体积代价大）。切片 6 正式 UI 建议时区选择器先只放这两个 tzid。
- **调试页测试数据残留**：MuMu 设备 DB 里有 4 条 enabled reminder（r1/r2/r3 → item DD8mXxdpl9xNKkjo；r5 → item 245tj7du3WLI81GN）+ 对应系统通知（r5 窗口外 0 条）。模拟器是验收环境，未清理；切片 6 正式 UI 联调时可手动删除（调试页「删除并取消通知」按钮）。
- **启动对账无 UI 提示**：_layout 启动/回前台 reconcile 不弹任何 UI（missed 非空也不弹聚合通知——§4.19 允许调用方决定）。调试页通过观测口显示。正式 UI 是否展示 missed 聚合通知由切片 6 决定。
- **expo-doctor 2 项既有基线**：non-CNG 提示 + watermelondb/simdjson RN Directory 元数据；本切片无新增。
- **AGENTS.md v0.5**：§4.16–4.22（ReminderScheduler/Reminder 模型/对账语义/expo-notifications 约束/polyfill/调试页）与 §8 已随本切片提交；§4.3 的「接口签名在切片 5 前冻结」已完成历史使命，冻结状态见 §4.16。
- **依赖锁定**：`expo-notifications@0.32.17` 与 SDK 54 的适配已验证；升级 SDK 时需重新核对 trigger 类型枚举与 presentNotificationAsync 替代方案。

## 收尾事实（2026-11-03）

- 切片提交：`57600a0`（`task/slice-05`，26 files changed，3331 insertions）。
- 合并提交：`b9c8d7e`（`main`，`--no-ff`）。
- 远端已核对：`origin/main` = `b9c8d7e`，`origin/task/slice-05` = `57600a0`；本次 fetch/push 直连成功（代理 `172.16.100.254:7893` 在本切片多数时间不可达，收尾时网络恢复，未用到 `http.version=HTTP/1.1` 变通）。
- 收尾后工作区干净，`main` 与 `origin/main` 同步；切片分支 `task/slice-05` 保留待追溯。
