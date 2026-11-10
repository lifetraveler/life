# 切片 14 · 阶段 5 反馈总结（UX 架构升级：Tab/路由 + 真机反馈迭代 5b–5i）

- 日期：2026-11-09（阶段 5 主体 11-08，反馈迭代 5b–5i 11-09）
- 阶段：Phase 5（原阶段 5 小组件已顺延为阶段 6）
- 分支：`task/slice-14`
- 阶段提交序列（12 个）：
  `0f5b4cc` 阶段5 主体 → `eb7fc54` 5b → `243868f` 5c → `99013e6` 根路由 fix →
  `63fd8ba` 5d → `23ddfa8` 5d 收尾 → `74e0a1c` 5e → `6292259` 5f → `4658d6d` 5g →
  `c9de2f4` 5h → `c429556` 5h 追加 → `d5f8f57` 5i 收官
- 状态：✅ 完成（tsc 0 error；jest 39 套件 / 492 用例全过，较阶段 4 +36 用例；expo-doctor 16/18，2 失败为切片前基线告警；MuMu 真机逐轮验证）

## 一、用户反馈与处理对照（5 轮 + 收官条目）

### 第 1 轮 → 5b（8 条）
| 反馈 | 处理 |
| --- | --- |
| 搜索改独立页，列表顶换 🔍 | 新页 `src/app/search.tsx`（LIKE 语义不变 §7.18）；排序=有 startAt 开始时间倒序在前、无时间按 createdAt 倒序在末尾（`src/domain/views/searchOrder.ts` + 单测）；分页 50/批距底预取 |
| 统一顶栏 ‹标签›+🔍+筛选+今天 pill | plan.tsx 顶栏重写；今天=agenda 滚动定位/周·日锚点回今日/月回本月 |
| 周=今日起 7 天（getWeekRange 周一自然周留给 /week 页） | `getSevenDayWindow`；周条 chip 行 + PanResponder 横滑 ±7 天 |
| 日=纵向时间轴 | `layoutDayEvents`（Google 式 lane 复用、跨午夜裁剪）+ 8 个单测；全天/待办 chip 区；红线 |
| 月=富月历 | react-native-calendars 1.1314.0（纯 JS，兼容核对通过）；FlatList 纵向无极双向滚动；自绘格子 chip≤3+「+N」+中文星期表头 |
| 筛选面板即时生效、重置只清筛选 | FilterSheet 重写为受控（删草稿/应用），✕/遮罩直接关，重置移右上角 |
| FAB 长按占位「闪电录入即将上线」 | onLongPress + Alert（切片 15 前占位） |
| ~~今日视图~~ | 拍板去掉，视图收敛为 日程/周/月/日（AgendaViewKind 4 值） |

### 第 2 轮 → 5c（8 条）
| 反馈 | 处理 |
| --- | --- |
| 左上年月标签可点、弹年月选择器 | 自绘 `MonthPickerPopover`（‹2026› 步年+12 月宫格，当前月黑胶囊；react-native-calendars 无此形态故零依赖自绘） |
| agenda 上下滑无缝 + 标签随首行联动 | 月窗口方案前身为全量列表 + `onViewableItemsChanged` 跟踪首可见组 |
| 月视图全空白格（bug） | 定位为 `onStart/EndReachedThreshold 1.5` 初始双发 prepend 把视口顶推入空月（Android mVCP 不可靠）→ 收敛 0.5 |
| 日视图记录盖时间竖栏 + 左右滑切日 | 两列结构（左 44px 刻度列+右画布，块百分比相对画布）+ PanResponder ±1 天 |
| 周/日去左上箭头 | ‹› 仅月视图保留 |
| 周视图点日期跳日视图是误跳 | 周视图双态：单日态（点天只切选中）+「周」pill 切整周列表 |
| 已归档入口移入筛选面板 | FilterSheet 底部「已归档」行（仿参考图「已删除项目」），主列表删 linksRow |
| 面板底部操作行（订阅日历等） | 3 占位行（Alert 即将上线），功能后续切片 |

