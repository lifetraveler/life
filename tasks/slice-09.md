# 切片 9：Android 系统日历单向导入

## 相关契约
- docs/contracts/data-model.md §Item 外部来源字段（v0.8）；§allDay 归一化（v0.8）
- docs/contracts/repository.md §ICS 导入导出接口（v0.8）；§系统日历导入接口（v0.9，本切片落地）
- docs/contracts/ui.md §今日/本周视图（v0.7）；§修复记录（v0.8）
- slice-08-closeout.md（三字段存储形态、去重行为、时区伪影）

## 目标
使用 expo-calendar 读取 Android 系统日历事件，按 (sourceType='system-calendar', sourceUid) 去重，
落库为 sourceReadOnly=true 的 Item，并能在今日/本周视图中展示。
不写回系统日历，不请求写权限，不修时区伪影。

## 允许修改/新增的范围
- src/data/：importSystemCalendarEvents 实现；sourceUid 生成策略（优先 event.id，回退内容哈希）
- src/domain/systemCalendar/：事件到 ImportedItemInput 的映射纯函数；内容哈希纯函数；单测
- src/app/settings.tsx：增加“导入系统日历”入口（与 ICS 导入并列）
- src/app/system-calendar-import.tsx：日历选择 + 范围选择 + 导入结果页
- src/ui/：结果页展示组件（可复用 ICS 导入结果页的部分 UI）
- app.config.* / app.json：expo-calendar config plugin；Android 权限声明
- package.json：expo-calendar 依赖
- 测试：src/domain/systemCalendar/__tests__/、Repository 导入 mock 测试

## 禁止修改/实现
- 不修改 src/domain/recurrence/ 任何文件
- 不修改 src/notifications/ 任何文件
- 不修时区伪影（切片 11 范围）
- 不实现写回系统日历、双向同步、CalDAV
- 不实现只读项解绑为本地项
- 不修改 v5 migration；不清库
- 不请求 WRITE_CALENDAR 运行时权限
- 不承诺“读取全部系统日历”（如实记录 API 返回的日历范围即可）
- 不实现桌面小组件（切片 10）

## 实现要求

### 1. 依赖与权限
- 使用 `expo-calendar`，通过 `npx expo install expo-calendar` 安装。
- app.config 中加入 expo-calendar plugin；Android manifest 声明 READ_CALENDAR（如 plugin 要求，同时声明 WRITE_CALENDAR 但不请求运行时写权限）。
- 运行时只调用 `requestCalendarPermissionsAsync`，检查 `status === 'granted'`；拒绝后不崩溃，结果页提示“未授予日历读取权限”。

### 2. 读取流程
- 入口：设置页 →“导入系统日历”→ 选择日历（多选，默认全选 API 返回的日历）→ 选择时间范围（默认未来 90 天，可调 7/30/90/365 天）→ 导入。
- 使用 `Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)` 获取日历列表；如实展示返回结果，若 API 只返回默认日历，在 UI 提示“系统仅允许访问部分日历”。
- 对选中日历逐个调用 `Calendar.listEvents(calendarId, startDate, endDate)` 或等价 API，合并事件列表。
- 范围过滤以事件 startDate 落在 [rangeStartMs, rangeEndMs) 为准；跨范围事件（startDate < rangeStartMs 且 endDate > rangeStartMs）同样纳入。

### 3. 事件映射与去重
- 事件 → ImportedItemInput：
  type='event'；title=event.title（空则用“系统日历事件”）；content=event.notes ?? '';
  startAt=event.startDate 的毫秒值；endAt=event.endDate 的毫秒值（缺失则 null）；
  allDay=event.allDay；sourceType='system-calendar'；sourceReadOnly=true。
- sourceUid 策略：
  1) 若 event.id 非空且稳定，直接使用 event.id。
  2) 否则使用 `${calendarId}|${title}|${startAt}|${endAt}` 的 SHA-256 前 16 位十六进制。
  在结果页标注使用了哪种策略及对应条数。
