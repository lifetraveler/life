# docs/roadmap.md — 真机反馈路线图（v1，2026-11-14）

来源：用户以切片 20 release APK 在真实设备日常使用后的 6 项反馈（会话 m00996），附参考图 4 张（均在 tasks/ 下）。本文件是排期蓝图；每个切片开工时仍按 §7.1 先出任务卡与范围确认，逐切片从最新 main 开分支。

排期总览（v1 顺序，用户可调整）：

| 顺位 | 切片 | 主题 | 体量 | 前置 |
| --- | --- | --- | --- | --- |
| 1 | slice-21 | 真机显示修补（3 小项） | 小 | 无 |
| 2 | slice-22 | 闪电录入卡片化交互 | 中 | 交互口径确认 |
| 3 | slice-23 | 夜间模式（跟随系统） | 中大 | 无 |
| 4 | slice-24 | 数据备份：JSON 导出 + WebDAV | 大 | **变更提案先行** |
| 插队候选 | 变更B | 网络渠道后台送达（AlarmManager/Headless 提案重估） | 大 | 变更提案重估 |

排序理由：slice-21 全是小修复、能最快出一个改进版 APK 回真机；闪电录入是用户主入口，卡片化紧随其后；夜间模式覆盖面广但机械；备份涉及数据替换语义与新依赖决策，提案先行最稳妥。变更B 何时插队由用户按网络渠道使用重度决定（切片 20 closeout 遗留披露 1/2 是其硬输入）。

---

## slice-21 真机显示修补

对应反馈 2/6/1，均为 UI 层小修，不碰冻结区、无新依赖。

1. **闪电录入页顶部侵占状态栏**（反馈 2，图 tasks/闪电录入界面，侵占提示栏.jpg）
   - 现象：flash 页聊天气泡顶进系统状态栏区域（红框处图标与气泡重叠）。
   - 根因：src/app/(tabs)/flash.tsx 无顶部 safe-area 处理（grep 证实无 SafeArea/insets，仅一处 paddingTop:8）。
   - 修法：容器加 useSafeAreaInsets().top padding（对齐「计划」页的固定显示范围惯例）；注意键盘避让与底部输入区 insets.bottom 复核。
2. **提醒表单渠道 chips 高分辨率截断**（反馈 6，图 tasks/提醒添加界面，真机高分辨率显示问题.png）
   - 现象：「系统通知/Webhook/Apprise」chip 文字折行截断（系统通/知、Webh/ook、Appris/e）。
   - 根因：src/ui/ReminderFormEditor.tsx 渠道 chips 复用 segment 样式（flex:1 + 居中），与长标签「渠道（可多选）」同处 wrap 行，真机高密度/大字体下宽度被挤到不足以容纳整词。
   - 修法：渠道 chips 改 auto 宽度（去 flex:1）+ minWidth + 整词不折行（numberOfLines=1），行仍 flexWrap；顺带核查频率/时区行同模式风险。
3. **日程视图空态定位今天**（反馈 1）
   - 现象：当天无数据时日程（Agenda）视图定位与空态缺失。
   - 修法：无数据时仍定位到今天分组位置，渲染空态卡「今日没有安排」+「快速安排」CTA（deep link life://quick-add 落点，遵守 §7.18 约定与 ui.md 快速记录落点条款）。
   - 注意 §7.21 视图契约（按日期分组）不变，纯空态增补。

验收：tsc/jest 全过；MuMu 档逐项核对（chips 用 `adb shell settings put system font_scale 1.3` 模拟大字体）；出 release APK 交用户真机复测。

## slice-22 闪电录入卡片化交互

对应反馈 5，参考图 tasks/闪电录入对话里的卡片.jpg（会话流内日程卡片）与 tasks/闪电录入卡片点击预览编辑样式参考.jpg（点击后预览+快捷操作）。

