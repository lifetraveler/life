# 变更提案：小组件升级（阶段 7，切片 14）

状态：**已确认**（2026-11-09 用户拍板：视图切换采用「页签切换」；配置存储采用
「app_settings v7」两列方案按本提案 4 列执行）
日期：2026-11-09
来源：用户阶段 6 验收反馈 4 条

## 用户原始需求

1. 今日待办条目超出组件长度时无法浏览，需要支持滑动。
2. 过期项目展示改为配置（是否展示过期/是否展示待办到今日视图），展示时置于列表最下方。
3. 小组件左右滑切换展示周视图。
4. 配置：是否展示分类 emoji；标签带颜色展示（或标签 emoji 也作配置）。

## 平台能力核查（react-native-android-widget 0.26.0，本机源码实锤）

- **垂直滚动：可行。** `ListWidget` 原生映射 RemoteViews ListView + `setRemoteAdapter`
  （RNWidget.java:273-295，`rn_widget_list` 布局 + RNWidgetCollectionService），
  是真滚动列表，非静态位图。
- **滑动手势：不可行。** 全库交互仅有 `clickAction`（ClickableView 封装 setOnClickPendingIntent），
  无任何 onTouch/swipe API；Android RemoteViews 本身不支持小组件内滑动手势。
  「左右滑切换视图」在平台层面无法实现，只能以**点击**切换替代。
- 点击事件已具备：taskHandler 已按 clickAction 分发（OPEN_ITEM / OPEN_QUICK_ADD），
  新增 SWITCH_PAGE 动作即可；页面状态可经现有 WidgetSnapshotStoreModule（通用
  setString/getString）持久化，无需新原生代码。

## §7.16 冻结条款修订点（提案正文）

| # | 原冻结 | 拟改为 |
| --- | --- | --- |
| 1 | 「今日待办列表（最多 5 条）」 | ListWidget 滚动列表，每组上限 50（性能护栏，非展示上限） |
| 2 | 「快照内容冻结：today 分组（过期+已安排）top 5」 | today 快照三段：已安排（今日）+ 过期（可选，置底）+ 待办（可选，置底）；每组上限 50 |
| 3 | 「不在 MVP 做多个小组件类型」 | 仍为单一小组件类型；组件内「今日/周」双页经**点击页签**切换（平台无滑动手势） |
| 4 | （无） | 新增周快照键 `widget_week_snapshot_v1`（今天起 7 天按天分组，每组上限 20）与页状态键 `widget_page_state_v1`；today 键 `widget_today_snapshot_v1` 不变，JSON 增可选字段（旧版本 narrowEntry 容忍未知字段，兼容） |
| 5 | （无） | 显示配置落 `app_settings`（schema v6→v7 加 4 列，走 migration + Repository） |

**不变的冻结语义**：点击条目 → `item/[id]`；快速记录 → `life://quick-add`；
不用 AlarmManager/WorkManager 定时刷新；小组件内不做完成操作；数据桥接触发点 1-4 不变；
`widget_today_snapshot_v1` 键名不变。

## 显示配置设计

`app_settings` 新增 4 列（单行 'global'，migration v6→v7 回填默认值）：

| 列 | 类型 | 默认 | 语义 |
| --- | --- | --- | --- |
| widget_show_overdue | boolean | **true** | 今日视图是否展示过期组（置底；保持现状） |
| widget_show_todos | boolean | false | 今日视图是否展示无时间待办组（置底） |
| widget_show_category_emoji | boolean | false | 条目标题前是否展示分类 emoji（现状无，默认不变） |
| widget_show_tags | boolean | false | 条目标题下是否展示标签行（tag.color 背景色 + 文字/emoji 跟随 app 的 tagDisplayMode） |

- 设置页新增「小组件显示」区（4 个开关，即时保存 → 快照桥去抖重写）。
- 快照条目新增可选字段：`categoryEmoji: string | null`、
  `tags: Array<{ name, color, emoji }>`（配置关闭时不携带，快照体积不涨）。
- 过期组维持「全部历史过期」语义（end_at < now 且 active），滚动可浏览；
  历史积压多时可经配置关闭。不新增「仅今日过期」配置（避免过度设计）。

## 分阶段实施（每阶段独立提交，tsc+jest 全过后汇报）

- **阶段 7a**：ListWidget 滚动列表 + 三段式快照（已安排/过期置底/待办置底）
  + app_settings v7（4 列）+ Repository 读写 + 设置页「小组件显示」区 + 单测
  （快照分区/配置过滤、repository 配置读写、migration 默认值）。
- **阶段 7b**：周页——week 快照生成（今天起 7 天按天分组）+ 组件内「今日|周」
  点击页签 + 页状态持久化（widget_page_state_v1）+ taskHandler SWITCH_PAGE
  + 单测（week 快照分组、页状态切换）。
- **阶段 7c**：分类 emoji 与标签展示配置——快照可选字段 + TodayWidget 渲染
  + 单测（快照字段携带/省略、渲染分支）。

## 风险与影响范围

- schema v6→v7 为本切片第二次迁移（v5→v6 已在阶段 1 完成）；仅追加列与默认值回填，
  严禁重建表（AGENTS §4 红线）。
- ListWidget 行渲染路径与 FlexWidget 静态渲染不同（RemoteAdapter 每行独立 RemoteViews），
  行内点击（OPEN_ITEM）需逐行 clickAction，真机需回归点击语义。
- 周快照使 SharedPreferences 体积增大（估 7 天 × 20 条 ≈ 数十 KB，SP 可承受）；
  超限风险由每组上限护栏控制。
- 真机验收项每阶段 2-3 条，沿用阶段 6 模式由用户执行。

## 回滚方案

各阶段独立提交，可逐 commit revert；v7 migration 前进式追加，回滚仅需 revert 代码
（已迁移设备多出的空列不影响旧代码读取）。
