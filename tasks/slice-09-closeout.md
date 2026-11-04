# 切片 9 收尾移交：Android 系统日历单向导入

分支：`task/slice-09`（自 main @ 4fa4d62 切出）。本文随切片提交纳入 git。

## 1. 交付摘要

- 系统日历只读导入：权限申请 → 日历多选（默认全选）→ 范围选择（7/30/90/365，默认 90）→ 导入 → 结果页（读取/导入/跳过重复/冲突/失败/范围外/策略分布）。
- sourceUid：优先 expo-calendar `event.id`（'event-id' 策略）；缺失时 SHA-256 前 16 位（'content-hash' 策略，结果页标注重复风险）。真机数据 6 条全部 event-id。
- 去重：`findItemBySource('system-calendar', uid)` 命中 `sourceReadOnly=true` → skippedDuplicate；命中 `sourceReadOnly=false` → skippedReadOnlyConflict（不覆盖）。
- 结果数字：首次（空库）读取 6 / 导入 6 / 跳过 0；二次导入 跳过 6 / 导入 0；三次改名后重导 跳过 6 / 导入 0。
- 重复导入 100/批批写复用 `importItemsInBatches` 同构实现（`importSystemCalendarEvents`）。

## 2. 环境事实（承接切片 8 closeout，增量）

- npm 走 npmmirror；registry 报错时 `npm i <pkg> --cache ./.npm-cache`（用完删）。push 遇 reset 加 `-c http.version=HTTP/1.1`（本片未触发）。
- JAVA_HOME=D:/enviroment/java/jdk/oracle-jdk-17.0.10。构建顺序：`rm -rf node_modules/expo/android/build && ./gradlew :expo:generatePackagesList`（50s）→ `assembleDebug`（6m18s，566 tasks，APK 186MB）。新 expo 原生模块（expo-calendar/expo-crypto）后必须重生成 ExpoModulesPackageList，否则首启红屏。
- **裸工程 android/ 已 checked in：app.json 的 expo-calendar plugin 不会同步进 AndroidManifest**（即 expo-doctor CNG 提示的含义）。已在 `android/app/src/main/AndroidManifest.xml` 手工加 READ_CALENDAR + WRITE_CALENDAR uses-permission（附注释说明与 plugin 等价、方案 A 记录）。**后续切片改 app.json plugin 后必须核对 manifest 是否需手工同步。**
- 测试设备：emulator-5554（Android 15，adb root 后 uid=0）。无真实账户的设备 CalendarProvider 为空，需用 syncadapter URI 播种：`content://com.android.calendar/calendars?caller_is_syncadapter=true&account_name=X&account_type=LOCAL`。
- provider 坑（播种）：① dtstart/dtend 毫秒须 `--bind ...:l:`（long），`:i:` 报 usage 错；② `content` 工具成功写完后自身 Segmentation fault（exit 139）——无害，用 query 验证落地；③ URI 参数覆盖 --bind 的 account_name；④ expo-calendar 读 `calendar_displayName` 列而非 `name`，漏设则 UI 显示「（未命名日历）」；⑤ allDay=1 的事件 provider 会把 dtstart 规范化为当日 UTC 0 点。
- adb 坑：daemon 中途重启 → 一次性 `device offline`（重试即恢复）+ **清空 `adb reverse` 端口映射**（dev client 连不上 metro，需 `adb reverse tcp:8081 tcp:8081` 重建）；`pm clear` 会吊销运行时权限（需重新 grant）。
- dev client 坑：launcher 页的 `http://localhost:8081` 是**输入框**（点击只聚焦），启动要按「Connect」；`exp+life://expo-development-client/?url=...` deep link 可直接拉起加载；launcher「RECENTLY OPENED」卡片里的 life 才是应用入口（顶栏同名文字不是按钮）。
- metro 坑：`npx expo start | head -40` 会因 SIGPIPE 杀掉 metro（裸跑）；**metro 运行期间用 edit/write 工具改 src 下文件会与其 FallbackWatcher 竞态崩溃**（ENOENT watch 临时文件）——先改完文件再起 metro，或重启 metro。
- UI 自动化：uiautomator dump /sdcard/ui.xml → `adb shell cat` → python（heredoc，多行 `python -c` 在 Windows bash 会翻车；GBK 控制台输出中文用 `sys.stdout.buffer.write(...encode('utf-8'))`）解析 bounds 中心 → `input tap`。
- 切片 7 在本设备遗留 ~200 条「性能测试」过期事件，淹没今日/本周视图滚动验证；本片用 `pm clear`（一次性测试数据）后重装重导解决。closeout 记录：后续真机验收前建议先清测试噪音或换干净设备。

