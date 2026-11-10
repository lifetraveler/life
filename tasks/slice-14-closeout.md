# 切片 14 收尾移交（closeout）

- 切片：task/slice-14（视图架构重构 + Schema v6 分类/标签扩展 + 关系水合 + 设置与配置页 + Agenda/筛选 + 4 视图升级 + 待办独立入口 + 小组件升级 7a/7b/7c）
- 完成日期：2026-11-10
- 分支基点：task/slice-13@9930c01（**注意：切片 13 收尾时的 main 合并未执行，main 当时停在 107c1d0**，见遗留披露 1）
- 提交区间：main(107c1d0) → 9e6c491，共 36 个提交；最终合并 `--no-ff` 会一并把切片 13 提交带入 main。

## 环境事实

- Windows 原生（无 MSYS），工作目录 `F:\code\vibecoding\life`；Node/npm 版本未变。
- 依赖变化仅一处：新增 devDependency **patch-package ^8.0.1**（7b-修复原生补丁持久化，用户批准）；
  `scripts.postinstall = "patch-package"`；补丁文件 `patches/react-native-android-widget+0.26.0.patch`。
- 构建链修复：原 JAVA_HOME（C:\code\runtime\java\jdk\jdk-17.0.8.1-full）失效；devecostudio jbr=17.0.6 无 jlink（JdkImageTransform 失败）不可用；
  最终安装 **Temurin JDK 17.0.21+9** 至 `F:\code\tools\jdk17\jdk-17.0.21+9`，`cd android && JAVA_HOME=... ./gradlew.bat assembleDebug` 通过（51s/626 tasks），`adb install -r` 保数据覆盖。
- 真机：MuMu 模拟器（adb `127.0.0.1:16384`，与 7555/emulator-5554 同实例），wm 900x1600 density 320（2.0x）；
  桌面 launcher=app.lawnchair（Lawnchair）；小组件实例 id=5（4x2，provider `.widget.TodayWidget`）。
- git 推送：全局 `.gitconfig` 代理键为 `https.proxy`（git 不认，静默忽略→直连被墙）；推送须显式
  `git -c http.proxy=http://172.16.100.254:7893 -c http.version=HTTP/1.1 push ...`（切片 4/6/7 结论沿用）。
- remote：origin=https://github.com/lifetraveler/life.git；备用 origin-ssh（ssh.github.com:443）。

## 数据库/构建事实

- schema **v5→v6**（阶段 1）：`items` 增 categoryId/priority（回填 'other'/0）、新增 `categories` 表（预置 work/personal/study/health/other）与 `app_settings` 表（单行 'global'）、`tags` 增 color/emoji。
- schema **v6→v7**（阶段 7a）：`app_settings` 增 4 个 boolean 列 widget_show_overdue/widget_show_todos/widget_show_category_emoji/widget_show_tags；
  addColumns 自动回填 false，仅 `widget_show_overdue` 显式 `UPDATE = 1`（默认 true 保现状）。
- **真机迁移实证**：MuMu 覆盖安装后 logcat `[🍉] Migrating from version 6 to 7... → Migration successful`（库 /data/user/0/com.vibecoding.life/life.db）。
- 原生补丁：`node_modules/react-native-android-widget` RNWidget.java **禁用 S+ 容器显式尺寸分支**（`if (false && Build.VERSION.SDK_INT >= S)`+中文注释）；
  经 patch-package 净装验证（模拟项目 + patch 应用后 CONTENT-IDENTICAL modulo CRLF）。
- `npx expo-doctor`（收尾 2026-11-10）：**16/18，2 失败均为预存状态非本切片引入**——
  ①non-CNG app config sync 提示（android/ 目录本就存在，custom dev client 工作流常态）；
  ②RN Directory 元数据（@nozbe/watermelondb 未经新架构测试、widget-snapshot-store 本地模块无元数据、@nozbe/simdjson 契约配置），均不可按其建议"清理"。
- 工具链验证：`npx tsc --noEmit` 零错误（阶段 6/7a/7b/7c 各阶段均验）；`npx jest --runInBand` **42 套件 / 525 用例全过**（492→499(6)→506(7a)→521(7b)→525(7c)）。

