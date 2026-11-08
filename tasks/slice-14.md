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

### 阶段 5：UX 架构升级（Tab导航与路由重构）

根据真机实测反馈，对应用架构进行升级：

#### 1. 底部 Tab 导航（参考 Toki 图1）
- 引入 Expo Router 的 `(tabs)` 布局。
- 底部包含 4 个入口：
  - 聊天 / 闪电添加（占位）
  - 事项（占位）
  - **计划（当前主视图，将原 index.tsx 移入此处）**
  - 我的（设置页移入此处）
- 确保 Tab 切换时状态不丢失。

#### 2. 计划页（Plan Tab）重构
- **顶部去标题**：移除顶部的“life”标题。
- **引入 SVG 图标**：筛选按钮等所有图标，必须使用 `@expo/vector-icons`（如 Ionicons / Feather），不要用 emoji 或纯文字。
- **移除内嵌输入**：移除主页原有的快速录入输入框。
- **悬浮新增按钮（FAB）**：右下角增加 FAB，点击跳转到 `life://item/new`。
  - 新建页面复用标准编辑页 `item/[id]/edit.tsx` 的表单组件。
  - 保存后 `router.back()` 返回计划页并刷新列表。

#### 3. 筛选面板升级（参考 `tasks/日程筛选0.jpg`）
- 修改现有 BottomSheet（FilterSheet）：
  - **将原本在主界面的四个视图选项（日程 / 今天 / 周 / 月）移入筛选面板顶部**。
  - 下方保留分类 Chip 和标签 Chip 的选择。
- 点击“应用”后，不仅过滤数据，同时切换视图的渲染模式。

### 阶段 5b：真机反馈迭代（统一顶栏与视图收敛，2026-11-09 用户拍板）

#### 1. 统一顶栏
- 计划页顶栏改为 `[‹ 标签 ›]` + 右侧 🔍（search-outline，进独立搜索页）/ 筛选（options-outline）/「今天」pill。
- 标签随视图：日程=当前月（纯展示）；周=7 天窗日期；日=单日；月=当前月。
- `‹ ›` 步进：周 ±7 天、日 ±1 天、月 ±1 月；日程视图纯展示。

#### 2. 视图收敛为 4 个
- 日程 / 周 / 月 / 日（删除「今日」视图选项）。
- 「今天」按钮保留：日程定位今日分组、周/日锚点回今日、月回本月。

#### 3. 周视图语义（今日起 7 天）
- 计划页周视图 = 「今日起 7 天」滑动窗口（新纯函数 `getSevenDayWindow`）。
- 横向滑动（PanResponder）±7 天，`‹ ›` 同步；点击某天进入日视图。
- 原 `getWeekRange`（周一~周日）保留供 `/week` 独立页面（ui.md v0.7 契约不动）。

#### 4. 日视图（纵向时间轴）
- ScrollView + 每小时 64px；重叠事件聚类横向平分（纯函数 `layoutDayEvents` 带单测）。
- 跨午夜事件当日裁剪；全天/无时间项放时间轴上方 chip 区；当前时刻画红线。

#### 5. 月视图（富月历，react-native-calendars）
- 引入 `react-native-calendars`（纯 JS 跨平台，允许依赖）。
- FlatList 纵向无极双向滚动：每月一个日历 section，custom day 格渲染当日事件 chip ≤3 + 「+N」；周一开头；点格进日视图；「今天」滚回本月。
- 开工前核对与 RN 0.81/新架构兼容；不兼容则回退自绘月网格（纯函数 itemsByDay 仍复用）。

#### 6. 搜索独立页
- 顶栏 🔍 进入 `src/app/search.tsx`（LIKE 语义不变，§7.18）。
- 排序：有 startAt 按开始时间倒序在前；无时间按 createdAt 倒序在末尾。
- 分页 50/批，滚至距底 20 条预取。

#### 7. 筛选面板即时生效
- FilterSheet 去草稿/应用按钮，点选条件即回调；重置移面板右上角（仅清筛选，不动视图）；X/点遮罩直接关闭；视图区 4 选项。

