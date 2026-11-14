# 切片 21 收尾移交（closeout）：真机显示修补与防重发

## 0. 交付概览

- 分支 `task/slice-21`（自 main @ 6f952d7），四段提交：
  - `5824316` 立项（任务卡 + AGENTS 版本头 v0.20→v0.21 对齐 §7.32）；
  - `bddfe0f` 阶段 1 UI 显示修补（5 files, +105/-10）；
  - `1ee0e82` 阶段 2 网络渠道防重发（7 files, +269/-6，notifications 冻结区单独 commit）；
  - 真机反馈修补（plan.tsx 跨午夜滚动 + agenda 空今日降级定位，closeout/AGENTS §8 同笔提交；commit 信息含「切片 21 修补」，可从 git log 追溯）。
  - 真机反馈修补第 2 笔（plan.tsx「今天」组头恒显示——空今日合成组头+空态卡挂组头下；closeout/AGENTS 同步）。
- 无 schema 变更、无新依赖、无 native 配置改动。
- 真机验收（MuMu，release APK @2026-11-15）：flash 顶部不遮挡 ✓、空今日「今天 0」合成组头+空态卡 ✓（第二轮验收：冷启动与「今天」pill 从 2027年2月回位均落今天组头顶）、font_scale 1.3 频率/渠道/时区 chips 不折行 ✓、闪电本地降级解析+落库 ✓（测试条目已归档清理）；第三轮验收（新 APK）：空态卡无「＋ 快速安排」按钮仅文案 ✓、长按 FAB 800ms 跳闪电录入页（dump 证实「⚡ 闪电添加」+输入框）✓；**webhook 回前台不双发实机复验留待用户**。

## 1. 环境事实（承接 slice-20，均复验）

- Windows 原生 bash（无 MSYS）；npm；jest preset=jest-expo。
- `npx tsc --noEmit` 0 错；`npx jest --runInBand` 71 套件 / **926 用例全过**（基线 918 + 本切片新增 8）。
- `npx expo-doctor` 16/18，2 项失败与 slice-20 基线完全相同（android/ CNG 同步提示、RN Directory 元数据缺 battery-optimization/widget-snapshot-store/@nozbe/simdjson + watermelondb 新架构未测），无新增问题。
- git push 仍需代理：`git -c http.proxy=http://172.16.100.254:7893 -c http.version=HTTP/1.1 push`。
- Android 真机构建需 `JAVA_HOME=D:\enviroment\java\jdk\oracle-jdk-17.0.10`。
- MuMu 联调基建（承接）：webhook 接收端 node 脚本 0.0.0.0:18999 恒回 200（日志 C:\Users\Public\webhook-receiver-s20.log）+ `adb reverse tcp:18999 tcp:18999` + `adb reverse tcp:8081 tcp:8081`；MuMu=Android 15 127.0.0.1:16384 com.vibecoding.life；`adb shell settings put system font_scale 1.3` 模拟大字体。

## 2. 数据库/构建事实

- 本切片纯 JS 层（UI 组件 + src/notifications/ JS 实现），**无 schema/migration 变更**，无新增 native 模块；development build 无需重打，Metro reload 即可验收。
- `react-native-safe-area-context` ~5.6.0（实装 5.6.2）本就在 package.json，flash.tsx 的 `useSafeAreaInsets()` 是 src/ 内首个使用点，无依赖动作。
- 阶段 2 触碰 src/notifications/（冻结区授权修补，AGENTS §7.32 第 4 条 + 任务卡阶段 2），已按 §7.9 精神单独 commit（`1ee0e82`），可与阶段 1 独立回滚。
- **release APK 需重打才有修补后的 JS**（MuMu 首轮验收误用 14:12 的 slice-20 旧包，界面完整 + `flags=0x0` 非 debuggable + 8081 无 Metro ⇒ release 包）：`gradle assembleRelease`（JAVA_HOME 同上）→ `adb -s 127.0.0.1:16384 install -r android/app/build/outputs/apk/release/app-release.apk`（108MB）→ force-stop + 冷启动。MuMu 设备时区 Asia/Shanghai 系统侧正确（`getprop persist.sys.timezone` 复验）。

