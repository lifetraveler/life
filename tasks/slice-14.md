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

### 阶段 5c：真机反馈迭代 2（2026-11-09 用户 8 条反馈，方案 m00930/拍板 m00931）

#### 1. 年月选择器
- 任意视图左上角标签：今年只显月份（「11月」）、非今年显月+年（「2027年1月」）；
  周/日跨度标签跨年才带年。
- 点击标签弹出年月选择器（自绘浮层 `MonthPickerPopover`：‹年份› 步年 + 12 月宫格，
  当前月黑胶囊高亮；react-native-calendars 无该形态 → 零新依赖自绘，用户拍板）。
- 选择后落点：month→切月；week/day→锚定该月 1 日；agenda→滚动定位该月第一组。

#### 2. Agenda 无缝与标签跟随
- agenda 上下滑无缝加载前后记录（全量数据链既有）；顶栏月份跟随首可见分组
  （onViewableItemsChanged）自动变化；「今天」按钮滚动定位今日分组。

#### 3. 月视图空白格修复
- `MonthCalendarView` 预取阈值 1.5→0.5（初始双发 prepend 把视口顶推入空月，
  Android maintainVisibleContentPosition 不可靠）；新增渲染回归测试锁定 chip/日号输出。

#### 4. 日视图修复与横滑
- 两列结构：左 44px 时间标签列 + 右 flex:1 事件画布（块坐标百分比相对画布，
  修复 5b 版事件块盖住时间列）；横滑（PanResponder）±1 天切前后日。

#### 5-6. 周视图单日态 / 整周态
- 顶栏 ‹›箭头仅月视图保留（week/day 靠周条与横滑）。
- 周视图默认单日态：点周条某天只切换选中天（列表=该天记录，日程排版），不跳日视图。
- 工具栏「周」pill 切整周态（7 天按天分组，日程排版；pill 有激活态黑底白字区分）；
  整周态点某天 → 切回单日态并选中该天（拍板 m00931-②）。
- 日视图（时间轴）入口只剩筛选面板「单日」选项 + 月历点格。

#### 7. 已归档移入筛选面板
- 主页删除「已归档」链接行；FilterSheet 底部操作区首行「已归档」
  （archive 图标 + 右箭头，点击关面板跳 /archived）。

#### 8. 筛选面板底部操作行（占位）
- 「订阅日历/智能颜色编码/更多日历设置」3 行占位（点击 Alert「即将上线」），
  功能留后续切片。

### 阶段 5d：真机反馈迭代 3（2026-11-09 用户 5 条反馈，拍板 m01286）

#### 1. 顶栏标签统一与年月选择联动
- 四视图左上标签一律只显月：本年「11月」/非本年「2025年11月」（agenda 仍跟随
  首可见分组月；week/day 跟随锚点民用月；month 跟随锚点月）。
- 选择器弹出位置：顶栏标签正下方（card top:96 left:16），不再顶到屏幕左上角。
- 选择后联动：month→切月；day→同月同日（日号超目标月天数收敛到月末，
  daysInMonth）；week→周序不变（当前自然周在「周一所在月」第几周 → 目标月同序
  自然周，`nthMondayDateOfMonth`，周数不足回退最后一周）；agenda→定位该月第一组。

#### 2. 模块间距标准
- 日视图时间轴顶部与周条拉开 16px（`SECTION_GAP=16`，区块间距标准值，
  plan.tsx 与 DayTimelineView 同源），修复 00:00 与上方工具栏重合。

#### 3. 切换动效
- 周条自然周变化：按切换方向平移淡入（36px，150ms，Animated/Easing.out cubic）。
- 日视图切日：按方向平移淡入（40px，200ms），方向由组件内前后 dayStartMs 自算。

#### 4. 滑动语义（拍板 m01286）
- 7 天头横滑 = 整周 ±1（自然周对齐，±7 天恒落在周一）。
- 内容区横滑（周视图）= 选中日 ±1；整周态 = 整周 ±1；日视图时间轴 = 选中日 ±1。
- 选中日走出当前自然周时周条整体切换（周条数据源=getWeekStart 自然周，
  周视图整周态窗口同步 getWeekRange）。

#### 5. 月历空格子
- 去掉格子边框/圆角（无项目保持空白），有项目格子由 chip 自带背景承载视觉。
- 压掉 react-native-calendars 自带英文月头（「October 2026」，真机发现）：
  Calendar 传 `customHeader={() => null}` 整体替换头部组件（该库 headerStyle
  prop 传入后组件内部并不消费，无法用样式压扁）。