- **成功反馈卡片化**：useFlashChat 确认保存后的 assistant 消息由文本「已添加xxx项目」改为卡片消息（新消息类型 {kind:'card', itemId, 快照}）；卡片含分类 chip+emoji、标题、日期行（X月X日周X | 时间段/全天）、提醒行（渠道/提前X分钟），样式对齐参考图 1。
- **卡片点击**：MVP 跳详情页 item/[id]（切片 6 路由，编辑/提醒管理能力齐全），避免重复实现编辑表单。参考图 2 的「页内全量预览+快捷 chips（推迟一小时/提前30分钟提醒）+编辑输入框」作为口径决策点：若用户要页内预览，则该切片扩为中大体量（自建预览面板 + 推迟落库走 Repository + 关闭返回刷新卡片），MVP 与全量二选一在立项时确认。
- **卡片快捷操作（MVP 至少含）**：推迟 15 分钟 / 1 小时两个 chip（仅含时间的项显示，onceAt/startAt 直接偏移落库 + 卡片行内刷新 + 结果一句话反馈）；「编辑」入口跳详情页。
- **会话内纠正保留**：现有「继续输入纠正字段→卡片更新」机制不变（§7.25 交互契约）。
- 不碰冻结区；无新依赖。立项先出交互口径（卡片点击去向 + chips 集合 + 是否要页内预览）供确认。

## slice-23 夜间模式（跟随系统）

对应反馈 3。

- 主题层：新增 src/ui/theme.ts 定义 light/dark 双 token 集（背景/卡片/边框/主文字/次文字/主色/危险色），useColorScheme() 驱动，StatusBar 样式跟随。
- 覆盖面：4 个 Tab（日程/待办/计划/我的）、详情/新建、闪电录入、设置页群（含后台运行保障）、提醒表单、导入导出页——把散落十六进制色收敛为 token（工作量主体）。
- 小组件暗色（stretch，可延后）：react-native-android-widget 渲染侧背景/文字随系统（Android 12+），若复杂则披露留后续。
- 不碰冻结区；无新依赖。验收：模拟器 `adb shell cmd uimode night yes/no` 逐页核对 + 测试全过 + 真机复测。

## slice-24 数据备份：JSON 导出 + WebDAV

对应反馈 4。**开工前必须先出变更提案**（数据替换语义、凭据存储、是否新增依赖——§7.3/§7.5）。

- **导出**：全量 JSON（items/categories/tags/reminders/channel_presets/app_settings + schema 版本 + 导出时间戳 + 应用版本），复用切片 8 expo-file-system + expo-sharing 基础设施（§7.18 先例），经分享/保存到任意位置。
- **导入**：文件选择（核对切片 8 ICS 导入已有 picker 依赖，无则提案说明）→ 结构校验（手写守卫，§7.24 纪律）→ **预览页**（§7.28 导入预览惯例：计数概览 + 确认）→ 替换语义（整库事务替换 vs 按 id upsert，提案定夺）；导入前自动做一次本地 JSON 快照兜底。
- **WebDAV**：推荐自写 fetch 客户端（PROPFIND/GET/PUT/MKCOL，WebDAV 即 HTTP 语义，零新依赖，符合 §7.3）；替代方案引入 webdav npm 包（须提案陈述理由）。凭据存 expo-secure-store（§7.24 纪律：严禁明文入库）。
- **UI**：设置页「备份与恢复」入口（服务器/账号/密码 + 立即备份 + 从云端恢复 + 远端文件列表）。
- 提案要素：影响范围（Repository 层批量写路径）、回滚方案（导入前快照）、失败中断语义（部分导入失败如何处置）。

## 变更B：网络渠道后台送达（插队候选，原 slice-21 候选）

- 前台服务救不了 RN JS 定时器（切片 20 机制发现）：提案重估为**原生 AlarmManager 驱动投递（原生侧 HTTP）或 Headless 唤醒**两路线对比。
- 提案硬输入：tasks/slice-20-closeout.md 遗留披露 1（冻结器/host-pause/白名单价值边界）与 2（重复投递 in-flight 修复，随本变更一并处理，src/notifications/ 冻结区需授权）。
- 启动时机由用户定（网络渠道重度使用时插队）。

---

## 验收惯例（切片 20 起沿用）

- 每切片：tsc + jest 全量 + expo-doctor（2 项预存基线）+ MuMu 自动化档验收 + release APK 交用户真机档复测。
- push 代理（2026-11-14 实测）：LAN 7893 已失效，用 `git -c http.proxy=http://127.0.0.1:9090 -c http.version=HTTP/1.1 push`。
- JAVA_HOME：gradle 构建显式 `D:\enviroment\java\jdk\oracle-jdk-17.0.10`。