## 3. 代码地图

### 阶段 1（UI 显示修补，commit bddfe0f）
- `src/app/(tabs)/flash.tsx`：`useSafeAreaInsets()` 顶部 padding（状态栏不再遮挡聊天列表）+ 底部 inputRow `paddingBottom: 12 + insets.bottom`（手势条让位）。
- `src/ui/ReminderChannelFields.tsx`：styles.segment 去 `flex:1` → `flexGrow:0/flexShrink:1/minWidth:64/paddingHorizontal:12`，chip Text 加 `numberOfLines={1}`。
- `src/ui/ReminderFormEditor.tsx`：频率行 styles.segment 同配方；Text `numberOfLines={1}`。
- `src/ui/TzPicker.tsx`：styles.option 去 `flex:1`（minWidth 88）+ 行 flexWrap + optionText `numberOfLines={1}`。
- `src/app/(tabs)/plan.tsx`：agenda 视图新增 `AgendaRowEmptyToday` 行类型（kind:'empty-today'，携带 civilKey 与 item 行标签跟随逻辑同构）+ `AgendaEmptyTodayCard` 组件（「今日没有安排」+「＋ 快速安排」按钮，accessibilityLabel="快速安排"），插在**今天所在月页的月名行之后**（仅当今天的 day 组不存在时）；CTA 复用 `openNewItem` → `router.push('/item/new')`。

### 阶段 2（网络渠道防重发，commit 1ee0e82）
- `src/notifications/channels/networkTimers.ts`：NetworkTimerRegistry 新增 `beginDeliver(channelId, occurrenceKey): boolean`（原子占位，false=已占用）/ `endDeliver(...)`（幂等释放）/ `isInFlight(...)`；底层 `inFlight: Set<复合键>`；cancel/cancelByReminder/clearTimers/pruneExcept **均不清占位**（投递仍在进行，由持有方 finally 释放）。
- `src/notifications/channels/types.ts`：`NetworkDeliverStatus` 扩展 `'skipped'`（内部类型，非冻结）：beginDeliver 被拒→不 send、不写 attempts，结果由并发持有方 recordAttempt。
- `src/notifications/channels/BaseNetworkChannel.ts`：deliver 体首行（任何 await 之前）`beginDeliver` 占位，被拒即 warn+返回 'skipped'；原 try/catch 包进 try…finally，finally 无条件 `endDeliver`（失败/抛错路径也释放）。**原子性依据：claim 发生在第一个 await 前，JS 单线程事件循环保证无间隙。**
- `src/notifications/ReminderScheduler.ts`：reconcile missed 循环在 `attemptStatus==='ok'` 判重后新增 `isInFlight` 跳过——迟到 timer × reconcile 竞态窗口（slice-20 披露的回前台双 POST 缺陷）双向封闭。
- 测试：`networkTimers.test.ts` +5（占位原子性/复合键隔离/清除方法不清占位/endDeliver 幂等/与 attempts 独立）；`WebhookChannel.test.ts` +2（并发第二路 skipped 且 fetch 恒 1 次、失败路径 finally 释放后可重试）；`ReminderScheduler.test.ts` +1（端到端 race：deferred fetch 挂起首路投递 → 并发 reconcile 不双发 → 完成 → 下一轮不再补发）。