### 阶段 5e：真机反馈迭代 4（2026-11-09 用户 3 条反馈，方案 m01618/确认 m01619）
- 周条 chip 定高（height 62）、「今天」黑点改 absolute 定位——切日后选择框高度不再跳动。
- agenda 重构为「3 月窗口」无限列表：agendaPages 初始 4 页（生效月前 2 页缓冲）、
  每页首行为月名标题行（agendaRows 生成），onScroll/onScrollEndDrag 在 offset<50 时
  prepend 上月、onEndReached append 下月（各 1200ms 防重入）；左上标签=生效月随视口联动；
  年月选择器选月=重置窗口+jumpKey 重挂+scrollToOffset 定位到该月名行（无数据也生效）。
- 定位实现教训（真机/Fabric 实锤）：initialScrollIndex 估算不稳定且失败时会触发
  onScrollToIndexFailed 兜底把视口拉回 offset 0，同时伴随窗口渲染残废（组头在卡片行
  缺失）；effect 内 setState 改自身 deps 会触发 cleanup 清掉延迟滚动 timer；scrollTo*
  失败被 logcat 管道失效（MuMu logcat 无 ReactNativeJS 输出）误导多轮。最终方案：
  月名行定高（marginTop 28 + height 53 + marginBottom 4 = 85px/块），
  offset = 目标页序 × 85 精确 scrollToOffset。
- overscroll 标签联动死角：Android 滚动到顶后 overscroll 不再发 onScroll，
  prepend 后 350ms 将生效月同步到新顶页（lastPrependedRef）。
- 「待办」组（startAt 为 null 的条目）仅在 agenda 视图显示，week/day 视图过滤。

### 阶段 5f：真机回归修复（2026-11-09 用户 3 bug，提交后真机复验通过）
- 00:00 标签被裁一半：日时间轴 gutter 标签 top 改 Math.max(0, hour*HOUR_PX-6)
  （负偏移被 Android clipChildren 裁掉）。
- 跨天任务只显示第一天：dayTimeline 过滤改「与当日区间相交」
  （startAt < endMs && (endAt ?? startAt) > startMs），layoutDayEvents 的
  0..1440 裁剪把后续日呈现为 00:00 到结束时刻（11-10 显示 00:00-13:45 块）。
- 月历左上标签不随滚动联动 + 今天定位露上月：MonthCalendarView 增加
  onVisibleMonthChange（FlatList onViewableItemsChanged 首可见页回调）与
  jumpToMonth/jumpKey 定位（scrollToIndex + onScrollToIndexFailed 400ms 重试，
  不做「跳近似位置」——highestMeasuredFrameIndex=0 会滚回顶）；计划页
  monthDayItems 改全量 itemsByDay（联动切月不影响各页 chip）。

### 阶段 5g：真机回归修复 2（2026-11-09 用户 3 bug，真机复验通过）
- 日程「点今天」不跳今日组：goToday 的 agenda 分支从「定位月名行」升级为
  AgendaJumpTarget（day=civilKey 今日组 / month=月名行），冷启动初值=今日组。
- 今日组定位链（排障实锤 4 层）：①onScroll 里 offset<50 的 prepend 守卫在
  FlatList 重挂首帧（key 变化）也会以 y=0 触发，把定位好的组头顶下去——
  prepend 触发源改 onScrollEndDrag/onMomentumScrollEnd（仅用户手势），onScroll
  只记 lastAgendaOffsetRef；②Fabric 下 scrollToIndex 对 window 外未测量行
  静默无效果（不滚、也不触发 onScrollToIndexFailed）——先按平均行高估算
  offset 大跳把窗口推近；③Android FlatList 子项用 transform 定位，item 内
  View 的 onLayout.y 恒≈0 不可用——今日组头挂 ref，精修用 measureInWindow
  （header 窗口 y − 列表窗口 y + 当前 offset）；④最终真因=今日组接近列表
  末尾、末尾内容不足一屏，max offset 卡在贴顶之前（header offset 1027.5 >
  max offset 970，差 57.5 物理滚不到）——agenda 列表底部补
  paddingBottom≈0.9×屏高 filler，今日组可贴顶。
- 前两条用户 bug（学习不并排/周视图不展示）复现时数据链与 4-lane 布局实测
  正常，未复现（疑为旧状态/anchor 不在当天），待用户再报。

