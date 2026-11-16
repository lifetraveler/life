# 切片 24 收尾：夜间模式与视觉清理

完成日期：2026-11-16。分支 `task/slice-24`（基点 main @ 0172df3）。
三阶段一次连续完成（§7.33 情形 1：**不写阶段反馈文件**，阶段粒度由本 closeout §0 提交索引与 §3 代码地图承载）。

## 0. 交付清单

- 功能：全局主题 Token `src/ui/theme.ts`（ThemeColors + LIGHT_COLORS/DARK_COLORS +
  colorsForScheme + useTheme，含 textOnPrimary 共 8 键）；src/app + src/ui 51 文件
  硬编码色替换（makeStyles(colors) + useMemo 模式）；StatusBar / TabBar / Stack 导航头
  深浅跟随；FlashPreviewCard 时间行日期重复修复；AI merge inheritTags 修复（新意图
  不继承上一轮 tags，编辑词/澄清续答仍继承）。
- 文档：AGENTS.md v0.26（§7.36 主题与视觉规范成文 + §8 精简为指针）与任务卡
  `tasks/slice-24.md` 随阶段 1 提交入库；backlog.md §1 划项（本次收尾提交）。
- 反馈文件：无（三阶段一口气完成，§7.33 情形 1）。
- 版本：无变化（0.23.0 / versionCode 10；纯 UI 切片，无 schema、无 native 变更）。

### 提交索引（task/slice-24）

| commit | 内容 |
| --- | --- |
| 3767028 | feat(s24) 阶段 1：theme Token + 闪电卡日期重复与 AI tags 污染修复（10 文件 +386/−7，任务卡+AGENTS v0.26 入库） |
| 019fa8f | feat(s24) 阶段 2：全局 Token 替换（src/app+src/ui 51 文件）+ StatusBar/TabBar 深浅跟随（52 文件 +2647/−2280） |
| fa9ed46 | fix(s24) 阶段 3：真机验收修补——Stack 导航头 Token 化 + plan renderRow styles 依赖 |
| (收尾) | docs(s24) closeout + backlog 划项 + AGENTS §8 刷新 |

## 1. 环境事实

- Windows 原生 bash（GNU bash 5.3）；构建 JDK 同 slice-23（`D:\enviroment\java\jdk\oracle-jdk-17.0.10`）。
- 设备：AVD `emulator-5554`（Android 15）+ MuMu `127.0.0.1:16384`，包名 `com.vibecoding.life`。
- **本切片开始时两台设备均装的是 release v10 APK（`life-0.23.0-v10.apk`，无 dev-launcher）**：
  深链无法连 metro（dumpsys `grep -ic devlauncher` = 0 确证）。验收前两台均卸载 release、
  换装 `android/app/build/outputs/apk/debug/app-debug.apk`（2026-11-13 构建，expo-dev-client
  runtime exposdk:54.0.0；本切片零原生改动，旧 debug build 的 native 侧无损）。
- metro：`npx expo start --dev-client --port 8081` 后台运行；首次 bundling 16297ms / 2204 modules。
- dev client 深链：`exp+life://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081`
  **必须冷启动（先 `am force-stop`）才生效**；打在运行实例上 onNewIntent 不触发加载。
  `exp+life://localhost:8081` 会被 expo-router 当路由解析 → Unmatched Route 页（无效）。
  首次启动有通知权限弹窗（不允许 ≈450,1011）与开发菜单引导（Continue ≈450,1563）。
- `adb reverse tcp:8081 tcp:8081` 两台均设；AVD 亦可用 10.0.2.2 直达宿主。
- 中文输入：Android 15 `adb shell input text '中文'` 直过（无需 ADBKeyboard，raw.githubusercontent
  被墙未装成）；**空格会被 adb 拆参吞掉**（` #散步` 丢失）→ `#标签` 用无空格串（与 slice-23 教训一致）。
