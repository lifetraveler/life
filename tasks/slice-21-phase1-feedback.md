# 切片 21 · 阶段 1 反馈总结（真机显示修补）

- 日期：2026-11-15
- 阶段：Phase 1 / 2（UI 显示修补，不碰冻结区；阶段 2 为网络渠道防重发，另见 closeout）
- 分支：`task/slice-21`（基点 main @ 6f952d7）
- 阶段提交：`bddfe0f`（5 文件，+105/-10）；另有真机反馈追加修补三笔——`568d3f3`（修补 1–2）、`c4c7785`（修补 2 轮「今天」组头）、`5d380e2`（修补 3 轮空态卡/FAB），均属 UI 层延续，未触碰 src/notifications/
- 状态：✅ 完成（三轮 MuMu 验收全过；webhook 回前台不双发复验为用户手动项，不阻塞本阶段）

## 一、成果定性：达标

| 维度 | 结果 |
| --- | --- |
| 类型安全 | `npx tsc --noEmit` 0 error |
| 测试 | `npx jest --runInBand` 71 套件 / 926 用例全过（=基线，UI 阶段无新增测试） |
| expo-doctor | 与基线一致（2 失败预存：android/ CNG 提示 + RN Directory 元数据） |
| 真机 | MuMu 三轮实机验收 ✓（flash 顶部、chips 大字体、空态卡、今天回位、FAB 长按） |
| 交付 | release APK v0.21.0 / versionCode 2（commit 3d3b368，对齐 AGENTS v0.21） |

## 二、原始范围落点（阶段提交 bddfe0f，5 文件）

| 文件 | 修补 | 解决的问题 |
| --- | --- | --- |
| `src/app/(tabs)/flash.tsx` | `useSafeAreaInsets()` 顶部顶垫 + 底部输入行加 `insets.bottom` | 闪电页对话气泡顶进状态栏、输入框贴手势条（任务卡验收 1） |
| `src/ui/ReminderChannelFields.tsx` | 渠道 chips `flex:1` → 自适应宽（flexGrow:0 + flexShrink:1 + minWidth + paddingHorizontal）+ `numberOfLines={1}` | font_scale 1.3 下「系统通知」断成「系统通/知」（任务卡验收 3 点名） |
| `src/ui/ReminderFormEditor.tsx` | 频率行 4 chips 同款配方 | 频率选项截断 |
| `src/ui/TzPicker.tsx` | 时区选项同款配方 + 行 flexWrap | 时区选项截断（顺带检查发现的同风险点） |
| `src/app/(tabs)/plan.tsx` | agenda 空态卡「今日没有安排」+「＋ 快速安排」（插在今天所在月页的行数组里，非 ListEmptyComponent） | 「今天空但本月有数据」时无任何空态提示（ListEmptyComponent 只管整页空） |

配方要点（教训 2，closeout §4）：`flex:1` → `flexGrow:0, flexShrink:1, minWidth:<按文案> + paddingHorizontal:12` + Text `numberOfLines={1}`，行容器保留 `flexWrap`；纯删 flex:1 会丢触达面积。

## 三、真机反馈三轮演化（plan.tsx，最终形态）

1. **修补 1 —— viewTime 跨午夜滚动**（568d3f3）：`viewTime` 由挂载固化改为可滚动，AppState 'active' + useFocusEffect 双触发回前台/回页签时滚 now，**同民用日不重置**避免无谓重渲染。根因：App 进程长存跨午夜不重挂 → todayKey 停在挂载日（用户报「北京时间已 11-15 但今日还是 11-14」）；**诊断确认不是时区**——getDeviceTzid（slice-11 起 expo-localization）无 UTC 伪影，MuMu 系统时区 Asia/Shanghai 正确。
2. **修补 2 —— agenda 定位 effect 补空今日降级**（568d3f3）：今日组行 600ms 未解析则回退月名行定位并清除挂起目标（原注释声称「无今日组回退月名行」但代码无此路径——「今天」pill 与冷启动定位在空今日上双双失效）。
3. **修补 2 轮 —— 「今天」组头恒显示**（c4c7785，用户第二轮拍板）：空今日时也合成「今天」组头（key=`header-<todayKey>`、count 0、isToday 高亮，复用真实组头渲染与精修定位 ref）+ 空态卡挂组头下；`header-<todayKey>` 由此恒存在 ⇒ 定位与「有内容」走同一条 header 路径，600ms 降级退居兜底。
4. **修补 3 轮 —— 空态卡去按钮 + FAB 长按跳闪电录入**（5d380e2，用户第三轮拍板）：空态卡移除「＋ 快速安排」按钮（右下角 FAB 已是常驻新建入口）仅留文案；FAB 长按由 stale Alert「闪电录入 即将上线」（阶段 5b 占位、slice-21 遗留披露）改为 `router.push('/flash')` 切闪电录入 tab，短按仍新建 /item/new。AGENTS §7.32 空态引导条款已加 v0.21 注记。

## 四、真机验收清单（MuMu，三轮累计全 ✓）

- flash 顶部不遮挡状态栏、底部让出手势条 ✓
- font_scale 1.3：频率 4 chips 一行完整、渠道行 flexWrap 换行、「系统通知」不再断行、时区两选项并排完整 ✓
- 冷启动空今日：11月页显示「今天 0」组头 + 空态卡（仅文案）✓
- 「今天」pill 从 2027年2月回位落今天组头顶 ✓；长按 FAB 800ms 跳闪电录入页 ✓
- 装真机（v0.21.0 APK）建议顺手核对：上述各项 + 跨天回 App 看「今天」是否跟上日期

## 五、教训（详见 closeout §4）

- **「挂载固化 now」的设计意图 vs 长存进程**：固化本意是活跃期不漂移，但 Tab 页永不重挂——修法取中：同民用日不重置，仅回前台/回页签滚动；独立路由页（today/week）每次进入重挂无需同款修补。
- **注释声称的降级路径必须在代码里存在**：注释与实现偏差直接构成用户可感知缺陷。
- **agenda 空态卡的挂点是「月页行数组」不是 ListEmptyComponent**。
- **原生 Windows bash 构建必须走 `cmd /c gradlew.bat`**（POSIX ./gradlew 无 cygpath 报 127；`cmd //c` 不转义造成 exit 0 假象、APK 未重建），核对 BUILD SUCCESSFUL + APK mtime。
