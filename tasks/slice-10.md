
# 切片 10：Android 桌面小组件（今日待办 + 快速记录入口）

## 相关契约
- docs/contracts/ui.md §Android 桌面小组件（v0.10，本切片落地）
- docs/contracts/ui.md §今日/本周视图（v0.7）——分组与排序规则复用
- docs/contracts/repository.md §视图查询接口（v0.7）——listOverdueItems / listScheduledItemsInRange
- slice-09-closeout.md——时区伪影现状（getDeviceTzid 返回 UTC）、android/ 裸工程已 checked in

## 目标
使用 react-native-android-widget 实现一个 4x2 桌面小组件，展示今日待办 top 5 与快速记录入口。
数据通过 App 运行时写入的 SharedPreferences 快照桥接，小组件不直接读 WatermelonDB。
不修时区伪影，不做后台定时刷新，不做小组件内完成操作。

## 允许修改/新增的范围
- src/domain/widget/：快照类型、快照生成纯函数（从视图分组结果截断 top 5）、单测
- src/data/：WidgetSnapshotWriter（写入 SharedPreferences）；不修改 Repository 接口
- src/widget/：小组件 React 组件（小组件 UI）、widget task handler（WIDGET_ADDED/UPDATE/CLICK）、
  requestWidgetUpdate 调用封装
- index.ts（或 package.json main 指向的新 entry file）：注册 widget task handler
- package.json：新增 react-native-android-widget 依赖；main 字段改为自定义 entry
- app.json / android/：react-native-android-widget config plugin；小组件 provider 声明
- src/app/_layout.tsx：处理 life://quick-add deep link
- src/app/：数据变更时触发快照写入（在切片 7 响应式查询的变更回调中 debounce 500ms 调用 writer）
- 测试：src/domain/widget/__tests__/、快照写入的 mock 测试

## 禁止修改/实现
- 不修改 src/domain/recurrence/ 任何文件
- 不修改 src/notifications/ 任何文件（包括 ReminderScheduler / reconcileDiff / computeMissed / polyfill）
- 不修时区伪影（getDeviceTzid 仍返回 UTC；快照的 timeLabel 在 UTC 坐标系下生成，如实披露）
- 不引入 expo-widgets
- 不实现后台定时刷新（AlarmManager / WorkManager）
- 不实现小组件内完成/取消完成
- 不实现多个小组件类型（只做一个 4x2）
- 不修改 schema；不清库
- 不承诺“小组件跨天自动刷新”；App 未运行时快照不更新
- 不修改 v5 migration

## 实现要求

### 1. 依赖与原生配置
- `npm i react-native-android-widget`（或 `npx expo install`，以实际兼容版本为准）。
- 按库文档配置 config plugin，声明小组件 provider、预览图、resize 模式。
- `package.json` 的 `main` 改为自定义 entry（如 `index.ts`），在 entry 中 `registerWidgetTaskHandler`。
- 因为 android/ 裸工程已 checked in，config plugin 可能不会自动同步 AndroidManifest；
  必须手工核对并补齐小组件 receiver / service 声明，记录在 closeout。
- 必须重建 development build（新增原生模块 + 新 entry）。

### 2. 快照生成（纯逻辑）
- 新增 `buildTodayWidgetSnapshot(input: { overdue: ItemWithTags[]; scheduled: ItemWithTags[]; nowMs: number; tzid: string }): WidgetSnapshot`
- 复用切片 7 的 listOverdueItems / listScheduledItemsInRange 结果，不重新实现分组。
- overdue 截断前 5，scheduled 截断前 5；排序沿用切片 7 契约。
- timeLabel 生成：allDay → '全天'；overdue → '已过期'；scheduled → 本地时刻 HH:mm（在传入 tzid 下格式化，当前为 UTC）。
- 纯函数，必须单测覆盖：空列表、恰好 5 条、超过 5 条截断、allDay、done 项是否包含（按切片 7 契约，scheduled 含 done，overdue 仅 active）。

