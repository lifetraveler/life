# 契约：构建与依赖约束

> 适用范围：依赖与 UI 库约束。
> 最后更新切片：切片 6（v0.6）
> 来源：原 AGENTS.md 4.30（2026-11 由 AGENTS.md §4 拆分迁移至此，正文逐字保留，仅标题层级调整，语义未变）
> 相关契约：构建与配置类受保护项仍在 AGENTS.md §5（原地保留，未迁移），本文件不重复其内容。

## 4.30 依赖与 UI 库约束（v0.6）
- 允许新增日期时间选择器依赖（如 `@react-native-community/datetimepicker`），必须说明理由，且只用于编辑页/Reminder 表单。
- 不得引入重量级 UI 框架（如 NativeBase、Tamagui、gluestack）或图标库全家桶；优先用现有组件与 RN 内置能力。
- 不得引入新的状态库；详情页/编辑页状态用局部 state + Repository 读取。
