# 切片 8 closeout — ICS 导入导出 + schema v5 外部来源字段

## 环境事实

- Windows 原生 bash（无 MSYS 运行时，`uname -s` 报 MSYS 兼容标识但实际为原生 Win32 进程）；路径用 POSIX 形式传给 shell。
- 会话开场曾出现 bash 每条命令 `exit 3221225794`（0xC0000142）的宿主故障，用户重启环境后恢复；handoff §8「0xC0000142 停止重试」规则有效。
- 本机时区 Asia/Shanghai；所有跨时区测试用例均显式传参（parseIcs/buildIcs 纯函数），不依赖宿主时区。
- DSH 审批策略 never + danger-full-access；不设 sandbox_permissions。
- npm 走 npmmirror；`ical.js` 安装用 `npm i ical.js --cache ./.npm-cache`（装完删缓存）绕过 registry 元数据问题。

## 数据库 / 构建事实

- schema v4→v5：items 追加 `source_type` / `source_uid` / `source_read_only` 三列，**全部 isOptional**。原因：WatermelonDB `addColumns` 对非可选列会把既有行回填类型零值（string→''），违反「既有行不回填、读取层归一」契约；isOptional 回填 null，`toDomainItem` 归一为 `('local', null, false)`。migrations.ts 纯追加（diff 零删除行）。
- 新依赖（均已确认）：`ical.js ^2.2.1`（自带 TS 类型，无需 @types/ical）、`expo-document-picker ~14.0.8`、`expo-sharing ~14.0.8`（handoff §5 预确认）、`expo-file-system ~19.0.24`（切片中途经用户确认追加：Sharing 只接受文件 URI，落盘必须有它；与 picker/sharing 同一次重建，无额外构建成本）。
- **真机验收前必须重建 development client**（三个原生模块）。
- expo-doctor 16/18：2 个失败与切片 7 基线完全相同（app.json CNG 同步提醒；WatermelonDB/simdjson New Architecture 元数据），无新增阻塞。

## 代码地图

新增：
- `src/data/deviceTimezone.ts` — `getDeviceTzid()`；数据层不得 import src/ui，故独立于 ui/timeFormat 实现。
- `src/data/allDayNormalize.ts` — `normalizeAllDayTimestamps(startAt,endAt,allDay,tzid)`；allDay 起点归一设备时区当天 00:00（DST gap 跳过取最早整点）；endAt 永不改。
- `src/domain/ics/parseIcs.ts` — ICS→ImportedItemInput；IANA TZID 走 civilTime，非 IANA 走 ical.js VTIMEZONE，floating→设备时区。
- `src/domain/ics/buildIcs.ts` — Item→ICS；escape/fold(75 八位字节)/TZID 本地时间/VALUE=DATE/X-LIFE-STATUS:DONE。
- `src/ui/transferResultStore.ts` — 导入/导出结果的模块级单例传递。
- `src/app/settings.tsx`（导入导出入口 + 接线）、`src/app/import-result.tsx`、`src/app/export-success.tsx`。
- 测试：`allDayNormalize.test.ts`(7)、`sourceFields.test.ts`(11)、`importExport.test.ts`(13)、`parseIcs.test.ts`(15)、`buildIcs.test.ts`(14)。

修改：
- `src/db/schema.ts`/`migrations.ts`/`ItemModel.ts`、`src/domain/item.ts`（Item+ImportedItemInput+ItemSourceType）、`src/domain/views/ranges.ts`（resolveDayStart 导出）。
- `src/data/ItemRepository.ts`（4 冻结方法 + deleteItem + importItemsInBatches + ImportBatchFailure/Result）、`WatermelonItemRepository.ts`（全部实现 + updateItem/updateItemTime 只读护栏 + createImportedItem 归一）。
- `src/app/_layout.tsx`（3 路由）、`index.tsx`（设置入口）、`item/[id].tsx`（只读徽标/隐藏编辑/删除本地副本）、`item/[id]/edit.tsx`（只读拦截：提示+禁保存+隐藏标签编辑）。
- `docs/contracts/ui.md`（v0.8 两节替换，代码未改）、`data-model.md`/`repository.md`（v0.8 节，切片前已定稿）、`AGENTS.md`（v0.8 + §7.13）。
- `src/notifications/__tests__/ReminderScheduler.test.ts`：FakeRepository +6 stub（编译必需，实现文件零 diff）。

## 踩坑教训

