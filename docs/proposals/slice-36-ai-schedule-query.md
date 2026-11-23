# 提案：切片 36 — AI 日程查询/记忆检索（对话式日程管理）

状态：**已确认**（用户 2026-11-23 四问定案，见 §2）
分支：`task/slice-36`（从 main 切出，基点见任务卡）
关联：backlog 候选 29b（编号顺延转正）、切片 29/32/33/34 对话链路

## 1. 背景

用户愿景（2026-11-17 提出）：日程应作为「记忆/RAG 系统」——直接提问「未来一周有什么安排」「下周三有空吗」「有没有饭局或就医」，应用检索日程并对话式回答，而不是只做录入。

现状缺口：闪电录入的输入语义只有「新建 / 编辑上一张卡」两种。查询类输入（含疑问词）目前会被远端模型**误解析成新建条目**（例：「这周有什么安排」可能落一张「这周有什么安排」的待办卡）。

链路基础（已具备）：切片 29/32/33/34 已完备——民用 history 序列化、尾部平衡 JSON 提取、wire reminders、targetItemId 编辑落库、多提醒、AI 重试与调试查看器。查询轮可完全复用 provider 传输层（重试/超时/错误分类/lastDebug/lastUsage）。

## 2. 设计四问定案（用户 2026-11-23，全选推荐项）

| # | 问题 | 定案 |
| --- | --- | --- |
| Q1 | 意图路由 | **本地预路由 + 独立查询分支**：useFlashChat 层疑问词预判，查询轮独立处理（检索→注入→回答）；不走 parse/wire，ai.md 零改动；误判由用户重述兜底。否决模型自路由（wire intent 信封需契约演进+双形状+失败面大）。 |
| Q2 | 时间窗口 | **模型解析自然语言范围**：「未来一周」「下周末」→ 模型换算窗口参数；解析失败回退默认「今天起 7 天」并披露。否决固定预设窗口。 |
| Q3 | 回答形态 | **自然语言摘要**：模型把窗口内条目总结成对话式纯文本回答（与澄清/降级轮同形态）。否决摘要+结构化列表、仅列表。 |
| Q4 | 检索域与隐私 | **全域（含已归档）+ app_settings 开关默认开**：schema v18 新列（isOptional + 读层归一默认 true）；敏感用户可关（关闭时查询轮提示）。 |

立项编号：**切片 36**（候选 29b 代号转正）。随片顺带处置候选①剩余「保存后提示语轻改法」（切片 34 已使保存后输入=编辑已保存条目，原提示语动机失效，本片改为正向文案）。

## 3. 范围与不做清单

**做**：查询意图本地预判、查询轮两段式远端调用（窗口解析→检索注入→回答）、全域检索组包、app_settings 开关（v18）、查询轮消息流接线、降级路径、开关设置 UI、保存后提示语轻改。

**不做（冻结）**：
- 模型自路由 / wire intent 信封 / RemoteDraftWire 任何改动（**ai.md 契约正文零改动**，无变更记录条目——查询轮不触碰解析契约）；
- 查询结果结构化卡片 / 点击跳详情列表（Q3 否决；结果卡形态留后续评估）；
- 查询轮直接修改条目（「把周一那个改到周二」需先以普通编辑轮发起，不作为查询轮内嵌动作）；
- 后台/定时/回前台自动查询（仅用户在对话中主动提问触发）；
- 本地向量检索 / FTS5（沿用 AGENTS §2 技术栈锁定；检索=窗口过滤+行式注入）；
- 跨查询轮的多问上下文记忆（查询轮回答不携带上一查询轮内容，每次独立检索——「记忆」成分=全域日程数据本身）；
- 语音输入、多轮追问式 drill-down（「那周三呢」的指代消解不做——用户需完整重述）；
- `src/notifications/`、`src/domain/recurrence/`、`src/domain/export.ts` 实现文件为零（实现文件为空措辞，测试夹具 stub 除外）；
- Repository 接口/实现零改动（复用 listItemsWithTags/listArchivedItemsWithTags 全量读取，无新方法、无注记节；§4.5/§4.7 冻结面不动）；
- ChatMessage kind 不新增（查询回答为纯文本 assistant 消息）；schema 停留 v17 之外只加一列（v18）；
- 无新依赖。

## 4. 设计决策

### D1 本地预路由（queryIntent）

新文件 `src/domain/ai/queryIntent.ts`：纯函数 `matchesScheduleQueryIntent(input: string): boolean`。

- **保守疑问词表**（宁可漏判不可误判——漏判走录入分支用户可重述，误判把录入当查询代价高）：
  - 强疑问信号（命中即查询）：`什么`/`哪些`/`有没有`/`忙不忙`/`空吗`/`有空吗`/`几号`/`周几`/`星期几`/`查一下`/`看看我`/`提醒过我`/`安排了`/`预约了`（后两者仅当其后无明确事由名词时——实现为短语级正则，不做分词）；
  - 显式排除（含则不判查询）：`帮我记`/`帮我安排`/`提醒我`/`改成`/`改到`/`加一个`/`新增`/`推迟`（这些是录入/编辑动词开头）；
  - 判定顺序：先查排除表，再查疑问表；两表都不含 → false（走解析）。
