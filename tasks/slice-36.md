# 切片 36 任务卡 — AI 日程查询/记忆检索（对话式日程管理）

- 基点：main @ `97feeb6`（切片 35 合并 + backlog 立项登记后）
- 分支：`task/slice-36`（从 main @ `97feeb6` 切出）
- 提案：`docs/proposals/slice-36-ai-schedule-query.md`（用户 2026-11-23 四问定案：本地预路由+独立查询分支 / 模型解析自然语言范围 / 自然语言摘要 / 全域+开关默认开）
- 规模：中偏大；两阶段；schema v18（一列）

## 0. 明确不做（冻结清单）

- **ai.md 契约正文零改动**（查询轮不走 parse/wire；窗口轻守卫为独立函数，不触碰 RemoteDraftWire/isRemoteDraftWire）；AiParser.parse 冻结签名不变；
- Repository 接口/实现零改动（复用 listItemsWithTags/listArchivedItemsWithTags；无新方法、无注记节；§4.5/§4.7 冻结面不动）；
- ChatMessage kind 不新增；FlashPreviewCard/FlashResultCard/FlashConfirmCard 零改动；
- 查询结果结构化卡片不做（Q3 否决）；查询轮内嵌修改不做；
- 不做自动/定时查询、向量检索、FTS5、指代消解（「那周三呢」）、跨查询轮上下文记忆；
- 冻结区：`src/notifications/`、`src/domain/recurrence/`、`src/domain/export.ts` 实现文件为空；
- schema v18 仅一列（v15/v16/v17 step 不动）；无新依赖；无 `any`/`as any`；
- 闪电解析域零改动：AI_SYSTEM_PROMPT/localFallback/merge/savePlan/editIntent/openAiCompatible 解析链零改动（查询轮为独立新链路）。

## 1. 设计决策（D1–D8，详见提案 §4）

- **D1 本地预路由**：src/domain/ai/queryIntent.ts `matchesScheduleQueryIntent`（保守疑问词表+显式排除表，先排除后疑问；漏判走录入用户重述兜底）；useFlashChat.send() 顶部接线。
- **D2 两段式远端**：src/domain/ai/queryPrompt.ts（窗口解析 prompt→轻 JSON `{start:{date},end:{date}}` 民用；回答 prompt→纯文本摘要）；src/domain/ai/queryGuard.ts `isQueryWindowWire`+`resolveQueryWindow`（非法/失败→回退今天起 7 天+披露）；复用 provider 传输层（重试/超时/lastDebug/lastUsage）；不修改 AI_SYSTEM_PROMPT。
- **D3 全域检索**：src/domain/ai/retrieval.ts `buildScheduleRetrievalContext(items, window, tzid)`——窗口相交过滤（allDay 归一、无时刻待办单列节）+ 每条一行民用化组包 + content 80 字截断 + 上限 50 条 truncated 披露；输入=调用方组包 `listItemsWithTags() ∪ listArchivedItemsWithTags()`（切片 31 组包先例）。
- **D4 查询轮消息流**：ScheduleQueryTurnResult{answer, windowText, degraded, usage?, degradedNotice?}；user+assistant 纯文本消息；不产卡/不落库/不播种草稿 JSON；history append 照常（buildHistoryBriefing 对非 JSON 条目跳过，切片 33/34 编辑语义不受影响）；查询轮=新输入，**取消 §7.37 待确认**。
- **D5 开关**：app_settings v18 `ai_schedule_query_enabled` **isOptional boolean**（回填 null）+ 读层归一 `null→true` 默认开（**不得非可选 boolean**——回填 false 与默认开冲突，切片 30 教训同构）；settings.ts parse/validate + DEFAULT true；repository getSettings/updateSettings 透传；AppSettingsModel @field；profile.tsx「对话式查询」Switch（widgetToggleRow，settingsSavingKey 互斥）；关闭时查询轮本地提示不发远端。
- **D6 降级**：无 Key/第一段失败/第二段失败 → 本地行式列表回答（retrieval 组包直拼）+ degraded 披露；降级轮无 usage。
- **D7 候选①剩余顺带**：flash.tsx 保存后提示语改正向文案「已保存，继续输入可修改该条目，或直接提问查询日程」。
- **D8 边界**：lastDebug/lastUsage 被查询轮覆盖=已知行为（closeout 披露）；schema v18 迁移须真机升级验收（AGENTS §5）。