1. **ical.js 对未注册 IANA TZID 静默按 floating 处理**（TimezoneService.has→false）。绝不能用它转 IANA 时区；探针（.tmp-ical-probe.js，已删）实测后定为「IANA 走自有 civilTime、非 IANA 走注册 VTIMEZONE」的分工。
2. `ICAL.TimezoneService.register(timezone, name?)` 参数序是时区在前；`ICAL.parse` 返回 `any`（标 unknown 会 TS2345）。
3. `getZonedParts` 无秒字段：IANA 偏移均为整分钟，秒位可从瞬时值 `((ms % 60000)+60000)%60000/1000` 推导。
4. RFC 5545 折叠按 **八位字节** 不按码元：代理对须按码点计 4 字节，否则 CJK 长标题折叠会截半个字符。
5. expo-file-system（SDK 54 / v19）主入口是 New API；legacy API（cacheDirectory/writeAsStringAsync）在 `expo-file-system/legacy` 子路径。
6. jest 模块级自增夹具 id 跨用例累积，断言不要硬编码生成值。

## 遗留披露

- **未安排项（startAt=null）导出时不写 DTSTART/DTEND**：RFC 5545 要求 VEVENT 必有 DTSTART，但伪造占位时刻（如 1970）属数据污染；选择诚实省略，外部日历表现由导入方决定。
- 导出文件**不含 VTIMEZONE**（任务卡字段清单未要求）；TZID 为 IANA 名，由外部日历自行解析（Google/Apple 均支持）。
- `DURATION` 属性不支持（DTEND 缺省即 null）；重复规则 RRULE 不导出（本库 recurrenceRule 非 ICS RRULE）。
- floating 计数仅针对 date-time；VALUE=DATE（全天）不计入 F（无时刻可解释）。
- 同文件重复 UID 保留第一条；sourceUid=null 无去重键，重复导入每次新增。
- 导入结果页数据为内存单例：进程被杀后直接打开 /import-result 显示空态（MVP 可接受）。
- listItemsForExport 固定 MVP filter（未归档 + active/done），运行时校验非固定值即抛。
- force-stop 后通知重排仍未修（切片 11 范围）；无索引性能、只读项解绑未做（任务卡明确不做）。

## 验证结果（静态 1–5）

- `npx tsc --noEmit`：0 错。
- `npx jest --runInBand`：21 套件 / **261 用例**全绿（基线 16/199 + 本切片 62；真机阶段新增 2 个 HHMM 用例）。
- `npx expo-doctor`：与切片 7 基线一致（watermelondb 新架构未标记 / simdjson 无 metadata 两条库级提示），无新增阻塞。
- 禁改区：`git diff src/domain/recurrence` 为空；notifications 四实现文件零 diff；migrations 仅追加 v5。
- 无 `any`/`as any`；无新状态库；无 rrule。

## 真机验收结果（6–14，2026-11-04，emulator-5554 / SM-S9260 / Android 15）

全部 PASS。设备数据：迁移前快照（user_version=4，7 items）→ `adb install -r` v5 APK 保留数据 → 全程真机操作。

| # | 结论 | 关键观察 |
| --- | --- | --- |
| 6 | PASS | migration v4→v5 实跑：user_version=5，新列 source_type/source_uid/source_read_only 全 NULL（设计内：读取层 `?? 'local'` 归一，WatermelonItemRepository.ts:74），7 条旧项完好 |
| 7 | PASS | 周视图边界：startAt=rangeEnd（2026-11-09T00:00Z）项整体排除（16:00Z 对照项在列、00:00Z 不在）；d-boundary.ics 导入项同规则验证 |
| 8 | PASS | 全天 toggle→拾取→保存→落库 1794182400000（归一语义成立）；深链 life://item/<id>/edit 正常 |
| 9 | PASS | SAF 导入：a N4/M0/F0/K0；重导 a N0/M4（去重）；b N3（无 UID 无去重键）；c N1/M1/F1/K0 |
| 10 | PASS | 只读四项：详情徽标「来源：ICS（只读）」/深链编辑页置顶提示+保存置灰/今日视图快速完成双向可逆/删除本地副本（DB 行删、源 ICS 原样） |
| 11 | PASS | 导出：系统分享面板「life-export-20261104-173331.ics」；文件 216 VEVENT（=库内未归档总数）、UID 零重复、X-LIFE-STATUS:DONE×2、VALUE=DATE 5 项（乙 DTSTART/DTEND 与导入一致）；外部双验（ical.js + Python icalendar）全对 |
| 12 | PASS | 今日视图：过期/已安排分组边界=endAt vs now（性能测试138 end 09:27≤now 过期、139 end 09:31>now 已安排）；乙（allDay）显示「全天」；e 后 200 条全量渲染正确 |
| 13 | PASS | tap→今日视图首帧 **2921ms**（复测 2916ms，200+ 条 dev bundle）；dev 模式 JS 渲染主导非查询，加索引收益有限，release+虚拟化是正解（任务卡要求 >1s 报告并说明） |
| 14 | PASS* | DB 行/规则/occurrenceKey 完好、导入零影响；expandOccurrences 域层探针 29 条未来正确。*已调度通知现状见下「幽灵注册表」披露 |

