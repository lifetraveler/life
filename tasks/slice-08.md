# 切片 8：ICS 导入导出 + schema v5 外部来源字段 + 契约缺陷修复

## 相关契约
- docs/contracts/data-model.md §Item 外部来源字段（v0.8）、§allDay 归一化（v0.8）
- docs/contracts/repository.md §ICS 导入导出接口（v0.8）
- docs/contracts/ui.md §修复记录（v0.8），以及 v0.7 今日/本周视图（本切片导入项会进入视图）
- docs/contracts/notifications.md §对账触发（导入完成后是否 reconcile：本切片决定，见实现要求）

## 本切片新增契约（实现后合并到对应文件）
- docs/contracts/data-model.md：追加 v0.8 节
- docs/contracts/repository.md：追加 v0.8 节
- docs/contracts/ui.md：追加 v0.8 修复记录，替换 v0.7 两处歧义条目

## 目标
1. 修复 ui.md v0.7 两处契约缺陷（对齐 repository.md，不动实现）。
2. 在 Repository 层落地 allDay 归一化，覆盖 createItem / updateItemTime / 导入路径。
3. schema v4→v5：Item 新增 sourceType / sourceUid / sourceReadOnly。
4. 实现 ICS 导入与导出，导入项立即进入切片 7 视图，只读展示。

## 允许修改/新增的范围
- docs/contracts/：ui.md / data-model.md / repository.md 按上述增量追加/替换
- src/db/：Item model 新增三字段；schema v5；migration 追加 step
- src/data/：Repository 实现 allDay 归一化、createImportedItem、findItemBySource、listItemsForExport、updateImportedItemTime；批次写入辅助
- src/domain/ics/：ICS 解析与生成的纯函数与类型；导入映射（VEVENT → ImportedItemInput）；导出映射（Item → VEVENT）；单测
- src/app/：设置页或主页菜单中的“导入 ICS”“导出 ICS”入口；导入结果页；导出成功页
- src/ui/：导入结果展示、只读项徽标
- src/app/item/[id].tsx：只读项隐藏“编辑”入口，展示“来源：ICS”徽标
- package.json：允许新增 ICS 解析依赖（见实现要求 1）
- 测试：src/domain/ics/__tests__、Repository 导入导出 mock 测试

## 禁止修改/实现
- 不修改 src/domain/recurrence/ 任何文件
- 不修改 src/notifications/ 任何文件（包括测试夹具，除非 tsc 因接口扩展失败且必须补 stub；补 stub 需在报告中逐条列出）
- 不修 force-stop 重排（独立切片）
- 不实现系统日历导入（切片 9）
- 不实现桌面小组件（切片 10）
- 不实现只读项解绑为本地项
- 不实现自定义导出范围筛选
- 不实现 ICS 的双向同步、WebCal 订阅
- 不新增状态库、重量级 UI 框架
- 不修改 v4 migration；不得清库

## 实现要求

### 1. ICS 解析依赖
- 使用 `ical.js`（Mozilla 维护，纯 JS，RN/Expo 兼容，体积约 100KB）。
- 必须覆盖：VTIMEZONE、折叠行（line folding）、转义逗号（\,）、TZID 参数、
  VALUE=DATE、缺 UID、重复 UID、floating time。
- 不维护第二套自写解析器作为 fallback。

### 2. 解析到 ImportedItemInput 的映射
- VEVENT → Item：type='event'，title=SUMMARY，content=DESCRIPTION，startAt=DTSTART 绝对时刻，endAt=DTEND 绝对时刻（缺失则 null），allDay=(DTSTART.VALUE=DATE)，sourceUid=UID（缺失则 null）。
- DTSTART 无 TZID 且非 DATE：按 ICS 规范视为 floating time，MVP 按设备当前 IANA 时区解释；在导入结果页提示“N 条浮动时间已按设备时区解释”。
- DTSTART 有 TZID：按其 IANA 时区解析为绝对时刻；不受设备时区影响。
- 无法解析的 VEVENT：不落库，进失败清单，附原因。
- 复用 UID 的 VEVENT（同文件内重复）：保留第一条，其余进“跳过（重复）”清单。

