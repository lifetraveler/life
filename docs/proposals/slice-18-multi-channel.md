# 变更提案：切片 18 提醒多渠道并行 + 偏好设置（Schema v10）

状态：**已确认**（2026-11-13 立项，用户确认 5 个决策点均按推荐：①expo 渠道互斥
②channels ≥1 强制③读层 legacy bridge④channelConfigs per-key merge（null=清除）
⑤chips 1–4 项、每项 1–10080 分钟）。确认后允许修改
data-model.md / notifications.md / repository.md / src/notifications/ 实现文件 /
reminders·app_settings·channel_presets schema。依据：AGENTS.md §7.17、§7.29。

## 1. 原因

- AGENTS.md §7.29（v0.18）四项要求：①Reminder 多渠道同开（如既发系统通知又发
  Webhook）；②once 快捷 Chips 增量持久化到 app_settings；③channel_presets 增加
  is_default 默认预设；④Schema v10 迁移，旧数据平滑升级。
- 现状模型为单渠道（`channel` + `channel_config`），无法表达"系统通知 + Webhook
  同时触发"（任务卡阶段 4 验收项）。
- 冻结阻碍点：data-model.md §4.17（reminders 字段冻结）、notifications.md
  §4.16（调度器四方法签名冻结）、repository.md §4.18（createReminder/
  updateReminder 输入形状冻结）→ 本提案即 §7.17 闸门产物，确认后按契约修订
  清单（§8）随各阶段落正文。

## 2. 提案总览

| 层面 | 变更 |
| --- | --- |
| 数据模型 | Schema v9→v10：reminders 加 `channels_json`/`channel_configs_json`；app_settings 加 `chips_increments`；channel_presets 加 `is_default`。全部 addColumns，零 SQL 回填 |
| 旧数据 | 读层 legacy bridge（`channels_json` 为空 → 由旧 `channel`/`channel_config` 推导单元素数组/字典；all-or-nothing，见 §4） |
| 调度分发 | §4.16 四方法签名不变；内部 fan-out；网络定时器复合键；expo 家族分族 diff（顺带修 slice-16 的 sys↔alarm 切换残留缺陷） |
| 偏好/预设 | chipsIncrements（默认 [10,60]，写校验 1–4 项）；isDefault（同 type 唯一，事务内保证） |
| 阶段纪律 | 阶段 1 仅类型 + schema + bridge + 单测；调度器/UI 用编译兼容 shim（§6.7），行为与 v9 等同；阶段 2 真分发，阶段 3 多选 UI |

涉及文件：`src/db/schema.ts`、`src/db/migrations.ts`、`src/db/models/`（ReminderModel、
AppSettingsModel、ChannelPresetModel）、`src/domain/reminder.ts`、`src/domain/settings.ts`、
`src/domain/channelPreset.ts`、`src/data/reminderRuleMapping.ts`、
`src/data/WatermelonItemRepository.ts`、`src/notifications/ReminderScheduler.ts`、
`src/notifications/channels/types.ts`、`src/notifications/channels/networkTimers.ts`、
`src/ui/reminderForm.ts`、`src/ui/ReminderFormEditor.tsx`、`src/ui/ReminderChannelFields.tsx`、
`src/domain/ai/savePlan.ts`、测试夹具与相关 *.test.ts、契约 ×3。

## 3. 数据模型：Schema v9→v10

### 3.1 Reminder 领域模型（data-model.md §4.17 修订）

```typescript
// 删除：channel: ReminderChannel; channelConfig: string | null
channels: ReminderChannel[]            // ≥1；至多一个 expo 渠道；去重 + canonical 序
channelConfigs: Partial<Record<ReminderChannel, string>>
                                       // 仅网络渠道条目；expo 渠道不得有条目
```

落库列（addColumns，均 isOptional TEXT）：

- `channels_json`：JSON 字符串数组，如 `["system-notification","webhook"]`；
- `channel_configs_json`：JSON 对象，如 `{"webhook":"{\"url\":...}"}`（值是渠道
  config 原文，出现双编码属正常）；
- 旧列 `channel` / `channel_config` **保留不删**（WatermelonDB 无 dropColumn），
  标记 deprecated，仅作 legacy bridge 数据源，v10 写路径不再更新它们。