### 真机反馈修补（plan.tsx；修补 1–2 在 commit 568d3f3，修补 3 在 c4c7785，修补 4 在其后的追加提交，closeout/AGENTS 同步）
- `src/app/(tabs)/plan.tsx` 修补 1 —— **viewTime 跨午夜滚动**：`viewTime` 由挂载固化改为可滚动（`setViewTime`）；新增 `rollViewTimeToNow` useCallback（tzid 重取 + nowMs=Date.now()，**同民用日不重置**避免无谓重渲染，anchor 不动）；AppState 'active'（回 App 前台，subscription.remove() 清理）与 `useFocusEffect`（回页签）双触发。修复：App 进程长存跨午夜不重挂 → todayKey 停在挂载日（用户报「北京时间已 11-15 但今日还是 11-14」），「今天」判定/空态卡/回位全部停滞。
- `src/app/(tabs)/plan.tsx` 修补 2 —— **agenda 定位 effect 补空今日降级**：今日组行 600ms 未解析则 `scrollToOffset(index * AGENDA_MONTH_HEADER_BLOCK)` 回退到今天所在月页的月名行顶并 `agendaJumpTargetRef.current = null`（月名行恒存在，offset 不依赖行测量）；600ms 内 items 到位则 effect 随 agendaRows 重跑走正常 header 定位、timer 随 cleanup 取消。修复：原分支 header 缺失时挂起目标永不清除——「今天」pill 与冷启动定位在空今日上双双失效（原注释声称「无今日组回退月名行」但代码无此路径）。
- `src/app/(tabs)/plan.tsx` 修补 3 —— **「今天」组头恒显示**（用户反馈第二轮）：参考「今天 1」有内容组头的视觉，空今日时也在月名行后合成「今天」组头（key=`header-<todayKey>`、label '今天' 与 domain `dayGroupLabel` today 分支同文案、isToday 高亮/count 0，复用真实组头渲染与 `todayHeaderRef` 精修定位）+ 空态卡挂组头下。`header-<todayKey>` 由此恒存在 ⇒ 今天 pill/冷启动定位与「有内容」走同一条 header 定位路径；600ms 月名行降级（修补 2）退居兜底，仅覆盖 rows 未到位（observer 未推送）窗口。
- `src/app/(tabs)/plan.tsx` 修补 4 —— **空态卡去按钮 + FAB 长按跳闪电录入**（用户反馈第三轮）：空态卡移除「＋ 快速安排」按钮——右下角 FAB 已是常驻新建入口，卡片仅保留「今日没有安排」文案（AgendaEmptyTodayCard 改无 prop 纯文案卡，emptyTodayButton/emptyTodayButtonText 样式删除）；FAB 长按由 stale Alert「闪电录入 即将上线」（阶段 5b 占位）改为 `openFlashTab` → `router.push('/flash')` 切闪电录入 tab（delayLongPress=400 不变，onPress=openNewItem 仍新建）；renderRow deps 去 openNewItem，Alert 从 react-native import 移除。**§5 原披露的 FAB stale Alert 遗留就此解决**（原计划并入 slice-22，用户提前拍板）。
- 诊断记录：「今日停 11-14」**不是时区问题**——getDeviceTzid（slice-11 起 expo-localization）无 UTC 伪影，MuMu `persist.sys.timezone=Asia/Shanghai` 正确；根因即修补 1。today.tsx/week.tsx 的挂载固化 viewState 不受影响（独立页每次进入重挂，slice-14 契约原样保留不动）。

## 4. 踩坑教训

