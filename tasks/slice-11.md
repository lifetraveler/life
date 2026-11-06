# 切片 11：可靠性切片（时区修正 + force-stop 后通知重排）

## 相关契约
- docs/proposals/slice-11-reliability.md（本切片开工前必须先确认的变更提案）
- docs/contracts/ui.md §时区来源修正（v0.11）
- docs/contracts/notifications.md §reconcile forceRebuild（v0.11）
- slice-09-closeout.md §5（时区伪影实际偏移）
- slice-10-closeout.md §5（小组件 timeLabel 偏移）、§9 遗留 1/3

## 目标
1. 修复设备时区来源：getDeviceTzid 改为 expo-localization，不再依赖被 polyfill 接管的 Intl。
2. 修复 force-stop 后通知静默丢失：reconcile 支持 forceRebuild，cold start 时全量重建。
两处变更分两次提交，可独立回滚。

## 硬闸门
- 开工前先提交变更提案并等用户确认；提案未确认前，禁止修改以下实现文件：
  src/polyfill.ts、src/notifications/ReminderScheduler*、
  src/notifications/reconcileDiff*、src/notifications/computeMissed*。
- 可以先写测试、类型和纯函数草案，但不得合入实现文件。
- 提案确认后，先提交变更 A（时区），验收通过再提交变更 B（通知）。

## 允许修改/新增的范围
- 变更 A：
  - src/data/deviceTimezone.ts（getDeviceTzid 实现）
  - src/ui/timeFormat.ts（改为调用 getDeviceTzid）
  - package.json / app.json（expo-localization 依赖与 plugin，如需要）
  - 消费 getDeviceTzid 的测试快照（预期值从 UTC 改为设备时区）
- 变更 B：
  - src/notifications/ReminderScheduler（reconcile 签名与 forceRebuild 分支）
  - src/app/_layout.tsx（cold start 传 forceRebuild）
  - src/notifications/__tests__（forceRebuild 用例）
- docs/contracts/ 与 AGENTS.md 按上述增量落盘

## 禁止修改/实现
- 不删除、不改写 src/polyfill.ts 的 polyfill 逻辑（只改时区来源，不动 polyfill 本身）
- 不改 src/domain/recurrence/ 任何文件与测试
- 不改 src/domain/views/、src/domain/widget/ 的分组与快照逻辑
- 不修改 v5 schema；不清库；不迁移已有 reminder 的 tzid
- 不实现 Android 原生 AlarmManager 查询模块（方案 2 明确不做）
- 不实现“批量修正已有 reminder 的 tzid”
- 不修改小组件快照 schema（tzid 值变化，字段不变）
- 不把两处变更混在一个 commit

## 实现要求

### 变更 A：时区
- `getDeviceTzid()` 返回 `Localization.getCalendars()[0]?.timeZone ?? 'UTC'`，
  并用 `Intl.DateTimeFormat().resolvedOptions().timeZone` 做一次开发期断言/日志对比，
  若不一致在 dev 日志中打印，不抛错。
- `timeFormat.ts` 不再自行读时区，统一调用 `getDeviceTzid()`。
- 新建 reminder 的默认 tzid 使用修正后的值；已有 reminder 不动。
- 小组件快照桥调用 `getDeviceTzid()`，快照 JSON 的 tzid 随之变化；
  快照 schema 与渲染逻辑不变。
- 测试：getDeviceTzid 的 mock 返回 Asia/Shanghai 时，视图 ranges、allDay 归一化、
  快照 timeLabel 的预期值按设备时区更新；不依赖宿主 process.env.TZ。

### 变更 B：forceRebuild
- `reconcile(options?: { forceRebuild?: boolean })`：
  - true：`cancelAllScheduledNotificationsAsync()` → 对每个 enabled reminder
    `scheduleForReminder` → 计算 missed（逻辑不变）→ 汇总。
  - false / 缺省：v0.5 原有 diff 路径，逐行不变。
- `_layout.tsx` 启动路径记录 `lastReconcileAt`；cold start 且 `now - lastReconcileAt > 60s`
  时传 true，否则 false。前台恢复仍传 false。
