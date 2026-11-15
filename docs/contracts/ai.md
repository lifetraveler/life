# AI 解析层契约（v0.17）

## 接口定义
```typescript
export interface AiParseContext {
  now: number;       // 当前绝对毫秒
  tzid: string;      // 设备时区
  history: ChatMessage[]; // 之前的对话上下文
}

export interface ParsedItemDraft {
  title: string;
  content: string;
  type: 'note' | 'task' | 'event';
  startAt: number | null;
  endAt: number | null;
  allDay: boolean;
  categoryId: string | null;
  tags: string[];
  priority: number | null; // 0=无 1=低 2=中 3=高；null=用户未表达
  recurrence: RecurrenceRule | null; // 严格遵循 src/domain/recurrence/types.ts
  reminderOffsetMinutes: number | null; 
  reminderDelayMinutes: number | null; // v0.17（切片 19）：相对当前时刻“X分钟后提醒”
}

export interface AiParser {
  parse(input: string, context: AiParseContext): Promise<ParsedItemDraft>;
}
```

## 远端响应 wire 格式（v0.16，切片 15 阶段 4，变更提案已经用户当场确认）
`OpenAICompatibleProvider` 的模型输出（chat-completions `content`）不使用
`ParsedItemDraft` 形状，而是下面的民用时间 wire；Provider 内部经
`isRemoteDraftWire` 严格守卫后，由 `wireToParsedItemDraft` 本地换算为
`ParsedItemDraft`（Unix 毫秒）再返回。`AiParser.parse` 对外契约不变。

```typescript
interface RemoteDateTimeField {
  date: string;        // 'YYYY-MM-DD'，公历，2000..2100，日历合法性校验（如拒绝 02-30）
  time: string | null; // 'HH:mm' 24 小时制；null 表示只表达日期（全天）
}

interface RemoteDraftWire {
  title: string;
  content: string;
  type: 'note' | 'task' | 'event';
  start: RemoteDateTimeField | null; // 用户没表达任何时间时为 null；键缺失整体拒绝
  end: RemoteDateTimeField | null;
  allDay: boolean;
  categoryId: 'work' | 'personal' | 'study' | 'health' | 'other' | null;
  tags: string[];
  priority: 0 | 1 | 2 | 3 | null;
  recurrence: RecurrenceRule | null; // 形状同 src/domain/recurrence/types.ts
  reminderOffsetMinutes: number | null;
  reminderDelayMinutes: number | null; // v0.17（切片 19）
}
```

换算语义：
- `startAt`/`endAt` 由 `resolveCivilTimeToInstant(context.tzid, …)` 本地换算；
  DST gap 返回 null（与 LocalFallbackProvider 一致：该时刻不存在 → 未设时间）。
- `start` 为 null 时 `startAt` 为 null，且 `end` 一并丢弃（无起点不成区间）。
- `allDay` 归一：start 缺失 → false；start.time 为 null 或模型声明 allDay → true。
- `recurrence` 非空时，`startAt` 一律由 `nextOccurrenceInstant(rule, now, tzid)`
  本地确定性重算（模型给的首日不采用）。
- 任何形状偏差（非法日期/时刻/枚举/缺键）整体拒绝（schema-mismatch），不做补救。

## reminderOffsetMinutes 的落库降级（v0.16 记录，切片 15 阶段 3 起）
`ParsedItemDraft.reminderOffsetMinutes`（相对提醒，如“提前10分钟”）在冻结的
Reminder 模型中没有落库位置：data-model.md §4.1 冻结
`frequency: 'daily' | 'weekly' | 'monthly'`，无一次性/相对频率；`recurrence`
非空时该偏移与重复提醒的 localTime 语义也不兼容。因此确认保存时：

- `recurrence` 非空：创建重复 Reminder（偏移分钟数暂不落库，卡片保留展示）；
- `recurrence` 为空且 `reminderOffsetMinutes` 非空（纯一次性提醒）：**不创建
  Reminder**，意图保留在卡片（draft 字段仍在），确认保存后弹提示
  “一次性提醒暂不支持自动创建，已保留在卡片意图中”。该行为实现于
  `mapDraftToCreateInputs` / `buildFlashSavePlan`（savePlan.ts），并由测试固化。
- 如需真正落库一次性提醒，须先对 data-model.md / notifications.md 提变更提案
  （Reminder 模型加一次性频率或偏移字段 + schema migration + 调度器支持），
  属后续切片，未经确认不得实现。