## 代码地图（关键变更，按阶段）

| 阶段 | 文件/区域 | 说明 |
| --- | --- | --- |
| 1 数据底座 | `src/db/schema.ts`(v6)、`src/db/migrations.ts`、`src/db/models/*`、`src/domain/category.ts` | 分类/标签/设置表 + 预置分类；Item 弃 color 改挂 Category |
| 1-2 水合 | `src/data/WatermelonItemRepository.ts`、`src/domain/tags/tagDisplay.ts`、`src/ui/TagChip.tsx` | ItemWithRelations=Item&{tags,category} 全查询水合；标签展示样式 text/emoji/both |
| 3 设置页 | `src/app/(tabs)/profile.tsx`、分类/标签管理页 | 分类 CRUD+视觉编辑、标签管理、导入/导出入口（ScrollView 修复） |
| 4 | `src/app/(tabs)/index.tsx`、`src/ui/AgendaItemCard.tsx` | Agenda 重构 + 筛选面板（分类/来源/标签/状态多选） |
| 5 UX | `src/app/(tabs)/` 路由重构、`src/domain/views/`（ranges/agenda/filters）、月历/日时间轴/搜索页 | Tab 化 + 4 视图（日程/周/月/日，5b 收敛）、统一顶栏、待办独立入口 /todos（5i） |
| 6 | `src/domain/widget/categoryDot.ts`、Repository ITEM_WATCH_COLUMNS 观察列修正 | 快照 categoryColor；observeWithColumns 补 category_id/title（改分类色/改任务分类触发刷新） |
| 7a | `src/domain/widget/snapshot.ts`(三段式+护栏50)、`src/db/schema.ts`(v7)、`src/data/WidgetSnapshotWriter.ts`、`src/widget/TodayWidget.tsx`(ListWidget 包 FlexWidget{flex:1})、profile 小组件显示区 | 滚动列表；过期/待办开关置底；listUnscheduledItems/observeUnscheduledItems 新查询 |
| 7b | `src/domain/widget/weekSnapshot.ts`、`pageState.ts`、writer week/page API、`src/widget/taskHandler.tsx`(SWITCH_PAGE)、TodayWidget 页签+周页 | 周快照（今天起 7 天×20/天）、widget_week_snapshot_v1/widget_page_state_v1、今日|周点击页签 |
| 7b-修复 | `patches/react-native-android-widget+0.26.0.patch`、patch-package | S+ 容器塌缩修复（见教训 3）；bug 截图 tasks/小组件bug.png 入库 |
| 7c | `src/domain/widget/display.ts`、snapshot 条目扩 categoryEmoji/tags、`src/widget/widgetDisplay.ts`、TodayWidget emoji+标签 chips、taskHandler/bridge display 贯通、profile 4 开关 | 渲染开关在渲染侧读当下设置，快照恒携带（proposal 定案） |
| 收尾 | `tasks/slice-14.md`（阶段7 移出记录）、`AGENTS.md`(§7.16 注记)、本文件 | 阶段 7 导入预览移出（用户拍板） |

## 踩坑教训

