# 切片 34 提案：已保存条目对话式编辑（闪电录入 targetItemId 回填 + update 落库链）

- 日期：2026-11-21
- 状态：已确认（用户 2026-11-21 三问定案，见 §2）
- 关联：tasks/slice-34.md（任务卡）、tasks/backlog.md §2（切片 25 候选①②合并立项）、tasks/feedback-log.md F2
- 上游依赖：切片 25（认真模式 confirm）、切片 29（历史卡视觉区分/保存播种）、切片 32（wire reminders 多计划）、切片 33（serializeDraftForHistory/四写入点归一/三形状兼容）

## 1. 背景与定性

- **F2 真机实证**（2026-11-18，feedback-log）：用户在闪电录入保存条目后继续对话修改内容，确认保存后出现**两条相同条目**——第一条为首次创建，第二条为"修改后"产物。用户期望：要么修改第一条、要么作废第一条，历史卡与新卡应对应同一条记录。
- **链路缺口**（切片 33 后状态）：保存链落库后播种 `serializeDraftForHistory(current, tzid)`（useFlashChat.ts:935），但该 JSON 只有草稿形状、**不含条目 id**；`handleConfirmSave` 落库链**只有 `createItem` 分支**（useFlashChat.ts:896）。模型按摘要块编辑语义正确出卡，但确认保存无从知道这是"更新已存在条目"。
- **能力现状**：已保存条目的对话式修改仅覆盖时间（窄规则 applyEditToDraft + 快捷顺延 postponeCard）；content/category/tags 的修改只能走详情页表单。
- **本片目标**：把"最后保存的条目"挂回对话上下文（带 id），模型编辑轮显式回填目标条目 id，确认保存走 update 落库链；编辑字段范围含提醒增删。

## 2. 用户定案（2026-11-21 三问）

| 问题 | 定案 |
| --- | --- |
| Q1 编辑判定机制 | **wire 加键、模型显式回填**（非 hook 层谓词判定）——RemoteDraftWire 加可选键，播种 JSON 带条目 id，模型编辑基线条目时回填；彻底消除 F2 误判；ai.md 契约演进成文 |
| Q2 编辑字段范围 | **含提醒增删**——全字段对话式编辑 + once 提醒集合全量替换（差异重建） |
| Q3 历史卡范围 | **仅当前基线可编辑**——只有最后保存/最后编辑的条目可继续对话编辑；更早历史卡保持切片 29 视觉区分，点击跳详情页 |

## 3. 不做清单（本片边界）

- 不做多基线/历史卡引用编辑（「把第一张卡的标题改成X」不支持——摘要块只渲染一张卡，buildHistoryBriefing 结构性限制）。
- 不做重复提醒（daily/weekly/monthly）的对话式增删改——重复计划维持"只读基线"，管理走详情页。
- 不做 offset/delay 渠道语义的对话式新增管理（其落库产物 once 提醒作为基线 once 集合的一部分被全量替换语义覆盖，见 D4-c）。
- 不支持「删除全部 once 提醒」的表达（wire reminders 空数组仍拒绝，v0.23 纪律不动）——全删场景披露提示走详情页，记为已知限制。
- 不改 `AiParser.parse` 冻结签名与返回类型；`RemoteDraftWire` 12 必填键清单与既有键纪律零改动（仅追加可选键）。
- 不做「作废第一条」式删除联动（条目删除仍走详情页，切片 30 已删除卡联动覆盖卡片态）。
- ChatMessage kind 不新增；schema 停留 v16 零迁移；无新依赖；冻结区（src/notifications/、src/domain/recurrence/、src/domain/export.ts）零改动；本地降级链路（localFallback/fallbackTurn）零改动（降级轮无 targetItemId，确认保存走 create——与「本地不做编辑意图兜底」既定边界一致）。
- src/domain/export.ts / 数据导出链路零改动。

## 4. 设计决策

### D1 wire 可选键 targetItemId（ai.md v0.24 → v0.25）