- 测试：mock expo-notifications，验证 forceRebuild=true 时先 cancelAll 再全量 schedule；
  forceRebuild=false 时与旧行为逐调用一致；missed 在 forceRebuild 后仍去重。

### 文档
- 按增量更新 AGENTS.md、docs/contracts/ui.md、docs/contracts/notifications.md。
- 变更提案文件保留在 docs/proposals/，不删除。

## 验收标准

### 静态与单测
1. `npx tsc --noEmit` 零错误。
2. `npx jest --runInBand` 全部通过，至少包含：
   - getDeviceTzid 在 mock Asia/Shanghai 下的视图 ranges 与 allDay 归一化；
   - 小组件快照 timeLabel 在修正时区后的预期值；
   - reconcile forceRebuild=true：先 cancelAll，再按期望全量 schedule；
   - forceRebuild=false：调用序列与旧测试完全一致；
   - forceRebuild 后 missed 不重复（连续两次 forceRebuild，第二次 missed 为空）。
3. `npx expo-doctor` 与切片 10 基线对比：不得新增阻塞项。
4. 代码检查：
   - `git diff -- src/domain/recurrence` 为空；
   - `src/polyfill.ts` 无 diff；
   - `src/domain/widget/snapshot.ts` 无 diff；
   - 无 `any`；无新增原生模块（方案 2 未做）。

### 真机（development build，Android）
5. 覆盖安装，App 正常启动；dev 日志显示 getDeviceTzid 返回 Asia/Shanghai（或模拟器真实时区），
   与 `Intl` 的 'UTC' 不一致的对比日志可见。
6. 时区回归：
   - 今日视图的“今天”范围按设备时区划分；北京时间 00:30 时不再归属前一日；
   - 非 allDay 系统日历事件显示时刻与系统日历 App 一致（不再 -8h）；
   - 小组件 timeLabel 与 App 内今日视图一致；
   - 新建 reminder 的默认 tzid 为设备时区；已有 tzid='UTC' 的 reminder 仍可展开，
     详情页标注“创建于时区修正前（UTC）”。
7. force-stop 重排：
   - 创建一条 5 分钟后触发的 daily 提醒，确认 AlarmManager 有闹钟；
   - `adb shell am force-stop` 后重开 App；
   - dev 日志显示 cold start 触发 forceRebuild，cancelAll 后重新 schedule；
   - 等待触发，通知实际弹出。
8. 二次 cold start：距上次 reconcile <60s 时重开，不触发 forceRebuild，走 diff，
   `newlyScheduled` 与 `cancelled` 为空。
9. 通知内容不变：forceRebuild 后通知 title/body/data 与重排前一致；
   identifier 仍为 occurrenceKey。
10. 小组件回归：快照 tzid 变为 Asia/Shanghai，timeLabel 正确；
    小组件点击、快速记录入口不退化。
11. 时区修正不破坏 recurrence：切片 6 的 NY 02:30 提醒仍按 America/New_York 展开，
    Hermes 下 gap 行为不变（只改 getDeviceTzid，不改 recurrence）。

### 分支与提交
12. 按 AGENTS.md §7.8–7.11 建 task/slice-11。
13. 提交顺序固定：
    a. 变更提案 commit（docs/proposals/ + AGENTS.md §7.17）；
    b. 变更 A commit（时区修正 + 契约 ui.md）；
    c. 变更 B commit（forceRebuild + 契约 notifications.md）；
    d. closeout commit。
14. push 遇 reset 加 `-c http.version=HTTP/1.1`。

## 完成后输出
- 变更提案的确认记录（用户确认时间与结论）
- 三个 commit 的 hash 与各自 diff 范围
- getDeviceTzid 修正前后的实际返回值（真机）
- 视图、系统日历事件、小组件 timeLabel 修正前后的对比值
- force-stop 前后 `getAllScheduledNotificationsAsync` 与 dumpsys alarm 的数量对比
- 每条验收标准对应的测试名称或真机观察
- 已有 tzid='UTC' reminder 的实际处理结果
- 未完成项与风险（已有 reminder tzid 未迁移、forceRebuild 短暂无通知窗口、
  模拟器时区可能仍异常）
- 是否触碰受保护契约（本切片是“经提案授权的触碰”，需附提案路径）
- 分支名、commit hashes、merge hash、远端核对结果