- 结果页文案实测：新增/跳过（重复）/浮动时间已按设备时区解释/失败 + 查看今日视图/返回设置两按钮。

## 遗留披露（真机阶段新增）

1. **时区伪影（升级切片 7 披露，影响所有设备）**：`@formatjs/intl-datetimeformat` polyfill（src/polyfill.ts:14-19，因 Hermes 缺 formatRange/dateStyle 被接管）把 `Intl` 默认时区钉死为 UTC → `getDeviceTzid()`（src/data/deviceTimezone.ts:11-17、src/ui/timeFormat.ts:14-20）恒返回 'UTC'。三层不一致：原生 DatePicker 按**系统时区**（实测 Asia/Shanghai）取 epoch、JS 显示与 allDay 归一/浮动解释按 **UTC**。本切片所有视图/归一/浮动语义在 UTC 坐标系下自洽（Asia/Shanghai 精确值由单测覆盖）；修复需原生通道或 expo-localization 新依赖 → 切片 11 前出变更提案。
2. **ics HHMM 无秒 DT 值缺陷（真机发现并已修复）**：e-perf-200.ics 首导失败 200/200（`invalid date-time value: "2026-11-04T08:04:"`）——RFC 5545 FORM #2 秒可选，ical.js 2.2.1 严格拒绝。修复：src/domain/ics/parseIcs.ts 新增 `padSecondslessDtValues(text: string): string`（regex `/^(DTSTART|DTEND)(;[^:\r\n]*)?:(\d{8}T\d{4})(Z?)(\r?\n|$)/gim` 补秒 00），parseIcs 内包一层。重导新增 200/失败 0。教训：String.replace 回调的可选捕获组是 undefined 不是空串（`params ?? ''`）。
3. **验收 14 定性：expo 通知「幽灵注册表」实锤（切片 11 预留缺口的机制定位）**：expo-notifications 的注册表在 SharedPreferences（`expo.modules.notifications.SharedPreferencesNotificationsStore.xml`，ExpoSchedulingDelegate.kt:19），包替换（install -r）/force-stop 会清掉 AlarmManager 闹钟（dumpsys alarm 0 条 active，pi_cancelled 历史）但**注册表残留**（实测 57 条 = NY 29 + yyk 28，含明天的 key）→ `getAllScheduledNotificationsAsync` 返回幽灵 keys → diffNotifications(expected,actual)=∅ → reconcile 静默无操作（三次 reconcile 零 scheduled/cancelled/failed 日志）→ 通知永不触发。 ReminderScheduler 自身逻辑无缺陷（孤儿清理/预算/窗口全按 §4.19 跑）；修法=reconcile 前比对 AlarmManager 实况或注册表失效自检，属切片 11 冻结区变更提案内容。另发现 DB 有白名单外 tzid 历史行（yykDspfiyowpUMPX daily Europe/London 挂 SeedItemA，切片 6/7 遗留），reconcile 对其正常展开无崩溃。
4. 设备自动化/环境坑（复现成本高，记录）：① `git worktree remove` 会**穿透 junction 删除主树 node_modules**（本会话真发生：life-s7 worktree 的 node_modules junction 指主树，remove 后主树 node_modules 清空、metro 随之退出；修复=npm install 重装；后续删 worktree 前先 `cmd //c rmdir <junction>` 断链）；② 新增 expo 原生模块后 `node_modules/expo/android/build` 的 ExpoModulesPackageList 不自动刷新 → 首启红屏 `Cannot find native module 'ExpoDocumentPicker'`；修法 `rm -rf node_modules/expo/android/build && ./gradlew :expo:generatePackagesList` 再 assembleDebug；③ 云机 screencap 偶发冻结帧（滑动后截屏与上一张字节相同）、`input tap` 会被进行中的 screencap 流吞掉、uiautomator dump 只含挂载行且大列表下单次可达 30s+（验收 13 的 38409ms 首测即 dump 伪影，正确测法=截屏裁剪指纹差分）；④ SAF 对同一目录反复导入后 MediaStore 索引卡死（文件实际都在）→ 新目录+MEDIA_SCANNER_SCAN_FILE 广播绕过；⑤ Windows 下 npx/cmd shim 不能套 `timeout`；⑥ adb 僵死（云机 transport 卡死 adb server）修法 `taskkill /F /IM adb.exe` 后重启 server；⑦ 有效 JDK=D:\enviroment\java\jdk\oracle-jdk-17.0.10（JAVA_HOME 原值失效）。