### 3. Repository 实现
- 按 docs/contracts/repository.md v0.8 节实现四个方法。
- allDay 归一化统一在 Repository 层：createItem / updateItemTime / createImportedItem 都走同一私有函数 `normalizeAllDayTimestamps(startAt, endAt, allDay)`，返回归一化后的时间。
- 归一化时显式传设备当前 IANA tzid（用现有 getDeviceTzid() 或等价工具）；不得读系统默认偏移。
- 批量写入：100 条/批，每批一个 writer 事务；单条失败记录原因并继续，不整批回滚。

### 4. 导入流程（UI）
- 入口：设置页 →“导入 ICS”→文件选择（Expo DocumentPicker）→解析→写库→结果页。
- 不在主页放导入入口；导出入口同样在设置页。
- 结果页展示：新增 N、跳过（重复）M、跳过（浮动时间已解释）F、失败 K
  （可展开失败清单，附 VEVENT SUMMARY 与原因）。
- 结果页提供“查看今日视图”按钮，直接跳到 today.tsx。
- 导入完成后触发一次 reconcile()；失败不阻断结果页展示。

### 5. 导出流程（UI）
- 入口：设置页 →“导出 ICS”→调用 listItemsForExport→生成 ICS 文件→Expo Sharing 分享或保存到本地。
- 导出 VCALENDAR 头 + 每个 Item 一个 VEVENT；VEVENT 字段：UID（用 Item.id）、DTSTAMP（导出时刻）、DTSTART、DTEND、SUMMARY、DESCRIPTION、STATUS（done 项写 CONFIRMED 加 X-LIFE-STATUS:DONE）。
- allDay=true 项用 VALUE=DATE 写 DTSTART/DTEND；endAt 为 null 时 DTEND 省略。
- 时区：写 TZID=设备当前 IANA 时区。
- 导出成功页展示条数与文件保存位置。

### 6. 只读项在 UI
- 详情页：sourceReadOnly=true 时隐藏“编辑”入口，展示“来源：ICS（只读）”徽标；显示“删除本地副本”按钮（删除即 Repository.deleteItem，不影响源 ICS）。
- 编辑页：即便通过 URL 直达，也必须在进入时检查 sourceReadOnly，命中则显示只读提示并禁用保存。
- 视图页：只读项与本地项无视觉差异，只是点击进详情后看到只读徽标。

### 7. 契约修复
- 按 docs/contracts/ui.md v0.8 修复记录更新文档；实现不动（切片 7 已按 repository.md 实现）。
- 修复必须在报告中明确“文档已改、代码未改”，并给出 diff 摘要。

### 8. 视图回归
- 导入的 ICS 事件 startAt 落在今日/本周范围内时，进入对应分组；allDay 项展示“全天”；
  sourceReadOnly 不影响分组与快速完成按钮（可完成，完成状态本地化，不回写源 ICS）。
- 导入项在视图中的完成/取消完成与本地项行为一致，触发 reconcile。

## 验收标准

### 静态与单测
1. `npx tsc --noEmit` 零错误。
2. `npx jest --runInBand` 全部通过，至少包含：
   - ICS 解析：带 TZID、无 TZID（floating）、VALUE=DATE、缺 UID、重复 UID、折叠行、转义逗号；依赖选择为 ical.js 时也要覆盖这些（用 ical.js 解析后映射到 ImportedItemInput 的逻辑）。
   - ICS 生成：allDay 项写 VALUE=DATE；非 allDay 写 TZID 参数；done 项写 X-LIFE-STATUS:DONE；DTEND 缺失时省略。
   - allDay 归一化：Asia/Shanghai 与 America/New_York 各一条，allDay=true 时 startAt 落在该时区当天 00:00；非 allDay 不变。
   - createImportedItem：sourceUid 重复时抛 DuplicateSourceUid；sourceUid=null 时允许重复。
   - 批量写入：101 条输入 → 2 批；第 50 条失败时前 49 条与后 51 条行为符合契约。
   - 导出映射：本地项、导入只读项、done 项各一条，生成 ICS 可被解析回等价的 Item 字段。