1. **WatermelonDB observe() 不监听行内字段更新**——列级变化必须 `observeWithColumns(...)`；阶段 6 根因：视图观察者 item 源手写列清单缺 category_id/title，改分类色/改任务分类后快照停旧色。统一口径 ITEM_WATCH_COLUMNS 供全部观察者复用。
2. **react-native-android-widget ListWidget 平台机制**：无 flex（convertCommonStyle 不复制 flex，必须外包 FlexWidget{flex:1} 占位）；一次渲染最多 **2 个集合视图**（MAX_COLLECTION_WIDGETS=2，周页只能单 ListWidget 混排行）；行=独立渲染位图+行级 clickAction 保留。
3. **小组件视口塌缩（7b-修复根因）**：库 S+ 分支 `setViewLayoutWidth/Height(容器, dp)` 被 launcher 宿主按自身 density 换算（Lawnchair ~1.536 → 76.8% 等比塌缩：312×381 vs 应为 406×496）。**uiautomator dump 是定位宿主侧真实层级的决定性工具**——背景位图探针/原生插桩只能证明 JS 树 layout 正确，宿主塌缩在 App 进程不可见。
4. **patch-package 实操**：make 模式（带包名参数）会临时 npm install，本机网络下卡死两次——手工构造补丁用 `git -c core.autocrlf=false diff --no-index`（普通 diff 会剥离 CR 导致 LF/CRLF 混排——javac 无影响，验证口径 CONTENT-IDENTICAL modulo CRLF）；净装验证工程需 package-lock.json 含 packages 条目，否则报 'No such package'。
5. **convertColor 陷阱**（style.utils.ts）：`#RRGGBBAA` 8 位输入被重排为 `#AARRGGBB` 输出——半透明探针色（#80FF0000）实际落库为全透明；组件调试探针必须用不透明色。正式渲染代码同理：8 位色值语义与直觉相反。
6. **APPWIDGET_UPDATE 是受保护广播**（shell 发送 SecurityException）；触发小组件重渲染走 `am start -d life://` 回前台→桥 refreshNow。改 JS 后 dev-launcher bundle（DevLauncherApp-*.js）必须 force-stop→launcher 点条目重载，仅 am start 不生效（mtime 变化才算）。
7. **MuMu 谎报 widget 尺寸**：库 fallback selectSize 得 264×324dp，真实 cell=203×248dp；RNWidgetSizing prefs（profile/calibration）会回写校准值，篡改 prefs 触发 miss 后不会自动重渲染。
8. **LokiJS 测试库发射测试模式**：订阅前挂 resolver（同步首发射在 subscribe() 内到达）+ `Promise.race(sleep(500))` timeout 兜底；断言顺序类结果时记得 domain 不重排（输入序保留），勿按时间序臆断。
9. **commit 规范**：node_modules 补丁不入库（patch 文件入库）；本切片 36 提交按阶段 `feat/fix(s14): 阶段N …` 记谱，`.im-status` 仅作会话间状态接力。

## 遗留披露

1. **切片 13 合并缺位（上游流程债，本次一并清偿）**：main 停在 107c1d0，切片 13 完成提交 9930c01（纯文档）此前只在 task/slice-13 上——本切片直接基于 task/slice-13 开发。本次 `git merge --no-ff task/slice-14` 会顺带把切片 13 提交带入 main；task/slice-13 分支本次一并推送补齐追溯。
2. **阶段 7（导入预览）移出本切片**（用户拍板 2026-11-10，任务卡已记）：ICS/系统日历导入仍为无预览直接落库（导入链路行为不变）；建议切片 15 或单独小切片承接预览勾选页。
3. **待用户真机验收**（工具链全过，功能项待验）：阶段6 68/69（分类色点显示/刷新）、7a 71/72（过期/待办开关效果+超长滑动）、7b 74/75（页签切换+页状态冷启动/周页数据一致性）、7b-修复（视口塌缩确认——本会话已 uiautomator 实测修复后 ListView 366×329px，仍列用户确认项）、7c 77/78（分类 emoji 开关/标签 chips）。注意待办展示默认关闭（widgetShowTodos=false），验收 72/78 需先在设置页开启。
4. **时区伪影延续**（切片 9 遗留，接受 UTC 坐标系自洽）：getDeviceTzid 返回 UTC；小组件 timeLabel 与 App 同坐标系（snapshot.ts 头注释有说明）。
5. **过期窗口观察者仅回前台重订**：长驻前台跨天不自动扩窗（阶段 6 已披露，未修）；同理小组件过期组=全部历史过期项（end_at<now 且 active），滚动可浏览。
6. **expo-doctor 2 个预存失败项**（见构建事实）属项目长期状态：non-CNG sync 提示与 RN Directory 元数据，不按其建议改配置；若未来转 CNG/EAS 构建需重新评估。
7. **JDK 17 留存**：`F:\code\tools\jdk17\jdk-17.0.21+9` 为后续构建的可用 JAVA_HOME；全局 JAVA_HOME 指向的旧 JDK 已失效，未动用户环境变量。