- 深浅切换：`adb shell cmd uimode night yes/no` **不重建 Activity、无需重启 App**，
  RN Appearance listener 驱动 useTheme 实时刷新；Fast Refresh 同样可热更样式。
- 坐标沿用 slice-23 closeout §1（AVD 900×1600：底部 tab y≈1535，闪电 112 / 事项 345 /
  计划 586 / 我的 816；计划顶栏 🔍≈613 筛选≈659 待≈727 今天≈811；FAB≈803,1418）。

## 2. 数据库/构建事实

- 本切片无 schema 变更（停留 v11）；无新依赖；无 `any`/`as any`；src/notifications/ 与
  src/domain/recurrence/ 零 diff（冻结区未触碰）；docs/contracts/* 未改动。
- 验证终态：`npx tsc --noEmit` 0 错；`npx jest --runInBand` **77 套件 / 1053 用例全过**
  （切片基线 76/1042 → +1 套件 +11 用例：flashPreviewCardTime 5 + merge inheritTags 3 +
  chat tags 继承边界 3）；`npx expo-doctor` 2 项预存基线失败无新增。
- hex 审计（src/app + src/ui 非测试文件）剩余全部豁免（6 处）：theme.ts（Token 本体）、
  visualOptions.ts PALETTE_COLORS（DB 数据色）、color.ts contrastTextColor（'#000000'/'#FFFFFF'
  对比色算法）、stripeColor.ts CARD_STRIPE_FALLBACK、profile.tsx:65 SAMPLE_TAG、
  FlashResultCard.tsx:39 FALLBACK_CATEGORY_COLOR（均为数据驱动色，§7.36 禁令针对主题装饰色）；
  另有 2 处 scheme 感知 rgba：FilterSheet.tsx:109（遮罩 0.4/0.6）、MonthPickerPopover.tsx:104
  （阴影 0.08/0.16），任务卡口径内接受。

## 3. 代码地图（本切片新增/改动）

- **新增**：`src/ui/theme.ts`（ThemeColors 接口 + LIGHT_COLORS/DARK_COLORS + colorsForScheme +
  useTheme；light/dark 各 8 token：background/card/text/textMuted/primary/border/danger/textOnPrimary）；
  `src/ui/__tests__/flashPreviewCardTime.test.ts`（5 例）。
- **核心修改**：
  - `src/ui/timeFormat.ts`：新增 formatItemClock（'HH:mm'）与 isSameCivilDay。
  - `src/ui/FlashPreviewCard.tsx`：describeDraftTime start 行单用 formatItemTime（修复日期重复），
    endAt 同民用日 formatItemClock / 跨日 formatItemTime。
  - `src/domain/ai/merge.ts`：mergeDraftCorrection 第 4 参 `options: MergeCorrectionOptions`
    （`inheritTags?: boolean`，false → tags 恒取本轮）。
  - `src/domain/ai/chat.ts`：fallbackTurn `inheritTags = matchesEditIntent(trimmed) ||
    previousDraft?.needsClarification === true`（编辑词轮与澄清续答轮继承，全新意图不继承）。
  - `src/app/_layout.tsx`：StatusBar style 随 colorScheme（dark→'light'）+ contentStyle 背景 +
    **headerStyle/headerTintColor Token**（阶段 3 真机修补）。
  - `src/app/(tabs)/_layout.tsx`：tabBarStyle/sceneStyle/activeTintColor/inactiveTintColor Token。
  - 其余 49 个页面/组件：module-scope StyleSheet → 组件内 `useMemo(() => makeStyles(colors), [colors])`
    + useTheme；静态回退常量改组件内 Token 回退；memo/useCallback 依赖补 styles。
- **测试**：merge.test.ts +3（inheritTags false/缺省 true/expressed 覆盖）、chat.test.ts +3
  （叫醒新输入不继承、编辑词继承、澄清续答继承+信号归位）。

## 4. 踩坑教训

- **release APK 冒充 dev client**：设备上装过 release v10 后，深链/monkey 启动跑的都是内嵌
  release bundle（旧配色截图骗过初判，「Unmatched Route」页也是旧 JS 渲染的）。判别法：
  `dumpsys package com.vibecoding.life | grep -ic devlauncher`（release=0）；logcat 见
  「Loading JS Bundle → Running main」0.3 秒完成且 metro 零 bundling 请求 = 内嵌 bundle。
- **memo/useCallback 依赖漏 styles**：Token 化后 styles 随 colors 重建，依赖数组缺 styles 时
  深浅切换瞬间沿用旧色。plan.tsx renderRow 真机复现（「周三 18」胶囊白底、月名标题暗字，
  Fast Refresh 补依赖后即恢复）；阶段 2 已修 MonthCalendarView/DayTimelineView/todos/archived
  同类问题，阶段 3 对全部 diff 文件做了括号配平扫描确认仅剩此一处。
- **Stack 导航头不随运行时深浅切换**：expo-router 默认头主题冷启动定格（夜间下 AI 配置/详情页
  头部仍浅底黑字）。screenOptions 显式 `headerStyle: { backgroundColor: colors.card }` +
  `headerTintColor: colors.text` 修复（fa9ed46），且随 useTheme 实时刷新。
- **dev-client 深链必须冷启动**：运行实例上 `am start -a VIEW` 报「delivered to currently
  running top-most instance」且无效果；force-stop 后再发才进 launcher/加载 manifest。
- **uimode 切换即时生效**：验收不需要重启 App；`cmd uimode night yes/no` 由 Appearance
  listener 直接驱动 React 重渲染。

## 5. 遗留披露

- **双设备上的 release v10 已被 debug build 替换**（验收需要 dev client）。恢复 release：
  `cd android && gradlew assembleRelease` 后 `adb install -r`（覆盖 debug 需先卸载，签名不同）。
- **标题保护块在新意图下会误留旧标题**：聊天实测「起床」标题沿用至「后天下午3点开会」卡
  （内容行正确并入两段原词）——切片 23 既有行为，阶段 1 已记录为已知观察，超本卡范围未动。
  后续如做对话式新建流（切片 25 认真模式同域）可一并处理。
- rgba 2 处非 hex 值按任务卡口径接受（见 §2 审计节）。
- backlog U1/U2/U3 手验项不受本切片影响，仍开放；L1–L13 未动。
- 契约文档无变更：§7.36 落在 AGENTS.md，docs/contracts/ui.md 正文未动（本切片是 v0.26
  首次实现，无新增契约语义）。

## 6. 真机验收清单（已执行，AVD + MuMu 双设备）

- 浅色：计划页（空态 + 数据态）/ 新建页 / 闪电页 / 闪电聊天（用户气泡/预览卡/类型徽章/确认按钮）/
  详情页 / 待办页——米色底 #F5F0E6、白卡、绿主色 #4C7A5C、DB 数据色（分类 chip/色条）完好。
- 深色：同上 + 我的 / 分类与标签（AI 配置含输入框对比度）/ 筛选面板（rgba 遮罩 0.6）——
  暗底 #201D18、暗卡 #2D2924、亮字 #E8E2D6、深绿 #5D9471。
- 深浅双向**实时切换**（不重启）+ StatusBar 双向跟随（浅色深图标 / 深色亮图标）。
- 遗留修复 1（日期重复）：`2026-11-17 08:00` 单日期；allDay 卡 `2026-11-21 全天`；跨日 endAt 带日期 ✓。
- 遗留修复 2（tags 污染）：叫醒卡（自动闹钟渠道）→ 带标签输入 merge 卡（标签=散步）→
  全新意图「后天下午3点开会」→ **标签行消失（不继承）** ✓；编辑词/澄清续答继承路径由单测覆盖。
- 验收中发现并修复 2 处缺陷（fa9ed46：Stack 头 Token、renderRow styles 依赖），修复后复验通过。
- MuMu 与 AVD 深色渲染一致性 ✓。
