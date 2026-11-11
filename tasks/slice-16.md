# 切片 16：提醒能力升级（一次性提醒 + 多渠道提醒）

状态：**立项（2026-11-11，用户确认）**。开工闸门：变更提案未确认前，禁止修改
src/notifications/ 实现文件与 reminders 表 schema（AGENTS §7.26）。

## 背景与目标

切片 15 遗留两项提醒能力缺口（详见 tasks/slice-15-closeout.md 遗留披露 1）：

1. **一次性提醒**：AI 解析出“提前10分钟提醒我开 3 点的会”这类相对/绝对单次提醒，
   当前冻结的 Reminder 模型只有 daily/weekly/monthly，无法落库，只能降级为提示。
2. **提醒渠道扩展**：提醒方式不应只有一种。用户要求至少支持：
   - 系统通知（现状，expo-notifications）
   - 闹钟（强提醒：响铃/震动，越过免打扰）
   - Apprise 推送（聚合通知服务，支持 Telegram/钉钉/Bark/邮件等上百渠道）
   - Webhook（自定义 HTTP POST，用户自建接收端）

## 相关契约（须变更提案才能动）

- docs/contracts/data-model.md §4.1：Reminder.frequency 冻结 'daily'|'weekly'|'monthly'
- docs/contracts/notifications.md §4.3/4.16/4.19–4.22/4.26：ReminderScheduler、
  occurrenceKey、reconcileDiff/computeMissed、identifier=occurrenceKey、tzid 白名单
- src/domain/reminder.ts（CreateReminderInput）、src/db/schema.ts（reminders 表，当前 v7）

## 强制实施阶段（禁止一次性写完）

### 阶段 0：变更提案（docs/proposals/slice-16-reminder-channels.md）
- 列出 Reminder 模型扩展方案（一次性触发时间 + 渠道字段）、schema v8 migration、
  调度器对一次性提醒的 occurrenceKey 语义、渠道抽象与降级路径、旧数据兼容、回滚方案。
- **用户确认前不得写任何实现代码。**

### 阶段 1：数据模型与 Repository
- schema v7→v8：reminders 表扩展（一次性触发字段 + 提醒渠道/channel config），
  migration 自动回填（存量默认系统通知渠道）。
- CreateReminderInput/Reminder 领域类型扩展；WatermelonReminderRepository 适配。

### 阶段 2：调度器与渠道实现
- ReminderScheduler 扩展：一次性提醒的调度与 occurrenceKey 规则（提案确定）。
- 渠道抽象 ReminderChannel：system-notification（默认）/alarm/webhook/apprise。
- 闹钟：评估 Android 精确闹钟（AlarmManager）实现路径（expo-notifications 能力边界
  或需 native module/config plugin——以提案结论为准）。
- webhook/apprise：后台网络调用路径（App 前台/后台行为差异、失败重试与降级记录）。
  本地优先原则的例外边界须在提案中明确。

### 阶段 3：UI
- 提醒编辑 UI 增加渠道选择与渠道配置（webhook URL / apprise 配置）。
- 闪电添加：reminderOffsetMinutes 真正落库为一次性提醒，卡片不再弹降级提示。

### 阶段 4：验收
- `tsc` + `jest` 全过；新增迁移/调度/渠道单测。
- MuMu 真机：migration 实证（logcat Migrating 7→8）、一次性提醒到点触发、
  各渠道触发实证（系统通知/闹钟必测；webhook/apprise 用本地接收端实测）。
- 数据兼容：切片 15 前创建的存量提醒行为不变。

## 明确不做（本切片）
- 不做提醒的云同步/多端分发；不做 iOS 渠道验证（当前阶段 Android MVP）。
- 不引入新的全局状态库；渠道发送失败不入库日志表（后续切片再议）。
