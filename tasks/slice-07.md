# 切片 7：今日/本周视图

## 相关契约（先读这些，不要读 AGENTS.md §4 正文）
- docs/contracts/ui.md §今日/本周视图（本切片落地）
- docs/contracts/repository.md §视图查询接口（本切片落地）
- docs/contracts/data-model.md §Item 时间字段（schema v4，切片 6 已落地）
- docs/contracts/notifications.md §对账触发（完成/取消完成后 reconcile）

## 本切片新增契约（实现后合并到对应文件）
- docs/contracts/ui.md：用正式节替换原「今日/本周定义（预冻结）」节
- docs/contracts/repository.md：追加「视图查询接口」节

## 目标
在切片 6 的时间字段与详情页基础上，实现今日/本周视图：按设备时区分组展示过期、已安排、今日创建；支持快速完成/取消完成；点击进入详情页。
本切片不新增 schema，不新增 migration。

## 允许修改/新增的范围
- src/domain/views/：范围计算、跨天判定、分组与排序纯函数，以及单测
- src/data/：Repository 实现三个视图查询方法
- src/app/：今日/本周页面（单页切换或两页，实现中固定）、导航注册
- src/ui/：分组标题、空态、快速完成按钮等
- 测试：src/domain/views/__tests__/、Repository 视图查询的 mock 测试

## 禁止修改/实现
- 不新增 schema / migration，不加索引，不改 Item 字段
- 不修改 src/domain/recurrence/ 任何文件与测试
- 不修改 src/notifications/ 下 ReminderScheduler / reconcileDiff / computeMissed / polyfill
- 不修改 v4 migration；不清库
- 不实现 missed 正式展示
- 不实现日历网格视图、拖拽改期、重复任务在视图内的特殊渲染
- 不引入新状态库、重量级 UI 框架、rrule
- 不在视图内提供归档/删除
- 不实现下拉刷新、搜索、筛选
- 不修改 AGENTS.md §4 正文（对 AGENTS.md 的改动仅版本号与当前切片指针）

## 实现要求

### 1. 领域纯函数（src/domain/views/）
- `getTodayRange(nowMs, tzid): { startMs, endMs }`
- `getWeekRange(nowMs, tzid): { startMs, endMs }`，周一为起点
- `overlapsRange(item, rangeStart, rangeEnd): boolean`
- `groupItemsForView(input): { overdue, scheduled, createdToday }`
  - 分组与排序严格按 docs/contracts/ui.md；同一 Item 只进一个分组，优先级：过期 > 已安排 > 今日创建。
- 所有函数显式接收 tzid 或已计算好的范围，不得内部读设备时区。

### 2. Repository
- 按 docs/contracts/repository.md 实现三个方法。
- 使用 WatermelonDB 查询，不在内存全表过滤。
- 返回 ItemWithTags，字段与 listItemsWithTags 一致。

### 3. 视图页面
- 路由：src/app/today.tsx + src/app/week.tsx，或单页 plan.tsx 带切换；实现中固定，不两套并存。
- 使用 WatermelonDB 响应式查询；数据变更自动刷新。
- 分组渲染：过期 → 已安排 → 今日创建（仅今日）；空分组隐藏标题；全空显示空态 + 快速记录入口。
- 每项展示：title、type 文案、时间（已安排显示时刻或“全天”，过期显示“已过期”+endAt，今日创建显示创建时间）。
- 点击进入 item/[id] 详情页。
- 快速完成：勾选后调用 updateItem 改 status，成功后触发 reconcile()；失败回滚 UI 并提示。

### 4. 导航
- 主界面增加“今日/本周”一键入口；不得破坏切片 6 的详情页与通知跳转路由。

### 5. 对账触发
- 快速完成/取消完成后触发 reconcile()；失败不阻断 UI，记录日志。
- 视图加载本身不触发 reconcile。

## 验收标准（逐条执行并报告）

### 静态与单测
1. `npx tsc --noEmit` 零错误。
2. `npx jest --runInBand` 全部通过，至少包含：
   - getTodayRange / getWeekRange：Asia/Shanghai 与 America/New_York 各一条；跨月、跨年、周一为起点；结果与 process.env.TZ 无关。
   - overlapsRange：正常范围、跨天、allDay 单天、endAt 为 null、startAt 为 null。
   - groupItemsForView：同一 Item 同时满足过期与已安排时只进过期；done 排同组末尾；今日创建只含 active；本周视图不产生 createdToday。
   - Repository 三个方法（mock）：边界含/不含、跨天命中、archived 不返回、排序正确。
3. `npx expo-doctor` 与切片 6 基线对比：不得新增阻塞项。
4. 代码检查：
   - git diff -- src/domain/recurrence src/notifications 为空；
   - 无新增 migration；
   - src/domain/views/ 无 any / as any；
   - 视图页面未直接 import WatermelonDB database；
   - 无新状态库、无 rrule。

### 真机（development build，Android）
5. 覆盖安装，schema 仍为 v4，数据未丢。
6. 今日视图：预置“过期 / 今天 14:00 / 今天 allDay / 今天创建无 startAt / 今天 done”五条，分组与排序符合契约；done 在同组末尾。
7. 本周视图：上述项在本周范围内的出现；过期分组显示；无“今日创建”分组。
8. 时区：设备时区 Asia/Shanghai 下边界正确；能切换设备时区到 America/New_York 时确认分组边界随之变化；reminder 的 tzid 不影响分组。
9. 快速完成：勾选已安排项，完成后置灰；若该 Item 有 reminder，其通知被取消；取消完成后恢复 active。
10. 交互：点击进详情页，返回后视图状态保持；全空数据下显示空态与快速记录入口。
11. Hermes 回归：切片 6 的 America/New_York daily 02:30 reminder 仍在，视图分组不受其 tzid 影响。

### 分支与提交
12. 按 AGENTS.md §7.8–7.11：从最新 main 新建 task/slice-07，实现、验收、commit、push、--no-ff 合并到 main、push main；closeout 随切片提交。
13. push 遇 Recv failure 先加 -c http.version=HTTP/1.1。

## 完成后输出
- 修改/新增文件列表
- 确认无 schema 变更 / 无 migration
- 执行的命令及结果
- 每条验收标准对应的测试名称或真机观察（重点：分组优先级、跨天、时区边界、快速完成触发 reconcile）
- 今日/本周视图的实际截图或文字描述（覆盖：有空数据、有过期、有 allDay、有 done、全空）
- groupItemsForView 的输入输出示例（真机数据）
- 快速完成触发 reconcile 的实际返回摘要
- Hermes 回归结论
- 未完成项与风险（无索引下大数据量性能、本周视图是否显示“今日创建”的取舍、导航入口位置）
- 是否触碰受保护契约（应为“否”；若“是”，附变更提案）
- 分支名、commit hash、merge hash、远端核对结果