## reminderDelayMinutes 语义（v0.17 新增，切片 19 阶段 1，任务卡三阶段划分已确认）
`ParsedItemDraft.reminderDelayMinutes`（延迟提醒，“10分钟后提醒我吃药”）表示
**相对当前时刻**延迟多少分钟再提醒，与 `reminderOffsetMinutes`（提前提醒，
“提前10分钟”）语义独立、可在同一句分别出现、分别填写，互不覆盖/换算：

- 取值：≥1 的整数分钟或 null（与 offset 同纪律：缺键整体拒绝，0/负数/小数拒绝）。
- 换算边界（prompt.ts“延迟提醒判定规则”一节与 localFallback 延迟槽均已固化，
  测试断言关键句存在）：
  - 只支持“分钟/小时”两种单位；X小时=X*60、半小时=30、一个半小时=90；
  - 不支持的单位一律 null，禁止自行换算（“X天后提醒”→null、“X秒后”→null）；
  - “明天提醒我”“下午3点提醒我”是 start 时间语义，填 start、delay 为 null；
  - delay 禁止换算成 start/end；同句另有具体时间时 start 照常按字面填写。
- 落库（阶段 2 实现）：`recurrence` 为空且 `reminderDelayMinutes` 非空时，
  以 `now + delay*60000` 为触发时刻创建 once 提醒（无需 startAt）。
- 落库修订（切片 19 真机验收 3/4 反馈，用户提出）：
  - 条目时间锚定：原 draft 无 startAt 时，条目 `startAt` 取触发时刻
    （now + delay），条目落入日程时刻分组而非无时间「待办」组；draft 已有
    startAt 时照常保留原值。提醒因时区白名单等原因未创建时锚定仍成立
    （条目时间与提醒互相独立）。上句「delay 禁止换算成 start/end」仍指
    AI/prompt 层纪律（模型不得自行换算），落库层的锚定是产品行为；
  - 提醒渠道跟随全局默认渠道：AI 落库提醒的 `channels` 取
    `app_settings.defaultChannels`（savePlan 第 4 入参，闪电添加链路传入），
    不再恒为系统通知单渠道；channelConfigs 保持空，含网络渠道时 notice
    诚实披露「闪电添加未配置其参数，到点投递会失败」。

## 变更记录（v0.15.1，切片 15 阶段 1，变更提案已经用户当场确认）
- ParsedItemDraft 新增 `tags: string[]` 与 `priority: number | null` 两个字段。
- 原因：tasks/slice-15.md 阶段 4 验收 6 要求预览卡片包含“标签”；priority 是 §7.22 的卡片可编辑字段，
  原契约漏列会导致卡片无法承载该数据。
- 影响范围：仅内存契约与 Provider/守卫/Mapper 实现；不涉及 schema、migration、Repository 签名。
- 迁移方案：无库迁移。守卫要求两字段必须存在（tags 为数组、priority 为 0–3 或 null）；
  Provider 的 system prompt 已同步约定输出这两字段。
- ChatMessage 契约引用但未定义形状，实现侧定为 `{ role: 'user' | 'assistant'; text: string }`
  （src/domain/ai/types.ts），如后续需要扩展在此契约补充。

## 变更记录（v0.16，切片 15 阶段 4，变更提案已经用户当场确认）
- 远端模型响应从“直接输出毫秒时间戳”改为民用时间 wire（见上文专节）；
  ParsedItemDraft 与 AiParser 对外签名不变。
- 原因：阶段 4 真机验收实证 LLM 直接计算 Unix 毫秒不可靠，三种失败模式：
  整年算错（“每天9点”→2025-11-12）、时区反算（“明早9点”→01:00，恰好 -8h）、
  照抄 history 上一轮旧值（“明早8点”与“明早9点”返回同一时间戳）。prompt 端
  锚点差值法无法消除。
- 影响范围：OpenAICompatibleProvider（wire 守卫 + 本地换算 + 重复项确定性重算）、
  prompt.ts（字段定义与时间书写规则重写，移除锚点差值法）、相关测试；
  不涉及 schema、migration、Repository 签名；LocalFallbackProvider 不受影响。
- 迁移方案：无库迁移。旧 wire（含 startAt/endAt 数字）会被新守卫整体拒绝
  （schema-mismatch），不存在兼容路径需要——模型响应即弃即换。

## 变更记录（v0.17，切片 19 阶段 1，任务卡三阶段划分经用户确认）
- ParsedItemDraft 与 RemoteDraftWire 新增 `reminderDelayMinutes: number | null`
  （延迟提醒：相对当前时刻 X 分钟/小时后提醒，AGENTS.md §7.30 第一条）。
