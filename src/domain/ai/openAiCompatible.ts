/**
 * 切片 15 阶段 1：OpenAI 兼容 Provider（OpenAI / DeepSeek 等自定义 API Key）。
 *
 * 职责（§7.24）：调用 /chat/completions，取 choices[0].message.content，
 * 剥离可能的 ```json 围栏后 JSON.parse，经 isRemoteDraftWire 严格校验，
 * 再由 wireToParsedItemDraft 本地换算为 ParsedItemDraft（Unix 毫秒时间戳）。
 *
 * v0.16 变更（ai.md）：模型不再直接输出毫秒时间戳——已实证 LLM 算 epoch
 * 不可靠（整年错、时区反算、照抄 history 旧值）。远端 wire 改用民用时间
 * {date:"YYYY-MM-DD", time:"HH:mm"|null}，epoch 一律本地换算；重复项的
 * startAt 进一步由 nextOccurrenceInstant 本地确定性重算。
 *
 * 拦截原则（不做任何补救）：
 * - HTTP 非 2xx → http-status（带 status）；
 * - 响应体不是合法 JSON → invalid-json；
 * - 响应体是 JSON 但缺少 choices[0].message.content → schema-mismatch（信封不完整）；
 * - content 不是合法 JSON（剥围栏后仍失败）→ invalid-json；
 * - content JSON 未通过结构守卫 → schema-mismatch；
 * - fetch 抛 AbortError（超时）→ timeout；其他 fetch 异常 → network。
 *
 * 安全：错误消息绝不包含 apiKey；Authorization 头只出现在请求里。
 * 可注入 fetchImpl 便于单测；默认全局 fetch（RN/Hermes 与 Jest 均可用）。
 */

import { AiParseError } from './errors';
import { isRecurrenceRule, isReminderChannelArray } from './guard';
import { nextOccurrenceInstant } from './localFallback';
import { AI_SYSTEM_PROMPT, buildHistoryBriefing, buildNowFacts } from './prompt';
import { positivePriceOrNull, readAiUsageSnapshot } from './usage';
import type { AiUsageSnapshot } from './usage';
import { daysInMonth, getZonedParts, resolveCivilTimeToInstant } from '../recurrence/civilTime';
import type { RecurrenceRule } from '../recurrence/types';
import type { ReminderChannel } from '../reminder';
import type { AiParseContext, AiParser, ChatMessage, ParsedItemDraft } from './types';

export interface OpenAiCompatibleConfig {
  /** 例如 https://api.openai.com/v1 或 https://api.deepseek.com/v1（自动去掉末尾斜杠） */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 请求超时毫秒数；缺省 20000 */
  timeoutMs?: number;
  /**
   * 每百万 tokens 输入/输出单价（切片 26 / §7.38，可选；正数才有效）。
   * 两价齐备时按全价上界估算费用（不区分缓存折扣）；留空/非正数只出 token 段。
   */
  priceInputPerMillion?: number;
  priceOutputPerMillion?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** 阶段 2「测试连接」结果：ok 时带往返耗时，失败带可展示原因（绝不含 apiKey）。 */
export type TestConnectionResult =
  | { ok: true; latencyMs: number }
  | { ok: false; reason: string };

/** 从 chat-completions 信封中取 content；形状不对抛 schema-mismatch。 */
function extractContent(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AiParseError('schema-mismatch', 'AI 响应信封不是 JSON 对象');
  }
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new AiParseError('schema-mismatch', 'AI 响应缺少 choices 数组');
  }
  const first = choices[0];
  if (typeof first !== 'object' || first === null) {
    throw new AiParseError('schema-mismatch', 'AI 响应 choices[0] 不是对象');
  }
  const message = (first as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) {
    throw new AiParseError('schema-mismatch', 'AI 响应缺少 choices[0].message');
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new AiParseError('schema-mismatch', 'AI 响应 choices[0].message.content 为空');
  }
  return content;
}