## 2. 阶段划分

### 阶段 1：域 + 数据层 + 契约文档（一次提交）

- queryIntent.ts / queryPrompt.ts / queryGuard.ts / retrieval.ts / scheduleQuery.ts（查询轮编排：开关读取→预判（调用方）→两段调用→降级组包）+ types.ts ScheduleQueryTurnResult；
- settings v18：schema.ts（SCHEMA_VERSION 17→18 + 列）+ migrations.ts toVersion 18 + AppSettingsModel + settings.ts（AppSettings/DEFAULT/parseAiScheduleQueryEnabled/validate）+ WatermelonItemRepository 读写透传两处；
- 单测：queryIntent 词表矩阵 / queryGuard（合法/非法回退/时区换算）/ retrieval（相交/allDay/无时刻待办/截断/上限 50/归档含入）/ settings 读层归一（null→true）/ migrationsV18 / repository 透传 / scheduleQuery 降级三路径；
- **提案 + 本卡 + AGENTS v0.40 随本阶段提交**（§7.48 新节 + §8 刷新）；
- ai.md / repository.md 确认零 diff。

### 阶段 2：UI 接线 + 真机 + closeout（一次提交）

- useFlashChat.ts：send 顶部预判 + 查询分支（enabled=false → 本地提示；开关读取走 getSettings）+ 消息流（切片 25 updater 纯函数纪律）+ 取消待确认接线；
- profile.tsx 开关行；flash.tsx 提示语轻改（D7）；
- 组件/hook 单测补充（useFlashChat 查询分支 Probe 模式：mock scheduleQuery 编排，真机降级路径同切片 25/30 方式）；
- 真机矩阵（§3）+ closeout（含 lastDebug 覆盖披露、误判样例记录）+ backlog 划项（29b 行 + 候选①剩余行注记「随切片 36 顺带处置」）。

## 3. 真机验收矩阵（MuMu + dev client；复用切片 32 调试弹层观察窗口解析轮）

1. 「这周有什么安排」→ 查询轮回答含本周已有条目（自然语言摘要），不落卡；
2. 「下周末有空吗」→ 窗口解析（调试弹层核轻 JSON）+ 空档回答；窗口外有条目不误报；
3. 「三月内有哪些就医」→ 自然语言窗口 + 全域检索（归档条目计入）；
4. 查询轮后「帮我把周一那个改到周二」→ 摘要块仍有效，编辑链路正常出卡（切片 34 语义）；
5. 查询轮后「记一下明天下午3点开会」→ 正常新建卡（预判不误伤录入）；
6. 「提醒我明天8点吃药」→ 正常录卡（排除表生效，含「提醒」但非查询）；
7. 开关关闭 → 查询输入得到本地提示（无远端调用，lastDebug 不更新）；
8. 无 Key/断网 → 本地行式列表回答 + degraded 披露；
9. 待确认（认真模式拦截轮）期间输入查询句 → 待确认取消、查询正常回答（§7.37 契约）；
10. 深浅色两态：开关行、回答消息（Token 化）。

## 4. 验收命令

- `npx tsc --noEmit` → 0 错
- `npx jest --runInBand` → 基线 **104 套件 / 1559 用例** 只增不减
- `npx expo-doctor` → 2 项预存基线失败无新增
- schema v18 升级安装 migration 真机验收（16384 存量升级）
- 真机矩阵 §3 全过；ai.md/repository.md 零 diff

## 5. 风险与注意

- 疑问词误判：保守词表+真机矩阵 5/6 误判样例必验；
- 两段式 RTT 延迟接受（查询非高频路径）；
- MuMu 双实例/黑帧恢复/输入法等操作纪律沿用切片 32/35 closeout 教训；
- .tmp-s25/26/28/31/32/35 与 apk 永不提交。
