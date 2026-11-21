# AI 解析层契约（v0.25）

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
  reminders?: number[]; // v0.23（切片 32）：绝对时刻提醒（epoch 毫秒，升序去重）；undefined=未表达
  targetItemId?: string; // v0.25（切片 34）：编辑落库路由信号——非空=更新该已保存条目；undefined=未表达（全新意图/本地降级轮），null 已在 wire 层归一为 undefined
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
  reminders?: RemoteDateTimeField[] | null; // v0.23（切片 32）；键可缺省，值出现即从严
  targetItemId?: string | null; // v0.25（切片 34）；键可缺省，值出现即从严
}
```

换算语义：
- `startAt`/`endAt` 由 `resolveCivilTimeToInstant(context.tzid, …)` 本地换算；
  DST gap 返回 null（与 LocalFallbackProvider 一致：该时刻不存在 → 未设时间）。
- `start` 为 null 时 `startAt` 为 null，且 `end` 一并丢弃（无起点不成区间）。
- `allDay` 归一：start 缺失 → false；start.time 为 null 或模型声明 allDay → true。
- `recurrence` 非空时，`startAt` 一律由 `nextOccurrenceInstant(rule, now, tzid)`
  本地确定性重算（模型给的首日不采用）。
- `reminders`（v0.23）非空数组时逐条 `resolveCivilTimeToInstant` 换算：DST gap
  条目丢弃（不整体拒绝——单条时刻不存在只丢该条）；结果升序去重后写入
  `ParsedItemDraft.reminders`。
- 任何形状偏差（非法日期/时刻/枚举/缺键）整体拒绝（schema-mismatch），不做补救。

### reminders wire 键纪律（v0.23，切片 32）

- `reminders` 键**可缺省**（v0.19 三字段同款偏离）：缺省/null = 旧版模型响应，
  照常通过；值出现即从严——必须是数组且每个元素为合法 `RemoteDateTimeField`
  且 `time` 必非 null（提醒必带时刻），数组长度不得超过 8（`WIRE_REMINDERS_MAX`，
  超出整体拒绝），形状偏差整体拒绝（schema-mismatch）。
- 语义：绝对民用时刻提醒（“明天8点、10点提醒我吃药”），与 `start` 语义独立、
  可同句出现；prompt“绝对时刻提醒判定规则”一节明确禁止模型把绝对时刻换算成
  `reminderOffsetMinutes`/`reminderDelayMinutes`（F1 真机缺陷根因封堵）。

### targetItemId wire 键纪律（v0.25，切片 34）

- `targetItemId` 键**可缺省**（v0.23 `reminders` 同构偏离）：缺省/null = 旧版
  模型响应，照常通过（null 归一为 undefined）；值出现即从严——必须是非空
  字符串，空串/非串形状偏差整体拒绝（schema-mismatch）。守卫不校验条目
  存在性（id 是否指向真实条目由落库层校验，模型无条目清单可编造）。
- 语义：编辑落库路由信号（非内容字段，不参与 merge 掩码，恒取本轮透传）——
  上一张卡片摘要块带「关联条目 id」且本轮是对该已保存条目的修改时回填该 id；
  全新事项一律 null（prompt 明确禁止编造或复用其他 id）。

## 已保存条目对话式编辑落库语义（v0.25，切片 34 阶段 1，AGENTS.md §7.46）

`ParsedItemDraft.targetItemId` 非空且草稿确认保存时，`useFlashChat.confirmSave`
走 update 落库链（提案 docs/proposals/slice-34-saved-item-conversational-edit.md
D4）：

- 存在性 + 只读护栏预检：`getItemById(targetItemId)` 为 null / 查询失败 /
  `sourceReadOnly`（外部导入只读，`updateItem` 既有抛错护栏语义沿用）时降级
  按 create 处理并披露「目标条目不存在/不可编辑，已按新建处理」——预检挡在
  写之前（一旦 updateItem 已执行，后续链失败无法整链回退）；
- 全量 patch：`updateItem(id, {title, content, type, categoryId, priority})`
  + `updateItemTime(id, plan.timePatch)`（时间字段只走 updateItemTime，§4.24
  纪律不变）——卡片即编辑后完整快照，模型输出编辑后全量草稿；
- once 提醒集合差异（`diffOnceReminderPlans` 纯函数）：基线 =
  `listRemindersByItem` 中 `frequency==='once'` 且 `onceAt` 非空的行，双侧
  触发时刻经 `resolveCivilTimeToInstant`（各自 tzid）换算 epoch 比较——
  `draft.reminders` 显式数组 = 全量替换（增 create/减 delete/同 epoch 保留
  不动、渠道不漂移）；`reminders` 缺省 = 基线不删、本轮 offset/delay/锚点
  产物增量创建；不可解析 epoch 的基线行保留不删；重复提醒与非 once 频率
  不参与差异；增删逐条失败 warn + 披露不中断（'[slice-34]'）；
- tags 差异（`diffItemTags` 纯函数，normalizeTagName 归一键比较）：目标有而
  基线没有逐个 `addTagToItem`、基线有而目标没有逐个 `removeTagFromItem`；
- `reminderScheduler.reconcile()` 显式一次（失败不阻断，切片 15 先例）；
- 结果卡措辞 update =「已更新《title》」/ create =「已添加《title》」；
- 保存后播种 `serializeDraftForHistory(current, tzid, itemId)`：create/degrade
  传 created.id（覆盖降级场景草稿残留的陈旧 targetItemId）、update 传基线 id
  （基线连续）；摘要块渲染「关联条目 id」行（解析 itemId 优先、回退
  targetItemId），模型据此在下一轮回填 wire 的 targetItemId。

边界：仅当前基线可编辑（更早历史卡保持切片 29 视觉区分，点击跳详情页）；
认真模式 confirm 守卫零改动复用（update 路径 title/content 变化天然覆盖）；
本地降级链路零改动（降级轮无 targetItemId 走 create，§7.40「本地不做编辑
意图兜底」既定边界）；不支持重复提醒对话式增删与「删除全部 once 提醒」
（wire 空数组仍拒绝，v0.23 纪律不动，全删场景披露走详情页）；schema 停留
v16 零迁移；无新依赖；冻结区零改动。

## reminders 落库语义（v0.23，切片 32 阶段 1）

`buildFlashSavePlan` 的提醒产出从单计划扩展为多计划（FlashSavePlan
`reminderPlan: ReminderPlan | null` → `reminderPlans: ReminderPlan[]`、
`reminderNotice: string | null` → `reminderNotices: string[]`）：

- `reminders` 逐条创建 once 提醒（toOncePlan；触发时刻 ≤ now 的条目不落库，
  披露「提醒时刻已过去（民用），未创建一次性提醒」——含民用时刻文本）；
- `reminderOffsetMinutes`（条目时间锚定的提前提醒）与 `reminderDelayMinutes`
  各自独立落库（原「一次只产一条计划」限制解除，切片 25 候选②/backlog L5 关闭）；
- 强提醒锚点（reminderChannels 无偏移/延迟语义）行为不变；
- 跨来源（重复计划 + reminders + offset + delay + 强提醒锚点）按 `startAt`
  去重，保留先产出者；
- `recurrence` 非空时重复计划照常落库，reminders/offset/delay 不另建一次性
  提醒，逐项披露保留意图；
- 渠道覆盖（draft.reminderChannels > defaultChannels）与网络渠道预设回填对
  最终计划数组循环应用，缺预设渠道合并为一句披露。

执行链（useFlashChat.confirmSave，阶段 2 接线）：`createReminder` 逐条顺序
await，单条失败 warn + 披露不中断不回滚；全部完成后 `reminderScheduler.reconcile()`
显式一次；`FlashCardPayload.reminder` 改为 `reminders: FlashCardReminderSnapshot[]`
（空数组 = 未创建提醒，卡片不渲染提醒行）。

## AI 调试查看器副通道（v0.23，切片 32 阶段 1，AGENTS.md §7.44，非破坏性条目）

- OpenAICompatibleProvider 新增只读 getter `lastDebug: AiTurnDebugSnapshot`
  （`{ request: string | null; response: string | null }`）：request = 发送给
  chat-completions 的请求体 JSON 文本（与实际发送同一文本；不含 HTTP headers
  ——Authorization 等凭据不采集不展示）；response = 响应体原文（成功轮 =
  chat-completions 信封，失败轮 = 错误响应文本）。parse 进入即清空，每轮尝试
  覆盖（重试取最后一次），成功失败均保留。
- FlashTurnResult 新增域内字段 `debug: AiTurnDebugSnapshot | null`（远端轮恒
  携带，含失败降级轮——失败轮正是缺陷排查主场景，与 usage「只报成功轮」刻意
  不同；无 Key 本地轮 null）。
- **传输边界（v0.20 冻结条款同款）**：debug 不进入 ParsedItemDraft、不进入
  history JSON、不触碰 RemoteDraftWire/isRemoteDraftWire；AiParser.parse 冻结
  签名与返回类型不变。UI 消费（开关存储 app_settings.show_ai_request /
  show_ai_response，schema v16，弹层三节）在阶段 2。

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
- 时间已明确的预约/安排类输入直接出卡（禁止为细节反问）；机构/医院/地点名称一律
  写入 content（补充说明），title 只保留动作主题词（如「预约体检」，不把医院/机构/
  地名写进标题）；澄清续答轮与已有卡片后的补充轮同样——title 沿用上一轮主题词，
  补充细节写入 content。FlashPreviewCard 与保存后结果卡 FlashResultCard 均新增
  「内容」行（content 非空时显示，numberOfLines=2），补充细节在卡片上直接可见。
- 防误伤边界：纯想法/记录/感叹不是预约动作不澄清；type=note 且无安排意图一律不反问；
  只有明确的预约/预订/挂号/订类动词触发。MuMu 实测（v0.23.0/versionCode 9，全远端
  路径）：预约体检→澄清「你想预约哪一天、去哪家医院体检？」→补时间出卡（title 预约
  体检/17日全天）→补医院→卡片 title 不变、「内容：西安交通大学第二附属医院」直接
  可见 ✓；灵感输入不反问 ✓、强提醒澄清与带时刻叫醒直接出卡回归 ✓。
- 本地降级层（chat.ts fallbackTurn）：纠正合并轮若本轮 expressed 标题与上一轮不同，
  标题沿用上一轮主题词、本轮原词并入 content（「；」衔接既有 content）——本地槽位
  解析没有标题提炼能力，剩余原文当标题会把「预约体检」改写成原词（用户截图实证）。
  标题未表达的纠正轮（如「改成后天」）行为不变。
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

## 用量展示副通道（v0.20，切片 26 阶段 1，AGENTS.md §7.38，非破坏性条目）
- OpenAICompatibleProvider 新增只读 getter `lastUsage: AiUsageSnapshot | null`：
  取自 chat-completions **信封** `usage` 字段（非模型 JSON content），defensive
  读取（usage 缺失/非对象、tokens 非有限数值或为负、cached_tokens 越界等形状
  偏差 → 整体回退 null，不炸解析主链）；失败轮恒 null，每轮重置不残留。
- FlashTurnResult 新增域内字段 `usage: AiUsageSnapshot | null`（runFlashTurn 成功
  轮携带 provider.lastUsage；fallbackTurn / 无 Key / 降级轮恒 null），由
  src/domain/ai/usage.ts（新文件）定义 AiUsageSnapshot / AiUsagePrices /
  formatAiUsageLine。
- **传输边界（冻结）**：usage 不进入 ParsedItemDraft、不进入 history JSON、
  不触碰 RemoteDraftWire / isRemoteDraftWire；AiParser.parse 冻结签名与返回
  类型不变。本条目对契约接口为零改动（纯新增旁路字段）。
- AiProviderConfig 新增可选 `priceInputPerMillion` / `priceOutputPerMillion`
  （正数有效；非正数/非数值由 isAiProviderConfig 丢弃为 undefined、不整包拒绝
  ——旧版本写入的配置不能因强校验整条失效）；两价齐备才按全价上界估算
  estimatedCost（不区分缓存命中折扣，不做币种换算）。
- 原因：tasks/slice-26.md 阶段 1（AI 透明度）要求远端解析轮可展示每轮输入/
  输出 tokens、缓存命中数与估算费用；开关存储走 app_settings.show_ai_usage
  （schema v13，UI 开关在阶段 2 接线）。
- 影响范围：src/domain/ai/usage.ts（新）、openAiCompatible.ts、chat.ts、
  configStore.ts；src/db/schema.ts（v13）、migrations.ts、AppSettingsModel.ts、
  src/domain/settings.ts、WatermelonItemRepository.ts（settings 读写的 v13 列
  接线）；相关测试。不涉及任何冻结签名变更。
- 迁移方案：schema v12→v13 addColumns（app_settings.show_ai_usage，boolean
  非可选默认 false，旧数据回退 false，v12 careful_mode 先例，零
  unsafeExecuteSql）；usage 本身无持久化（每轮内存即弃），无兼容路径需要。

## AI 配置平台化与 DeepSeek 峰谷分层计价（v0.21，切片 26 阶段 2b，AGENTS.md §7.38 注记，非破坏性条目）
- AiProviderConfig 新增可选 `platform`（'deepseek' | 'volcano' | 'bailian' |
  'xiaomi' | 'custom'；守卫集合校验，集合外/非字符串丢弃为 undefined——
  undefined 与 'custom' 等价，均按自定义平台消费，不整包拒绝）与
  `priceCachedPeak / priceCachedOffPeak / priceUncachedPeak /
  priceUncachedOffPeak / priceOutputPeak / priceOutputOffPeak` 六价字段
  （元/百万 tokens，正数有效；非正数/非数值丢弃为 undefined，不整包拒绝，
  口径同 v0.20 两价）。
- 预设表 `AI_PLATFORM_PRESETS`（configStore，纯数据）：deepseek =
  https://api.deepseek.com + deepseek-flash / deepseek-v4-pro（官方价格页
  2026-11 口径）；volcano = ark.cn-beijing.volces.com/api/v3 + doubao 系；
  bailian = dashscope.aliyuncs.com/compatible-mode/v1 + qwen 系；xiaomi
  占位（暂无公开 OpenAI 兼容端点，不预填）；custom 空。预设只供设置页 UI
  预填（BaseURL 随平台预填、Model 点 chip 填入，输入框始终可自由编辑），
  域层不做平台分支默认值。
- 估算路径分叉（OpenAICompatibleProvider，构造器新增可选 clock 注入
  `now: () => number` 供测试冻结判峰时刻，缺省 Date.now）：platform ===
  'deepseek' → readAiUsageSnapshotTiered（输入段拆缓存命中/未命中两截，
  各按 isPeakBeijing(now) 取价；**逐段规则：非零 token 段必须有其档位单价，
  缺价 → estimatedCost null 只出 token 段**；cached_tokens 缺省（null）时
  输入段全按未命中价计（保持上界语义）；cached=0 / 全缓存命中（未命中段
  金额 0）不要求对应档位价）；其余平台 → v0.20 全价上界两价路径不变。
  estimatedCost 均除 1e6 并 round 到 6 位小数；usage 行格式（formatAiUsageLine）
  不变。
- **isPeakBeijing 口径**：北京时间（UTC+8 固定偏移，Asia/Shanghai 无夏令时）
  周一至周五 [9:00,12:00) ∪ [14:00,18:00) 为高峰，其余空闲。**已知限制（冻结
  的简化）**：法定节假日不做识别——节假日工作时段会按高峰计价（官方口径
  节假日全天空闲），误差方向为高估费用；节假日表随官方每年公布变动、且无
  内置更新通道，不做。已记 tasks/backlog.md 待定候选。
- 传输边界（v0.20 冻结条款）不变：usage 不进 ParsedItemDraft / history JSON /
  RemoteDraftWire；AiParser.parse 冻结签名不变（OpenAICompatibleProvider 类
  构造器新增参数不属于冻结接口）。
- 原因：用户提出按平台完善 AI 配置（预设 BaseURL/Model）并按 DeepSeek 官方
  价格页做峰谷分层计价（含缓存命中档）；提案
  docs/proposals/slice-26-ai-config-enhancement.md 经用户确认（阶段 2b 并入
  切片 26；四平台+自定义；节假日 auto 工作日窗口）。
- 影响范围：src/domain/ai/configStore.ts（platform/六价/预设表）、usage.ts
  （AiDeepSeekTierPrices / isPeakBeijing / readAiUsageSnapshotTiered）、
  openAiCompatible.ts（config 类型六价/platform、clock 注入、估算分叉）、
  src/app/settings/ai.tsx（平台 chips / Model 预设 chips / 单价区按平台切换 /
  DeepSeek 官方价预填）；相关测试。契约接口零改动。
- 迁移方案：纯可选字段新增，旧 SecureStore JSON 缺键照常通过守卫（undefined
  = custom 平台 / 无价），无数据迁移。

## AI 配置每平台独立配置槽（v0.22，切片 26 阶段 2c，AGENTS.md §7.38 注记，非破坏性条目）

- **存储模型**：AiConfig 扩展为槽模型——`slots: Record<AiPlatform,
  AiProviderConfig | null>`（每平台独立保存 BaseURL/API Key/Model/单价，
  含 DeepSeek 分层六价）+ `activePlatform: AiPlatform`（使用中平台）。
  `active` 恒等于 `slots[activePlatform]`（不变式；isAiConfig 归一化时按槽
  重算 active，忽略传入值）。闪电录入消费面不变：runFlashTurn 仍读
  `config.active`。
- **v1 旧格式迁移（读取时归一化）**：SecureStore 旧 JSON 无 slots 键时，
  isAiConfig 将 active 按 platform（缺省 custom）归入对应槽、activePlatform
  置为该平台、其余槽为 null——零独立迁移步骤，写回即 v2 格式。v2 格式
  （slots/activePlatform 任一键存在）：逐槽守卫校验，损坏槽配置或
  activePlatform 非集合内 → 整包 null（走本地降级，不抛错）。
- **UI 交互（保存即激活，用户确认）**：平台 chips 点选仅切换**编辑视图**
  （从该平台槽回填表单；空槽按预设默认值初始化；未保存编辑直接丢弃不提示，
  MVP 口径）；「保存配置」写入当前编辑平台槽并将「使用中」徽标切到该平台；
  使用中徽标实时标注 activePlatform。切换编辑视图时保存按钮状态一并重置。
- **回滚**：v2 JSON 在旧代码下多余键被忽略、active 仍可读，无锁死。
- 原因：用户指出切换平台后 API Key 不分平台（单槽设计）；要求每平台保存
  自己的数据并标出使用中平台。
- 影响范围：src/domain/ai/configStore.ts（slots/activePlatform/createEmptyAiSlots/
  isAiConfig 归一化）、src/app/settings/ai.tsx（槽化 state/applySlotToForm/
  保存激活/徽标）；相关测试（configStore.test.ts / SecureAiConfigStore.test.ts）。
  消费面（chat.ts / openAiCompatible.ts / usage.ts）零改动。
- 迁移方案：无独立迁移（读取时归一化）；SecureStore JSON v1→v2 自动升级。

## 变更记录（v0.23，切片 32 阶段 1，方案与设计默认值经用户确认）

- ParsedItemDraft 与 RemoteDraftWire 新增绝对时刻提醒表达：draft 侧
  `reminders?: number[]`（epoch 毫秒升序去重，undefined=未表达）；wire 侧
  `reminders?: RemoteDateTimeField[] | null`（键可缺省、值从严整体拒绝、
  time 必非 null、≤8 条、DST gap 条目丢弃）。见上文「reminders wire 键纪律」
  与「reminders 落库语义」两节。
- 原因：F1 真机缺陷——「明天8点、10点提醒」被模型硬塞进 reminderOffsetMinutes，
  落库层 fireInstant = startAt−offset ≤ now 触发「提醒时刻已过去」误报，两条
  提醒均丢失。根因是 wire 无绝对时刻表达 + 落库层「一次只产一条计划」
  （backlog L5），本版两处同修。
- 影响范围：src/domain/ai/{types,guard,merge,openAiCompatible,savePlan,cardPayload,
  chat,prompt}.ts；src/domain/settings.ts、src/domain/configSnapshot.ts、
  src/db/{schema.ts,migrations.ts,models/AppSettingsModel.ts}、
  WatermelonItemRepository.ts（v16 两列接线）；相关测试。AiParser.parse 冻结
  签名与返回类型不变；不触碰 src/notifications/。
- 迁移方案：schema v15→v16 addColumns（app_settings.show_ai_request /
  show_ai_response，boolean 非可选默认 false，旧数据回退 false，v12/v13 先例，
  零 unsafeExecuteSql）；draft.reminders 为可选字段，旧 history JSON 缺键照常
  通过摘要解析与 merge。

## 变更记录（v0.24，切片 33 阶段 1，提案 docs/proposals/slice-33-deepseek-flash-parsing-adaptation.md 已经用户确认）

- history assistant 草稿 JSON 民用化（根因 B）：chat.ts 两处 historyAppend
  （fallbackTurn / runFlashTurn）assistant 文本从域形状 JSON（startAt/endAt/
  reminders 为 epoch 毫秒）改为 `serializeDraftForHistory(draft, tzid)`
  （prompt.ts）——时间 epoch → `{date,time} | null`（allDay → time null）、
  reminders epoch[] → `[{date,time}]`、其余字段照抄；**键名对齐远端 wire**
  （时间键输出为 `start`/`end`，不再沿用草稿键名 startAt/endAt）。阶段 1 修正
  （真机矩阵 #3 轮 3 定性）：序列化若沿用草稿键名 startAt/endAt，模型在编辑轮
  照抄输出 startAt 民用对象，与 RemoteDraftWire 必填键 start/end 冲突 →
  isRemoteDraftWire 整体拒绝 → schema-mismatch 降级（同轮模型随机偏向：轮 2
  自我纠正用 start、轮 3 照抄 history 用 startAt 的实证）；history 键名与
  prompt 字段定义一致后 few-shot 同化与 wire 同向。buildHistoryBriefing 消费面
  三形状兼容：number = legacy 毫秒本地换算渲染（getZonedParts，与落库同源，
  v0.16 纪律不变）、startAt 键 `{date,time}` = v0.24 首轮发布形状直接渲染
  （升级瞬间内存残留）、start/end 键 `{date,time}` = 现产物直接渲染（解析优先
  start/end、回退 startAt/endAt）。原因：毫秒 JSON 进 history 后被 few-shot
  同化——模型自述「为保持一致输出 startAt 毫秒」压过 prompt 禁令，毫秒形状
  wire 守卫仍拒绝 → schema-mismatch 降级；仅剥离思维链不修同化，两修复必须
  捆绑。prompt 多轮节「history 毫秒仅供程序读取」条款随之改写为「history 中
  assistant 草稿 JSON 一律是民用时间格式；民用时间一律以摘要块为准——摘要块
  是唯一民用时间基准；输出 JSON 严禁出现毫秒时间戳或任何非字段定义格式的日期
  时间」。ParsedItemDraft 域形状不变（reminders 仍 `number[]` epoch，仅序列化
  出口民用化）。阶段 2 补全（真机矩阵 #6 发现，用户批准）：UI 层
  useFlashChat.ts 两个 assistant history 写入点——保存后播种（§7.40）与本地
  编辑成功回写（ai.md v0.19 草稿 JSON 回正）——原为域形状毫秒 JSON，是
  保存→继续编辑场景 few-shot 的同化源残留；两处改接
  `serializeDraftForHistory(draft, tzid)`，与 chat.ts historyAppend 同格式
  （民用时刻 + wire 键名 start/end），history assistant 条目四个写入点全部
  归一。
- 解析链尾部平衡 JSON 提取（根因 A）：新增纯函数
  `extractLastBalancedJson(text): string`（openAiCompatible.ts 导出）——从
  末尾向前扫描配平 `{}[]`、字符串字面量与 `\"` 转义感知、取最靠后配平块；
  无配平块原样返回走既有 invalid-json 失败路径；纯 JSON 输入零回归。解析链序
  `extractContent → stripCodeFence → extractLastBalancedJson → JSON.parse`。
  原因：deepseek-flash 思维链为纯散文、无 <think> 标签，直接拼进
  choices[0].message.content，JSON.parse 失败 → schema-mismatch 降级（L8
  「返回结构异常」主因）。
