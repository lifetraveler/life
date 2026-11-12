# 切片 18：多渠道同开 + 偏好持久化 + 预设默认值

## 目标
1. Schema v10：app_settings 增加 chips 偏好；channel_presets 增加 is_default；Reminder 支持多 channel。
2. 重构调度器：支持同一条提醒向多个渠道分发（含独立取消）。
3. UI 升级：表单支持多选渠道；Chips 支持自定义增量；预设默认自动选中。

## 强制实施阶段

### 阶段 1：变更提案与 Schema v10（底层与契约）✅ 已完成（2026-11-13）
- **必须先撰写变更提案** `docs/proposals/slice-18-multi-channel.md`，说明 Reminder 模型的字段变更（单值->多值字典）及兼容方案。等用户确认后再改代码。（已确认：5 决策点均按推荐）
- 修改 schema 升到 v10。✅
- `app_settings` 加 `chips_increments` (JSON，默认 `[10, 60]`)。✅
- `channel_presets` 加 `is_default` (boolean)。✅
- `reminders` 表 `channel` 迁移为 `channels_json`（数组），`channel_config` 迁移为 `channel_configs_json`（字典）。旧数据自动回填适配。✅（读层 legacy bridge，旧列保留不写）
- 更新 Domain、Repository、Scheduler 类型定义。✅（Scheduler 为阶段 1 shim：取 expo 渠道优先的单渠道投影，阶段 2 移除）
- 补充单测。✅（830 全过；tsc 0 错）

### 阶段 2：调度器多渠道并行分发 ✅（2026-11-13）
- 修改 `ReminderScheduler`。✅（scheduleForReminder/reconcile 按 channels fan-out：expo 渠道至多一个走家族感知 diff（identifier 不变，trigger.channelId 区分 system/alarm，异家族残留一并取消）；网络渠道循环独立登记复合键 `channelId|occurrenceKey` 定时器，retainReminderKeys/pruneExcept 收口）
- 遍历 `channels` 数组，为每个开启的渠道生成对应的调度任务。✅（网络 registry 升级复合键——多渠道并行后同 reminder 两个网络渠道各自持有同 occurrenceKey 定时器，slice-16 单键覆盖缺陷根治；missed 补发按（渠道×occurrence）独立判 attemptStatus，lastFiredOccurrenceKey 游标仍按 reminder 共享一次推进；shim 已移除）
- 对账（reconcile）时：确保某一个渠道如果被手动取消，不会影响其他渠道；`forceRebuild` 时全量重建所有渠道。✅（forceRebuild 清 expo 全部+registry.clearTimers 后全量重建；网络定时器每轮 reconcile 幂等重建即进程重启自愈；新增 6 个多渠道/家族切换/reconcile attempt 独立用例，838 全过、tsc 0 错）

### 阶段 3：UI 重构（表单与设置）
- **设置页**：在“我的”中增加“Chips 增量设置”（两个输入框）与“渠道预设”中的“设为默认”。
- **提醒表单**：
  - 渠道选择器改为多选（或加号新增）。
  - 快捷 Chips 读取用户自定义的增量。
  - 选中 Webhook 时，自动选中默认预设。

### 阶段 4：真机联调与收尾
- 跑通 tsc 和 jest。
- 真机验证：多选渠道下发，Webhook 和系统通知同时到达；修改并生效 Chips 增量。

## 验收标准
1. tsc 和 jest 全过。单测覆盖 Schema v10 迁移与多渠道去重。
2. 真机：建一条提醒，同时勾选“系统通知”和“Webhook（Zulip）”，到点后两者同时触发。
3. 真机：修改 Chips 配置为 `[15, 120]`，回到表单，快捷按钮显示为“+15分钟”和“+2小时”。
4. 真机：在设置里将某预设设为默认，新建 Webhook 提醒时自动选中该预设。

## 分支与提交
- 从最新 main 新建 `task/slice-18`。
- 提案确认后，分阶段提交。push 遇 reset 加 HTTP/1.1。