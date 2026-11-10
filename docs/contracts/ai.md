# AI 解析层契约（v0.15）

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

## 变更记录（v0.15.1，切片 15 阶段 1，变更提案已经用户当场确认）
- ParsedItemDraft 新增 `tags: string[]` 与 `priority: number | null` 两个字段。
- 原因：tasks/slice-15.md 阶段 4 验收 6 要求预览卡片包含“标签”；priority 是 §7.22 的卡片可编辑字段，
  原契约漏列会导致卡片无法承载该数据。
- 影响范围：仅内存契约与 Provider/守卫/Mapper 实现；不涉及 schema、migration、Repository 签名。
- 迁移方案：无库迁移。守卫要求两字段必须存在（tags 为数组、priority 为 0–3 或 null）；
  Provider 的 system prompt 已同步约定输出这两字段。
- ChatMessage 契约引用但未定义形状，实现侧定为 `{ role: 'user' | 'assistant'; text: string }`
  （src/domain/ai/types.ts），如后续需要扩展在此契约补充。
