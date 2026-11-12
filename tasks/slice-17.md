# 切片 17：体验补全（渠道配置中心 + Webhook 适配 + once 时间选择器 + 导入预览）

## 目标
1. 解决 Webhook 推送内容无法被第三方接收端（如 Zulip）正确识别的问题。
2. 允许在设置页配置常用的 Webhook/Apprise 预设，详情页提醒表单支持一键选择。
3. 彻底优化 once 提醒的时间录入，引入 Picker 和快捷 Chips。
4. 补回 ICS 和系统日历的导入预览（切片 14 移出项）。

## 强制实施阶段（分 3 次提交）

### 阶段 1：数据与模型层扩展（纯逻辑，不碰 UI）
- **Webhook 载荷模板**：扩展 `Reminder` 的 `channelConfig` 或定义新类型，支持 `payloadTemplate`（例如 `{"content": "{{title}} - {{body}}"}`）或 `mode`（json/form）。
- **渠道预设表**：新增 WatermelonDB `channel_presets` 表（schema v9），存储名称、类型、配置 JSON。
- **导入预览 Data 层**：提供 `parseIcsToPreview` 等接口，只解析不落库，返回带 `isDuplicate` 标记的预览列表。
- **单测覆盖**：模板渲染测试、schema 迁移、预览标记测试。

### 阶段 2：设置页与表单重构
- **渠道预设管理**：在“我的->设置”增加“提醒渠道”入口。可新增/编辑预设（如命名为“Zulip-工作”，填入 URL，选择 template 格式）。
- **详情页提醒表单**：渠道选择 Webhook/Apprise 时，不再直接填 URL，而是从预设下拉选择；若无预设则引导去设置页。
- **once 时间录入**：引入 `@react-native-community/datetimepicker`（需 rebuild）或自研弹窗，替代纯文本输入。
- **快捷 Chips**：在时间选择器下方提供“10分钟后、1小时后、明早9点”快捷按钮。

### 阶段 3：导入预览页面重构
- 改造 `src/app/import-preview.tsx`（如果之前存在）或新建。
- UI 需求：展示即将导入的条目（标题、时间、来源），重复项默认置灰不勾选。
- 点击“确认导入”才真正调用 `createImportedItem` 落库。

## 验收标准

### 阶段 1 验收
1. `tsc` 和 `jest` 全过，迁移 v8→v9 数据正确。
2. 单测证明 Webhook 模板能正确渲染出 Zulip 要求的 payload。

### 阶段 2 验收
3. 在设置页成功创建一个“测试渠道”预设。
4. 详情页提醒弹窗中，选择该预设，无需再手填 URL；选 Webhook 类型。
5. 尝试新增一次“2月30日”的提醒，Picker 直接禁止选择，快捷 Chips 点击后自动生成合法时间并落库。

### 阶段 3 验收
6. 导入一份含 5 条（2 条已存在）的 ICS，弹出预览页显示 5 条，其中 2 条置灰默认不选。
7. 取消勾选 1 条新记录，确认导入后，数据库中只增加了 2 条记录。

## 分支与提交
- 从最新 main 新建 `task/slice-17`。
- 若阶段 2 引入原生的 datetimepicker，必须重新构建 dev client。