- 原因：切片 19 任务卡要求 AI 域与本地降级层支持延迟提醒意图；prompt 必须明确
  写清边界与示例，不得依赖模型自行推断（防静默丢失）。
- 影响范围：types.ts / guard.ts（缺键与非法值整体拒绝，同 offset 纪律）/
  merge.ts（DraftField 加行）/ openAiCompatible.ts（wire 守卫 + 透传）/
  prompt.ts（字段行 + “延迟提醒判定规则”一节）/ localFallback.ts（延迟提醒槽，
  先于提前槽扫描、命中整段认领）；不涉及 schema、migration、Repository 签名。
- 迁移方案：无库迁移。旧 wire 缺 reminderDelayMinutes 键会被守卫整体拒绝
  （schema-mismatch → 降级本地解析），模型响应即弃即换（v0.16 先例）。

## 变更记录（v0.18，切片 22 阶段 1，方案经用户当场确认）
- 按 v0.15.1 留言「如后续需要扩展在此契约补充」：`ChatMessage` 实现侧形状扩展可选字段
  `kind?: 'text' | 'card'` 与 `cardPayload?: FlashCardPayload`（形状见
  src/domain/ai/types.ts；FlashCardCategorySnapshot / FlashCardReminderSnapshot /
  FlashCardPayload 结构化快照）——闪电录入保存成功后的 AI 回复改为结果卡片消息
  （AGENTS.md §7.34），卡片 UI 由 src/ui/FlashResultCard.tsx 现算展示文案。
- 原因：tasks/slice-22.md 阶段 1 要求 ChatMessage 支持携带 cardPayload；载荷存结构化
  快照而非文案，阶段 3 快捷推迟只更新 startAt / onceAt 即可原地刷新。卡片消息仅入
  渲染流（保存成功后 historyRef 已清空），不进入 LLM history。
- 影响范围：src/domain/ai/types.ts、cardPayload.ts（新）、__tests__/cardPayload.test.ts（新）、
  src/ui/useFlashChat.ts、src/ui/FlashResultCard.tsx（新）、src/app/(tabs)/flash.tsx；
  不涉及 schema、migration、Repository 签名。可选字段而非判别联合：ChatMessage 既有
  构造点（runFlashTurn historyAppend 等）缺省即 'text'，零改动。
- 迁移方案：无库迁移。消息为内存 UI 状态，无持久化兼容问题。

## 澄清与渠道推荐（v0.19，切片 23 阶段 1，方案经用户确认）
- `ParsedItemDraft` 扩展三个可选字段（undefined = 未表达）：
  - `reminderChannels?: ReminderChannel[]`：解析层识别出的**强提醒渠道推荐**。元素
    ∈ ReminderChannel 四值，且 `"system-notification"` 与 `"alarm"` 不得同现
    （expo 家族互斥，AGENTS.md §7.30）。语义澄清：**普通提醒不携带该字段**（远端
    模型未提及渠道时填 `null`；本地解析未命中强提醒词表时不设键），落库渠道照旧
    走 `app_settings` 的 defaultChannels（§7.30 不变，禁止远端每句自填
    `['system-notification']` 踩掉用户默认渠道）；仅强提醒场景（起床/叫我/叫醒/
    吃药/抢购等，远端按语义判断、本地按关键词表）才填 `['alarm']`；用户明示渠道
    时按用户。落库优先级：draft 显式渠道 > defaultChannels > 单系统通知。
  - `needsClarification?: boolean`：true = 输入缺关键属性（缺具体时刻，且无提前量/
    延迟/重复规则兜底），不应急于落库，Chat 侧展示澄清反问并允许用户直接回复补充；
    false/undefined = 正常出卡。带完整时刻的叫醒类输入（如「明天上午8点叫我起床」）
    默认事由就是起床，不反问。
  - `clarificationPrompt?: string`：澄清反问文案（单句，复用用户原词，只问缺失的
    那一个属性，如「你要在什么时间提醒你吃药？」）。
- wire 三键可缺省（对 v0.16「缺键整体拒绝」的刻意偏离）：`RemoteDraftWire` 新增
  `reminderChannels?: ReminderChannel[] | null` / `needsClarification?: boolean | null` /
  `clarificationPrompt?: string | null`。键缺省 = 旧版模型响应，照常通过；值出现即
  从严校验（形状偏差仍整体拒绝）。偏离理由：澄清与渠道推荐是建议性信息，缺键不应
  把整个解析炸成 schema-mismatch 降级。此偏离仅限本节三字段，reminderOffsetMinutes /
  reminderDelayMinutes 的「缺键整体拒绝」纪律不变。
