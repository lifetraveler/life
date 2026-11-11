
# 切片 15：闪电添加（AI 解析 + Chat UI）

## 相关契约
- `docs/contracts/ai.md`（v0.15）
- `AGENTS.md` §7.24–7.25
- 截图参考：`tasks/` 目录下的 `toki_1.webp`（看 Chat UI 布局）

## 目标
1. 实现闪电添加的 Chat 风格 UI（挂载在 `flash` Tab 下）。
2. 实现 AI 解析层（OpenAI 兼容 Provider + 本地正则降级）。
3. 安全存储 API Key（使用 `expo-secure-store`）。
4. 支持多轮对话修改解析卡片。
5. 最终将解析结果映射为 `Repository.createItem` / `createReminder` 落库。

## 强制实施阶段（禁止一次性写完）

### 阶段 1：数据契约与 AI Provider 层
- 引入 `expo-secure-store`。
- 实现 `LocalFallbackProvider`（正则提取“明天/下午X点”等基础逻辑）。
- 实现 `OpenAICompatibleProvider`（fetch 调用、Zod/手写校验返回结果）。
- 实现 `ParsedItemDraft` 到 `CreateItemInput` 的 Mapper。
- **严禁碰任何 UI 代码**。补充纯函数单测。

### 阶段 2：设置页配置接口
- 在设置页（`profile` Tab 下）新增“AI 配置”入口。
- 实现 API Key、BaseURL、Model 的安全存取。
- 实现“测试连接”按钮。

### 阶段 3：Chat UI 与状态机
- 改造 `src/app/(tabs)/flash.tsx`。
- 实现消息列表（用户气泡靠右，AI 卡片靠左）。
- 实现底部的多行输入框与发送按钮。
- 实现预览卡片（展示提取的字段，点击可弹窗修改）。
- 实现“确认添加”按钮，调用 Mapper 落库。

### 阶段 4：联调与收尾
- 真机测试无 Key 降级逻辑。
- 真机测试多轮对话纠错逻辑。
- tsc 零错误，jest 全过。

## 阶段验收标准

### 阶段 1 验收
1. `tsc` 和 `jest` 全过。
2. 单测验证正则降级能正确解析“明天下午3点开会”，且 JSON 校验能拦截残缺的 AI 返回格式。

### 阶段 2 验收
3. 输入 Key 保存后，重启 App 依然保留（安全存储生效）。
4. 点击“测试连接”能返回成功/失败结果。

### 阶段 3 & 4 验收
5. 无 Key 时进入闪电 Tab，输入文字并发送，返回降级提示和粗糙的解析卡片。
6. 配置 Key 后，输入“明早9点开周会，重要工作，提前10分钟提醒”，返回完美的预览卡片（包含分类、标签、时间、提醒）。
7. 在输入框补充“改成后天”，卡片的时间自动更新为后天。
8. 点击卡片，可手动调整字段（分类、时间）。
9. 点击“确认添加”，检查数据库成功落库，且回到原 Tab 时列表已刷新。
10. 代码检查：全工程无 `any` 强转 AI 结果；无明文存储 Key。

## 分支与提交
- 从最新 main 新建 task/slice-15。
- 由于引入了 expo-secure-store，必须重新构建 dev client。
- push 遇 reset 加 HTTP/1.1。

## 完成记录（2026-11-11，详见 tasks/slice-15-closeout.md）
- 阶段 1–4 全部完成；验收 1–10 全过（真机=MuMu 模拟器 emulator-5554，Android 15）。
- 计划外变更（用户当场确认）：契约 ai.md v0.15.1（ParsedItemDraft 补 tags/priority）
  与 v0.16（远端模型响应改民用时间 wire，epoch 一律本地换算——LLM 直接算毫秒时间戳
  已实证不可靠：整年错/时区反算/照抄 history）。AiParser 对外签名不变。
- 阶段 4 缺陷修复 2 处：useFlashChat 每次发送前重载配置（设置页保存即时生效）；
  详情页 local 条目补「删除记录」入口（复用切片 8 删除链路）。
- 已知限制：一次性提醒（reminderOffsetMinutes 且无 recurrence）不落库，卡片保留
  意图 + 确认后提示；真正落库与提醒渠道扩展（闹钟/系统通知/webhook/apprise）
  立项为切片 16（tasks/slice-16.md），须先过变更提案。