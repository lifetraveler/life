# 切片 22：闪电录入卡片化与快捷操作

## 相关契约
- `AGENTS.md` §7.25（闪电添加 UI 交互）、§7.33 阶段反馈总结文件惯例 、§7.34（闪电录入结果卡片化与快捷操作）
- 截图参考：`tasks/闪电录入对话里的卡片.jpg`、`tasks/闪电录入卡片点击预览编辑样式参考.jpg`

## 目标
1. 扩展 Chat 消息类型，支持 `kind: 'card'` 载荷。
2. 实现漂亮的预览卡片组件（展示分类色条、标题、日期、提醒）。
3. 打通卡片点击跳转详情页的逻辑。
4. 实现“+15分钟 / +1小时”的快捷推迟操作，并原地刷新卡片。

## 强制实施阶段

### 阶段 1：类型定义与状态机扩展
- 修改 `src/domain/ai/types.ts` 或相关 UI 类型文件，给 `ChatMessage` 增加可选的 `cardPayload` 字段（包含 ItemWithRelations 的摘要信息和 Reminder 的摘要信息）。
- 调整 `src/ui/useFlashChat.ts` 的保存成功逻辑：保存成功后，追加一条 `kind: 'card'` 的 AI 消息，而不是纯文本提示。

### 阶段 2：卡片组件实现（src/ui/FlashResultCard.tsx）
- 实现卡片 UI：
  - 顶部/左侧：分类 Chip（展示颜色、Emoji）。
  - 中间：任务标题（大字号、加粗）。
  - 底部：图标 + 时间（如 `📅 今天 14:00 - 15:00`），图标 + 提醒（如 `🔔 提前 10 分钟`，如果有）。
- 卡片支持 `onPress` 跳转 `router.push('/item/' + id)`。
- **快捷操作**：如果是带 `startAt` 的事件/任务，展示两个小 Chip：「+15分钟」「+1小时」。

### 阶段 3：快捷推迟逻辑与提醒联动
- 在 `FlashResultCard` 内部处理 Chip 点击事件：
  - 计算新的 `startAt`（当前 startAt + 15/60 分钟）。
  - 调用 Repository 更新 `startAt` 和 `updatedAt`。
  - **联动处理（关键）**：如果该 Item 有关联的 `once` 类型提醒，必须查出该提醒，并使用 `getZonedParts` 和 `resolveOnceAt` 将 `onceAt` 的绝对时间也加上相同的偏移量并落库（如果该提醒是重复提醒则跳过）。
  - 更新成功后，通过回调让父组件（或全局状态）更新该条消息的 `cardPayload`，实现原地重渲染。

### 阶段 4：Chat UI 接入与真机验证
- 在 `src/app/(tabs)/flash.tsx` 中渲染 `kind === 'card'` 的消息。
- 验证：成功解析保存后出卡片 -> 点卡片跳详情 -> 回到聊天点快捷推迟 -> 卡片时间更新 -> 跳详情看时间已变，且提醒时间顺延。

## 允许修改/新增的范围
- `src/domain/ai/types.ts`（扩展 ChatMessage）
- `src/ui/useFlashChat.ts`（保存成功回调逻辑）
- `src/ui/FlashResultCard.tsx`（新建）
- `src/app/(tabs)/flash.tsx`（渲染卡片）
- `src/data/ItemRepository.ts` 及实现（如需要，增加联动更新的方法）
- 相关单测

## 禁止修改/实现
- **绝对禁止触碰 `src/notifications/` 冻结区的任何实现文件**（渠道分发、调度器等）。
- 不修改 `src/domain/recurrence/` 的重复规则计算逻辑。
- 无需引入任何第三方 UI 库或图标库。
- 不做多渠道推送的额外适配。

## 验收标准
1. `tsc` 零错误；`jest` 全过。
2. 单测覆盖：
   - `cardPayload` 的数据组装逻辑。
   - 快捷推迟时间计算。
   - 如果存在 `once` 提醒，`onceAt` 能够正确顺延。
3. 真机：输入“明早9点开周会，提前10分钟提醒我”，成功保存后，出现富文本卡片（包含分类、标题、时间、提醒）。
4. 真机：点击卡片上的“+15分钟”Chip，卡片时间原地变为 09:15，提醒变为 09:05。
5. 真机：点击更新后的卡片进入详情页，确认 `startAt` 和 `onceAt` 均已被正确修改。
6. 代码检查：无 `as any`；`src/notifications/` 零 diff。

## 分支与提交
- 从最新 main 新建 `task/slice-22`。
- 分阶段提交。