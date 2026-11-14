# 切片 21：真机显示修补与防重发

## 目标
1. 修复闪电录入页顶部安全区遮挡。
2. 修复提醒表单渠道 chips 在高分屏下的截断。
3. 日程视图空态卡增加“快速安排”CTA。
4. 修复网络渠道回前台并发双发缺陷（in-flight 防重）。

## 强制实施阶段

### 阶段 1：UI 显示修补
- **闪电录入页安全区（src/app/(tabs)/flash.tsx）**：使用 `react-native-safe-area-context` 的 `useSafeAreaInsets()` 给顶部加 padding，解决被状态栏侵占的问题。
- **渠道 chips 截断（src/ui/ReminderFormEditor.tsx）**：检查渠道选择的 chips 容器，移除导致硬性挤占的 `flex: 1`，改用 `auto` 宽或 `minWidth` 配合 `flexWrap`，确保大字体或高分辨率下不折行、不截断。顺带检查频率/时区行。
- **日程空态卡（src/app/(tabs)/plan.tsx）**：在“今天”分组无数据时，展示空态卡（包含“今日没有安排”文案），并在卡内提供“快速安排”按钮，点击触发 `router.push('/item/new')`（或现有 FAB 相同的路由）。

### 阶段 2：网络渠道防重发（冻结区授权修补）
- 修改 `src/notifications/channels/BaseNetworkChannel.ts` 和 `src/notifications/ReminderScheduler.ts`。
- **根因**：上一轮 closeout 已定位，迟到 timer 与启动 reconcile 并发时，`recordAttempt` 在 `deliver` 之后调用，产生了竞态窗口。
- **修复**：在 `deliver` 发起前，先在内存里设置 `in-flight` 标记（如 `Map<string, boolean>`，key 为 occurrenceKey 或 networkTimerKey），`reconcile` 判重时连同 `in-flight` 一起排除。成功后清理标记。

### 阶段 3：真机验证与收尾
- `tsc` 和 `jest` 全过。
- 真机/MuMu 模拟器（或 `font_scale 1.3` 模拟大字体）验证修复效果。
- 提交代码。

## 验收标准
1. tsc 零错误；jest 全过（单测需覆盖网络渠道防重的并发场景）。
2. 真机检查：闪电录入页顶部不再被状态栏遮挡。
3. 真机检查：设置大字体后，提醒表单的渠道选项正常换行或自适应，不出现“系统通/知”这种折行。
4. 真机检查：日程页今天为空时，显示空态卡和按钮。
5. 代码检查：网络渠道防重逻辑有明确的 in-flight 标记及对应单测，无 `as any`。

## 分支与提交
- 从最新 main 新建 `task/slice-21`，分阶段提交（阶段 2 触碰 `src/notifications/` 需单独 commit）。