/** 剥离 ```json ... ``` / ``` ... ``` 围栏（存在时）；否则原样返回。 */
export function stripCodeFence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/u.exec(text);
  return fenced !== null ? fenced[1] : text;
}

// ---------------------------------------------------------------------------
// 远端 wire 格式（ai.md v0.16）：民用时间，本地换算 epoch
// ---------------------------------------------------------------------------

/** 单个民用日期时间字段：date 必为合法日历日；time null 表示只表达日期（全天）。 */
export interface RemoteDateTimeField {
  date: string;
  time: string | null;
}

/** 模型实际输出的 JSON 形状（v0.16：不含任何毫秒时间戳；v0.17：+reminderDelayMinutes）。 */
export interface RemoteDraftWire {
  title: string;
  content: string;
  type: 'note' | 'task' | 'event';
  start: RemoteDateTimeField | null;
  end: RemoteDateTimeField | null;
  allDay: boolean;
  categoryId: 'work' | 'personal' | 'study' | 'health' | 'other' | null;
  tags: string[];
  priority: 0 | 1 | 2 | 3 | null;
  recurrence: RecurrenceRule | null;
  reminderOffsetMinutes: number | null;
  /**
   * “X分钟/小时后提醒我”（切片 19 / ai.md v0.17）：相对当前时刻的延迟分钟数；
   * null=未表达。与 reminderOffsetMinutes（“提前X分钟”）语义独立、可同时出现。
   */
  reminderDelayMinutes: number | null;
  /**
   * 渠道推荐（切片 23 / ai.md v0.19）：强提醒场景 → ['alarm']；普通提醒/未表达 →
   * null 或缺省（落库渠道走用户 defaultChannels，禁止自填 system-notification）。
   * expo 家族互斥（system-notification 与 alarm 不同现）。
   */
  reminderChannels?: ReminderChannel[] | null;
  /** 主动澄清：缺关键信息需要反问 → true；false/null/缺省=不澄清。 */
  needsClarification?: boolean | null;
  /** needsClarification=true 时的单句反问文本；null/缺省=无。 */
  clarificationPrompt?: string | null;
}

