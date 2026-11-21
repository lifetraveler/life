# 切片 34：已保存条目对话式编辑（闪电录入 targetItemId 回填 + update 落库链）

- 基点：main @ `862a227`
- 分支：`task/slice-34`（从 main @ `862a227` 切出）
- 提案：docs/proposals/slice-34-saved-item-conversational-edit.md（用户 2026-11-21 三问定案：wire 加键显式回填 / 含提醒增删 / 仅当前基线可编辑）
- 提交纪律：提案 + 本卡 + AGENTS.md v0.38 随阶段 1 提交（勿单独提交、勿提前提交）

## 0. 明确不做（禁改清单）

- 不做多基线/历史卡引用编辑；不支持重复提醒（daily/weekly/monthly）对话式增删改；不支持「删除全部 once 提醒」（wire 空数组仍拒绝，v0.23 纪律不动）。
- `AiParser.parse` 冻结签名与返回类型不变；`RemoteDraftWire` 12 必填键清单与既有键纪律零改动（仅追加可选键 targetItemId）；ChatMessage kind 不新增。
- 本地降级链路（localFallback.ts / fallbackTurn）零改动（§7.40 本地兜底否决先例；降级轮无 targetItemId，确认保存走 create——既有语义）。
- 冻结区实现文件为空：`src/notifications/`、`src/domain/recurrence/`、`src/domain/export.ts`（测试夹具 stub 属编译必需，不属实现改动）。
- schema 停留 v16 零迁移；无新依赖；不做「作废第一条」式删除联动；src/domain/export.ts 与数据导出链路零改动。
- merge.ts 的 DraftField 掩码**不纳入** targetItemId（id 是落库路由信号非内容字段，直接透传）。

## 1. 设计决策（详见提案 §4）

- D1 wire 可选键 `targetItemId?: string | null`（键可缺省宽容、值出现即从严整体拒绝、不校验存在性）；ParsedItemDraft + 可选 `targetItemId?: string`（guard 纪律同 reminders）；ai.md v0.25 变更记录。
- D2 播种 JSON 带 `itemId` 键（serializeDraftForHistory 调用方传入；useFlashChat 两处 + chat.ts 两处核对）；renderBriefing 摘要块加「关联条目 id」行（tryParseBriefingDraft 判据字段不变，itemId 透传）。
- D3 prompt 成文：字段定义 targetItemId 行（编辑基线回填、全新意图 null、禁止编造）+ 多轮节编辑已保存条目语义（reminders 输出编辑后完整绝对时刻集合）。
- D4 update 落库链：存在性校验（getItemById + sourceReadOnly 拒绝转披露、降级 create）→ updateItem 全量 patch + updateItemTime → tags diff（add/removeTagToItem 逐个）→ once 集合差异（listRemindersByItem 按 frequency==='once' 分组按 epoch 对比：增 create/减 delete/同 epoch 不动；重复提醒与非 once 不参与；缺省=不动；offset/delay 产物经摘要块照抄保留）→ reconcile 一次 → 卡措辞「已更新」→ 播种更新后草稿（itemId 保持）。FlashSavePlan + targetItemId 透传。
- D5 认真模式 confirm 守卫零改动复用（update 路径 title/content 变化天然覆盖）。
- D6 历史卡边界：仅当前基线可编辑；更早历史卡视觉区分（切片 29）+ 点击跳详情页。

## 2. 阶段划分

### 阶段 1：域层 + 落库链 + 契约 + 单测

1. openAiCompatible.ts：RemoteDraftWire + targetItemId（isRemoteDraftWire 值从严、wireToParsedItemDraft 归一）。
2. types.ts：ParsedItemDraft.targetItemId（guard 键可缺省、值从严非空字符串）。
3. savePlan.ts：FlashSavePlan.targetItemId 透传（buildFlashSavePlan）。
4. prompt.ts：serializeDraftForHistory 输出 itemId；BriefingDraftShape/renderBriefing/tryParseBriefingDraft 附加键；AI_SYSTEM_PROMPT 字段定义 + 多轮节两处。
5. chat.ts：核对两处 historyAppend（draft 无 id 场景 itemId 缺省）与 FlashTurnResult 透传（结构零改动则不动）。
6. useFlashChat.ts：handleConfirmSave update 分支（D4 全链）+ 降级披露；编辑/新建措辞分叉。
7. docs/contracts/ai.md：v0.25 变更记录条目（wire 可选键 + 草稿可选字段 + history itemId 键；非破坏性声明）。
8. AGENTS.md：版本 v0.37→v0.38 + 新增 §7.46 + §8 刷新（当前切片行、候选链划掉切片 25 候选①②）。
9. 单测：wire 守卫矩阵 / draft guard / serializeDraftForHistory itemId / renderBriefing 行 / once 集合差异（增/删/同 epoch 不动/offset 产物保留）/ tags diff。
10. 提交：`git add` 提案 + 卡 + AGENTS.md + 源码 + 测试；提交信息 `完成切片 34 阶段 1：已保存条目对话式编辑域层与落库链`（或按仓库惯例分拆）。

### 阶段 2：真机验收 + closeout + backlog 划项

1. MuMu/真机矩阵 8 条（§3）。
2. closeout：tasks/slice-34-closeout.md（§7.10 义务）。
3. backlog：划掉切片 25 候选①②两行（注明关闭切片号）；closeout 惯例同步刷新 AGENTS §8。

## 3. 真机验收矩阵

1. **F2 回归**：保存条目 → 对话改 content（「内容加上：记得带伞」）→ 确认保存 → 详情页 content 已改且**列表无重复条目**。
2. **提醒减**：保存带 2 条提醒 → 对话「去掉 10 点那条提醒」→ 确认 → 条目剩 1 条提醒、通知一致。
3. **提醒增**：保存无提醒 → 对话「明天下午3点也提醒我」→ 确认 → 新增成功。
4. **认真模式**：编辑轮改 title → 确认卡出现 → 应用 → 条目更新。
5. **窄规则回归**：已保存条目「改成明天下午4点」本地窄规则路径不受影响。
6. **全新意图回归**：保存后输入全新事项 → 卡为新建语义（targetItemId 缺省）→ create 正常。
7. **降级回归**：无 Key 输入 → 本地解析 → create 语义不变。
8. **历史卡回归**：两张卡时第一张（历史）点击跳详情页；编辑措辞「已更新《xx》」正确。

## 4. 验收命令

- `npx tsc --noEmit`（0 错）
- `npx jest --runInBand`（基线 **98 套件/1426 用例** 只增不减）
- `npx expo-doctor`（2 项预存基线失败，无新增）
- Android 真机/MuMu 验收（调试开关 show_ai_request/show_ai_response 辅助观察 targetItemId 回填链路）

## 5. 风险

- 模型漏填 targetItemId → 退化新建（F2 残余概率，远端模型波动既有边界）——prompt 强约束 + 真机矩阵①覆盖。
- once 差异误删 offset/delay 产物 → epoch 对比 + 摘要块照抄（矩阵②专项验证）。
- updateItem 全量 patch 覆盖未表达字段 → 卡=编辑后完整快照（模型输出完整 JSON），无部分更新歧义。
- 全删提醒不支持 → 披露文案引导详情页，记 backlog 已知限制。