- 澄清待补轮（如「下午2点」）不含疑问词，天然不冲突。
- 预判位置：`useFlashChat.send()` 顶部（在任何分支之前），`enabled` 且 `matchesScheduleQueryIntent` → 走查询分支。

### D2 查询轮两段式远端调用（queryPrompt + 独立轻守卫）

新文件 `src/domain/ai/queryPrompt.ts`：

- **第一段·窗口解析**：`buildQueryWindowResolutionPrompt(input, context)`（当前时间事实 + 用户问题）→ 模型输出**独立轻 JSON** `{ "start": {"date": "YYYY-MM-DD"}, "end": {"date": "YYYY-MM-DD"} }`（民用日期，含当日）；本地守卫 `isQueryWindowWire`（独立函数，**不触碰 RemoteDraftWire/ai.md**）+ `resolveQueryWindow`（民用→本地时区 epoch，start 当日 00:00 / end 当日 23:59:59.999；end < start / 非法日期 / 解析失败 → 回退默认今天起 7 天并在回答披露「按未来 7 天检索」）。
- **第二段·回答生成**：`buildQueryAnswerPrompt(question, retrievalContext, windowText)` → 模型输出**纯文本回答**（自然语言摘要；无条目时如实回答「窗口内没有安排」）。
- 两段均为 chat-completions fetch，复用 OpenAICompatibleProvider 传输层（重试/超时/错误分类/lastDebug/lastUsage 副通道）；queryPrompt.ts 导出 `AI_QUERY_SYSTEM_PROMPT` 等常量，**不修改 AI_SYSTEM_PROMPT**（闪电解析域隔离，ai-prompt 只读页不变）。
- usage/debug：两段调用各自写 provider 副通道；查询轮结束后 `lastUsage`/`lastDebug` 反映最后一次调用（第二段），**会覆盖解析轮的调试载荷**（披露为已知行为；usage 行展示沿用 show_ai_usage 开关）。

### D3 全域检索组包（retrieval）

新文件 `src/domain/ai/retrieval.ts`：纯函数 `buildScheduleRetrievalContext(items: ItemWithRelations[], window: {startMs, endMs}, tzid): {context: string, included: number, truncated: boolean}`。

- 输入 = 调用方（useFlashChat）经 Repository 取 `listItemsWithTags()` ∪ `listArchivedItemsWithTags()`（全量列表，切片 31 组包先例同构）；
- 过滤：条目与窗口相交（startAt/endAt 归一；allDay 按当日全段相交；无时间待办（仅 title 无时间）单列「无时刻待办」节，不参与时间排序）；
- 组包每条一行：`周三 09:00 体检（健康）[已完成] 备注：<content 前 80 字>`（tzid 用 getZonedParts 民用化；category 空/emoji 省略；content 空省略备注节）；
- 上限 50 条（按时间升序取最早 50），超出 truncated=true 并在回答 prompt 中注入披露指令（模型回答末尾提及「仅包含前 50 条」）；
- 不做语义/向量检索——「记忆」成分=全域数据 + 模型对窗口的理解（Q2/Q4 定案的自然语言边界）。

### D4 查询轮结果与消息流

- 新类型 `ScheduleQueryTurnResult { answer: string; windowText: string; degraded: boolean; usage?: AiUsageSnapshot; degradedNotice?: string }`（**不走 FlashTurnResult**——无 draft/assistantNote/historyAppend）；
- 消息流：user 消息 + assistant **纯文本回答**消息（复用既有 push 模式，切片 25 updater 纯函数纪律）；不产卡、不落库、不播种草稿 JSON；
- history 连续性：查询轮 user/assistant 文本照常 appendEditHistory 进 history——`buildHistoryBriefing` 对非 JSON assistant 条目 parse 失败跳过（既有行为），**上一张卡的摘要块仍有效**，切片 33/34 编辑语义不受影响；
- §7.37 待确认并存：查询轮是「任何新输入」，**取消待确认状态**（契约遵守）。

### D5 开关（schema v18）

- 列名 `ai_schedule_query_enabled`：**isOptional boolean**（addColumns 回填 null）+ 读层归一 `null → true`（默认开）。**不得用非可选 boolean**——回填 false 与「默认开」定案冲突（切片 30 非可选 number 回填 0 教训同构）；`parseAiScheduleQueryEnabled`：非 boolean → true。
- `AppSettings.aiScheduleQueryEnabled?: boolean` + `DEFAULT_APP_SETTINGS.aiScheduleQueryEnabled: true`；写路径严格校验（validate 同 boolean 简单校验）；repository getSettings 归一点透传；AppSettingsModel `@field('ai_schedule_query_enabled', isOptional)`；schema v17→v18 单条 addColumns；migrations toVersion 18。
- UI：profile.tsx AI 配置区块内新增「对话式查询」widgetToggleRow（Switch，settingsSavingKey 互斥，carefulMode 行同款）；关闭时查询轮直接回答本地提示「对话式查询已关闭，可在『我的』-设置开启」（纯文本，不发远端）。