const WIRE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WIRE_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isRemoteDateTimeField(value: unknown): value is RemoteDateTimeField {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { date?: unknown; time?: unknown };
  if (typeof v.date !== 'string' || typeof v.time !== 'string' && v.time !== null) return false;
  const m = WIRE_DATE_RE.exec(v.date);
  if (m === null) return false;
  const year = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const day = Number.parseInt(m[3], 10);
  if (year < 2000 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (v.time !== null && WIRE_TIME_RE.test(v.time) === false) return false;
  return true;
}

/** 远端响应结构守卫：任何形状偏差整体拒绝（schema-mismatch），不做补救。 */
export function isRemoteDraftWire(value: unknown): RemoteDraftWire | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.title !== 'string' || v.title.trim().length === 0) return null;
  if (typeof v.content !== 'string') return null;
  if (v.type !== 'note' && v.type !== 'task' && v.type !== 'event') return null;
  if (v.start !== null && isRemoteDateTimeField(v.start) === false) return null;
  if (v.end !== null && isRemoteDateTimeField(v.end) === false) return null;
  if (typeof v.allDay !== 'boolean') return null;
  if (
    v.categoryId !== null &&
    v.categoryId !== 'work' &&
    v.categoryId !== 'personal' &&
    v.categoryId !== 'study' &&
    v.categoryId !== 'health' &&
    v.categoryId !== 'other'
  ) {
    return null;
  }
  if (Array.isArray(v.tags) === false || v.tags.some((t) => typeof t !== 'string')) return null;
  if (
    v.priority !== null &&
    (typeof v.priority !== 'number' ||
      Number.isInteger(v.priority) === false ||
      v.priority < 0 ||
      v.priority > 3)
  ) {
    return null;
  }
  const recurrence = isRecurrenceRule(v.recurrence);
  if (v.recurrence !== null && recurrence === null) return null;
  if (
    v.reminderOffsetMinutes !== null &&
    (typeof v.reminderOffsetMinutes !== 'number' ||
      Number.isInteger(v.reminderOffsetMinutes) === false ||
      v.reminderOffsetMinutes < 1)
  ) {
    return null;
  }
  // 切片 19（§7.30 / ai.md v0.17）：reminderDelayMinutes 同 offset 纪律——
  // 键必填（缺失时 undefined 走非法分支 → 整体拒绝，旧版响应按既有降级路径回退 fallback），
  // 值须为 ≥1 的整数或 null。上限 Number.MAX_SAFE_INTEGER 同 guard.ts。
  if (
    v.reminderDelayMinutes !== null &&
    (typeof v.reminderDelayMinutes !== 'number' ||
      Number.isInteger(v.reminderDelayMinutes) === false ||
      v.reminderDelayMinutes < 1 ||
      v.reminderDelayMinutes > Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }
  // 切片 23（§7.35 / ai.md v0.19）：澄清与渠道推荐三字段——键可缺省/null（建议性
  // 信息不炸整体解析，对 v0.16「缺键整体拒绝」的刻意偏离，理由见 ai.md v0.19），
  // 值出现即从严：boolean / string / 非空合法渠道数组（元素 ∈ REMINDER_CHANNELS
  // 且 expo 家族互斥）。校验复用 guard.isReminderChannelArray，与本地守卫同源。
  const needsClarification = v.needsClarification;
  if (
    needsClarification !== undefined &&
    needsClarification !== null &&
    typeof needsClarification !== 'boolean'
  ) {
    return null;
  }
  const clarificationPrompt = v.clarificationPrompt;
  if (
    clarificationPrompt !== undefined &&
    clarificationPrompt !== null &&
    typeof clarificationPrompt !== 'string'
  ) {
    return null;
  }
  let reminderChannels: ReminderChannel[] | undefined;
  const reminderChannelsRaw = v.reminderChannels;
  if (reminderChannelsRaw !== undefined && reminderChannelsRaw !== null) {
    if (!isReminderChannelArray(reminderChannelsRaw)) return null;
    reminderChannels = [...reminderChannelsRaw];
  }
  return {
    title: v.title,
    content: v.content,
    type: v.type,
    start: v.start as RemoteDateTimeField | null,
    end: v.end as RemoteDateTimeField | null,
    allDay: v.allDay,
    categoryId: v.categoryId as RemoteDraftWire['categoryId'],
    tags: v.tags as string[],
    priority: v.priority as RemoteDraftWire['priority'],
    recurrence: recurrence,
    reminderOffsetMinutes: v.reminderOffsetMinutes as RemoteDraftWire['reminderOffsetMinutes'],
    reminderDelayMinutes: v.reminderDelayMinutes as RemoteDraftWire['reminderDelayMinutes'],
    needsClarification: needsClarification === null ? undefined : needsClarification,
    clarificationPrompt: clarificationPrompt === null ? undefined : clarificationPrompt,
    reminderChannels,
  };
}

function resolveDateTimeField(field: RemoteDateTimeField, tzid: string): number | null {
  const m = WIRE_DATE_RE.exec(field.date);
  if (m === null) return null;
  const year = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const day = Number.parseInt(m[3], 10);
  let hour = 0;
  let minute = 0;
  if (field.time !== null) {
    const t = WIRE_TIME_RE.exec(field.time);
    if (t === null) return null;
    hour = Number.parseInt(t[1], 10);
    minute = Number.parseInt(t[2], 10);
  }
  // DST gap 返回 null（与 LocalFallbackProvider 语义一致：该时刻不存在 → 未设时间）。
  return resolveCivilTimeToInstant(tzid, year, month, day, hour, minute);
}