### 3. 快照写入
- `WidgetSnapshotWriter.write(snapshot)`：通过 react-native-android-widget 提供的 SharedPreferences 桥接或库推荐的跨进程存储方式写入 `widget_today_snapshot_v1`。
- 写入后调用 `requestWidgetUpdate` 触发 WIDGET_UPDATE。
- 触发时机：
  1. App 启动后首次数据就绪；
  2. AppState 从 background 回到 active；
  3. 切片 7 的 today 视图响应式查询变更（debounce 500ms）；
  4. WIDGET_UPDATE action 内（先查 DB 生成快照再写，保证小组件添加时立即有数据）。
- 写入失败必须捕获并记录，不得崩溃。

### 4. 小组件 UI 与交互
- 4x2 布局：标题“今日”、列表最多 5 行、底部“快速记录”按钮。
- 列表项展示：title + timeLabel；点击导航到 `life://item/{id}`。
- 空状态：显示“今天没有安排”，按钮仍可用。
- 快速记录按钮：点击导航到 `life://quick-add`。
- WIDGET_CLICK action 必须处理：根据 clickAction 区分条目点击和按钮点击，分别导航。

### 5. Deep link
- `life://quick-add`：App 冷启动或前台时，导航到快速记录入口并聚焦输入框。
- `life://item/{id}`：复用切片 6 已有的详情页路由。
- 冷启动等待导航就绪再跳转；Item 不存在时显示占位页（复用切片 6）。

### 6. 测试与回归
- 快照生成纯函数单测。
- 快照写入 mock 测试（验证写入键名、触发 requestWidgetUpdate）。
- 不新增对 src/notifications/ 的任何修改；ReminderScheduler 测试的 FakeRepository 不需要新 stub（因为 Repository 接口未变）。

## 验收标准

### 静态与单测
1. `npx tsc --noEmit` 零错误。
2. `npx jest --runInBand` 全部通过，至少包含快照生成的 6 类用例（空、恰好、超 5、allDay、done 在 scheduled、overdue 仅 active）。
3. `npx expo-doctor` 与切片 9 基线对比：不得新增阻塞项。
4. 代码检查：src/domain/recurrence、src/notifications 实现文件、src/db/migrations.ts 无 diff；无 any；无 rrule；无 expo-widgets 依赖。

### 真机（development build，Android）
5. 重建 dev client 并覆盖安装，App 正常启动，无红屏。
6. 将 4x2 小组件添加到桌面：初始显示“今天没有安排”或已有数据；点击“快速记录”唤起 App 并聚焦输入。
7. 在 App 中创建/修改今日范围内的 Item：切回桌面后小组件在数秒内更新（验证 debounce + requestWidgetUpdate）。
8. 点击小组件中的条目：导航到对应详情页；删除该 Item 后再点，进入占位页。
9. 空状态与有数据状态切换：清空今日数据后小组件显示空状态；重新添加后恢复。
10. 时区伪影记录：在 UTC 坐标系下，scheduled 项的 timeLabel 与 App 内今日视图显示一致（预期偏移 8h，如实记录，不静默当作正确）。
11. 跨天刷新限制：不打开 App 的情况下，次日小组件仍显示前一日快照；打开 App 后更新。如实记录该行为。
12. 不触碰冻结区：确认 src/notifications 实现文件无 diff；确认未引入 expo-widgets。
13. 不实现小组件内完成：确认小组件 UI 无完成/取消完成按钮。

### 分支与提交
14. 按 AGENTS.md §7.8–7.11 建 task/slice-10，验收后合并；push 遇 reset 加 -c http.version=HTTP/1.1。

## 完成后输出
- 修改/新增文件列表
- react-native-android-widget 版本与 entry 文件路径
- android/ 裸工程中手工补齐的 manifest 声明（如有）
- 快照生成的实际 JSON 示例（真机数据）
- 每条验收标准对应的测试名称或真机观察
- 时区伪影对小组件 timeLabel 的实际影响（偏移量）
- 跨天刷新限制的实际观察（次日不打开 App 时的快照行为）
- 未完成项与风险（后台刷新未做、时区伪影未修、小组件内完成未做）
- 是否触碰受保护契约
- 分支名、commit hash、merge hash、远端核对结果