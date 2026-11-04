# 切片 10 收尾移交：Android 桌面小组件

日期：2026-11-05。分支 `task/slice-10`（自 `3b8adf2` 即切片 9 合并后的 main 切出；开工 commit `3657e7e`）。

## 1. 交付摘要

- 4x2 Android 桌面小组件「今日待办」：过期 + 已安排 top5（每行 `timeLabel  title`，过期/done 灰显）、空态「今天没有安排」、底部「＋ 快速记录」pill。light/dark 双配色 representation，适配深浅模式。
- 数据桥接：App 侧快照桥在四触发点（launch / foreground / data-change / WIDGET_UPDATE）把「今日待办快照」JSON 写入 SharedPreferences（键 `widget_today_snapshot_v1`），再 `requestWidgetUpdate` 重画。小组件进程不读 SQLite。
- 快照写入通道：本地极小 Expo Module `modules/widget-snapshot-store`（Kotlin，SharedPreferences get/putString），零新 npm 依赖、零 manifest 权限。
- 点击链路：条目行 → `life://item/<id>`（详情页，复用切片 6 路由，删除后进占位页）；pill → `life://quick-add`（新增 `src/app/quick-add.tsx` 路由，导航就绪后 `router.replace('/')` 进根记录页并聚焦标题输入）。
- 依赖：新增 `react-native-android-widget ^0.26.0`（任务卡方案 A 允许）。`package.json` main 由 `expo-router/entry` 改为 `index.ts`（根 `index.ts` 先注册 expo-router 再注册 widgetTaskHandler）。
- 测试：`src/domain/widget/__tests__/snapshot.test.ts` 7 用例（空、恰好、超 5 截断、allDay→全天、done 在 scheduled、overdue 仅 active、无 startAt 裸事件不入组），期望值独立构造、timeLabel 断言统一 tzid 'UTC'。

## 2. 环境事实（承接切片 9 closeout，增量）

- 新依赖：`react-native-android-widget@0.26.x`（npm ^0.26.0，lockfile +17 行）。entry 变更后 `tsconfig.json` include 追加 `index.ts` 与 `modules/**/*.ts`。
- 构建顺序（新增原生模块后）：`rm -rf node_modules/expo/android/build && ./gradlew :expo:generatePackagesList`（55s，autolinking 发现 `modules/widget-snapshot-store/android`）→ `:app:assembleDebug`（2m17s，APK 179MB）。JAVA_HOME 同切片 9。
- 测试设备：MuMu `127.0.0.1:16384`（两台设备并存：emulator-5554 空闲，所有 adb 命令必须 `-s 127.0.0.1:16384`）。launcher 实为 Lawnchair（`app.lawnchair`），非 MuMu 默认桌面。
- `persist.sys.timezone=Asia/Shanghai`（+8），但 App 按切片 9 伪影以 UTC 坐标运行（`getDeviceTzid()` 返回 'UTC'）——小组件快照的「今日」范围与 timeLabel 全部是 UTC 坐标，见 §5。
- **Metro/Windows FallbackWatcher 坑实锤**：metro 运行期间用 edit/write 新增 `src/widget/*` 文件 → FallbackWatcher 不收录 → bundle 500 `UnableToResolveError "./requestWidgetUpdate from src/widget/index.ts"`（文件实际存在）。处置：`Stop-Process` 杀 metro 后重启。本切片已提前重启规避，仍踩中一次。
- **rnaw 首击校准机制**（`RNWidgetSizing.java`）：点击时 `correct()` 用 `sourceBounds+padding` 反推真实 cell 尺寸写入 `rnwidget.measured_sizes.xml`（profile 匹配才生效），并把该次点击消费为 WIDGET_RESIZED；`hasOutdatedSize()`（渲染后 profile/size 变化）同样静默吞点击。真机实测：Lawnchair 报告的 `OPTION_APPWIDGET_SIZES` 预设（264×324dp 等 4 个）不含真实 cell 203×248dp → 首次真实点击被校准消费，其后点击正常。**首次点击不触发动作是一次性预期行为**，验收时先点一次「激活」再测。
- 图像与热区错位：纠偏前位图与 clickable 覆盖层可差 ~40px（库已知特性「image and hit areas may disagree」），纠偏渲染后对齐；点击验收用 `uiautomator dump` 读覆盖层 bounds，不要用位图视觉坐标。
- **stopped 状态链路**：force-stop → 包进 stopped → ① manifest receiver 收不到广播（FLAG_EXCLUDE_STOPPED_PACKAGES），② 已注册 PendingIntent 全部失效（launcher 端 `ActivityNotFoundException at Activity.startIntentSender`），③ WM 任务被 JobScheduler 扣住 → 点击完全无响应。`am kill` 只杀进程不清 stopped，且 PI 不随进程死亡失效 → 冷启动验收用 `am kill`。恢复 = `am start` 一次 + JS 加载后 launch 触发点重画（重注册 PI）。
- headless 任务：dev 下冷启动 headless ~30s（拉 bundle）；App 进程 JS 存活时秒级完成。`requestWidgetUpdate` 的 JS 路径是 getWidgetInfo→renderWidget→drawWidgetById 直绘（无 WM 日志是正常）；WM 路径只服务原生广播触发的 headless 任务。
- 测试骚操作坑：`am broadcast` 手工模拟 WIDGET_CLICK 时 `clickActionData` 必须传 Bundle（`--es clickActionData '{}'` 传字符串 → `Arguments.fromBundle(null)` NPE at Arguments.java:301）——崩溃是测试手法造成，非产品 bug；DevLauncher 会残留 uncaught exception 警告横幅。
- 快照 XML 读法：`run-as com.vibecoding.life cat shared_prefs/widget_snapshot_store.xml`；XML 转义引号为 `&quot;`，grep 引号串会落空，直接 cat 全文看。

