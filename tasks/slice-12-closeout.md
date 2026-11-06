# 切片 12 收尾移交（closeout）

任务卡：tasks/slice-12.md。分支 task/slice-12，提交链见 §8。

## 1. 环境事实（本切片新增或再次验证）

- MuMu 模拟器 `SM-S9110`，adb transport `127.0.0.1:16416` 与 `emulator-5556` 是同一设备；
  命令统一用 `ANDROID_SERIAL=127.0.0.1:16416`。本窗口未发生隔夜重启，16416 端口未漂移。
- metro 启动命令：`npx expo start --dev-client --port 8081`（后台 job 运行）；
  杀旧 metro 用 `powershell Stop-Process -Id <pid>`（本 bash 里 `taskkill //PID` 报无效参数）。
- UI 自动化脚本位于 `$TMP`（即 `%LOCALAPPDATA%\Temp`）：
  - `driver.py`：子命令 `texts` / `tap <文本>` / `type <文本>` / `key <keycode>` / `clear`（40×DEL）/
    `ime`（dumpsys input_method 的 mInputShown）/ `tap_at x y`。
    `tap` 取第一个同文本节点——同文本节点重复出现时（如「导出 JSON」的区块标题与按钮）
    必须用 `taplast.py`（取 bounds 最下方匹配）才能命中按钮。
  - `parse_export.py`：导出 JSON 的本地解析校验。
- Python 坑：`python -c` 多行串会被 Windows shim 破坏（报 `goto :error`）→ 一律落盘脚本再执行；
  控制台输出乱码是 GBK 问题 → 必须 `export PYTHONIOENCODING=utf-8`。
- 分享面板、返回键路径：分享面板用 `input keyevent 4` 收起；收起后 App 回前台
  （这会触发切片 11 的前台 reconcile 钩子，见 §6）。

## 2. 数据库 / 构建事实

- 无 schema 变更，`PRAGMA user_version` 仍为 5；覆盖安装后旧数据完整
  （切片 11 的 2 条旧 item + 3 条旧 reminder 原样保留）。
- 真机验收种数据（`adb shell "run-as com.vibecoding.life sqlite3 life.db '...'"`，app force-stop 后直写）：
  - items：`seed-item-a`（task，start_at=1793844000000 = 2026-11-05 10:00 CST）、
    `seed-item-b`（1795136400000 = 11-20）、`seed-item-c`（1792022400000 = 10-15）、
    `seed-item-d`（content='独特关键词xyzq'）、`seed-item-e`（status='archived'）；
  - tags：`testtag`（seed-tag-1）挂 seed-item-a；
  - reminders：`seed-rem-1`（daily 10:00 Asia/Shanghai enabled=1 挂 seed-item-a）。
- 本切片无新原生模块，未重建 dev client；package.json 零改动。
- `npx expo-doctor` 16/18，与切片 11 基线完全一致（同样两项已知失败：
  non-CNG config 提示 + RN Directory metadata（watermelondb / widget-snapshot-store / @nozbe / simdjson））。

## 3. 代码地图