#### 8. FAB 长按
- 长按弹「闪电录入即将上线」（切片 15 占位）；短按跳 `/item/new` 不变。

### 阶段 6：小组件升级
- 更新快照生成函数，携带 Category 颜色和 timeLabel。
- 更新小组件 UI。

### 阶段 7：导入预览
- 拦截 ICS 和系统日历导入，进入预览勾选页，确认后批量落库。

## 允许修改/新增的范围
- src/db/schema.ts, migrations.ts, ItemModel.ts, 新增 CategoryModel.ts, TagModel.ts, AppSettingsModel.ts
- src/domain/relations/, src/domain/views/, src/domain/tags/
- src/data/ItemRepository.ts, WatermelonItemRepository.ts, 新增 CategoryRepository.ts
- src/app/（主页、设置、详情、编辑、标签管理、search.tsx）
- src/ui/（TagChip, CategoryChip, 视图卡片等）
- src/domain/widget/, src/widget/
- src/domain/ics/, src/domain/systemCalendar/
- package.json 新增依赖：react-native-calendars（阶段 5b 用户拍板，纯 JS 跨平台）

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
12. `tsc` 零错误，`jest` 全过。
13. **路由结构检查**：`src/app/` 下必须存在 `(tabs)` 目录，且包含 `_layout.tsx` 和至少 4 个 Tab 页面。
14. **代码检查**：主页源码中不得出现原本的内嵌录入框；图标必须来自 `@expo/vector-icons`，严禁使用 Emoji 字符串作为图标；FAB 组件存在并绑定跳转路由。
15. **真机验证 - Tab 导航**：底部显示 4 个入口（闪电、事项、计划、我的），图标为 SVG 矢量图。点击切换正常，不闪退。
16. **真机验证 - 计划页清理**：进入“计划”页，顶部无“life”标题；无内嵌输入框；右下角显示 FAB 按钮。
17. **真机验证 - FAB 新建流程**：点击 FAB → 跳转全屏表单页 → 填写内容保存 → 自动返回计划页 → 列表立即刷新并展示新条目。
18. **真机验证 - 筛选联动**：在面板里切到“周”并应用，主页数据必须切换到本周范围渲染；切回“日程”则恢复默认。在 Tab 之间来回切换，之前的筛选状态和列表位置不丢失。

### 阶段 5b 验收
19. `tsc` 零错误，`jest` 全过（含 `getSevenDayWindow`/`getDayRange`/`itemsByDay`/`layoutDayEvents` 新单测）。
20. 顶栏：月视图 `‹ ›` 切月；周/日步进窗口；「今天」按钮各视图正确回位。
21. 周视图横滑 ±7 天流畅；点击某天进入日视图。
22. 日视图：重叠事件并排平分；跨午夜事件当日裁剪；全天项在上方 chip 区；红线在当前时刻。
23. 月视图纵向无极滚动不丢视口；当日格 chip ≤3 + 「+N」；点格进日视图；周一开头。
24. 搜索页：命中标题/内容/标签；排序符合阶段 5b-6；滚动分页正常。
25. 筛选面板：点选即时生效；重置仅清筛选；X/遮罩关闭；视图 4 选项切换后主视图渲染模式同步。
26. FAB 短按新建流程不回退（验收 17 持续有效）；长按出现占位提示。
27. Tab 来回切换，筛选状态、视图模式、列表位置不丢失。

### 阶段 6 验收
28. 桌面小组件展示任务时，左侧带有 Category 对应的颜色小圆点。

### 阶段 7 验收
29. 导入 ICS 时弹出预览页，包含事件标题、时间、是否重复。
30. 取消勾选 2 条后，实际导入数量减少 2 条。

### 分支与提交
31. 从最新 main 新建 task/slice-14，禁止一次性写完。每阶段完成后汇报，等确认再继续。
32. push 遇 reset 加 HTTP/1.1。

## 完成后输出
- 各阶段的实际执行结果与自测情况。
- 迁移后数据库的表结构与预置数据验证。
- Agenda 视图、筛选面板、配置页的实际截图或文字描述。
- 关系水合的性能观察（用 200 条数据测一下是否会卡顿）。
- 未完成项与风险。