### 第 3 轮 → 5d（5 条，滑动语义经用户拍板）
| 反馈 | 处理 |
| --- | --- |
| 四视图标签统一只显月（本年/非本年规则）；选择器从标签下方弹出 | monthLabelOf 统一；popover card 定位调整 |
| 00:00 与工具栏重合；间距要定标准值 | container paddingTop；**SECTION_GAP=16** 沉淀为区块间距标准值 |
| 周/日切换动效 | 周条 150ms Easing.out cubic、时间轴 200ms 平移（方向自算） |
| 滑动语义：**周条横滑=整周±1；内容区横滑=选中日±1；整周态=整周±1** | contentPanResponder 与 weekStripPanResponder 分离；语义经用户拍板 |
| 月历空格子不画框 | cell 去边框（chip 自带背景） |

### 第 4 轮 → 5e（3 条）
| 反馈 | 处理 |
| --- | --- |
| 切日后 7 天栏会变高 | 周条 chip 定高 62 + 今天黑点改绝对定位（黑点参与布局导致行高跳动） |
| agenda 选月不生效 + 不能滑月 | agenda 重构为 3 月窗口：每页首行月名标题（定位锚点恒存在）、prepend/append 无边界、标签=生效月联动、选月=重置窗口+定位月名行（无数据也生效） |
| 「待办」数据哪来的 | 语义澄清（startAt 为空项）；「待办」组先收敛为仅 agenda 显示，阶段 5i 移出主列表 |

### 第 5 轮 → 5f/5g/5h（3+3+3 真 bug 修复）
| 反馈 | 根因 | 修复 |
| --- | --- | --- |
| 日视图 00:00 被裁一半 | gutter 标签 top=hour*HOUR_PX-6 被 Android clipChildren 裁 | `Math.max(0, …)` |
| 跨天任务只显示第一天 | 日范围过滤用 startAt 落点而非区间相交 | 过滤改 `startAt < endMs && (endAt ?? startAt) > startMs` |
| 月历滚到 11 月标签没变；点今天露 10 月 | MonthCalendarView 无标签联动；页窗口重置与 scrollToIndex 间有视口中间态 | `onVisibleMonthChange` 回调 + jump 重挂定位 |
| 点「今天」不跳今日组（停在当月第一条） | goToday 只定位月名行 | AgendaJumpTarget {day/month} + 定位链 4 层（见第三节 3） |
| 新增条目先进待办、再操作一下旧项才"挪到对应日"；周视图不即时 | **WatermelonDB `Query.observe()` 只发集合成员变化，行内字段更新不发射**；保存链 createItem→updateItemTime 两步写停在无时间中态 | 四个订阅全部改 `observeWithColumns` 列订阅（ITEM/TAG/CATEGORY_WATCH_COLUMNS） |
| 月历点今天先闪 9 月 | 重挂+80ms scrollToIndex 之间的视口中间态 | key 重挂+initialScrollIndex 渲染期定位；agenda 侧（5h 追加）发现重挂首帧闪列表顶旧月，改去重挂+立即 scrollToOffset 估算+120ms 精修（连拍验证无闪） |
| （流程批评）我截图间隔 2.5s 漏掉瞬态 | — | 改连拍记录跳转全程（帧表留档），瞬态可见后才能定位根因 |

### 收官条目 → 5i
| 反馈 | 处理 |
| --- | --- |
| 待办与已归档同模式：工具栏加「待」字，有数据才显示，点击进待办列表 | 顶栏「待」pill（NOT_ARCHIVED 查询、归档不计）+ 新页 `src/app/todos.tsx`（observe 实时刷新、createdAt 倒序、点击进详情）；主列表（日程/周/日/月）统一排除无时间项；待办清零 pill 自动消失 |

## 二、交付清单（阶段 5 全程）