- 落库语义（savePlan）：`reminderChannels` 已表达且无提前量/延迟/重复规则时，在
  startAt 时刻创建 once 提醒并使用推荐渠道（闹钟语义：8点叫就8点响，不需要提前量）；
  allDay 或无时间不建并披露；有提前量/延迟/重复规则时锚点规则不变，仅渠道取推荐渠道。
- 影响范围：src/domain/ai/types.ts、guard.ts、openAiCompatible.ts、prompt.ts（字段行 +
  强提醒/澄清/多轮续答三节指令）、localFallback.ts（强提醒词表 + 意图短语槽 + 澄清
  判定）、merge.ts（reminderChannels 掩码合并；澄清信号恒取新一轮）、savePlan.ts
  （强提醒 once 分支 + 渠道优先级）；不涉及 schema、migration、Repository 签名；
  Chat/UI 侧消费（澄清消息、渠道标识）在阶段 3。
- 迁移方案：无库迁移。三字段均为可选：旧 wire（12 键）与含三键或 null 值的新 wire
  均可通过守卫；本地解析对不含意图词的输入行为不变。
## 主动澄清扩展至预约/预订/安排类（v0.19 验收反馈修补，切片 23，2026-11-16）
- 触发范围（仅远端 AI_SYSTEM_PROMPT 主动澄清节；本地降级层澄清保持强提醒 scope 不变）：
  预约、预订、挂号、订票、订酒店、订餐厅等「要落实一个未来时点安排」的动作动词，缺
  关键时间（完全没提时间，或只有「下周/周末/近期」这类模糊说法）→ needsClarification=true，
  反问先问具体时间，可顺带问自然相伴的一个细节（哪家医院/机构、常规还是专项），仍是单句。
- 时间已明确的预约/安排类输入直接出卡（禁止为细节反问）；机构/医院/类型等细节并入
  title（如「仁济医院常规体检」，卡片一眼可读）或 content/tags；澄清续答轮补全时同样
  并入 title/content/tags。
- 防误伤边界：纯想法/记录/感叹不是预约动作不澄清；type=note 且无安排意图一律不反问；
  只有明确的预约/预订/挂号/订类动词触发。MuMu 实测（v0.23.0/versionCode 7）：预约体检
  →澄清→补全出卡（title 仁济医院常规体检/次日 09:00）✓、灵感输入不反问 ✓、强提醒澄清
  与带时刻叫醒直接出卡回归 ✓。
## v0.19 阶段 2/3 落点记录（切片 23，2026-11-15）

上文「Chat/UI 侧消费（澄清消息、渠道标识）在阶段 3」的落点与本阶段远端上下文编辑的实现记录：

- 远端上下文编辑：新增 `buildHistoryBriefing(history, tzid)`（prompt.ts）——从 history
  末尾向前取最近一条 assistant 草稿 JSON（note 文本跳过），渲染「上一张卡片草稿摘要
  （修改时以此为准，禁止新建条目）：」块（标题/民用时间/重复/分类/标签/优先级/渠道
  推荐/澄清注记），由 OpenAICompatibleProvider.parse 拼入 system 消息。民用时间经
  getZonedParts 本地换算，摘要块绝不携带毫秒 epoch；Prompt 同步升级：编辑意图以摘要
  块民用日期为基准、其余字段照抄、禁止由毫秒反算日期。
- history 契约回正（useFlashChat.appendEditHistory）：草稿编辑成功路径的 assistant
  文本回写编辑后草稿的 JSON（切片 15 格式），纯文本 note 只留消息流；失败/引导路径
  仍写 note。澄清轮 historyAppend 不变（assistant=草稿 JSON）。
- Chat 澄清消费（useFlashChat.send）：解析结果 `needsClarification === true` 时不设
  待确认草稿（不出预览卡），clarificationPrompt（缺省兜底通用文案）作为普通 AI 文本
  消息追加，degraded 时补降级说明；草稿保留供下一轮续答经 merge 补全后自然出卡。
  澄清待补轮不被「改成X点」编辑窄规则劫持（needsClarification=true 时窄规则不拦截）。
- 结果卡片快照渠道（阶段 3）：FlashCardReminderSnapshot 新增 `channels:
  ReminderChannel[]`（恒携带、防御拷贝）；FlashPreviewCard 新增 describeDraftChannelLine
  （alarm → ⏰ 闹钟 / system-notification → 🔔 通知 / 网络渠道按标签列出 / 未表达不渲染）、
  FlashResultCard 提醒行改 describeCardReminderLine（图标 + 「渠道 · 规则摘要」，
  规则摘要保留）。展示为纯 UI 消费，不改变 wire 契约与落库语义。