## 3. 代码地图（全部新增/修改）

新增：
- `src/domain/systemCalendar/types.ts` — SystemCalendarInfo / SystemCalendarEvent / SourceUidStrategy。
- `src/domain/systemCalendar/sourceUid.ts` — `Sha256Hex` 端口、buildContentHashInput（`calendarId|title|startDate|endDate`）、resolveSystemEventSourceUid（event-id 优先 / content-hash 前 16 位）。
- `src/domain/systemCalendar/mapSystemEvent.ts` — 映射到 ImportedItemInput；startDate 不可解析抛错；`系统日历事件` 回退标题。
- `src/domain/systemCalendar/filterEventsInRange.ts` — 复用 overlapsRange 的精确范围过滤（含跨范围）。
- `src/domain/systemCalendar/readerWindow.ts` — **本片真机验收发现的适配层缺陷修复**：expo-calendar 15.0.8 Android 原生 Instances 查询为纯包含式（`BEGIN >= start AND END <= end`，CalendarModule.kt:285-286），跨范围事件被原生层丢弃；`expandReaderWindow` 外扩 1 天（READER_WINDOW_WIDEN_MS=86400000）让它们返回，精确过滤仍由 filterEventsInRange 执行。副作用：外扩带入的不重叠事件计入读取总数/范围外；跨度 >1 天且结束于窗口起点附近的长事件仍会被原生层丢弃（API 层限制，如实披露）。
- `src/data/systemCalendarAdapters.ts` — SystemCalendarReader 端口 + expoSystemCalendarReader（getEvents 内用 expandReaderWindow）+ sha256Hex（expo-crypto）+ SystemCalendarDeps/defaultSystemCalendarDeps。
- `src/app/system-calendar-import.tsx` — 单页流程（loading/permission-denied/select/importing/done）。
- `src/ui/SystemImportResultView.tsx` — 结果展示（含策略分布与 content-hash 风险标注、失败清单折叠）。
- `src/domain/systemCalendar/systemCalendar.test.ts`（25 用例）、`src/data/__tests__/systemCalendarImport.test.ts`（10 用例）。

修改：
- `src/data/ItemRepository.ts` — ItemSourceType 放宽 findItemBySource 参数（契约内授权，用户确认）；SystemCalendarImportInput/SystemImportResult（冻结四字段 + totalRead/outOfRangeCount/sourceUidStrategies 扩展，沿 deleteItem/observe* 先例）；新增 importSystemCalendarEvents 接口方法。
- `src/data/WatermelonItemRepository.ts` — 构造函数第三参 SystemCalendarDeps 注入（现有调用不变）；importSystemCalendarEvents 管线 + findSystemCalendarDuplicateInTransaction + insertSystemCalendarItemInTransaction（sourceType='system-calendar'/sourceReadOnly=true 固定写入）。
- `src/app/settings.tsx` — 「系统日历」section 导航入口。
- `src/app/_layout.tsx` — 注册 system-calendar-import 路由。
- `src/app/item/[id].tsx` — 徽标/外部来源文案/删除弹窗文案按 sourceType 区分（'system-calendar' → 「来源：系统日历（只读）」「不影响系统日历中的原事件」；ICS 原样）。
- `src/notifications/__tests__/ReminderScheduler.test.ts` — FakeRepository 补 importSystemCalendarEvents stub（§7.13 测试夹具编译必需，+14/-1）。
- `app.json` — expo-calendar plugin（iOS usage description；Android 实际权限经 manifest 手工声明）。
- `android/app/src/main/AndroidManifest.xml` — READ/WRITE_CALENDAR uses-permission。
- `package.json`/`package-lock.json` — expo-calendar ~15.0.8、expo-crypto ~15.0.9（`npx expo install`，SDK 54 兼容版本）。
- `AGENTS.md` — v0.9：§7.15 系统日历来源契约（方案 A 措辞：单一弹窗同时请求 READ+WRITE 为库实现所限，如实记录）；§8 当前切片。
- `docs/contracts/repository.md` — v0.9（开工时随工作树带入的既有变更）。
- `.gitignore` — 忽略 `.tmp-slice*/`。

