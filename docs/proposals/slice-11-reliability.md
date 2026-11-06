# 切片 11 可靠性变更提案

## 变更 A：设备时区来源从 Intl 切换到 expo-localization

### 问题
`src/polyfill.ts` 的 `@formatjs/intl-datetimeformat` 接管后，
`Intl.DateTimeFormat().resolvedOptions().timeZone` 恒返回 'UTC'。
`getDeviceTzid()` 依赖 Intl，导致整个应用运行在 UTC 坐标系：
- 视图“今日”按 UTC 日历日划分，北京 00:00–08:00 归属错日；
- 小组件 timeLabel 偏移 8 小时；
- allDay 归一化写入 UTC 00:00 而非设备时区 00:00。

### 方案
- 新增 `expo-localization` 依赖，`getDeviceTzid()` 改为：
  `Localization.getCalendars()[0].timeZone ?? 'UTC'`。
  该 API 同步读取系统时区，不经过 JS Intl，不受 polyfill 影响。
- `getDeviceTzid()` 是唯一改动点；`timeFormat.ts` 中同源实现一并改为调用它，
  避免两处读时区逻辑分叉。
- polyfill 本身**不删除、不修改**；它仍负责 DateTimeFormat 的格式化能力，
  只是不再被当作时区来源。

### 影响范围
- `src/data/deviceTimezone.ts`、`src/ui/timeFormat.ts`（改为共用 getDeviceTzid）。
- 所有消费 getDeviceTzid 的模块：视图 ranges、allDay 归一化、小组件快照桥、
  reminder 创建时的 tzid 默认值。行为从 UTC 变为设备真实时区。
- 不改 schema、不改 reminder 的 tzid 字段（已存 'UTC' 的 reminder 保持原 tzid，
  不自动迁移；新建 reminder 使用修正后的设备时区）。

### 回滚
- 单 commit 回退 `getDeviceTzid` 实现即可；无 schema 变更，无数据迁移。

### 已知边界
- 已有 reminder 的 tzid='UTC' 是历史数据，不自动改写；其 occurrence 仍按 UTC 展开。
  是否提供“批量修正 tzid”入口，本切片不做，留给后续。
- MuMu 模拟器上 expo-localization 是否返回真实时区，需真机/模拟器各验一次；
  若模拟器仍异常，如实记录，不把它当作修复失败的判据。

  ## 变更 B：reconcile 前校验通知是否真实存在于 AlarmManager

### 问题
force-stop / `install -r` / `pm clear` 会清掉 AlarmManager 中的真实闹钟，
但 expo-notifications 的 SharedPreferences 注册表仍保留记录。
`getAllScheduledNotificationsAsync()` 返回这些“幽灵 key”，
`diffNotifications(expected, actual)` 判定为空，reconcile 静默跳过，
通知永远不会触发。

### 方案（三选一，提案阶段先定方向，实现前二选一）
1. **保守重建（推荐）**：reconcile 检测到“注册表非空但进程刚经历 cold start 且
   AlarmManager 不可直接查询”时，先 `cancelAllScheduledNotificationsAsync()`，
   再按期望集合全量重排。
   - 优点：不依赖任何未公开的原生 API，纯 JS 可测；
   - 缺点：每次冷启动会重建全部通知，规模大时有一次性开销；
   - 幂等性：重建后 `actual` 与 `expected` 一致，后续对账恢复 diff 语义。

2. **原生查询（需要自定义 Expo Module）**：写一个 Kotlin 模块读取
   `AlarmManager` 的 pending intents，与注册表比对。
   - 优点：精准；
   - 缺点：Android 没有公开 API 枚举自己的 alarms，需要反射或
     `dumpsys` 级权限，跨版本风险高，不建议 MVP。

3. **启动标记 + 条件重建**：在 SharedPreferences 记录 `last_known_alive_ts`，
   若启动时发现 `now - last_known_alive_ts` 超过阈值（如 6 小时），
   执行方案 1 的全量重建；否则正常 diff。
   - 优点：减少冷启动重建频率；
   - 缺点：阈值是启发式，且 App 长期后台但未被杀时也会误触发重建。

### 推荐
方案 1 + 一个轻量保护：reconcile 入口增加 `forceRebuild` 参数，
由 App 启动路径在“本次是 cold start 且距离上次 reconcile 超过 1 分钟”时传 true；
`WIDGET_UPDATE` / 数据变更触发的 reconcile 仍走 diff。
这样既覆盖 force-stop 场景，又不让每次前台切换都全量重建。

### 影响范围
- `src/notifications/ReminderScheduler.reconcile` 增加可选参数 `forceRebuild`；
- `reconcileDiff` 语义不变；`computeMissed` 不变；
- 500 条通知预算逻辑不变，重排后仍按预算截断；
- 调用方（`_layout.tsx` 启动路径）传参；其他调用点保持默认 false。

### 回滚
- 单 commit 回退 `reconcile` 签名与调用方；无 schema 变更。

### 已知边界
- `forceRebuild` 时 `cancelAll` 会取消所有本 App 通知，包括非 reminder 前缀的调试通知；
  当前 App 只有 reminder 通知，可接受；若后续新增其他通知类型，需改为按前缀取消
  （此条纳入 slice-11-closeout 风险清单）。
- 全量重建期间如果进程被杀，可能出现“全部取消、部分重排”的中间态；
  下次 reconcile 会再次补全，最终一致，但存在短暂窗口无通知。

## 确认记录

用户于 2026-11-05（会话时间 Asia/Shanghai）逐项确认本提案并批准开工，决议如下：

1. **提案接受，确认开工**（变更 A = 方案 A、变更 B = 方案 1）。
2. **60s 阈值的 lastReconcileAt 来源**：取 DB 中 reminder 的 `lastReconciledAt`
   （reconcile 时 `markReminderReconciled` 已逐条持久化），经
   `WatermelonReminderScheduler` 新增非冻结类方法暴露；不引入 AsyncStorage，
   不改 Repository 冻结接口。无记录/无 reminder 时视为超时（forceRebuild=true，
   此时无现存通知可损失）。
3. **详情页「创建于时区修正前（UTC）」标注**纳入变更 A 范围
   （`src/app/item/[id].tsx` 仅此一处展示增量，满足验收 6）。
4. **文档缺陷随对应 commit 修复**：AGENTS.md 版本行 v0.10→v0.11 随提案 commit；
   ui.md:84 代码块闭合围栏与 `WidgetSnapshotWriter.ts:32` 过时注释随变更 A commit。
5. **真机验收前噪音清理**：pm clear 全清 + 重新授权通知权限 + 最小种子数据。

实现口径补充：`getDeviceTzid()` 采用任务卡的安全形式
`Localization.getCalendars()[0]?.timeZone ?? 'UTC'`（比本文正文
`[0].timeZone` 多可选链）；变更 A 提交先于变更 A 真机验收，验收通过（G2 确认）后
才开始变更 B。