### 3.2 app_settings

- `chips_increments` TEXT isOptional：JSON 数字数组（分钟），默认 `[10,60]`。
- 域对象 `AppSettings` + `chipsIncrements: number[]`；读层防御：坏 JSON/空/越界
  → 默认值；写校验：1–4 项、每项 1–10080 整数。

### 3.3 channel_presets

- `is_default` BOOLEAN 非可选：addColumns 自动回填 false（v7 widget 开关先例），
  无需 UPDATE step。
- 域对象 `ChannelPreset` + `isDefault: boolean`；Create/Update 输入加
  `isDefault?: boolean`（缺省 false）。
- 不变式：**同 type 至多一个 true**，由 Repository 写路径保证（设 true 时在同
  type 其余预设上同事务 batch 清 false；LokiJS 可测）。

### 3.4 migration step（migrations.ts 末尾追加 toVersion(10)）

- 3 个 addColumns（reminders 2 列 / app_settings 1 列 / channel_presets 1 列），
  **零 unsafeExecuteSql、零 UPDATE**；已发布 step 一律不动。
- SCHEMA_VERSION 9→10；models 同步加列声明（装饰器写法保持）。

## 4. 旧数据迁移：读层 legacy bridge（all-or-nothing）

规则（`toDomainReminder` 读路径 + 映射层实现，v8 `channel` 防御回退纪律的延续）：

1. `channels_json` 为 null/'' → 判定「未迁移旧行」：
   - `channels` = 旧 `channel` 枚举合法 ? `[channel]` : `['system-notification']`；
   - `channelConfigs` = 旧 `channel` 为网络渠道且 `channel_config` 非空
     ? `{ [channel]: config }` : `{}`。
2. `channels_json` 非空 → 判定「已迁移行」，**完全以新列为准**：
   `channel_configs_json` 为 null/''/坏 JSON → `{}`，绝不回头读旧列
   （防止"编辑清空配置后被 bridge 回魂"）。
3. 坏值防御：`channels_json` 非 JSON 数组 → 回退旧行为（bridge）；元素非法枚举
   丢弃；结果空 → 默认 `['system-notification']`；configs 值非字符串/键非法/
   键不在 channels 内 → 丢弃该条目。
4. 首次经 v10 写路径更新后新列即权威；`channels_json` 恒写非 null。

**为何不做 SQL 回填（替代方案已否决）**：①`channel_config` 是任意文本（webhook
新形态是 JSON，内含双引号），migration step 里字符串拼接转义风险高；②json1 函
数在 Android 系统 SQLite 的可用性不确定；③LokiJS 测试适配器忽略 'sql' 步骤，
SQL 回填无法被 jest 覆盖，而读层 bridge 可完整单测（满足任务卡「Schema v10 迁
移与多渠道去重」单测要求）。

## 5. 写路径校验（reminderRuleMapping.ts + WatermelonItemRepository）

输入形状（repository.md §4.18 修订）：

```typescript
CreateReminderInput {
  channels?: ReminderChannel[]            // undefined = 默认 ['system-notification']
  channelConfigs?: Partial<Record<ReminderChannel, string>>
}
UpdateReminderInput {
  channels?: ReminderChannel[]            // undefined = 保持现状
  channelConfigs?: Partial<Record<ReminderChannel, string | null>>
                                          // per-key merge；null = 清除该渠道
}
```

归一规则（多渠道版 `normalizeReminderChannelFields`，替换单渠道版）：

1. 每个元素过 `isReminderChannel`，枚举外抛错；
2. 去重 + 按 `REMINDER_CHANNELS` canonical 序排序（存储确定性）；
3. 归一后 length ≥ 1，空数组抛错（不存在"静默不提醒"的 Reminder）；
4. **expo 渠道互斥**：system-notification 与 alarm 至多其一，双开抛错（§6.3）；
5. config-free 渠道（expo 两渠道）的 config 条目静默丢弃（v9 对 expo 传 config
   置 null 的先例）；不在 channels 内的 config 条目 prune；
6. 网络渠道 config trim 后必须非空，纯空白抛错（v9 纪律）；
7. updateReminder 维持 patch-merge 语义：`channelConfigs` per-key merge（null=
   清除）后 prune 到 active channels；`FakeRepository` 夹具同步补 stub
   （§7.13 允许的编译必需改动）。