| 关注点 | 文件 | 说明 |
| --- | --- | --- |
| 日期片段解析 | src/domain/search.ts | `extractDateFragment(rawKeyword): string \| null`（整词匹配 YYYY / YYYY-MM / YYYY-MM-DD / MM-DD，月 1-12 日 1-31 校验）；`matchesDateFragment(instant, fragment, tzid)`（`formatLocalDate(getZonedParts(...)).includes(fragment)`）。import 自冻结区 civilTime.ts（只读） |
| 搜索日期腿 | src/data/WatermelonItemRepository.ts | `searchItems` 第 3.5 步：仅当 `extractDateFragment(trimmed)` 非 null 时，`Q.or(start_at notEq null, end_at notEq null)` 单表取行，内存对 `this.deviceTzid()` 格式化结果做子串匹配，并入 matchedItemIds（不过滤 status；跨表仍分步，LIKE 转义不变） |
| 归档查询 | src/data/ItemRepository.ts + WatermelonItemRepository.ts | 新增 `listArchivedItemsWithTags()`（v0.12 契约明文）；v0.3 `listArchivedItems` 保留不删 |
| 契约外扩展 | src/data/ItemRepository.ts + WatermelonItemRepository.ts | 新增 `listAllReminders()`（导出需要全量 reminder；文件头注按 observeItems 等先例记录理由） |
| 导出纯函数 | src/domain/export.ts | `serializeExportData(items: ItemWithTags[], reminders: Reminder[]): string`；`ExportedReminderSummary` 只含 frequency/localTime/weekdays/dayOfMonth/tzid/startAt/enabled，剔除调度器内部字段（lastFiredOccurrenceKey/lastReconciledAt）与 reminder id/itemId；孤儿提醒忽略 |
| 导出 UI | src/app/settings.tsx | `handleExportJson`（busy 复用 'export'；三列表并集→序列化→cacheDirectory→shareAsync(application/json)）；页内成功/失败提示，不用 Alert；不触发 reconcile |
| 归档页 | src/app/archived.tsx | 改调 `listArchivedItemsWithTags`；`startAt` 非 null 显示「归档前：formatItemStart(...)」；空态文案「没有已归档的条目」；失败页内红字不静默 |
| 聚焦信号 | src/ui/focusRequestStore.ts | 模块级一次性信号 `requestTitleFocus()` / `consumeTitleFocusRequest()`（transferResultStore 先例） |
| 草稿判定 | src/ui/quickAddDraft.ts | `isQuickAddDraftEmpty(title, content, tagInput, pendingTagCount)`（trim 语义，纯空白不算草稿） |
| quick-add | src/app/quick-add.tsx | replace('/') 前调 `requestTitleFocus()`；deep link `life://quick-add` 约定不变 |
| 主页 | src/app/index.tsx | `useFocusEffect` 消费聚焦信号（100ms setTimeout 避开路由动画）；BackHandler：键盘弹起时 dismiss，草稿空→blur、非空→仅收键盘保草稿；标题输入框挂 ref |
| 测试 | src/domain/__tests__/search.test.ts、export.test.ts；src/data/__tests__/searchDateMatch.test.ts、archivedWithTags.test.ts、exportData.test.ts；src/ui/__tests__/quickAddDraft.test.ts | 新增/扩展 6 个测试文件 |

## 4. 验证结果

- `npx tsc --noEmit` 零错误；`npx jest --runInBand` 29 套件 / 364 用例全过
  （切片 11 收官时为 27 套件 / 357 用例，本切片 +2 套件 +7 用例）。
- 真机（MuMu，覆盖安装，覆盖后未重建 dev client）：
  1. 覆盖安装数据不丢：schema 仍 v5，旧 item/reminder 完整。
  2. 搜索日期：`2026-11` → A+B+SLICE11-CAL-EVENT；`11-05` → 仅 A；`2026-10` → 仅 C；
     `xyzq` → D（content LIKE 不变）；`testtag` → A（tag 腿不变）；
     非日期关键词与空关键词行为不变。
  3. 归档视图往返：归档样例 E → 取消归档 → 空态「没有已归档的条目」→ 返回主页 E 回默认列表。
  4. 导出 JSON：分享面板出现 `life-export-20261106-161000.json`；页内提示
     「导出成功：…（7 条，已打开分享面板）」；文件可解析，version=1、items=7、
     5 条 seed 全在、tags/reminder 摘要齐全、无违规键、键集合单一变体。
  5. 导出不触发 reconcile：见 §6 三重证据。
  6. 快速记录：深链唤起后标题输入自动聚焦（键盘弹起）；连续创建两笔（DB 落库 jOM5MEgpA5sKhyKY / olddCFHOOasQnQG1），
     保存后键盘不收、输入清空；非空草稿按返回键键盘收起草稿保留；空草稿按返回键键盘收起并退出聚焦。
  7. 时区回归 Asia/Shanghai：日期腿用设备时区格式化的设备端证据见 §5。

