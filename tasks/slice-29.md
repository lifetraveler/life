# 切片 29：闪电录入对话能力强化包（候选 29a 立项）

- 状态：立项（2026-11-17，用户选定路线 29a；29b 顺延编号）
- 基点：main @ `0085863`（切片 27 合并 + backlog 立项登记后）
- 分支：`task/slice-29`（从 main @ `0085863` 切出；卡与 AGENTS.md v0.32 随阶段 1 提交）
- 来源：tasks/backlog.md §2 候选 29a（2026-11-17 真机反馈驱动）；规模中偏小
- schema：**停留 v14，无迁移**

## 0. 目标与背景

闪电录入三个真机反馈痛点（切片 26 阶段 3 用户实测）：

1. **口语纠正短句被误判为新建**：history 有上一张卡时，「还是30分钟后吧」这类无动词短语的修正句被远端模型当新事项（实测波动：上轮编辑成功、下轮同型短句新建）。修法＝AI_SYSTEM_PROMPT 多轮节追加判定条款。
2. **「推迟 X 分钟」语义未成文**：远端实测已按「推迟＝基于卡片当前时间；X分钟后＝说话时刻」工作，但 prompt 无此条款，行为可漂移。修法＝prompt 成文钉死。
3. **聊天历史结果卡与新卡视觉混淆**：多轮后旧结果卡与最新卡外观一致，误读成「新添加了一张」。修法＝历史卡降透明度 +「历史」角标。

## 1. 设计决策

- **D1（①纯 prompt，本地兜底否决）**：①只改 `AI_SYSTEM_PROMPT`，**不做本地兜底改写**。评估结论（记录在案）：本地降级对「还是30分钟后吧」无任何可执行变更——无「改成」动词不进窄规则（editIntent.ts），「30分钟后」无提醒尾缀不产 delay 槽（localFallback.ts REMINDER_DELAY_RE），即使强制判成编辑意图也无字段可改，会落入「编辑意图但零变更」死路；窄规则扩展需新增「相对 ±Δ 分钟」解析路径（resolveEditStartAt 不支持），实现量与误伤风险均不划算。远端 prompt 是主路径。
- **D2（①条款两轴）**：多轮节（prompt.ts `:82-88` 区域）追加——(a) **短纠正句判定**：history/摘要块存在时，输入**不含新事由名词**（无新的标题性名词短语/新动作主体），仅时间或属性修正表达（含「还是/就/吧/算了」等语气结构与分钟/时刻修正）→ 默认视为对上一张卡的编辑，以摘要为基准修正被提及字段，其余字段照抄摘要，禁止新建；(b) **反向边界修订**（现 `:87` 全新意图条款）：补「短纠正句不算全新意图」；同时保留误伤护栏——「明天开会」这类**含新事由名词**的短句仍是全新意图，照常新建。
- **D3（②推迟语义条款）**：多轮节追加——「推迟/延后 X 分钟」＝以上一张卡（摘要块）当前时间为基准平移 ±X 分钟；「X 分钟后」＝以当前说话时刻为基准（reminderDelayMinutes 语义不变）；两种表达可同现，互不覆盖。
- **D4（③判定规则冻结）**：聊天列表中**最后一条 kind:'card' 消息＝当前卡**，其余 card 消息一律历史样式。实现：`FlashResultCard` 新增 `historical?: boolean`（默认 false）——historical 时整体透明度下降（约 0.55，经 styles）+ 右上角「历史」小角标（textMuted Token 化）；flash.tsx 以 useMemo 从 messages 计算最后一张 card 的 id，renderMessage 内比对 `item.id` 传 prop。历史卡的快捷推迟 chips **保留可用**（历史卡也是已保存条目，postponeCard 按 itemId 操作语义仍正确）。
- **D5（契约零改动）**：ai.md 正文与变更记录均不动——prompt 文本不是契约面（AiParser.parse 签名、RemoteDraftWire、ChatMessage 结构零变化），多轮节仍是「强提醒/澄清/多轮续答」节构成（ai.md `:184` 描述仍准确）；schema v14 不动；无新依赖；切片 26 的 ai-prompt 只读展示页自动反映新文本，无需改动。

## 2. 阶段

### 阶段 1：prompt 语义成文（①＋②）

- `src/domain/ai/prompt.ts` 多轮节：D2 两轴条款 + D3 推迟语义条款 + `:87` 反向边界修订。
- `src/domain/ai/__tests__/prompt.test.ts`：新增关键句断言（沿用「断言关键句存在、不做全文比对」惯例）。
- 代码仅 prompt.ts + 其单测；本地兜底否决结论以本卡 §1 D1 为准，代码零改动。
- AGENTS.md v0.32（新增 §7.40，§8 刷新）与本卡随阶段 1 提交。

