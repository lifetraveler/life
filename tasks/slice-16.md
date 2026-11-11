# 切片 16：提醒能力升级（一次性提醒 + 多渠道）

## 相关契约
- `docs/proposals/slice-16-reminder-channels.md`（已批准的变更提案）
- `docs/contracts/data-model.md`（v0.16 模型扩展）
- `docs/contracts/notifications.md`（v0.16 渠道抽象与 occurrenceKey 规则）

## 目标
1. Schema v7→v8：Reminder 支持 `once` 频率（JSON 存时间）和 `channel` 渠道配置。
2. 领域层与数据层适配：Repository 读写新字段，映射 AI 的一次性提醒需求。
3. 调度器重构：实现 `ReminderChannel` 抽象（系统通知、Webhook、Apprise）。
4. UI 适配：提醒编辑支持渠道配置；闪电添加的“提前提醒”正式落库。

## 强制实施阶段

### 阶段 1：数据底座与迁移（不碰调度器和 UI）
- 修改 schema 升到 v8，reminders 表新增 `once_civil_json`, `channel`, `channel_config`。
- migration 回填：`channel` 默认填 'system-notification'，其余为 null。
- 更新 `src/domain/reminder.ts` 与 Repository 读写映射。
- 补充单测：迁移测试、once 频率的读写测试。

### 阶段 2：调度器渠道抽象
- 新建 `src/notifications/channels/`。
- 定义 `ReminderChannel` 接口（schedule/cancel）。
- 实现 `SystemNotificationChannel`（把现有的 expo-notifications 逻辑迁移过来）。
- 实现 `WebhookChannel` 与 `AppriseChannel`（基于 fetch）。
- 改造 `ReminderScheduler`，根据 reminder.channel 分发调度；处理 once 频率的 occurrenceKey 规则。
- 补充单测：once 提醒的展开逻辑、渠道分发路由。

### 阶段 3：UI 适配
- 详情页的“新增/编辑提醒”弹窗增加“通知方式”选择器（系统通知、Webhook、Apprise），选择后者需配置 URL。
- `flash.tsx` 适配：`reminderOffsetMinutes` 有值时，若 Item 有 startAt，则自动生成一个 once 提醒落库，不再只给提示。

### 阶段 4：联调与真机验证
- tsc 零错误，jest 全过，真机验收。

## 阶段验收标准

### 阶段 1 验收
1. `tsc` 和 `jest` 全过。
2. 覆盖安装后，已有的旧 reminders 的 `channel` 正确回填为 'system-notification'。

### 阶段 2 验收
3. 调度器单测能覆盖 once 提醒的触发时刻计算。
4. 渠道分发：一条 Webhook 提醒，在 mock fetch 下能请求正确的 URL。

### 阶段 3 & 4 真机验证
5. 在详情页，新增一条 once 提醒并选择“Webhook”，填入测试 URL（如 webhook.site），到点后本地通知和 Webhook 网络请求同时触发。
6. 进入闪电添加，输入“明早9点开会，提前10分钟提醒”，确认添加后，详情页能看到一条“一次性提醒（08:50）”。
7. 若输入“开会，提前10分钟提醒”（无时间），点击确认后，仍保留提示“需设定时间才能提前提醒”，不落库。

## 分支与提交
- 从最新 main 新建 task/slice-16。
- 由于修改了 src/notifications/（冻结区），按提案要求拆分为两次独立提交。
- push 遇 reset 加 HTTP/1.1。