**新增页面/组件**：`src/app/(tabs)/`（_layout/plan/flash/items/profile）、`src/app/item/new.tsx`、`src/app/search.tsx`、`src/app/todos.tsx`、`src/app/(tabs)/index.tsx`（根路由 Redirect）、`src/ui/ItemFormFields.tsx`、`src/ui/useItemForm.ts`、`src/ui/MonthCalendarView.tsx`、`src/ui/DayTimelineView.tsx`、`src/ui/MonthPickerPopover.tsx`、`src/domain/views/itemsByDay.ts`、`src/domain/views/dayTimeline.ts`、`src/domain/views/searchOrder.ts`
**域层扩展**：ranges.ts（getSevenDayWindow/getDayRange/shiftAnchorDay/getWeekStart/weekIndexInMonth/nthMondayDateOfMonth/shiftCivilMonth/getMonthRangeForCivil）、agenda.ts（AgendaViewKind 4 值）
**重写/大改**：FilterSheet（即时生效+已归档行+操作行）、plan.tsx（805→~1500 行，月窗口/定位链/双态周）、edit.tsx（复用共享表单）、WatermelonItemRepository（列订阅）
**测试**：+36 用例（ranges 8、itemsByDay 5、dayTimeline 8、searchOrder 3、MonthCalendarView 渲染探针等）
**新依赖**：react-native-calendars 1.1314.0（用户拍板）；@expo/vector-icons、expo-font（peer 对齐修复）

## 三、踩坑与教训（真机实锤）

1. **WatermelonDB `Query.observe()` 只发集合成员变化**——行内字段更新（成员不变）不发射。订阅一律 `observeWithColumns` 列订阅。
2. **effect 内 setState 改自身 deps → cleanup 清 timer → 逻辑永不执行**（两次实锤）。跨渲染传目标用 ref+seq。
3. **Fabric `scrollToIndex` 对窗口外未测量行静默无效**（连 onScrollToIndexFailed 都不触发）。定位链三层：估算 offset `scrollToOffset` 立即跳 → `measureInWindow` 实测精修 → 底部 filler（paddingBottom 0.9 屏）保 max offset。
4. **FlatList 重挂首帧从 offset 0 渲染**（闪列表顶旧月）。重挂仅用于冷启动 mount（initialScrollIndex），运行中跳转走命令式。
5. **Android 滚动到 0 不发 onScroll**——prepend 守卫须补挂 onScrollEndDrag/onMomentumScrollEnd。
6. **mVCP 把视口弹回锚行形成「顶部黑洞」**——无边界列表最终不锚定。
7. **react-native-calendars**：Theme 类型（嵌套）与实现（扁平键）不一致，不覆盖；headerStyle 传入不消费，须 `customHeader={()=>null}`；threshold 1.5 初始双发顶飞视口，收敛 0.5。
8. **item 内 `onLayout.y` 是 transform 局部值**（Android），窗口坐标只能 measureInWindow。
9. **Metro 运行期间 npm install 损坏增量图谱**（delta 500）——装完必须重启；npm 不补装缺失传递依赖（@expo/vector-icons 需显式装）。
10. **(tabs) 迁移后相对导入层级变化**（../→../../，sed 批量修）；git mv 不自建目录；React 19 无 react-test-renderer 类型（src/types 最小声明）。
11. **测试断言先 node 实算历法**（2026-11-09 是 11 月第 2 个周一不是第 1 个）。
12. **瞬态过程验证用连拍**（adb 循环 screencap，~0.4s/帧），固定间隔截图会漏过程；滚动惯性未停时 tap 会被吞（假警报）；tap 列表区可能误进详情页（后续 swipe 全打在详情页上）。

## 四、验收与披露

- 任务卡验收 12-18（阶段 5）、19-27（5b）、33-40（5c）、44-49（5d）、54-56（5f）、57-59（5g）、60-63（5h）、64-66（5i）中非真机项全部自验通过；真机终验（各轮手动项）留用户。
- 已知限制：①日历视图月页进入时视口停在缓冲页（prepend 缓冲策略，5b 起既有行为）；②agenda 列表末尾约一屏留白（今日组贴顶的滚动余量）；③面板操作行 3 项为占位（Alert 即将上线）；④闪电录入（FAB 长按）为占位，切片 15 实现。
- 数据披露：验证期间经 adb/UI 创建的测试条目（TestZ/P5Hno1/P5Hno2/P5Hwk×3）已全部归档清理；用户自建数据未动。