### 阶段 5h：真机回归修复 3（2026-11-09 用户 3 bug，真机复验通过）
- 新增带时间项落进「待办」、再操作一下旧项才「挪到对应日」：根因=WatermelonDB
  `Query.observe()` 只在「匹配集合成员」变化时发射（processChangeSet 按记录集合
  diff），行内字段更新（成员不变）不发射。新增保存链是 createItem → updateItemTime
  两步写，第二步的时间字段属成员不变的字段级变化，列表永远停在「无时间」中态；
  用户后来编辑改时间（updateItem 路径同为字段级）才触发一次「挪动」错觉。
  修复：observeItemsWithTags / observeItems / observeTags / categories 订阅全部改
  observeWithColumns 列订阅（ITEM_WATCH_COLUMNS / TAG_WATCH_COLUMNS /
  CATEGORY_WATCH_COLUMNS，item_tags join 表保持 observe()——关联增删本就是成员变化）。
- 周视图新增数据要「操作下一条才加载上一条」：同一根因（同一订阅源），同修复。
- 月历点「今天」先闪 9 月再跳：页窗口重置 effect 与 80ms scrollToIndex 之间存在
  视口中间态；改 key 重挂 + initialScrollIndex 渲染期定位（同 agenda 5g 方案），
  jump effect 保留作重挂后精修，onScrollToIndexFailed 400ms 重试兜底。
- 真机闭环：P5Hwk/P5Hwk2/P5Hwk3 三条带时间项保存后均直接落位「今天」组；
  月历滚远（停顿后）点「今天」一次直达本月页。
- 用户复报：日程点「今天」瞬态=先跳 9 月再回今天（此前截图间隔 2.5s 漏捕瞬态）。
  根因=FlatList key 重挂后首帧从 offset 0 渲染（4 页窗口首月=9 月），400ms 定位
  timer 期间显示列表顶。修复：去重挂，scrollToOffset 估算不依赖行测量改为立即
  执行+120ms measureInWindow 精修。连拍验证（点击后每 ~0.4s 一帧）：全程左上
  标签「11月」无 9 月闪现；估算跳先过冲（11 月尾+12 月中转）~0.4s，~0.8s 即位
  今天组贴顶。

### 阶段 6：小组件升级（适配新数据关系）

#### 目标
让桌面小组件不仅展示任务标题和时间，还能展示该任务关联的 Category 颜色点。

#### 核心要求
1. **快照 Schema 升级**：
   - 修改 `src/domain/widget/snapshot.ts` 中的快照类型。
   - 为每个 Item 增加 `categoryColor: string | null` 字段（取值自 `ItemWithRelations.category?.color`，缺省回退 `#9E9E9E`）。
   - 由于阶段 5 已将“无时间的待办”移出主列表，小组件的“今日待办”数据源需调整：仅拉取今天有过期/已安排的任务（不再包含无时间的纯待办，除非它今天到期）。
2. **小组件 UI 更新**：
   - 修改 `src/widget/TodayWidget.tsx`。
   - 在每一项的最左侧渲染一个 8x8 的彩色圆点或 2px 的竖条，使用 `categoryColor` 作为背景色。
3. **刷新时机验证**：
   - 由于 WatermelonDB 的 `observe` 不监听行内字段更新，需确认在修改了 Item 的 category、或修改了 Category 的颜色后，小组件快照能否在 App 运行期间正确重新生成并推送到桌面。

#### 实现记录（2026-11-09）

- 阶段 5（commit 6ad24f5）已提前落地大半：快照条目 `categoryColor` 字段
  （snapshot.ts，`item.category?.color ?? null` 原样携带）；WidgetSnapshotWriter
  narrowEntry 兼容旧快照（无字段 → null）；TodayWidget 已渲染 8×8 色点；快照
  单测覆盖取色透传与 null。数据源经 5h 收窄为「今日已安排 + 过期」
  （scheduledInRangeQuery 要求 start_at 非空，无时间纯待办不进快照；§7.16 冻结
  语义，不加待办区）。
- A｜新增 `src/domain/widget/categoryDot.ts`：`WIDGET_DEFAULT_CATEGORY_COLOR`
  常量 + `resolveCategoryDotColor()`（合法 #RRGGBB 原样透传，null/非法回退
  `#9E9E9E`，与主页色条 AgendaItemCard FALLBACK_BAR_COLOR 同规则）；widget/index.ts
  转出；TodayWidget.tsx 色点改调该函数（回退不再用 palette muted）。