- 边界：RemoteDraftWire 键纪律与 12 必填键清单零改动；isRemoteDraftWire 仍对
  毫秒形状整体拒绝（不做宽容解析）；AiParser.parse 冻结签名与返回类型不变；
  不消费 reasoning_content 字段（多渠道 reasoning 形状探测不做）；
  localFallback / lastUsage / lastDebug 副通道零改动；schema 停留 v16 零迁移；
  无新依赖；冻结区（src/notifications/、src/domain/recurrence/、
  src/domain/export.ts）零改动。

## 变更记录（v0.25，切片 34 阶段 1，提案 docs/proposals/slice-34-saved-item-conversational-edit.md 已经用户确认）

- wire 可选键 `targetItemId?: string | null`（编辑落库路由信号）：键可缺省
  宽容（v0.23 reminders 同构）、值出现即从严整体拒绝（非串/空串）、null 归一
  undefined、不校验存在性（落库层校验）；`ParsedItemDraft` 追加可选
  `targetItemId?: string`（guard 同纪律）；`mergeDraftCorrection` return 末尾
  直接透传（id 是落库路由信号非内容字段，不纳入编辑掩码）；AiParser.parse
  冻结签名与返回类型不变。
- history 播种 JSON 带条目 id（D2）：`serializeDraftForHistory(draft, tzid,
  itemId?)` 追加第三可选参——显式非空串时输出 JSON 追加 `itemId` 键
  （draft.targetItemId 仍经 rest 原样透传）；调用方传入：保存链播种传
  created.id（update 传基线 id、degrade-create 传 created.id 覆盖陈旧基线）；
  chat.ts 两处 historyAppend 不传（缺省，无 id）。摘要块渲染「关联条目 id」
  行（renderBriefing，仅解析出 itemId 时渲染；`tryParseBriefingDraft` 判据
  字段不变，新增 `parseBriefingItemId` 读 `itemId ?? targetItemId` 非空串——
  比 D2 字面多兼容 targetItemId 键，修复 chat.ts 产物 JSON 无 itemId 键时
  第二轮摘要块丢 id、模型填 null 退化新建的链洞，阶段 1 报告披露）。
- prompt 成文（D3）：字段定义加 targetItemId 行（编辑基线回填/全新意图
  null/禁止编造或复用其他 id）；多轮节加「编辑已保存条目」bullet——摘要块带
  「关联条目 id」且本轮是对该条目的修改时回填该 id、以摘要块为基准其余照抄、
  reminders 输出编辑后完整绝对时刻集合（摘要块基础上增删后的全集）。
- update 落库链（D4）：见「已保存条目对话式编辑落库语义」节——存在性/只读
  预检降级、全量 patch + updateItemTime、once 集合差异（replace/append 双
  模式）、tags 差异、reconcile 显式一次、「已更新《title》」措辞、播种
  itemId 保持基线连续。
- 边界：本地降级链路（localFallback/fallbackTurn）零改动（降级轮无
  targetItemId，确认保存走 create）；认真模式 confirm 守卫零改动复用；
  RemoteDraftWire 12 必填键清单与 reminders 键纪律零改动（空数组仍拒绝）；
  schema 停留 v16 零迁移；无新依赖；冻结区（src/notifications/、
  src/domain/recurrence/、src/domain/export.ts）零改动。