- `RemoteDraftWire` 追加可选键 `targetItemId?: string | null`：
  - **键可缺省宽容**（reminders v0.23 同构先例）：缺省/null = 旧版模型响应或全新意图，不拒绝；
  - **值出现即从严**：非 string 或空字符串 → isRemoteDraftWire 整体拒绝（schema-mismatch 降级）；
  - **不校验存在性**（wire 层不做 DB 查询）——条目存在性由落库层校验（D4-a）。
- `ParsedItemDraft` 追加可选字段 `targetItemId?: string`（guard 键可缺省、值从严有限非空字符串；undefined = 未表达）；`wireToParsedItemDraft` 归一 null/undefined → undefined。
- ai.md 变更记录追加 v0.25 条目（非破坏性：可选键 + 草稿可选字段；12 必填键清单、既有键纪律、民用时间纪律零改动）。

### D2 播种 JSON 带条目 id + 摘要块回显

- `serializeDraftForHistory` 输出追加 `itemId` 键：调用方传入（保存链播种传 `created.id`；本地编辑回写传基线 id；useFlashChat 两处调用点 + chat.ts 两处 historyAppend——chat.ts 场景草稿无 id，输出 itemId 缺省）。
- `renderBriefing` 摘要块追加「关联条目 id」行（仅解析出 itemId 时渲染）；`tryParseBriefingDraft` 判据字段不变，itemId 作为附加键透传（BriefingDraftShape 扩可选 itemId）。
- 契约面：history assistant JSON 形状演进追加 itemId 键，并入 ai.md v0.25 变更记录条目（与 D1 同条）。

### D3 prompt 成文（AI_SYSTEM_PROMPT）

- 字段定义追加 `targetItemId` 行：「上一张卡片摘要块带『关联条目 id』时，若本轮是对该已保存条目的修改（而非新事项），回填该 id；全新事项一律填 null（禁止编造或复用其他 id）」。
- 多轮节追加编辑已保存条目语义注记：编辑基线时以摘要块为基准修改被提及字段、其余照抄、reminders 输出编辑后的完整绝对时刻集合（见 D4-c）。

### D4 update 落库链（useFlashChat handleConfirmSave 分支）

- a) **存在性校验**：`plan.targetItemId` 非空时先 `getItemById` 校验条目存在且非 sourceReadOnly（外部导入项不可经闪电编辑——护栏沿用 updateItem 既有 sourceReadOnly 抛错，转换为披露消息）；不存在/只读 → 降级走 create 并披露「目标条目不存在/不可编辑，已按新建处理」。
- b) **条目字段更新**：`updateItem(id, { title, content, type, categoryId, priority })`（UpdateItemInput 全量 patch）；时间字段经 `updateItemTime`（复用切片 6 校验）。
- c) **once 提醒集合全量替换**：
  - `listRemindersByItem(id)` 取现有提醒，按 `frequency === 'once'` 分组为基线集合（触发时刻 = onceAt epoch）；重复提醒与非 once 频率**不参与差异**（只读基线）；
  - 本轮 `plan.reminderPlans` 中的 once 计划 epoch 集合 = 目标集合；
  - 差异：目标有基线无 → `createReminder`；基线有目标无 → `deleteReminder`（通知清理依赖既有 reconcile 幂等重排）；同 epoch 保留不动（渠道/配置不漂移）；
  - reminders 缺省（未表达）= **不动 once 集合**；显式数组 = 全量替换；
  - offset/delay 产物（once 频率）在基线集合中按 epoch 参与对比——模型从摘要块「提醒时刻」行照抄保留，即不被误删。
- d) **tags 差异**：`getItemById` 水合现有 tags（名称归一）vs `plan.tagNames`：新增 `addTagToItem`、移除 `removeTagFromItem`（§4.5 冻结签名，逐个调用）。
- e) **收尾链**：reconcile 显式一次（失败不阻断）；结果卡措辞「已更新《title》」（vs 新建「已添加」）；pushCard 同构；播种更新后草稿（itemId 保持原值，基线连续）。
- f) **`FlashSavePlan` 扩 `targetItemId?: string`**（buildFlashSavePlan 从 draft 透传；域内类型，非冻结面）。