## 3. 代码地图（全部新增/修改）

新增（本切片，含目录）：

| 文件 | 说明 |
| --- | --- |
| `src/domain/widget/snapshot.ts` (114) | `buildTodayWidgetSnapshot(input)` 纯函数：今日分组（overdue+scheduled top5）、allDay→全天、过期→已过期、done 灰显标记、无 startAt 不入组；schema 冻结字段 id/title/type/timeLabel/status |
| `src/domain/widget/index.ts` (16) | re-export |
| `src/domain/widget/__tests__/snapshot.test.ts` | 7 用例（§1） |
| `src/data/WidgetSnapshotWriter.ts` (137) | Repository 查询→快照→`widgetSnapshotStore.setString`→`requestWidgetUpdate`，500ms 去抖；三级兜底（写库读回→旧持久化→空快照） |
| `modules/widget-snapshot-store/` | 本地 Expo Module：`index.ts`/`expo-module.config.json`/`package.json`/`android/`（`WidgetSnapshotStoreModule.kt` + build.gradle，SharedPreferences 读写） |
| `src/widget/widgetName.ts` (6) | `WIDGET_NAME='TodayWidget'` |
| `src/widget/TodayWidget.tsx` (162) | rnaw 渲染树（'use no memo'——build-widget-tree 把自定义组件当函数展开，禁 hooks/memo）；light/dark palette（light bg#F5F0E6/text#3D3A34/muted#8A8377/accent#4C7A5C；dark bg#201D18/text#E8E2D6/muted#9C948A/accent#5D9471） |
| `src/widget/requestWidgetUpdate.tsx` (25) | `refreshTodayWidgets(snapshot)` |
| `src/widget/taskHandler.tsx` (89) | widgetTaskHandler：CLICK→OPEN_ITEM/OPEN_QUICK_ADD→`Linking.openURL`；ADDED/UPDATE/RESIZED→先写快照再渲染（触发点 4） |
| `src/widget/snapshotBridge.ts` (106) | `initWidgetSnapshotBridge`：launch/foreground/data-change 三触发点 + AppState 监听 + observeOverdueItems/observeScheduledItemsInRange 订阅；返回清理函数 |
| `src/widget/index.ts` (12) | re-export |
| `src/app/quick-add.tsx` (25) | `life://quick-add` 路由：导航就绪（`useRootNavigationState?.key`）后 `router.replace('/')` |
| `index.ts` (15) | 根入口：`expo-router/entry` 注册 + `registerWidgetTaskHandler(widgetTaskHandler)` |
| `android/.../widget/TodayWidget.java` | provider 空类（`extends RNWidgetProvider`，package com.vibecoding.life.widget） |
| `android/.../res/xml/widgetprovider_todaywidget.xml` | 180×110dp、4x2 cell、resizeMode horizontal|vertical、updatePeriodMillis=0、previewImage |
| `android/.../res/drawable/todaywidget_preview.png` | 预览图（脚本生成占位图，2250B） |
| `assets/widget-preview/TodayWidget.png` | app.json 引用的源预览图 |

