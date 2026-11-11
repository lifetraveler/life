# 变更提案：切片 16 提醒能力升级（一次性提醒 + 多渠道）

状态：**待用户确认**（2026-11-11 立项）。确认前禁止修改
data-model.md / notifications.md / src/notifications/ / reminders schema。

## 1. 原因

- 切片 15 契约化降级（ai.md v0.16）：ParsedItemDraft.reminderOffsetMinutes（一次性
  相对提醒）在冻结 Reminder 模型中无落库位置，只能“卡片保留意图 + 提示不支持”。
  用户确认需要真正落库（“就算是一次性任务也应该提醒”）。
- 用户要求提醒支持多渠道：闹钟 / 系统通知 / Apprise 推送 / Webhook。
- 冻结契约阻碍点：data-model.md §4.1 `frequency: 'daily'|'weekly'|'monthly'`；
  notifications.md 的 occurrenceKey/reconcile 契约均围绕三种重复频率设计。

## 2. 提案内容（模型扩展）

### 2.1 Reminder 模型（data-model.md §4.1 变更）

```typescript
frequency: 'daily' | 'weekly' | 'monthly' | 'once'   // 新增 'once'
// once 专用：绝对触发时刻（民用，含 tzid 语义，与现有 localTime 家族一致）
onceAt: { year: number; month: number; day: number; hour: number; minute: number } | null
// 渠道（新增；存量数据回填 'system-notification' 保持行为不变）
channel: 'system-notification' | 'alarm' | 'webhook' | 'apprise'
channelConfig: string | null   // webhook URL / apprise 配置 JSON；渠道无关时 null
```

- reminderOffsetMinutes（AI 相对提醒）落库映射：`once` + 从 Item.startAt 反推
  onceAt = startAt − offset（映射层换算，与 mapper 现有职责一致；Item 无 startAt 时
  落库为 null onceAt 并保留卡片提示——提案待确认的边界之一）。
- **替代方案（已否决）**：单独 one_shot_reminders 新表——查询/水合/响应式通知链路
  全部要双轨维护，复杂度高于加枚举值。

### 2.2 schema v7→v8（notifications.md §4.4 语义 + migrations）

- reminders 表加列：`frequency` 允许 'once'（TEXT 值域扩展，无类型变化）、
  `once_year/once_month/once_day/once_hour/once_minute`（可空 INTEGER，5 列）或
  合并为单个 `once_civil_json` TEXT（二选一，倾向后者：加 1 列，migration 最小）。
- `channel` TEXT NOT NULL 回填 'system-notification'；`channel_config` 可空 TEXT。
- 严禁重建表；addColumns 自动回填 + 显式 UPDATE 语句在 migration step 内完成。

### 2.3 调度器语义（notifications.md 变更）

- occurrenceKey：once 提醒建议 `once:<reminderId>:<onceAt epoch>`（确定性、含 tzid
  换算、与现有 `recurring:<...>` 家族不冲突；最终以提案确认稿为准）。
- reconcile/computeMissed：once 只有一个 occurrence；过火（missed）处理沿用现有
  规则；取消/删除即无 occurrence。
- identifier 仍 = occurrenceKey；tzid 白名单语义不变（once 也受白名单约束）。

### 2.4 渠道抽象（notifications.md 新增子节）

```
ReminderChannel 接口：schedule(reminder, occurrenceKey, fireAt) → handle | null
  cancel(handle) → void
实现：SystemNotificationChannel（现 expo-notifications 路径，默认）
      AlarmChannel（Android 精确闹钟：需要评估 expo-notifications 能力边界；
        大概率需 native module / expo-build-properties + 权限（SCHEDULE_EXACT_ALARM），
        属构建配置变更，§5 保护项——须单独确认）
      WebhookChannel / AppriseChannel（后台 HTTP：前台直接 fetch；后台受
        Android Doze/后台执行限制，仅承诺“App 进程存活时可靠”，不引入
        WorkManager 常驻（切片 10 契约已明确不引入）——边界如实写进 UI）
```

- 渠道失败处理：不阻塞主流程；失败记 console.warn + UI 状态标注（后续切片再议日志表）。

## 3. 影响范围

| 区域 | 变更 |
| --- | --- |
| docs/contracts/data-model.md §4.1 | frequency 枚举 + onceAt/channel/channelConfig 字段 |
| docs/contracts/notifications.md | occurrenceKey once 规则、渠道抽象、边界披露 |
| src/db/schema.ts + migrations.ts | v7→v8（reminders 加列 + 回填） |
| src/domain/reminder.ts | CreateReminderInput/Reminder 扩展 |
| src/domain/ai/mapper.ts + savePlan.ts | reminderOffsetMinutes → once 提醒落库；去掉降级提示 |
| src/notifications/（冻结区） | ReminderScheduler/渠道分发（闸门：确认后按 §7.17 模式分两次提交） |
| src/ui/ 提醒编辑 + flash 卡片 | 渠道选择/配置 UI；一次性提醒不再降级提示 |
| app.json / 构建配置 | 若走闹钟 native 路径，涉 §5 保护项（单独确认，不动 simdjson 等） |

## 4. 迁移方案与兼容

- v8 migration 自动回填 channel='system-notification'：存量提醒行为完全不变。
- once reminder 与现有三频共存：老代码路径（若无 channel 字段读取）不受影响。
- 回滚：v8 为加列迁移，回滚 = 恢复 schema v7 定义并丢弃新列数据（once 提醒数据
  丢弃可接受；channel 回填数据无独立价值）。

## 5. 待用户决策点（确认提案时一并拍板）

1. onceAt 落库形态：5 个 INTEGER 列 vs 单个 JSON TEXT 列（倾向后者）。
2. 闹钟实现路径：A) 仅 expo-notifications 全屏意图通知模拟“强提醒”（不动构建配置，
   能力有限）；B) 引入 native module + SCHEDULE_EXACT_ALARM（真闹钟，动 §5 保护项）。
3. webhook/apprise 的可靠性承诺：是否接受“仅 App 进程存活时保证发送”（不引 WorkManager）。
4. AI 相对提醒映射：Item 无 startAt 时的一次性提醒如何处理（建议：不落库 + 保留现提示）。

## 6. 回滚方案

- 分两个提交：先数据模型（schema+domain），后调度器+渠道（notifications 冻结区），
  便于独立回滚（沿 §7.17 模式）。
- 提案确认前零实现。