### D5 认真模式复用（§7.37 零改动）

- update 路径 title/content 变化同样经过认真模式 confirm 守卫（守卫在 hook 层 runFlashTurn 返回后，与落库路径解耦，天然覆盖）；确认卡「应用修改」后执行的是 update 而非 create，交互机制零改动。

### D6 历史卡边界（Q3 定案）

- 仅当前基线可编辑：基线 = 播种 JSON 携带的条目（最后保存/最后编辑）。
- 更早历史卡保持切片 29 视觉区分（降透明度 + 「历史」角标），点击跳详情页；不支持对话引用编辑。
- 编辑保存后播种 JSON 被"更新后草稿"覆盖 → 基线跟随最新状态，与「每存一张=新对话」的既有设计一致。

## 5. 文件落点与单测

| 文件 | 改动 |
| --- | --- |
| src/domain/ai/openAiCompatible.ts | RemoteDraftWire + targetItemId 可选键；isRemoteDraftWire 值从严校验；wireToParsedItemDraft 透传归一 |
| src/domain/ai/types.ts | ParsedItemDraft + targetItemId 可选字段（guard 纪律同 reminders） |
| src/domain/ai/merge.ts | DraftField 是否纳入 targetItemId——**不纳入掩码**（id 是落库路由信号非内容字段，不做编辑掩码合并；直接透传） |
| src/domain/ai/savePlan.ts | FlashSavePlan + targetItemId 透传 |
| src/domain/ai/prompt.ts | serializeDraftForHistory 输出 itemId 键；BriefingDraftShape + itemId；renderBriefing 关联条目 id 行；AI_SYSTEM_PROMPT 字段定义 + 多轮节 |
| src/domain/ai/chat.ts | FlashTurnResult 链路透传（draft.targetItemId 自然携带，无结构改动；核对两处 historyAppend 序列化调用参数） |
| src/ui/useFlashChat.ts | handleConfirmSave update 分支（存在性校验/字段更新/tags 差异/once 集合差异/措辞/播种）；降级披露 |
| docs/contracts/ai.md | v0.25 变更记录（wire 可选键 + 草稿字段 + history itemId 键） |
| 单测 | wire 守卫矩阵（缺省/null/合法/非串/空串）；draft guard；serializeDraftForHistory itemId；renderBriefing 行；once 集合差异纯函数（新增保留/删除/同 epoch 不动/offset 产物保留）；tags diff |

## 6. 风险

- 模型漏填 targetItemId（编辑轮忘回填）→ 退化为新建（F2 残余概率）——prompt 强约束 + 摘要块 id 行显眼 + 真机矩阵覆盖；残余风险接受（远端模型行为波动既有边界）。
- once 集合差异误删 offset/delay 产物 → 基线集合按 epoch 对比 + 摘要块提醒时刻行照抄（D4-c）；真机矩阵专项验证。
- updateItem patch 全量覆盖把未表达字段写空 → 落库前以本轮卡为准（卡=编辑后完整快照，模型输出完整 JSON），与切片 25 确认卡摘要同源；无「部分更新」歧义。
- 全删提醒场景不支持（wire 空数组拒绝）→ 披露文案引导详情页，已知限制记 backlog。

## 7. 验收口径

- `npx tsc --noEmit` 0 错；`npx jest --runInBand` 基线 98 套件/1426 用例只增不减；`npx expo-doctor` 2 项预存基线无新增。
- 真机矩阵（deepseek-flash 主路径）：①保存→对话改 content→确认→**无重复条目**（F2 回归，详情页验证 content 已改）；②保存带 2 条提醒→对话去掉 1 条→确认→条目提醒剩 1 条且通知队列一致；③保存→对话加 1 条提醒→确认→新增成功；④编辑轮认真模式确认卡（改 title）→应用→条目更新；⑤窄规则时间修改回归（本地路径不受影响）；⑥全新意图回归（targetItemId 缺省→create 正常）；⑦无 Key 降级轮回归（create 语义不变）；⑧历史卡点击跳详情页回归。