- B｜`WatermelonItemRepository` 的 observeScheduledItemsInRange / observeOverdueItems
  item 源由手写列清单（scheduled=['status','start_at','end_at','all_day']、
  overdue=['status','end_at']）统一改为 `observeWithColumns(ITEM_WATCH_COLUMNS)`
  （含 category_id 与 title）——修复「改任务分类 / 改标题后快照与视图列表不刷新」；
  改 Category 颜色的刷新链路 5h 已修（CATEGORY_WATCH_COLUMNS），此处补发射单测锁住。
- C｜新增 `src/domain/widget/__tests__/categoryDot.test.ts`（默认色常量、透传、
  null/非法回退）；viewQueries.test.ts 新增 2 条发射用例：行内改 categoryId →
  重发射并水合新分类色；updateCategoryVisuals 改色 → 重发射
  （FIFO waiters + sleep(500) 超时兜底，同既有发射测试模式）。
- D｜`npx tsc --noEmit` 零错误；`npx jest --runInBand` 40 套件 499 用例全过
  （原 492 + 新增 7）。


### 小组件升级 7a：滚动列表 + 三段式快照 + 显示开关（2026-11-09，提案 docs/proposals/slice-14-widget-phase7.md）

#### 目标（用户 4 需求的第 1/2 条，需求 3/4 留 7b/7c）
今日列表超长可滚动浏览；过期/待办展示改为配置（展示时置底）。

#### 实现记录（2026-11-09）

- 领域层｜settings.ts：`AppSettings` 增 4 个 boolean 开关
  （widgetShowOverdue/widgetShowTodos/widgetShowCategoryEmoji/widgetShowTags，
  默认 true/false/false/false，emoji/tags 渲染消费在 7c）。
- 快照｜snapshot.ts：`WIDGET_SNAPSHOT_MAX_PER_GROUP` 5→50（滚动列表护栏）；
  `WidgetSnapshot.groups` 增 `todos` 三段式（BuildTodayWidgetSnapshotInput 增
  todos 输入，timeLabel 恒『待办』，仅 active，categoryColor 透传）；键
  widget_today_snapshot_v1 与 JSON 兼容性不变（narrowEntry 对旧快照宽松读）。
- DB｜schema v6→v7：app_settings 加 4 列（非可选 boolean）+ migration v7
  （addColumns 自动回填 0，仅 widget_show_overdue 显式 `UPDATE = 1`）；
  AppSettingsModel 4 个 @field；seed.ts 建行写 4 默认值（数据源 DEFAULT_APP_SETTINGS）。
- Repository｜`getSettings/updateSettings` 支持 4 开关；新增
  `listUnscheduledItems()`（start_at NULL + active，createdAt 降序，不限时间窗口，
  区别于 unscheduledCreatedInRangeQuery）与 `observeUnscheduledItems()`
  （combineLatest4，列订阅口径同阶段 6）。
- 写入器与桥｜WidgetSnapshotWriter 按开关条件取数（关→空数组）；snapshotBridge
  数据订阅加 observeUnscheduledItems（开关不入订阅——桥不订阅 app_settings，
  设置页改完自行触发刷新，触发点 1-4 语义不变）。
- 渲染｜TodayWidget.tsx：行区改「包裹 FlexWidget{flex:1} + ListWidget（原生
  ListView 滚动，行为独立位图）」，行序=已安排→过期→待办；空态同用 flex:1 占位
  保快速记录按钮贴底（平台机制实锤见提案文档）。
- 设置页｜profile.tsx 新增「小组件显示」节：展示过期项/展示待办项 2 个 Switch
  （emoji/标签开关随 7c 渲染落地时加入，避免死开关）；乐观更新+失败回滚+页内
  提示（同标签样式区模式），保存成功后手动 writeSnapshotFromRepository →
  refreshTodayWidgets。
- 测试｜snapshot.test.ts 适配护栏 50 与三段（用例 3 改 51/52/53→各截 50；
  新增用例 8：todos 『待办』标签+仅 active+取色透传）；viewQueries.test.ts 新增
  listUnscheduledItems 3 例（筛选/排序/categoryId 发射水合）+ settings 读写 2 例；
  seedPreset.test.ts 结构断言升 v7 并加 v7 step 校验；ReminderScheduler.test.ts
  FakeRepository 补 2 接口 stub（§7.13 编译必需）。