- 去重：先 findItemBySource('system-calendar', sourceUid)；命中则 skippedDuplicate++，
  若命中项 sourceReadOnly=false 则 skippedReadOnlyConflict++（不覆盖本地项）。
- 批量写入沿用 importItemsInBatches，100/批。

### 4. 结果页
- 展示：读取到的事件总数、导入 N、跳过（重复）M、跳过（本地可编辑冲突）C、失败 K（可展开）。
- 提示使用的 sourceUid 策略及条数。
- 提供“查看今日视图”按钮。
- 导入完成后触发一次 reconcile()（沿用既有，不改 notifications 实现）。

### 5. 只读项在 UI
- 详情页沿用切片 8 的只读徽标逻辑；来源显示“来源：系统日历（只读）”。
- 编辑页 URL 直达拦截沿用切片 8。
- 视图内快速完成/取消完成与切片 8 行为一致。

### 6. 时区与 allDay
- allDay 归一化调用切片 8 的 normalizeAllDayTimestamps；接受当前 getDeviceTzid() 返回 'UTC' 的现状。
- 非 allDay 事件的 startAt/endAt 直接使用 API 返回的绝对毫秒值，不额外做时区转换。

## 验收标准

### 静态与单测
1. `npx tsc --noEmit` 零错误。
2. `npx jest --runInBand` 全部通过，至少包含：
   - 内容哈希 sourceUid：相同输入稳定、不同输入不同；event.id 非空时优先使用 id。
   - 事件映射：allDay true/false、endDate 缺失、title 为空、notes 为空。
   - 去重：sourceUid 命中跳过；命中本地可编辑项时进入 skippedReadOnlyConflict 且不覆盖。
   - 范围过滤：startDate 在范围内/跨范围/范围外。
3. `npx expo-doctor` 与切片 8 基线对比：不得新增阻塞项。
4. 代码检查：src/domain/recurrence 与 src/notifications 实现文件无 diff；无 any；无 rrule；migrations v5 无改动。

### 真机（development build，Android）
5. 覆盖安装，权限请求出现；拒绝后 App 不崩溃，结果页提示权限未授予。
6. 授予权限后，日历选择页展示 API 返回的日历列表；如实记录是否包含非默认日历。
7. 导入一次：结果页数字与实际系统日历事件数核对（允许因权限范围差异有偏差，但要在报告中说明）。
8. 重复导入同一范围：新增 0，跳过（重复）=首次导入数。
9. 在系统日历中修改某事件标题后再次导入：若使用 event.id 策略，命中重复（不新增）；若使用内容哈希策略，产生新项并在结果页说明。记录实际行为。
10. 导入项在今日/本周视图中出现；allDay 项显示“全天”；只读徽标正确。
11. 视图内快速完成导入项：完成状态本地化，系统日历不变。
12. 时区伪影回归：确认 allDay 归一与切片 8 行为一致（当前 UTC 坐标系）；非 allDay 事件时间显示与系统日历 App 对比，记录差异（预期因伪影可能有偏移，不得静默当作正确）。
13. 不请求 WRITE_CALENDAR：检查权限请求弹窗只涉及读取；App 无写系统日历的调用路径。

### 分支与提交
14. 按 AGENTS.md §7.8–7.11 建 task/slice-09，验收后合并；push 遇 reset 加 -c http.version=HTTP/1.1。

## 完成后输出
- 修改/新增文件列表
- expo-calendar 版本与安装方式
- sourceUid 实际策略（id vs 哈希）及条数分布
- API 返回的日历范围（是否仅默认日历）
- 每条验收标准对应的测试名称或真机观察
- 时区伪影对导入项显示的实际影响（记录偏移量）
- 未完成项与风险（权限范围限制、内容哈希重复、时区伪影未修）
- 是否触碰受保护契约
- 分支名、commit hash、merge hash、远端核对结果