### 阶段 2：历史卡视觉区分（③）＋验收

- `src/ui/FlashResultCard.tsx`：`historical?: boolean` prop + 角标/透明度样式（Token 化，深浅色两态可读）。
- `src/app/(tabs)/flash.tsx`：lastCardId useMemo + renderMessage 接线（card 分支传 prop；confirm 分支不参与）。
- 单测：FlashResultCard historical 分支渲染断言（无既有组件套件则新建最小套件）。
- 真机验收矩阵（§3）+ closeout（`tasks/slice-29-closeout.md`）+ backlog 划项 + AGENTS §8 完成态，按 §7.9 序列提交合并。

### 阶段 3：保存后摘要块接线修补（用户批准的范围修订，2026-11-17）

- 真机验收发现：`useFlashChat.ts:741` `handleConfirmSave` 保存后 `historyRef.current = []`
  清空上下文 → 下一轮无「上一张卡片草稿摘要」块，多轮节短纠正句/推迟语义条款
  结构性失活（验收 1/5 post-save 必失败；mid-flow 路径实测通过——条款与 D3 语义
  在有摘要块时完全生效）。本卡 §0.1 前提「history 有上一张卡」在保存后不成立。
- 修法（用户选 A 最小接线修补）：保存时不再清空 history，播种
  `[{ role: 'assistant', text: JSON.stringify(保存时草稿 JSON) }]`（切片 15
  historyAppend 同格式）；下一轮 buildHistoryBriefing 有摘要块 → 条款 post-save
  生效；仍不携带更早对话，「每存一张=新对话」设计不变。
- 同批 prompt D3 加固（真机缺陷：degenerate 草稿上模型曾把「推迟30分钟」写入
  content，被认真模式拦截兜住）：推迟/延后类修正只调整时间字段，禁止把
  「推迟 X 分钟」这类原文写入 title/content。
- 改动面：`src/ui/useFlashChat.ts`（:741 一处）+ `src/domain/ai/prompt.ts`（:92
  同行追加）+ `src/domain/ai/__tests__/prompt.test.ts`（加固断言 1 例）；其余
  冻结面不动。

## 3. 真机验收矩阵

1. 有摘要块＋「还是30分钟后吧」（上一张卡 14:00）→ 卡改 14:30，**不新建**。
2. 有摘要块＋「不行，改到明天上午9点」→ 窄规则路径回归正常。
3. 全新意图短句「明天开会」（含新事由名词）→ 仍新建（反向边界不被误伤）。
4. 首轮（无摘要块）输入「还是30分钟后吧」→ 无卡基准，按普通新建/澄清处理，不崩。
5. 有上一张卡＋「推迟30分钟」→ 卡时间＝卡原时间＋30。
6. 「30分钟后提醒我吃药」→ 延迟提醒路径不变（reminderDelayMinutes）。
7. 多轮出 3+ 张结果卡 → 旧卡降透明度＋「历史」角标，最后一张正常无角标。
8. 保存后立即查看列表 → 最新结果卡无历史样式。
9. 深浅色两态：角标与降透明度均可读。
10. 无 Key 降级轮回归：「改成7点半」窄规则照常；「还是30分钟后吧」按既有边界走原解析（不新建错误卡即可接受，记录实际行为）。
11. ai-prompt 只读页展示文本包含新条款。

## 4. 验证命令

- `npx tsc --noEmit`
- `npx jest --runInBand`（基线 **86 套件 / 1199 用例**，只增不减）
- `npx expo-doctor`（2 项预存基线失败，无新增）
- MuMu（127.0.0.1:7555，Metro + `adb reverse tcp:8081`）执行 §3 矩阵；勿在项目目录写临时文件（切片 27 教训）

## 5. 明确不做

- 不做本地兜底改写、不扩展 editIntent.ts 窄规则（「推迟/还是…」均不入窄规则，D1）。
- 不做 29b（AI 日程查询）；不动 AiParser.parse 冻结签名 / RemoteDraftWire / ChatMessage。
- 不碰冻结区（src/notifications/、src/domain/recurrence/）；不引依赖；无 schema 迁移（停留 v14）。
- 不改 FlashConfirmCard 与认真模式交互（§7.37）；不做「当前卡」额外标识；ai.md 契约零改动（D5）。

## 6. 风险

- 短纠正句条款与反向边界的措辞边界（防「明天开会」误伤）——D2 用「不含新事由名词」锚定，验收 3 专项覆盖。
- 角标遮挡时间行/分类行——右上角布局放最外层，MuMu 目检。
- FlatList 行复用导致 historical prop 渲染串位——消息 key 已稳定（切片 25 修补先例），验收 7 覆盖。
- prompt 膨胀——追加约 4 行，幅度可接受（AI_SYSTEM_PROMPT 现 ~66 行）。
