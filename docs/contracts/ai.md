# AI 解析层契约（v0.16）

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
