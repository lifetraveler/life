# 切片 19：延迟提醒意图补全 + 默认渠道偏好 + Chip 临时编辑

## 目标
1. 修复“X分钟后提醒我”静默丢失的严重缺陷（涉及 AI 提示词、本地正则、落库映射）。
2. Schema v11：新增 `default_channels_json` 设置项。
3. 设置页支持配置默认提醒渠道；新建提醒时自动带入。
4. 长按 once 表单的快捷 Chip，支持临时修改增量值。

## 强制实施阶段

### 阶段 1：AI 域与 Schema v11 扩展
- **Schema v10→v11**：`app_settings` 加 `default_channels_json`（TEXT 列，默认存 `["system-notification"]`）。
- **AI 契约升级**：`ParsedItemDraft` 新增 `reminderDelayMinutes: number | null`。
- **Prompt 升级**：在 `src/domain/ai/prompt.ts` 中增加明确指令：“若用户表达‘X分钟后提醒我’、‘1小时后叫我’，请填入 reminderDelayMinutes，而不是 reminderOffsetMinutes”。
- **正则降级**：在 `src/domain/ai/localFallback.ts` 中增加匹配 `N分钟/小时后提醒` 的槽位逻辑。
- **单测覆盖**：正则匹配测试、Prompt 快照测试、Settings 读写默认值测试。

### 阶段 2：落库逻辑与默认渠道读取
- **落库逻辑（src/domain/ai/savePlan.ts）**：
  - 若 `draft.reminderDelayMinutes` 非空，且 `recurrence` 为空，则计算 `fireAt = now + delay * 60000`。
  - 生成一条 once 提醒配置，`onceAt` 填入由 `fireAt` 转换出的民用时间。
  - 如果此时 `draft.startAt` 为 null，不再报错“需设定时间”，而是正常落库。
- **读取默认渠道**：
  - Repository 暴露 `getSettings()`，表单初始化时如果是“新建提醒”，初始勾选状态从 `default_channels_json` 读取。

### 阶段 3：UI 适配与联调
- **设置页**：增加“默认提醒方式”多选（类似提醒表单，但只选类型，不填配置）。
- **表单接入**：新建提醒表单读取并应用默认渠道。
- **长按 Chip**：在 `src/ui/OnceAtField.tsx` 中，给 chips 增加 `onLongPress`。弹出行内小输入框，提交后更新当前组件的 state，不调用 updateSettings。
- **真机验收**。

## 验收标准

### 阶段 1 验收
1. `tsc` 和 `jest` 全过；覆盖安装后 `default_channels_json` 正确回填。
2. AI 解析（Mock）中，“10分钟后提醒我”能输出 `reminderDelayMinutes: 10`。

### 阶段 2 验收
3. 闪电添加“10分钟后提醒我出门”，保存后详情页显示“单次 (X时Y分)”且状态正常。

### 阶段 3 验收
4. 在设置页把默认渠道设为“系统通知 + Webhook”，新建提醒时表单自动勾选这两项。
5. 在表单中长按“+10分钟” Chip，改为“+20分钟”，点击生效，关闭重开表单恢复“+10分钟”（未写回全局）。
6. 真机验证：闪电添加“20分钟后提醒我拿外卖”，到点系统通知正常触发。

## 分支与提交
- 从最新 main 新建 `task/slice-19`。分阶段提交。