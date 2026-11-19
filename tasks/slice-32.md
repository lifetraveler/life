# 切片 32：F1 多提醒修复（wire reminders 数组）+ AI 对话调试查看器

- 提案：docs/proposals/slice-32-f1-multi-reminder-debug-viewer.md（用户 2026-11-19 确认范围 + 设计默认值）
- 基点：main @ 525c16f（切片 31 收尾 + 4 项真机补做 + backlog 划项后）
- 分支：task/slice-32（从 main @ 525c16f 切出）；提案/任务卡随阶段 1 提交
- 验收基线：tsc 0 错；jest **98 套件/1365 用例**（slice-31-closeout）只增不减；expo-doctor 2 项预存失败无新增；schema v15 → **v16**（本片唯一迁移：app_settings 两列 addColumns）
- 背景缺陷：F1（tasks/feedback-log.md）「明天8点、10点提醒」→「提醒时刻已过去」误报、两条提醒全丢；关联遗留 L5（savePlan 单计划约束）；调试查看器为 F1 类缺陷排查提供输入/响应/卡片数据内容面。

## §0 明确不做（禁改清单）

- 不碰 `src/notifications/`（调度/投递/reconcile 实现零改动）；不改 `AiParser.parse` 冻结签名与外层返回类型（ParsedItemDraft 字段扩展走 ai.md 变更记录，v0.15.1→v0.19 既定演化路径）；ChatMessage kind 不新增；
- `src/domain/ai/localFallback.ts` 零改动（§7.40 本地兜底否决先例，远端 prompt 为主路径）；
- F2（已保存条目对话式编辑防重复）不做，另属切片 25 候选②；
- 不引入新依赖（弹层用 RN 内置 Modal）；不做调试载荷持久化/导出/复制；不做聊天持久化、不做指数退避变更（切片 30 语义不动）；
- 请求头不采集（Authorization 不进任何调试载荷）；调试载荷不进 ParsedItemDraft / history JSON / wire（§7.38 传输边界同款纪律）；
- usage.ts 快照与格式化零改动；§5 构建配置不动；
- 工作区 `.tmp-s25/ .tmp-s26/ .tmp-s28/ .tmp-s31/ life-*.apk` 为验收残留，永不提交。

## §1 设计决策（提案 §1 定案落点）

- **D1 wire v0.23**：`RemoteDraftWire` 新增可选键 `reminders?: RemoteDateTimeField[] | null`（民用时刻，`time` 必须非 null）；缺省宽容、值出现即从严（非数组/元素坏/超 8 条 → `isRemoteDraftWire` 整体拒绝）；`wireToParsedItemDraft` 本地换算 epoch（DST gap 条目丢弃不炸整体）、升序排序 + 同 epoch 去重。
- **D2 草稿/守卫/合并**：`ParsedItemDraft.reminders?: number[]`（guard 键可缺省、值从严有限正整数数组）；`merge.ts` DraftField 扩 `'reminders'`（掩码命中防御拷贝、未命中沿用）。
- **D3 savePlan 多计划（F1 + L5）**：`FlashSavePlan.reminderPlan` → `reminderPlans: ReminderPlan[]`、`reminderNotice` → `reminderNotices: string[]`；reminders 每条 `toOncePlan`（epoch ≤ now 不落库 + 披露）；offset/delay 各自独立落库（L5 关闭，删「暂不支持一次创建两条提醒」文案）；强提醒锚点分支原样；跨来源同 `startAt` 去重；recurrence 非空全披露只落重复计划；渠道覆盖/预设回填循环应用每条。
- **D4 执行链**：`createReminder` 逐条 await，单条失败 warn + 披露不中断不回滚 item；`reconcile()` 保持成功后显式一次；`createdReminders: Reminder[]` 全量进卡片载荷。
- **D5 卡片载荷**：`FlashCardPayload.reminder` → `reminders: FlashCardReminderSnapshot[]`（内存态消息无迁移负担）；FlashResultCard 多提醒行（民用时刻逐条 + 渠道标签）；快捷推迟 chips 对条目全部 once 联动顺延；FlashPreviewCard 加 reminders 意图行。
- **D6 prompt**：字段定义加 reminders 行 + 新判定规则节（绝对时刻语义独立于 start、多时刻逐条展开、**禁止把绝对时刻换算成 offset/delay**、≤8 条、重复走 recurrence）；`buildHistoryBriefing` 摘要块加「提醒时刻」行（epoch 本地换算），history 毫秒禁反算条款扩展覆盖 reminders。
- **D7 调试查看器**：schema v16 两列 `show_ai_request`/`show_ai_response`（非可选 boolean，addColumns 回填 false，v12/v13 先例）；provider `lastRequest`/`lastResponse` 副通道（parse 进入清空、每轮尝试覆盖、成功失败均保留，getter `lastDebug`）；`FlashTurnResult.debug` 域内字段（远端轮恒携带含失败降级轮，与 usage 只报成功轮刻意不同；无 Key 轮 null）；UI 层 `FlashChatMessage.debugPayload`（request/response/draft JSON）；入口消息：用量行（showAiUsage）或「🔍 AI 调试」行（仅 debug 开关）；弹层三节显隐 request 随 show_ai_request、response/draft 随 show_ai_response；settings/ai.tsx 两行 Switch。