## 4. 验收对照（任务卡 5–13）

| # | 结果 | 证据 |
| --- | --- | --- |
| 5 | ✅ | 单一系统弹窗（日历组，与方案 A 一致）；拒绝后不崩溃，显示「未授予日历读取权限」+重试 |
| 6 | ✅ | 授予后列出 测试日历(id 1)/工作日历(id 2)（本地账户日历，非默认日历可见）；默认全选 2/2；范围默认 90 天 |
| 7 | ✅ | 空库首导 读取 6/导入 6/失败 0/范围外 0，与播种事件数一致（E6 在范围外被 reader 窗口过滤） |
| 8 | ✅ | 重导 导入 0/跳过重复 6（第三组证据：改名后重导同数字） |
| 9 | ✅ | provider 改 E7 标题（改名前标题→改名后标题）后重导：event-id 命中重复，导入 0；本地条目标题不覆盖 |
| 10 | ✅ | 今日/本周视图出现（本周视图可见 5 条，E5 在下周正确不在窗）；「全天事项」行显示「事件 · 全天」（ViewGroupSection）；详情页「来源：系统日历（只读）」、无编辑入口 |
| 11 | ✅ | 本周视图对 E4 点「完成」→ 状态 done、按钮变「取消完成」（本地化文案）；provider 7 事件原样（query 核对） |
| 12 | ✅（记录） | 见 §5 时区伪影 |
| 13 | ✅（方案 A 如实记录） | dumpsys：READ_CALENDAR+WRITE_CALENDAR 均声明且授予（库读取路径强制双权限）；grep 全 src/ 无 createEventAsync/updateEventAsync/deleteEventAsync 写回调用路径；验收 5 观察单一弹窗 |

静态 1–4：tsc 通过；jest 23 套件/296 用例全绿（基线 21/261）；expo-doctor 16/18 与基线一致（无新增）；src/domain/recurrence、src/db/migrations.ts、src/notifications 实现文件无 diff；无 any/无 rrule。

## 5. 时区伪影影响（记录，不修，切片 11 范围）

- 设备时区 Asia/Shanghai；@formatjs polyfill 把 Intl 时区钉死 UTC → 应用整体运行在 UTC 坐标系。
- 非 allDay 显示偏移：provider 墙钟 20:00+08 的 E4 在应用中显示「事件 · 12:00」、详情「开始 12:00/结束 18:00」（-8h）；21:00+08 → 13:00；10:00+08(11-06) → 02:00。与系统日历 App 对比差 8 小时，页面有「按设备时区 UTC 显示」标注，不静默。
- 「今天」窗口随 UTC 漂移：北京 11-05 01:50 时 App 的今日视图仍为 11-04（只含 E4），E1/E3 归入「明天」。allDay 项（E3）因 provider 归一为 UTC 0 点 + 应用按 UTC 日分组，日期归属自洽，徽标「全天」正确。
- 偏移量为恒定 +8h（Asia/Shanghai 无 DST），换算可预期。

## 6. 遗留与风险

1. expo-calendar 原生窗口包含式过滤：外扩 1 天仅覆盖常见跨夜事件；跨度 >1 天且结束于窗口起点附近的长事件会被原生层丢弃（无法在本层根治，已注释披露）。
2. content-hash 路径真机未触发（所有事件均有 event.id）；单测覆盖 22+ 用例。若真机事件无 id，结果页会标注重复风险。
3. WRITE_CALENDAR 运行时权限为 expo-calendar 15.0.8 读取路径强制（方案 A）；升级库或 expo 修复后可在 manifest 移除 WRITE 并回归。
4. 外扩窗口使「读取总数/范围外」含外扩带内的不重叠事件（本真机数据未触发，语义诚实）。
5. `pm clear` 重置会吊销日历权限（重测时需重新 grant）。

## 7. 契约触碰

- 未触碰冻结签名/枚举/schema v5/migrations。v0.9 变更（§7.15 措辞、ItemSourceType 放宽、SystemImportResult 扩展字段）均经用户开工确认，记录于开工确认与本文。
- docs/contracts/repository.md 的 v0.9 修改为开工前既有变更（随工作树纳入本切片提交）。