修改：

| 文件 | 说明 |
| --- | --- |
| `android/app/src/main/AndroidManifest.xml` (+16) | 手工注入 receiver（`.widget.TodayWidget`，APPWIDGET_UPDATE + WIDGET_CLICK action）+ service（RNWidgetCollectionService）；注释注明与 rnaw config plugin 等价 |
| `android/.../res/values/strings.xml` (+3) | `widget_todaywidget_description`（translatable=false） |
| `app.json` (+18) | plugins 追加 rnaw 配置（widgets 数组，单小组件声明） |
| `package.json` / `package-lock.json` | +rnaw ^0.26.0；main 'expo-router/entry'→'index.ts' |
| `tsconfig.json` | include + 'index.ts' + 'modules/**/*.ts' |
| `src/app/_layout.tsx` (+14) | useEffect 挂 `initWidgetSnapshotBridge`（cleanup 退订）+ Stack.Screen quick-add（headerShown:false） |
| `src/data/index.ts` (+11) | 导出 WidgetSnapshotWriter 相关 |
| AGENTS.md / docs/contracts/ui.md / tasks/slice-10.md | 已随开工 commit `3657e7e` 入库（§7.16 契约冻结 + 任务卡）；本次完成态更新 §8 |

## 4. 验收对照（任务卡 1–14）

| # | 标准 | 观察结果 |
| --- | --- | --- |
| 1 | tsc 零错误 | EXIT=0（含 index.ts/modules/**/src/widget） |
| 2 | jest 全过 | 24 suites 303 tests 全过；快照 7 用例 ≥6 类要求 ✓ |
| 3 | expo-doctor 基线 | 两项已知非阻断（非 CNG 同步警告、RN Directory 元数据）与切片 9 基线一致，无新增 |
| 4 | 代码检查 | `git diff main -- src/domain/recurrence src/notifications src/db/migrations.ts` 零 diff；新增代码无 any；无 rrule；无 expo-widgets 依赖 |
| 5 | 启动无红屏 | dev client 拉起 JS，ReactNativeJS Running "main"，根页正常渲染 |
| 6 | 添加小组件 + 快速记录 | 桌面长按→微件→「life 1 个微件」→预览→添加（widgetId=5）；渲染正确（暗色配色、过期行灰显、时间行、pill）；pill 点击→WIDGET_CLICK 广播→headless task→`life://quick-add`→根记录页聚焦标题输入 ✓（含进程被杀后冷启动链路，§8 条目 8 验证） |
| 7 | 数据变更数秒内更新 | 完成按钮→5s 内 generatedAt 更新 + status→done + overdue 清空 + 重画灰显；取消完成反向验证 ✓；删除/导入同样即时 |
| 8 | 条目点击详情 + 删除后占位页 | 行点击 dat=/5/1→`life://item/<id>`→详情页（与 deep link 直测截图一致）；删除后再点→「条目已删除」占位页 + 返回按钮 ✓ |
| 9 | 空态与恢复 | 删除后 groups 全空→「今天没有安排」；系统日历重导入→scheduled 恢复→小组件显示 ✓ |
| 10 | 时区伪影记录 | 见 §5：+8h 偏移如实记录 |
| 11 | 跨天刷新限制 | 见 §6：设计层面确认（updatePeriodMillis=0、无周期任务、仅四触发点）；未整夜实测，如实披露 |
| 12 | 不触碰冻结区 | 同 #4；未引入 expo-widgets |
| 13 | 无组件内完成 | 小组件 UI 仅列表行 + 快速记录 pill，无完成/取消按钮 |
| 14 | 分支提交合并 | `task/slice-10` → commit → push → `git merge --no-ff` → push main（见 §8） |