- 验证｜`npx tsc --noEmit` 零错误；`npx jest --runInBand` 40 套件 506 用例全过
  （原 499 + 新增 7）。

#### 7a 验收
70. `tsc` 零错误，`jest` 全过（506）。
71. 真机验证（用户执行）：设置页出现「小组件显示」节，关「展示过期项」后
    小组件不再显示过期行；开「展示待办项」后无时间待办以『待办』标签出现在
    列表底部。
72. 真机验证（用户执行）：今日条目超过组件可视高度时，列表可上下滑动浏览
    （Native ListView），快速记录按钮始终可见；建 10+ 条验证。

### 小组件升级 7b：今日/周页签切换（2026-11-10，提案 docs/proposals/slice-14-widget-phase7.md）

#### 目标（用户 4 需求的第 3 条；左右滑平台不可行——库全库仅 ClickableView 无 swipe/onTouch，7a 前已实锤，用户拍板页签方案）
组件内「今日 | 周」点击页签；周页=今天起 7 天按天分组、每天上限 20；页状态持久化。

#### 实现记录（2026-11-10）

- 领域层｜weekSnapshot.ts（新增）：`WIDGET_WEEK_SNAPSHOT_PREFS_KEY`
  （'widget_week_snapshot_v1'）、`WIDGET_WEEK_DAY_COUNT=7`、
  `WIDGET_WEEK_MAX_PER_DAY=20`；`getWidgetWeekDayStarts(nowMs,tzid)`
  （7 个民用日起点+第 8 天终点，DST 语义同 resolveDayStart）、
  `buildWeekWidgetSnapshot`（纯函数：滤 archived/startAt null，按民用日分桶
  取最大满足下标，组内沿用输入序截 20，dayLabel 今天/明天/'周X D' 与 App
  日程分组同规则，timeLabel 复用 snapshot.ts toScheduledEntry——7b 起导出）、
  `narrowWidgetWeekSnapshot`（读取端收窄，坏日跳过）。
- 领域层｜pageState.ts（新增）：'widget_page_state_v1'、
  `WidgetPageName='today'|'week'`、默认 'today'、`narrowWidgetPageState`
  （损坏回退今日页）。
- 下沉｜snapshot.ts 增导出 `narrowSnapshotEntry`（从 WidgetSnapshotWriter
  私有实现下沉 domain，今日/周快照读取端共用）；writer 改 import。
- 写入器｜WidgetSnapshotWriter 增 writeWeekSnapshotFromRepository（查
  listScheduledItemsInRange(周起,周终)→build→写）、writeWeekSnapshot/
  readWeekSnapshot、writePageState/readPageState。
- taskHandler｜WIDGET_CLICK 增 SWITCH_PAGE 分支（clickActionData.page 收窄后
  writePageState→完整渲染，不拉起 App）；渲染管线统一 renderCurrentWidget：
  今日+周两张快照并行写（三级兜底各自同构，周兜底快照带真实 7 天窗）→
  readPageState→渲染；WIDGET_UPDATE 触发点 4 语义不变。
- 渲染｜TodayWidget.tsx：头部「今日 | 周」pill 页签（active=accent 底+粗体，
  inactive=muted 描边；clickAction SWITCH_PAGE + {page}）；今日页布局沿用
  7a；周页=单个 ListWidget 混排「日期头行+条目行」（平台一次渲染最多 2 个
  集合视图，RNWidgetCollectionService.MAX_COLLECTION_WIDGETS=2，不能一天一个
  ListWidget——本次实锤），空天组头缀『· 无安排』，weekSnapshot null 占位文案；
  条目行抽 renderEntryRow 共用（周页 key 加 civilKey 前缀防跨天撞 key）。
- 桥与设置页｜snapshotBridge 刷新改为并行写两张快照→读页状态→refreshWidgetViews
  （今日快照读失败兜底空快照，两张全缺才跳过）；新增导出 refreshWidgetDataNow
  （reason 参数，设置页开关保存后调用）；profile.tsx 开关处理改走统一管线
  （原 writeSnapshot→refreshTodayWidgets 序列删除——开关只影响今日页数据，
  但渲染必须保持在用户当前页，不能把周页顶回今日页）；requestWidgetUpdate
  更名 refreshWidgetViews（入参 {page, snapshot, weekSnapshot}）。