### D6 降级路径

- 无 Key（config.active=null）或两段均网络失败：**本地简易回答**——窗口解析失败 → 默认今天起 7 天 + 披露；用 retrieval.ts 的行式组包直接拼「未来 7 天日程：\n- …」（不调用模型总结）；degraded=true；
- 第二段失败但第一段成功：同样回退本地行式列表回答 + 披露「AI 摘要生成失败」；
- 降级轮不计 usage（与解析轮「usage 只报成功轮」纪律一致）。

### D7 候选①剩余顺带处置

flash.tsx 保存后提示语由「已保存」类文案改为**正向说明**：「已保存，继续输入可修改该条目，或直接提问查询日程」（一行文案轻改；切片 34 已使保存后输入=编辑已保存条目，原「将继续新建」类动机失效）。

### D8 边界汇总

- ai.md 契约正文零改动（查询轮不走 parse/wire；窗口轻守卫为独立函数）；AiParser.parse 冻结签名不变；
- ChatMessage kind 不新增；FlashPreviewCard/FlashResultCard/FlashConfirmCard 零改动；
- Repository 接口/实现零改动（无新方法/无注记节——复用既有只读列表）；
- schema v18 仅一列（v15/v16/v17 step 不动）；无新依赖；冻结区三目录零改动；
- lastDebug/lastUsage 被查询轮覆盖 = 已知行为（披露）；
- 本地预判误判接受（保守词表 + 用户重述兜底，README/help 不做）。

## 5. 文件落点与单测

| 文件 | 动作 |
| --- | --- |
| src/domain/ai/queryIntent.ts | 新增（matchesScheduleQueryIntent + 词表导出） |
| src/domain/ai/queryPrompt.ts | 新增（AI_QUERY_SYSTEM_PROMPT / buildQueryWindowResolutionPrompt / buildQueryAnswerPrompt） |
| src/domain/ai/queryGuard.ts | 新增（isQueryWindowWire + resolveQueryWindow 含回退） |
| src/domain/ai/retrieval.ts | 新增（buildScheduleRetrievalContext） |
| src/domain/ai/types.ts | 扩展 ScheduleQueryTurnResult 类型 |
| src/domain/settings.ts | AppSettings + DEFAULT + parse/validate（aiScheduleQueryEnabled） |
| src/db/schema.ts | SCHEMA_VERSION 17→18 + app_settings 新列 isOptional |
| src/db/migrations.ts | toVersion 18 单条 addColumns |
| src/db/models/AppSettingsModel.ts | @field 新列 |
| src/data/WatermelonItemRepository.ts | getSettings 归一透传 + updateSettings patch 透传 |
| src/ui/useFlashChat.ts | send 顶部预判分支 + runScheduleQueryTurn 调用 + 消息流接线 |
| src/domain/ai/scheduleQuery.ts | 新增（查询轮编排：开关读取/两段调用/降级组包） |
| src/app/(tabs)/profile.tsx | 「对话式查询」Switch 行 |
| src/app/(tabs)/flash.tsx | 保存后提示语轻改（D7） |

单测清单：queryIntent 词表矩阵（命中/排除/漏判）/ queryGuard（合法窗口/非法回退/时区换算）/ retrieval（相交过滤/allDay/无时刻待办/截断 80/上限 50/归档含入）/ settings 读层归一（null→true/非 boolean→true）/ migrationsV18 / repository 读写透传 / scheduleQuery 降级路径（无 Key/第一段失败/第二段失败）。

## 6. 风险

| 风险 | 缓解 |
| --- | --- |
| 疑问词误判（录入被当查询） | 保守词表+排除表先行；漏判成本=用户重述；真机矩阵覆盖误判样例 |
| 窗口解析轮失败/幻觉日期 | isQueryWindowWire 从严 + 回退 7 天披露；两段式隔离（第一段只产日期不产内容） |
| 窗口内条目过多注入膨胀 | 50 条上限 + content 80 字截断 + truncated 披露 |
| 查询轮覆盖解析轮 lastDebug | 披露为已知行为；需要解析轮调试时先看再问（或后续版本分键） |
| 两段式延迟（两次 RTT） | 接受（查询非高频路径）；重试上限沿用 ai_retry_max |
| 隐私 | 开关默认开但用户可关；每次查询均用户主动发起；注入内容仅窗口内条目 |

## 7. 验收口径

- `npx tsc --noEmit` 0 错；`npx jest --runInBand` 基线 **104 套件 / 1559 用例** 只增不减；`npx expo-doctor` 2 项预存基线失败无新增；
- schema v17→v18 升级安装 migration 真机验收（AGENTS §5）；
- 真机矩阵（卡 §3）9 条全过；ai.md / repository.md 零 diff 确认；
- 提案/卡/AGENTS v0.40 随阶段 1 提交。