## 6. 调度器多渠道分发（src/notifications/ 冻结区变更）

### 6.1 不变的部分

- notifications.md §4.16 四方法签名（scheduleForReminder / cancelForReminder /
  cancelAll / reconcile）不变，仅内部语义升级；
- occurrenceKey 双族前缀与 `once:<reminderId>:<epoch>` 格式不变（missed 游标、
  identifier 约束、扩展机制均不动）；
- occurrence 民用时/换算/DST 语义、SCHEDULE_WINDOW_DAYS=30、cold-start >60s
  forceRebuild 均不变。

### 6.2 渠道层零改动：ScopedReminder 投影

```typescript
type ScopedReminder = Reminder & { channel: ReminderChannel; channelConfig: string | null };
scopeReminderToChannel(reminder, channelId) = {
  ...reminder, channel: channelId,
  channelConfig: reminder.channelConfigs[channelId] ?? null,
}
```

SystemNotification/Alarm/Webhook/Apprise 四个渠道实现与 channelFactory 继续消费
`reminder.channel` / `reminder.channelConfig`，**实现文件零改动**。
`channels/types.ts` 的 `ReminderChannelId` 由 `Reminder['channel']` 改为直接
引用 domain 的 `ReminderChannel`（域模型删字段后索引类型失效）。

### 6.3 expo 家族至多一渠道

system-notification 与 alarm 的 identifier 都是 occurrenceKey（§4.20），双开必
然同 identifier 互踩；修它需给 identifier 加后缀（§9 已否决）。故写路径抛错 +
UI 不提供该组合。单 expo 渠道内的 30 条/提醒上限不变。

### 6.4 scheduleForReminder fan-out（阶段 2）

```
for each channel c of reminder.channels:
  c 是 expo 渠道 → 走现有 expo diff 路径（expected keys 逻辑不变）
  c 是网络渠道   → 对窗口内每个 occurrence：
    registry.replace(c, occurrenceKey, entry{ reminderId, fireAt,
                                             reminder: scoped(c), channelId: c })
```

- cancelForReminder：expo 前缀清理 + registry.cancelByReminder（扫全渠道）不变；
- reconcile：expo 分族 diff（§6.6）+ 网络 expected 复合键收口（pruneExcept）
  + missed 游标仍按 reminder 共享；missed 补发对每个（网络渠道 × missed
  occurrenceKey）独立判 attemptStatus 抑制双发；
- 上限语义修订：30 条/提醒 → **每提醒每渠道** 30（网络定时器按渠道计数）；
  全局 500 reconcile 预算含义不变。

### 6.5 NetworkTimerRegistry 复合键（networkTimers.ts）

- timers/attempts 键由 occurrenceKey 改为 `${channelId}|${occurrenceKey}`；
  entry 增加 channelId；
- replace / cancel / attemptStatus 增加 channelId 参数；retainReminderKeys /
  pruneExcept 收复合键；cancelByReminder 语义不变；
- 此举同时根治现状缺陷：单键下同一 reminder 的两个网络渠道互踩（第二次
  replace 清掉第一个渠道的定时器）——多渠道后必然显性化，必须复合键。

### 6.6 expo 切换卫生（修 slice-16 潜在缺陷，阶段 2）

现状：sys↔alarm 切换后 occurrenceKey 相同，expo diff 视为"已存在"不重排，
闹钟行为实际不生效（latent defect）。多渠道使渠道编辑成为一等操作，必须修复。

方案：`listScheduledOurKeys` 扩展为返回 `Map<identifier, expoFamily>`，family
按 `trigger.channelId === ALARM_NOTIFICATION_CHANNEL_ID` 判 'alarm'，否则
'system'（Android）；diff 按 expected family 清异族残留 + 同族补缺。
**identifier 保持纯 occurrenceKey，§4.20 原文一字不改。**

披露：iOS 闹钟通知无 channelId，family 判定退化为旧行为（切换残留不清）；
Android 为 MVP 目标，接受该平台差异，真机验收按 Android 执行。

### 6.7 阶段 1 编译兼容 shim（临时，阶段 2 移除）