1. **注入 registry 时 onFire 由 registry 自带**：`WatermelonReminderScheduler` 构造器只在**未注入** registry 时把 onFire 接到私有 `dispatchNetworkFire`；测试里注入 noop-onFire registry 会让 timer 静默（fetch 0 次）。端到端 race 测试改用 `makeChannelScheduler`（内部 registry 派发正确），以 fetch 调用次数为可观察断言；registry 内部状态断言下沉到 WebhookChannel/networkTimers 两级单测。
2. **chips 去 flex:1 的固定配方**：`flexGrow: 0, flexShrink: 1, minWidth: <按文案>, paddingHorizontal: 12` + Text `numberOfLines={1}`，行容器保留 `flexWrap`。纯删 flex:1 会丢触达面积（minWidth 保底）。
3. **agenda 空态卡的挂点是「月页行数组」不是 ListEmptyComponent**：后者只在整页无数据时渲染；「今天空但本月其他日有数据」不会触发。空态卡须作为一行插进 agendaRows（本次插在今天所在月页的月名行之后）。
4. **`windowOccurrences` 纯未来窗口（instant > now）是防重发设计成立的前提**：调度桶/replace 永不重挂已投递的过去 occurrence，定时器路径对已 'ok' occurrence 无重复 fire 通道；双发唯一入口就是迟到 timer × reconcile missed 竞态，本次双向封闭后链路完备。
5. **「挂载固化 now」的设计意图 vs 长存进程**：plan/today/week 的 viewTime 固化本意是「活跃使用期间不漂移」，但 App 进程可存活远超一天且 Tab 页不重挂——固化变成缺陷。修法取中：保留固化语义（同民用日不重置），仅在回前台/回页签两个明确时机滚动 now；独立路由页（today/week）每次进入重挂，无需同款修补。
6. **注释声称的降级路径必须在代码里存在**：plan.tsx 定位 effect 注释写着「无今日组回退月名行」但实现只有 `rowIndex >= 0` 才滚动，空今日上挂起目标永不清除——注释与代码的偏差是用户报「定位到今日失效」的直接根因之一。写注释时应让分支结构与注释逐条对应。
7. **本机构建必须走 `gradlew.bat`（cmd /c），不能用 POSIX `./gradlew`**：原生 Windows bash 无 cygpath——gradlew shell 脚本在路径转换处直接 `cygpath: command not found` → `exec: : not found`（exit 127）；且此 bash 不做 MSYS 路径改写，`cmd //c` 不会被转成 `/c`，cmd 进交互模式立即 EOF 退出造成 exit 0 假象（APK 未重建——字节大小不变可识别）。正确姿势：`cmd /c "set JAVA_HOME=D:\enviroment\java\jdk\oracle-jdk-17.0.10&& gradlew.bat assembleRelease --console=plain"`，核对 `grep "BUILD SUCCESSFUL"` + APK mtime。

## 5. 遗留披露

- **阶段 3 真机/MuMu 验收已执行（2026-11-15，release APK）**：flash 顶部不遮挡、空今日空态卡+「＋ 快速安排」、「今天」pill 空今日回位、font_scale 1.3 频率/渠道/时区 chips、闪电本地降级解析+落库均实测通过（真机反馈修补两处即出自本轮验收：viewTime 跨午夜滚动、空今日降级定位）。**唯一遗留：webhook 回前台不双发的实机复验留待用户**（webhook 渠道造 once 提醒 → 触发后杀/切后台 → 回前台秒级补发，对照 receiver 日志 C:\Users\Public\webhook-receiver-s20.log 时间戳应只出现一条 POST）。
- ~~FAB 长按 stale Alert「闪电录入 即将上线」~~ **已解决（修补 4，用户 2026-11-15 拍板）**：FAB 长按改为 `router.push('/flash')` 切闪电录入 tab，不再并入 slice-22。
- **skipped 语义的边界**：并发持有方投递失败（attempt 'failed'）且 reconcile 游标已推进时，下一轮 reconcile 不再补发（既有「每轮至多一次机会」语义，单测 L919 已覆盖）；渠道级直接重试同一 occurrenceKey 仍可行（WebhookChannel 单测覆盖）。
- **in-flight 与 attempts 同为进程内存态**：进程死亡即失，at-least-once 边界不变（notifications.md v0.16「attempts 随进程生命周期存在」承诺的实现强化，无契约语义变更，docs/contracts/ 未动）。

## 6. 后续切片候选（不变，承接 slice-20 排期）

slice-22 闪电录入卡片化 → slice-23 夜间模式 → slice-24 数据备份 JSON+WebDAV【提案先行】；变更 B（网络渠道后台送达）仍为插队候选。