## 5. 踩坑教训

- 设备端时区证据（关键）：SLICE11-CAL-EVENT 在列表显示为 UTC 时间 `2026-11-05 16:57`
  （列表 formatTimestamp 是刻意的 UTC 显示，非回归），但搜索 `11-05` 不命中它、搜索 `2026-11` 命中——
  证明日期腿确实按设备时区（Asia/Shanghai，该时刻 = 2026-11-06 00:57）格式化匹配。
- 「导出 JSON」区块标题与按钮同文本：`driver.py tap` 命中第一个匹配（标题）导致点击无效；
  需 taplast.py 取最下方匹配。教训：UI 自动化按文本点击必须防同文本多节点。
- `python -c` 多行串在本环境必然失败（Windows shim 把 heredoc 内容当批处理解析），
  一切非平凡 Python 逻辑先写文件再执行。
- 布尔 grep -c 无匹配时 exit 1 会被当作命令失败，注意与真失败区分。
- 步骤⑤的 `useFocusEffect` 里直接 focus 会撞上路由转场动画（输入框未挂稳），
  100ms setTimeout 延后聚焦解决。

## 6. 遗留披露

1. **导出与 last_reconciled_at 观察窗口**：导出操作前后 DB 的 last_reconciled_at 发生变化
   （1793952041794 → 1793952619338）。隔离实验证实该变化来自切片 11 的**前台钩子 reconcile**
   （不导出、仅 home→回前台，时间戳同样前移到 1793952752142），而非导出触发。
   「导出不触发 reconcile」的三重证据：①静态：导出代码路径无 reconcile 调用；
   ②运行时：导出前后 `dumpsys alarm` 中 vibecoding 相关条目计数 230→230 不变；
   ③因果隔离：上述纯回前台实验。
2. 列表时间显示（formatTimestamp，src/ui/display.ts:15）保持 UTC——切片 1/2 起的既定显示行为，
   本切片未改；设备时区语义只适用于日期匹配腿与「归档前」时间标签（后者走 formatItemStart，设备时区）。
3. WatermelonDB `Q.like` 无 ESCAPE 子句的库限制延续（切片 3 披露），本切片未触碰 LIKE 转义语义。
4. 导出 JSON 的 tags 只含名称数组（不含 tag id/createdAt）；Reminder 摘要不含调度器内部字段——
   均为决策 D（用户已确认）的既定取舍，重导入（若后续切片需要）不能仅凭 JSON 还原 id 关联。
5. 深链冷启动聚焦：真机验证的是温启动路径（app 已在运行）；冷启动（进程不在）时
   MainActivity 启动 → quick-add 路由 → replace('/') → 聚焦信号在首个 useFocusEffect 消费，
   理论路径相同但未单独断电验证。
6. 噪音不入库：.tmp-session-log/、modules/widget-snapshot-store/android/.gradle/ 保持未跟踪。

## 7. 提交链（task/slice-12）

- 6b0cc9d 切片 12 开工：契约 v0.12 与任务卡入库（开工前既有变更）
- 406c0cf 切片 12 搜索增强：searchItems 日期片段匹配（LIKE 语义不变，非日期关键词行为不变）
- ff81c3e 切片 12 已归档视图：listArchivedItemsWithTags 新增、archived 页升级（时间标签/契约空态/页内失败提示）
- 8ac3685 切片 12 数据导出：serializeExportData 纯函数、listAllReminders（契约外扩展）、设置页 JSON 导出（页内提示、不触发 reconcile）
- 9cab657 切片 12 快速记录：quick-add 落地后聚焦标题输入（模块级一次性信号）、返回键按草稿空/非空区分
- 本文件并入「完成切片 12：…」收尾提交。

差异规模：21 文件，+1481/−17；禁改区（src/domain/recurrence、src/notifications 实现、src/polyfill.ts、src/db）零改动，
仅 src/notifications/__tests__/ReminderScheduler.test.ts +8 行（FakeRepository 两个接口 stub，§7.13 夹具编译必需）。