/** 民用 wire → 领域草稿（epoch 本地换算）。start 缺失时 end 一并丢弃（无起点不成区间）。 */
export function wireToParsedItemDraft(
  wire: RemoteDraftWire,
  context: AiParseContext,
): ParsedItemDraft {
  const startAt = wire.start === null ? null : resolveDateTimeField(wire.start, context.tzid);
  const endAt =
    wire.start === null || wire.end === null ? null : resolveDateTimeField(wire.end, context.tzid);
  const allDay = wire.start !== null && (wire.start.time === null || wire.allDay);
  const recurrence = wire.recurrence;
  let recurrenceCopy: RecurrenceRule | null = null;
  if (recurrence !== null) {
    const localTime = { ...recurrence.localTime };
    if (recurrence.frequency === 'daily') {
      recurrenceCopy = { frequency: 'daily', localTime };
    } else if (recurrence.frequency === 'weekly') {
      recurrenceCopy = { frequency: 'weekly', weekdays: [...recurrence.weekdays], localTime };
    } else {
      recurrenceCopy = { frequency: 'monthly', dayOfMonth: recurrence.dayOfMonth, localTime };
    }
  }
  return {
    title: wire.title,
    content: wire.content,
    type: wire.type,
    startAt,
    endAt,
    allDay,
    categoryId: wire.categoryId,
    tags: [...wire.tags],
    priority: wire.priority,
    recurrence: recurrenceCopy,
    reminderOffsetMinutes: wire.reminderOffsetMinutes,
    reminderDelayMinutes: wire.reminderDelayMinutes,
    // 切片 23（ai.md v0.19）：澄清/渠道字段映射——needsClarification 仅 true 落值
    //（false 与 undefined 等价，统一归一为 undefined，信号不粘滞）；空反问文本视同
    // 未澄清；渠道数组防御拷贝，缺省/null 归一为 undefined（普通提醒落库走默认渠道）。
    needsClarification: wire.needsClarification === true ? true : undefined,
    clarificationPrompt:
      wire.clarificationPrompt !== undefined &&
      wire.clarificationPrompt !== null &&
      wire.clarificationPrompt.length > 0
        ? wire.clarificationPrompt
        : undefined,
    reminderChannels:
      wire.reminderChannels !== undefined && wire.reminderChannels !== null
        ? [...wire.reminderChannels]
        : undefined,
  };
}

export class OpenAICompatibleProvider implements AiParser {
  private readonly config: OpenAiCompatibleConfig;
  private readonly fetchImpl: FetchLike;
  /**
   * 切片 26（§7.38 D1）：usage 副通道存值——初始 null；parse() 进入即清空，
   * 成功路径返回前才赋值，任何抛错点保持 null（不残留上一轮数值）。
   */
  private lastUsageSnapshot: AiUsageSnapshot | null = null;

