# 切片 14：视图架构重构 + Schema v6 + 分类与标签增强 + 导入预览

## 相关契约
- docs/contracts/data-model.md §Category 实体与 Item 关联（v0.14）
- docs/contracts/repository.md §Category 与标签接口（v0.14）
- AGENTS.md §7.21–7.23
- 截图参考：Toki 图3（Agenda 视图）、图5（筛选面板）

## 目标
1. Schema v6：新增 categories 表，Item 关联 categoryId，移除 item.color，Tag 增加 color/emoji，新增 app_settings。
2. 首页重构：实现 Agenda 视图，卡片左侧显示分类颜色条。
3. 筛选面板：按分类、日历源、标签过滤。
4. 视觉配置：支持配置 Category 和 Tag 的颜色/Emoji；支持切换 Tag 展示样式。
5. 小组件升级：快照携带分类颜色与准确时间。
6. 导入预览：导入前可查看并取消勾选。

## 强制实施阶段（AI 必须严格遵守）
本切片体量较大，**禁止一次性生成所有代码**。必须按以下阶段推进，每阶段自测（tsc + jest）通过后再继续：

### 阶段 1：数据底座与迁移
- 修改 schema 升到 v6。
- 编写 migration：建 categories/app_settings 表，插入 5 条预置分类；items 增加 categoryId/priority，tags 增加 color/emoji。
- 定义 WatermelonDB 的 CategoryModel、AppSettingsModel。
- 更新 Repository：实现 `getCategories`、`updateCategoryVisuals`、`updateTagVisuals`、`getSettings`、`updateSettings`，并扩展 Item 查询为 `ItemWithRelations`（批量查询水合）。
- 补充单测：迁移测试、Category 读写、Settings 读写（含默认值兜底）、Item 带 Category 和 Tags 的水合查询。



### 阶段 2：纯逻辑与基础 UI 组件
- 实现 Agenda 分组纯函数、筛选逻辑纯函数。
- 实现 `TagChip`、`CategoryChip` 组件（支持颜色、Emoji、不同展示模式）。
- 补充单测。

### 阶段 3：设置与配置页
- 标签/分类的视觉配置页（调色盘 + Emoji 选择）。
- App 设置页增加“标签展示模式”。
- 详情/编辑页增加分类与优先级选择。

### 阶段 4：核心页面重构（Agenda 与筛选）
- 重构主页为 Agenda 视图，接入分类颜色条。
- 实现视图切换器（日程 / 今日 / 本周 / 本月）。
- 实现 BottomSheet 筛选面板。

### 阶段 5：小组件升级
- 更新快照生成函数，携带 Category 颜色和 timeLabel。
- 更新小组件 UI。

### 阶段 6：导入预览
- 拦截 ICS 和系统日历导入，进入预览勾选页，确认后批量落库。

## 允许修改/新增的范围
- src/db/schema.ts, migrations.ts, ItemModel.ts, 新增 CategoryModel.ts, TagModel.ts, AppSettingsModel.ts
- src/domain/relations/, src/domain/views/, src/domain/tags/
- src/data/ItemRepository.ts, WatermelonItemRepository.ts, 新增 CategoryRepository.ts
- src/app/（主页、设置、详情、编辑、标签管理）
- src/ui/（TagChip, CategoryChip, 视图卡片等）
- src/domain/widget/, src/widget/
- src/domain/ics/, src/domain/systemCalendar/

## 禁止修改/实现
- 不修改 src/domain/recurrence/ 任何文件。
- 不修改 src/notifications/ 实现文件。
- 不修改 v5 之前的历史 migration。
- 不实现自定义新增/删除 Category（只允许修改颜色/Emoji）。
- 不实现闪电添加（留给切片 15）。

## 核心实现要求

### 1. 关系水合（Hydration）
- WatermelonDB 的 ItemModel 不要直接用 `@children` 或 `@relation` 强行拿 Category，因为这会导致 N+1 查询。
- 在 Repository 的查询构建器中，先查出 Items，收集所有的 `categoryId` 和 `itemId`，再用 `Q.oneOf` 批量查出 Categories 和 Tags，在内存中合并成 `ItemWithRelations` 返回。

### 2. Agenda 视图重构
- 参照 Toki 图3：每天一个分组（页头显示“周六 7”），卡片之间留白。
- 卡片左侧必须有一根 4px 宽的颜色条（来源于 Category.color），卡片内部展示 Emoji、标题和时间段。
- 对于没有 startAt 的 task（如单纯的待办），放在“今天”或“待办”分组（视当前视图而定），不显示时间段，只显示左侧颜色条和标题。

### 3. 标签视觉增强
- 标签管理页提供调色盘和 Emoji 选择。
- `TagChip` 根据 `app_settings.tagDisplayMode` 渲染：
  - text: "工作"
  - emoji: "💼"
  - both: "💼 工作"
- 背景色为 Tag 自身 color（若为 null 则透明），文字颜色需根据背景色亮度自动反色（黑/白）。

### 4. 导入预览
- 新增路由 `src/app/import-preview.tsx`。
- 数据结构：`PreviewItem = { draft: ImportedItemInput, isDuplicate: boolean, selected: boolean }`。
- 列表默认全选（排除 isDuplicate 的项），用户取消勾选后，点击确认，只落库被勾选的项。

## 验收标准

### 阶段 1 验收
1. `tsc` 零错误。
2. 覆盖安装，旧数据的 items 均关联到 `other` 分类，tags 颜色为空。
3. 查询接口能正确返回 ItemWithRelations。

### 阶段 2 验收
4. jest 单测全过，TagChip / CategoryChip 渲染逻辑正确。

### 阶段 3 验收
5. 进入分类设置，把“工作”改为黑色背景、💼 表情。
6. 进入标签设置，把“周报”改为橙色背景、📝 表情。
7. 设置页切换标签展示模式为“仅表情”。

### 阶段 4 验收
8. 主页 Agenda 视图正常展示，按日期分组。
9. 关联“工作”的任务卡片左侧是黑色条，展示 💼。
10. 筛选面板能按分类和标签多选过滤。
11. 切换视图到“本月”，日历视图或列表视图展示正常。

### 阶段 5 验收
12. 桌面小组件展示任务时，左侧带有 Category 对应的颜色小圆点。

### 阶段 6 验收
13. 导入 ICS 时弹出预览页，包含事件标题、时间、是否重复。
14. 取消勾选 2 条后，实际导入数量减少 2 条。

### 分支与提交
15. 从最新 main 新建 task/slice-14，禁止一次性写完。每阶段完成后汇报，等确认再继续。
16. push 遇 reset 加 HTTP/1.1。

## 完成后输出
- 各阶段的实际执行结果与自测情况。
- 迁移后数据库的表结构与预置数据验证。
- Agenda 视图、筛选面板、配置页的实际截图或文字描述。
- 关系水合的性能观察（用 200 条数据测一下是否会卡顿）。
- 未完成项与风险。