3. `npx expo-doctor` 与切片 7 基线对比：不得新增阻塞项。
4. 代码检查：
   - `git diff -- src/domain/recurrence` 为空；
   - `git diff -- src/notifications` 仅可能含测试 stub（若发生，逐条列出）；
   - `src/notifications/` 下 ReminderScheduler / reconcileDiff / computeMissed / polyfill 四个实现文件无 diff；
   - 无 `any` / `as any`；无新状态库；无 rrule。
5. `git diff -- src/db/migrations.ts` 仅追加 `toVersion: 5`，v4 step 无改动。

### 真机（development build，Android）
6. 覆盖安装，schema v4→v5 migration 执行：既有 Item 全部为 ('local', null, false)；数据未丢。
7. 契约修复验证：今日/本周视图中，切片 7 的过期/已安排分组行为不变；零时长边界项（用 sqlite 造一条 startAt=rangeEnd、endAt=null 的项）不进入已安排组。
8. allDay 归一化：编辑页把某本地项设为 allDay=true 并选 2026-11-10，落库后 startAt 为设备时区 2026-11-10 00:00 的绝对毫秒；在今日/本周视图中展示为“全天”。
9. ICS 导入：
   - 准备 3 个 ICS：a) Google Calendar 导出（含 VTIMEZONE），b) 手写无 UID 的 3 条 VEVENT，c) 含一条浮動时间、一条 有 TZID 的重复 UID。
   - 逐个导入，结果页数字与预期一致；失败清单展开可见原因。
   - 重复导入同一个 a) 文件：新增 0、跳过（重复）=N。
10. 只读项：
    - 导入项详情页展示“来源：ICS（只读）”，无“编辑”按钮；
    - 通过 URL 直达 item/[id]/edit 被拦截为只读提示；
    - 视图内快速完成有效，完成后置灰；取消完成恢复；
    - “删除本地副本”生效，视图内消失；源 ICS 文件不受影响。
11. ICS 导出：
    - 导出当前全部 Item，文件可被 Google Calendar 导入（用桌面端或在线工具验证，不要求在手机内互导）；
    - allDay 项在导出文件中为 VALUE=DATE；done 项带 X-LIFE-STATUS:DONE。
12. 视图回归：
    - 导入的今日范围内事件出现在已安排组，allDay 项展示“全天”；
    - 导入项快速完成触发 reconcile，通知取消与切片 7 行为一致。
13. 性能观察（补切片 7 遗留 #5）：导入 200 条今天范围内的项后，进入今日视图，记录从点击入口到列表可交互的耗时（粗测即可，秒表或日志打点）；若 >1s，报告并说明是否需要后续加索引。
14. Hermes 回归：切片 6 的 NY 02:30 提醒仍在，导入项不改变其 occurrenceKey 与已调度通知。

### 分支与提交
15. 按 AGENTS.md §7.8–7.11：从最新 main 新建 task/slice-08，实现、验收、commit、push、--no-ff 合并到 main、push main；closeout 随切片提交。
16. push 遇 Recv failure 先加 -c http.version=HTTP/1.1。

## 完成后输出
- 修改/新增文件列表
- 契约修复 diff 摘要（确认代码未改）
- schema v5 migration 摘要（确认 v4 step 未改）
- ICS 解析方案ical.js 
- 新增依赖名称与理由
- 执行的命令及结果
- 每条验收标准对应的测试名称或真机观察（重点：重复导入去重、浮动时间解释、只读项拦截、导出可被外部导入）
- 导入/导出结果页的实际截图或文字描述
- allDay 归一化前后的 startAt 实际值（真机数据）
- 性能观察结论（今日视图导入 200 条后的耗时）
- Hermes 回归结论
- 未完成项与风险（尤其：force-stop 重排仍未修、无索引性能、浮动时间语义、只读项解绑未做）
- 是否触碰受保护契约（应为“否”；若“是”，附变更提案）
- 分支名、commit hash、merge hash、远端核对结果
- 确认切片 9/10/11 顺序未变；确认本切片未触碰 src/notifications/ 实现文件