真机快照实际 JSON（重导入后）：

```json
{"generatedAt":1793824227728,"tzid":"UTC","groups":{"overdue":[],"scheduled":[{"id":"wkehph97jzyl8yoi","title":"验收9恢复事件","type":"event","timeLabel":"20:57","status":"active"}]}}
```

## 5. 时区伪影对 timeLabel 的实际影响（记录，不修）

- 设备真实时区 Asia/Shanghai(+8)，App 以 UTC 坐标运行（切片 9 伪影，§7.15 接受）。
- timeLabel 显示 UTC 时刻：上例 `20:57` 实际是北京次日 04:57——**偏差 8 小时，如实记录，不静默当作正确**。
- 「今日」按 UTC 日历日划分：北京 00:00–08:00 期间 UTC 仍是昨日 → 小组件的「今日待办」列表与用户体感日期可能相差一天（含用户体感昨日、或漏掉体感今日 0-8 点的事件）。
- 修复属切片 11（可靠性）范围，小组件快照桥已把 tzid 显式写入 JSON（`tzid:"UTC"`），届时改 `getDeviceTzid` 即全链路自洽，快照 schema 无需变更。

## 6. 跨天刷新限制的实际观察（记录）

- 设计层面确认：`widgetprovider_todaywidget.xml` `updatePeriodMillis=0`；无 AlarmManager/WorkManager 周期任务（§7.16 禁止）；刷新仅靠四触发点（launch/foreground/data-change/WIDGET_UPDATE）。
- 推论（未整夜实测，如实披露）：次日不打开 App，小组件停留前一日快照；打开 App 后 launch 触发点立即更新。跨天瞬间的小组件渲染由 launcher 的 APPWIDGET_UPDATE 触发 headless 重画（重画内容仍是旧快照数据）。

## 7. 契约触碰

- 未修改任何受保护契约：Repository/schema/migrations/notifications/recurrence 零 diff。
- `docs/contracts/ui.md` 新增 §7.16 对应契约正文、AGENTS.md 新增 §7.16 摘要与 §7.14 路线——均为开工 commit `3657e7e` 按任务卡流程落盘的冻结文本，非对既有冻结条款的修改。
- 未引入 AlarmManager/WorkManager 做后台刷新；快照 schema 未含 content/tags/reminders。

## 8. 分支、commit 与远端核对

- 分支：`task/slice-10`（自 main `3b8adf2` 切出，开工 commit `3657e7e`）。
- 完成提交：`完成切片 10：…`（hash 见 git log）；push：`git push -u origin task/slice-10`（遇 reset 加 `-c http.version=HTTP/1.1`）；merge：`git merge --no-ff task/slice-10`；`git push origin main`；切片分支保留。

## 9. 遗留与风险

1. **后台定时刷新未做**：§7.16 明确禁止本切片引入，跨天/长期不打开 App 的快照陈旧问题留后续切片。
2. **小组件内完成操作未做**：§7.16 禁止（跨进程写 DB 复杂度），完成仍需进 App。
3. **时区伪影未修**：见 §5，切片 11 范围。
4. **首击校准**：小组件放置后首次点击可能被 rnaw 尺寸校准消费（不触发动作，派 WIDGET_RESIZED 自纠偏），其后正常——库机制，验收/使用时先点一次。
5. **MuMu/Lawnchair 特性**：OPTION_APPWIDGET_SIZES 预设不含真实 cell 尺寸，依赖首击校准兜底；bnds 字段报旧 cell 属报告怪癖不影响功能。
6. **桌面误拖「篮球少女」商店快捷方式**：验收操作误拖产生（[20,1018][235,1191]），长按菜单无移除项、input swipe/drag 无法清除——装饰性污染，需手动清理，不影响应用。
7. **Metro FallbackWatcher 竞态**（开发环境）：metro 运行期间新增 src 文件不被收录 → 重启 metro；已两次踩中，开发期注意。
8. **headless 冷启动 30s（dev）**：bundle 拉取耗时；release 构建无此开销（未实测，风险低）。
9. 预览图为脚本生成占位图（2250B），后续可换设计稿产物。
