# 切片 23：闪电录入意图澄清与渠道智能推荐

## 目标
1. AI 识别强提醒场景（起床/吃药等），自动推荐 `alarm` 渠道并落库。
2. 远端 Prompt 与本地正则支持“修改成X点”的上下文编辑逻辑。
3. 引入澄清机制：当信息不全时，Chat UI 展示反问，用户可直接回复补充。

## 强制实施阶段

### 阶段 1：AI 契约、Prompt 与本地解析升级
- 更新 `src/domain/ai/types.ts`，增加澄清字段。
- **Prompt 升级**：在 `src/domain/ai/prompt.ts` 增加指令：“如果用户说‘叫我起床’，默认设置 alarm 渠道；如果缺失关键信息，请输出 needsClarification 与反问。”
- **本地正则升级**：在 `localFallback.ts` 中，新增正则匹配“叫我、起床、响铃”，命中后默认生成 `alarm` 渠道的提醒；补充“修改成/改为”的日期时间解析。
- 补充单测。

### 阶段 2：远端上下文编辑逻辑（2026-11-15 完成，commit 见反馈文件）
- 检查 `src/domain/ai/openAiCompatible.ts` 和 `chat.ts`。✅ chat.ts 零改动（history 保持切片 15 草稿 JSON 格式）。
- 确保发给 LLM 的 `history` 中，正确包含了上一张卡片的摘要（Item 标题与时间）。✅ buildHistoryBriefing（prompt.ts）从 history 末尾取最近一条 assistant 草稿 JSON，渲染「上一张卡片草稿摘要」块（民用时间经 getZonedParts 本地换算，禁止毫秒反算），parse() 拼入 system 消息。
- Prompt 中补充指令：“若用户输入包含‘改成’，请参考 history 中的卡片内容，更新对应字段而不是新建。” ✅ 多轮节指令升级为摘要块基准（日期沿用/其余字段照抄/不要新建 + 毫秒禁令）；useFlashChat.appendEditHistory 契约回正（assistant=编辑后草稿 JSON，note 只留消息流）。

### 阶段 3：UI 澄清状态与渠道展示适配（2026-11-15 完成，commit 见反馈文件）
- **澄清交互**：在 `src/ui/useFlashChat.ts` 与 `flash.tsx` 中，如果返回 `needsClarification`，不展示预览卡片，而是展示一条 AI 消息（例如：“你要定明天8点的闹钟吗？”），并提示用户继续输入。✅ send() 澄清分支：setDraft(null) 不出卡、clarificationPrompt 兜底文案、degraded 补降级说明；澄清待补轮不被「改成X点」窄规则劫持；flash.tsx 零改动（普通文本气泡已可渲染，经 hook 测试验证）。
- **渠道展示**：修改 `FlashPreviewCard.tsx` 和 `FlashResultCard.tsx`，如果包含 `alarm` 渠道，显示一个“⏰ 闹钟”的标识；如果是普通通知，显示“🔔 通知”。✅ FlashCardReminderSnapshot 加 channels 字段（cardPayload 防御拷贝）；describeDraftChannelLine / describeCardReminderLine 纯函数（alarm→⏰、system-notification→🔔、网络渠道按标签列出）。
- 真机验收。（✅ MuMu 0.23.0/v4 实测通过 2026-11-15：验收 2/3/4 全过且为远端路径实测（设备已配置 Key），响铃留观察——见 tasks/slice-23-phase2-3-feedback.md §5a）

## 验收标准
1. tsc 零错误；jest 全过（单测覆盖本地正则对“叫我起床”的 alarm 判断、Prompt 包含上下文）。
2. 真机：输入“明天上午8点叫我”，保存后卡片上显示“⏰ 闹钟”，详情页提醒渠道为“闹钟”。
3. 真机：输入“提醒我吃药”，AI 回复反问：“你要在什么时间提醒你吃药？”，用户回复“下午2点”后，能成功生成卡片。
4. 真机（有 API Key）：先建一个“明天开会”，再输入“改成7点半”，AI 能成功修改上一条，而不是新建。

## 分支与提交
- 从最新 main 新建 `task/slice-23`，分阶段提交。