- 测试｜weekSnapshot.test.ts（新增 10 例：键名/日起点/7 天恒在+labels+civilKey/
  分桶+越界丢弃/护栏截断/archived 与 null 跳过/dayStarts 数量防错/pageState 收窄
  合法与兜底）；pageState.test.ts（新增 5 例）；修一处断言反转（domain 不重排、
  输入序保留——乱序输入实证该口径）。
- 验证｜`npx tsc --noEmit` 零错误；`npx jest --runInBand` 42 套件 521 用例全过
  （原 506 + 新增 15）。

#### 7b 验收
73. `tsc` 零错误，`jest` 全过（521）。
74. 真机验证（用户执行）：小组件头部出现「今日 | 周」页签；点「周」切到周页
    （今天起 7 天分组，组头 今天/明天/周X D，条目带色点），点「今日」切回；
    切到周页后冷启动 App 再看小组件仍停在周页（页状态持久化）。
75. 真机验证（用户执行）：周页数据与 App 周视图一致——改某任务时间到明天后
    小组件（回前台或等待去抖刷新）该条目从原日期组消失、出现在明天组；
    超过一屏可上下滑动；快速记录按钮两页均可见可点。

### 阶段 7：导入预览
- 拦截 ICS 和系统日历导入，进入预览勾选页，确认后批量落库。

## 允许修改/新增的范围
- src/db/schema.ts, migrations.ts, ItemModel.ts, 新增 CategoryModel.ts, TagModel.ts, AppSettingsModel.ts
- src/domain/relations/, src/domain/views/, src/domain/tags/
- src/data/ItemRepository.ts, WatermelonItemRepository.ts, 新增 CategoryRepository.ts
- src/app/（主页、设置、详情、编辑、标签管理、search.tsx）
- src/ui/（TagChip, CategoryChip, 视图卡片等）
- src/types/（react-test-renderer 最小类型声明，阶段 5c 月历渲染回归测试配套）
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

### 阶段 5c 验收
33. `tsc` 零错误，`jest` 全过（含月历渲染回归测试）。
34. 左上标签：今年显月份/非今年显年+月；点击弹年月选择器（宫格+年份步进）；选择后落点正确——month 切月、week/day 锚定该月 1 日、agenda 定位该月第一组。
35. agenda 上下滑无缝；滚动时顶栏月份随首可见分组变化；「今天」定位今日分组。
36. 月视图格子不再空白（真机确认当日 chip 渲染）。
37. 日视图：事件块不再盖住时间列；左右滑切前后日。
38. 月视图 ‹› 可切月；周/日视图无 ‹› 箭头。
39. 周视图单日态点周条天不跳视图（列表显示该天记录）；「周」pill 切整周态且有激活视觉区分；整周态点某天回单日态。
40. 筛选面板：「已归档」行跳转 /archived；订阅日历等 3 占位行点击提示「即将上线」；主页无「已归档」链接行。

### 阶段 5d 验收
44. `tsc` 零错误，`jest` 全过（含 `getWeekStart`/`weekIndexInMonth`/`nthMondayDateOfMonth` 自然周单测）。
45. 顶栏标签四视图统一只显月（本年月/非本年年+月）；年月选择器从标签正下方弹出。
46. 年月选择联动：month 切月；day 同月同日（如 11-09 选 12 月 → 12-09）；week 周序不变切到目标月同序自然周（周一 00:00 起）。
47. 滑动语义：7 天头横滑=整周 ±1；周视图内容区横滑=选中日 ±1（整周态=整周 ±1）；日视图横滑=切前后日；选中日出周界时周条整体切换。
48. 周条与日视图切换有方向性平移动效；日视图 00:00 不再与上方工具栏重合（顶部 16px 间距）。
49. 月历无项目格子无框空白；有项目格子 chip 背景正常；自带英文月头（October 2026）不显示。

### 阶段 5e 验收
50. `tsc` 零错误，`jest` 全过。
51. 周视图/日视图切日后 7 天栏选择框高度不变（今天黑点 absolute）。
52. agenda：上下滑翻月无边界（下滑 prepend 上月、上滑 append 下月，一滑一页）；
    左上标签随视口月联动（含 overscroll 后无滚动事件场景）；年月选择器选任意月
    （含无数据月）都能定位到该月名行。
53. 「待办」组仅出现在日程视图；周/日视图不显示。