  constructor(config: OpenAiCompatibleConfig, fetchImpl: FetchLike = fetch) {
    if (
      config.baseUrl.trim().length === 0 ||
      config.apiKey.trim().length === 0 ||
      config.model.trim().length === 0
    ) {
      throw new Error('OpenAICompatibleProvider: baseUrl / apiKey / model 均不能为空');
    }
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  /** 切片 26（§7.38）：usage 副通道只读暴露；chat.ts 经 FlashTurnResult 携带到 hook。 */
  get lastUsage(): AiUsageSnapshot | null {
    return this.lastUsageSnapshot;
  }

  /**
   * 阶段 2：测试连接。发最小 chat completion（max_tokens=1）验证 baseUrl /
   * Key / model 三要素；任何失败都返回可展示原因（401/403 → 认证失败提示）。
   */
  async testConnection(): Promise<TestConnectionResult> {
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
            stream: false,
          }),
          signal: controller.signal,
        });
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          return { ok: false, reason: `连接超时（${timeoutMs}ms）` };
        }
        return {
          ok: false,
          reason: `网络错误：${e instanceof Error ? e.message : String(e)}`,
        };
      }
      const latencyMs = Date.now() - startedAt;
      if (response.status === 401 || response.status === 403) {
        return { ok: false, reason: `认证失败（HTTP ${response.status}，请检查 API Key）` };
      }
      if (!response.ok) {
        return { ok: false, reason: `服务返回 HTTP ${response.status}` };
      }
      return { ok: true, latencyMs };
    } finally {
      clearTimeout(timer);
    }
  }

  async parse(input: string, context: AiParseContext): Promise<ParsedItemDraft> {
    // 切片 26（§7.38）：进入即清空上轮用量；本轮成功路径返回前才赋值，
    // 任何抛错点（AiParseError 等）lastUsage 保持 null。
    this.lastUsageSnapshot = null;
    if (input.trim().length === 0) {
      throw new AiParseError('empty-input', 'AI 解析输入为空');
    }
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // 切片 23 阶段 2：history 里最近一张草稿以民用时间摘要注入 system 消息
    //（buildHistoryBriefing 本地换算 epoch），“改成/改为”编辑以此为准；
    // 无草稿（history 为空或只有 note）时不拼接，单轮行为不变。
    const briefing = buildHistoryBriefing(context.history, context.tzid);
    const systemContent =
      briefing === null
        ? `${AI_SYSTEM_PROMPT}\n\n${buildNowFacts(context)}`
        : `${AI_SYSTEM_PROMPT}\n\n${buildNowFacts(context)}\n\n${briefing}`;
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemContent },
      ...context.history.map((h: ChatMessage) => ({ role: h.role, content: h.text })),
      { role: 'user', content: input },
    ];

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            model: this.config.model,
            messages,
            temperature: 0,
            stream: false,
          }),
          signal: controller.signal,
        });
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          throw new AiParseError('timeout', `AI 请求超时（${timeoutMs}ms）`);
        }
        throw new AiParseError(
          'network',
          `AI 请求失败：${e instanceof Error ? e.message : String(e)}`,
        );
      }

      if (!response.ok) {
        throw new AiParseError('http-status', `AI 服务返回 HTTP ${response.status}`, response.status);
      }

      const bodyText = await response.text();
      let envelope: unknown;
      try {
        envelope = JSON.parse(bodyText);
      } catch {
        throw new AiParseError('invalid-json', 'AI 响应体不是合法 JSON（已拦截，不做补救）');
      }

      // 切片 26（§7.38）：usage 副通道提取——defensive 读取，形状偏差一律
      // null（不炸解析主链）；单价取 config 两字段均为正数才参与估算
      //（全价上界，不区分缓存折扣，ai.md v0.20）。
      const usageSnapshot = readAiUsageSnapshot(envelope, {
        input: positivePriceOrNull(this.config.priceInputPerMillion),
        output: positivePriceOrNull(this.config.priceOutputPerMillion),
      });

      const content = extractContent(envelope);
      const candidateText = stripCodeFence(content);
      let candidate: unknown;
      try {
        candidate = JSON.parse(candidateText);
      } catch {
        throw new AiParseError('invalid-json', 'AI 返回内容不是合法 JSON（已拦截，不做补救）');
      }

      const wire = isRemoteDraftWire(candidate);
      if (wire === null) {
        throw new AiParseError('schema-mismatch', 'AI 返回 JSON 未通过 isRemoteDraftWire 校验（已拦截）');
      }
      const draft = wireToParsedItemDraft(wire, context);
      // 切片 26（§7.38）：成功路径返回前赋值（两个 return 点都在其后——
      // recurrence 分支与普通分支观察等价）。
      this.lastUsageSnapshot = usageSnapshot;
      // 重复项的下一次发生完全由 (rule, now, tzid) 决定，模型给的时刻不携带
      // 额外信息——一律本地确定性重算，与 LocalFallbackProvider 语义对齐。
      if (draft.recurrence !== null) {
        const parts = getZonedParts(context.now, context.tzid);
        const today = { year: parts.year, month: parts.month, day: parts.day };
        const local = nextOccurrenceInstant(draft.recurrence, context.now, context.tzid, today);
        if (local !== null) {
          return { ...draft, startAt: local };
        }
      }
      return draft;
    } finally {
      clearTimeout(timer);
    }
  }
}