## §2 阶段

### 阶段 1：域 + 数据层

- `openAiCompatible.ts`：wire 键扩展 + `isRemoteDraftWire` + `wireToParsedItemDraft` + lastDebug 副通道（requestParse 记录请求体/响应体）；
- `types.ts` / `guard.ts`：ParsedItemDraft.reminders + isParsedItemDraft 扩展；
- `merge.ts`：DraftField 'reminders'；
- `savePlan.ts`：多计划组装（D3）；
- `chat.ts`：FlashTurnResult.debug 透传（provider 声明提出 try 块，失败降级轮也携带）；
- `prompt.ts`：AI_SYSTEM_PROMPT 字段行 + 判定节 + briefing 提醒行；
- `cardPayload.ts`：reminders 数组载荷；
- `schema.ts` v16 + `migrations.ts` + `AppSettingsModel.ts` + `settings.ts`（DEFAULT_APP_SETTINGS 两列）+ `WatermelonItemRepository.ts`（getSettings/updateSettings 接线）；
- `docs/contracts/ai.md`：v0.23（wire 节键清单 + 变更记录，含调试副通道传输边界注记）；提案/本卡/AGENTS.md（§7.44 + §8 刷新）随本阶段提交；
- 单测：提案 §4 第 1–8 项（域层全部）。

### 阶段 2：UI

- `useFlashChat.ts`：confirmSave 多计划执行链（D4）+ readTurnSettings 扩两开关 + pushUsageLine 扩展为调试入口消息（debugPayload 附加）；
- `FlashResultCard.tsx` / `FlashPreviewCard.tsx`：多提醒行渲染 + chips 全 once 顺延（D5）；
- `flash.tsx`：调试详情弹层（Modal 三节、Token 化深浅色、开关显隐）；
- `settings/ai.tsx`：AI 透明度区块两行 Switch + 说明文案；
- 单测：hook 执行链/入口消息/弹层显隐相关（可测域内部分），卡片渲染断言。

### 阶段 3：真机验收 + 收尾

- MuMu 真机矩阵（§3）；
- `tasks/slice-32-closeout.md` + backlog 划项（F1 关闭、L5 关闭、调试查看器落地）+ AGENTS §8 刷新（§7.9 收尾序列）。

## §3 真机验收矩阵

1. **F1 原始语句回归**：「明天8点、10点提醒我吃药」→ 卡片提醒行两条、保存落两条 once、无「提醒时刻已过去」误报；
2. L5 回归：「明天下午3点开会，提前10分钟提醒我，另外30分钟后提醒我准备」→ 两条 once 各自落库；
3. 编辑轮不丢意图：保存后「改成9点」「再加一条12点的提醒」→ reminders 随掩码合并；
4. 调试查看器：show_ai_request / show_ai_response 两开关 × 入口消息 × 弹层三节显隐（开 request 只见输入节、开 response 见输出+卡片节）；开关全关 = 现状无入口；
5. 失败轮调试：断网重试耗尽降级 → 「🔍 AI 调试」行可点击、请求体可见（响应体为 null 或错误响应）；
6. 隐私核对：弹层内容无 API Key（Authorization 不采集）；
7. 回归点：切片 23 alarm 推荐（「明天8点叫我起床」）、切片 25 认真模式拦截、切片 29 推迟 chips（多 once 全部顺延）+ 历史卡视觉、切片 30 重试提示；
8. schema 升级：v15 旧数据启动无迁移错误、两开关默认关、设置页开关即时生效（下一轮生效）、重启保持。

## §4 验证命令

- `npx tsc --noEmit`（0 错）
- `npx jest --runInBand`（基线 98 套件/1365 用例只增不减）
- `npx expo-doctor`（2 项预存失败无新增）
- Android 真机（MuMu）：§3 矩阵全过

## §5 风险与注记

- FlashSavePlan / FlashCardPayload 形状变更是本片最大爆点：消费方 grep 确认仅 useFlashChat.ts + cardPayload 链 + 测试，但测试断言面大（savePlan.test.ts 465 行 / cardPayload.test.ts / chat.test.ts），全量断言用例需逐个适配；
- 多计划 + 跨来源去重的边界（reminders 条目与强提醒锚点同刻）依赖模型输出质量，prompt 约束 + 去重兜底双层防御；真机 #1/#2 若模型仍输出旧形状（塞 offset），属 prompt 约束验证项，如实记录；
- 调试载荷内存态无隐私落盘风险，但请求体含用户输入原文与 system prompt，弹层注明「仅本机展示」；
- v16 迁移失败可能性低（addColumns 先例 v7–v15 全过），但真机 #8 必须实测升级路径。