### 阶段 5f 验收
54. `tsc` 零错误，`jest` 全过。
55. 日视图时间轴 00:00 标签完整显示（不被裁切）；跨天任务在开始日后的每一天
    都有时间块（呈现为 00:00 到结束时刻，跨午夜裁剪）。
56. 月历视图滚动翻月时左上标签随视口月联动（跨年显年）；点「今天」后 11 月页
    贴顶（无上月残留）。

### 阶段 5g 验收
57. `tsc` 零错误，`jest` 全过（492）。
58. 日程视图冷启动直接定位「今天」组头贴顶；滚远（跨多月）后点「今天」跳回
    今日组贴顶；从 prepend 出的远月（如 7 月）点「今天」同样跳回贴顶。
59. 日程视图下滑到列表顶可连续 prepend 前几个月名行（10→9→8→7…），左上标签
    随生效月联动；列表末尾有一屏左右留白（今日组贴顶的滚动余量）。

### 阶段 5h 验收
60. `tsc` 零错误，`jest` 全过（492）。
61. 新增带时间的条目保存后立即出现在对应日期组（不再先进「待办」）；在编辑页
    修改时间保存后列表即时更新；日程/周/日/月视图一致。
62. 月历滚远后点「今天」直接显示本月页（无先闪旧月的中间态）。
63. 日程视图滚远后点「今天」：连拍记录跳转全程，左上标签不闪旧月（原 9 月），
    约 1 秒内稳定于今天组贴顶。

### 阶段 5i：待办独立入口（2026-11-09，阶段 5 收官）
- 待办（无时间条目）与「已归档」同模式：主列表不混排，独立展示入口。
- 顶栏「待」pill：存在无时间条目时显示（observeItemsWithTags 为 NOT_ARCHIVED
  查询，归档项不计），点击进入 /todos；待办清零后 pill 自动消失。
- src/app/todos.tsx 新页：observe 订阅实时刷新、createdAt 倒序、行=标题+类型+
  建于时间+标签、点击进详情（补时间/归档等操作在详情页完成）；空态提示文案。
- plan.tsx：删 agendaRows 的待办组分支；agendaGroups 去掉 agenda 分支例外，
  所有视图统一排除无时间项。

### 阶段 5i 验收
64. 存在无时间条目时顶栏显示「待」，点击进入待办列表（条目=无时间项，createdAt
    倒序，点击进详情）；无待办时顶栏无「待」。
65. 日程/周/日/月主视图列表不再混入无时间条目。
66. `tsc` 零错误，`jest` 全过。

#### 阶段 6 验收标准
1. `tsc` 零错误，`jest` 全过。快照生成单测需覆盖 `categoryColor` 的取色和默认回退逻辑。
2. **真机验证**：在 App 里建一条关联“工作”（黑色）的任务，加入今日。桌面小组件刷新后，该任务左侧带黑色圆点。
3. **真机验证**：在设置里把“工作”分类改为红色，回到首页触发一次快照刷新，桌面小组件上的圆点变成红色。

### 阶段 6 验收
67. `tsc` 零错误，`jest` 全过（499）。快照 `categoryColor` 取色/回退有单测
    （快照用例 7 + categoryDot.test.ts 5 例 + viewQueries 发射 2 例）。
68. 真机验证（用户执行）：建一条关联「工作」的带时间任务加入今日，小组件刷新后
    左侧出现对应色圆点（注：预置 work 色为 #E57373 红，原卡「黑色」系 presets
    定稿前文案，以实际预置色为准）。
69. 真机验证（用户执行）：设置里改「工作」分类颜色 → 回首页触发快照刷新 →
    小组件圆点变色；改某条任务的分类，同样确认色点跟随新分类（B 步修复项）。

### 阶段 7 验收
42. 导入 ICS 时弹出预览页，包含事件标题、时间、是否重复。
43. 取消勾选 2 条后，实际导入数量减少 2 条。

### 分支与提交
44. 从最新 main 新建 task/slice-14，禁止一次性写完。每阶段完成后汇报，等确认再继续。
45. push 遇 reset 加 HTTP/1.1。

## 完成后输出
- 各阶段的实际执行结果与自测情况。
- 迁移后数据库的表结构与预置数据验证。
- Agenda 视图、筛选面板、配置页的实际截图或文字描述。
- 关系水合的性能观察（用 200 条数据测一下是否会卡顿）。
- 未完成项与风险。