阶段 1 只改类型/Schema/bridge/校验，不改分发逻辑：调度器用
`channels.find(expo) ?? channels[0]` 取单有效渠道 + scoped config，行为与 v9
逐字节等同（存量数据均为单渠道，无观察差异），保证阶段边界 tsc/jest 全绿。
UI 同理：reminderForm 机械适配（单选值 → `channels:[x]`），多选交互阶段 3 做。

## 7. 偏好与预设（Domain + Repository）

- `AppSettings` + `chipsIncrements: number[]`（默认 [10,60]）；读防御同 §3.2；
  `updateSettings` patch 写校验（1–4 项、每项 1–10080 整数分钟）。
- `ChannelPreset` + `isDefault: boolean`；预设 CRUD 输入加 `isDefault?`；
  默认唯一性见 §3.3。

## 8. 契约修订清单（确认后随对应阶段提交正文）

| 契约 | 修订 |
| --- | --- |
| docs/contracts/data-model.md | 新增 v10 节：3 表新列、deprecated 列、legacy bridge 规则、channels/channelConfigs 语义 |
| docs/contracts/notifications.md | 新增 v0.18 节：fan-out、registry 复合键、expo 分族 diff、30/500 上限语义；声明 §4.16 签名与 §4.20 identifier 规则不变 |
| docs/contracts/repository.md | CreateReminderInput/UpdateReminderInput 形状修订、ChannelPreset isDefault、AppSettings chipsIncrements、默认预设唯一性 |
| AGENTS.md | §8 当前切片在切片收尾更新 |

## 9. 替代方案（已否决）

1. **identifier 加渠道后缀**（如 `occurrenceKey#alarm`）：修 expo 切换最省事，
   但直接违反 §4.20「identifier 必须是 occurrenceKey，不得另造 ID」原文，且
   连带改 identifier 前缀 diff/取消链路；契约代价大于收益 → 用 trigger
   channelId 分族 diff 替代。
2. **migration SQL 回填**：转义/兼容性/可测性三输（§4）。
3. **允许双 expo 渠道同开**：依赖方案 1，一并否决。
4. **允许 0 渠道 Reminder**：语义混乱且用户无感知失效 → 强制 ≥1。

## 10. 回滚方案

- v10 = 纯 addColumns + 读层 bridge，无任何数据改写。回滚 = 还原 v9 代码与
  SCHEMA_VERSION=9，v10 新列被忽略，无破坏性操作。
- 披露的数据边界：升级后编辑过渠道的 reminder，回滚后渠道呈现升级前旧值
  （新列丢弃无保全，与 v8/v9 回滚惯例一致）；is_default / chips_increments
  同丢。

## 11. 测试与验收（阶段 1 范围）

- 迁移单测：toVersion(10) 步骤断言（3×addColumns、无 unsafeExecuteSql）；
- LokiJS 仓储往返：legacy 行（channels_json=null）→ bridge 读出单元素数组/
  字典；已迁移行 configs 空不回魂（all-or-nothing）；写路径校验（空数组/双
  expo/枚举外/纯空白 config 抛错，去重 canonical 序）；
- `normalizeReminderChannelFields` 多渠道用例（v9 用例全量移植）；
- is_default 同 type 唯一性、chips 校验（越界/非整数/空 → 默认或抛错）；
- 既有 811 用例全绿（shim 行为等同）；每阶段 `npx tsc --noEmit` +
  `npx jest --runInBand`；真机验收按任务卡阶段 4（系统通知 + Webhook(Zulip)
  同触、Chips 改 [15,120]、默认预设自动选中）。

## 12. 待确认决策点

1. **expo 渠道互斥**（推荐：互斥，写路径抛错）vs 允许 system-notification 与
   alarm 同开（需 identifier 后缀化，修订 §4.20）。
2. **channels 至少 1 个**（推荐：强制）vs 允许 0 渠道（静默不提醒）。
3. **迁移形态**（推荐：读层 legacy bridge）vs migration SQL 回填。
4. **channelConfigs patch 语义**（推荐：per-key merge，null=清除）vs 整表替换。
5. **chips 校验范围**（推荐：1–4 项、每项 1–10080 分钟）vs 严格限定 2 项。

——确认以上设计与决策点后，进入阶段 1 编码（Schema v10 + Domain/Repository/
Scheduler 类型 + 单测）；未确认前不动任何实现代码。
