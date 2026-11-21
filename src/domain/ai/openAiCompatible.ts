/**
 * 切片 15 阶段 1：OpenAI 兼容 Provider（OpenAI / DeepSeek 等自定义 API Key）。
 *
 * 职责（§7.24）：调用 /chat/completions，取 choices[0].message.content，
 * 剥离可能的 ```json 围栏、尾部平衡 JSON 提取（切片 33 / ai.md v0.24：思维链
 * 散文拼 content 时取最靠后配平块）后 JSON.parse，经 isRemoteDraftWire 严格
 * 校验，再由 wireToParsedItemDraft 本地换算为 ParsedItemDraft（Unix 毫秒时间戳）。
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
 * - content 不是合法 JSON（剥围栏 + 尾部平衡提取后仍失败）→ invalid-json；
 * - content JSON 未通过结构守卫 → schema-mismatch；
 * - fetch 抛 AbortError（超时）→ timeout；其他 fetch 异常 → network。
 *
 * 安全：错误消息绝不包含 apiKey；Authorization 头只出现在请求里。
 * 可注入 fetchImpl 便于单测；默认全局 fetch（RN/Hermes 与 Jest 均可用）。
 */

import { AiParseError } from './errors';
import type { AiParseErrorKind } from './errors';
import { isRecurrenceRule, isReminderChannelArray } from './guard';
import { nextOccurrenceInstant } from './localFallback';
import { AI_SYSTEM_PROMPT, buildHistoryBriefing, buildNowFacts } from './prompt';
import { positivePriceOrNull, readAiUsageSnapshot, readAiUsageSnapshotTiered } from './usage';
import { parseAiRetryMax } from '../settings';
import type { AiUsageSnapshot } from './usage';
import type { AiPlatform } from './configStore';
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
   * platform === 'deepseek' 时改用下方峰谷分层六价（阶段 2b / v0.21）。
   */
  priceInputPerMillion?: number;
  priceOutputPerMillion?: number;
  /** 平台标识（阶段 2b / v0.21）；缺省/undefined 等价 custom（走全价上界路径）。 */
  platform?: AiPlatform;
  /**
   * DeepSeek 峰谷分层单价（元/百万 tokens，可选；正数才有效）——
   * 缓存命中/缓存未命中/输出 × 高峰/空闲 六档；仅 platform === 'deepseek'
   * 时参与估算，非正数丢弃（守卫已在 configStore 层做，这里只取数）。
   */
  priceCachedPeak?: number;
  priceCachedOffPeak?: number;
  priceUncachedPeak?: number;
  priceUncachedOffPeak?: number;
  priceOutputPeak?: number;
  priceOutputOffPeak?: number;
  /**
   * 切片 30（§7.41）：自动重试次数上限（0–5 整数；0=关闭即现状，缺省/越界
   * 回退 DEFAULT_AI_RETRY_MAX=3，经 parseAiRetryMax 归一）。可重试=网络错误/
   * 超时/5xx/429/响应 JSON 解析失败；不可重试（401/403/400/schema-mismatch 等）
   * 立即抛出走降级。固定间隔 RETRY_DELAY_MS，不做指数退避。
   */
  retryMax?: number;
  /**
   * 切片 30（§7.41）：每次实际发起重试前的回调（attempt 第 n 次重试 / maxRetries
   * 上限 / kind 本轮失败类别）——UI 层借它即时展示「正在重试」提示（不进聊天历史）。
   * 成功/耗尽/不可重试都不回调。
   */
  onRetry?: (attempt: number, maxRetries: number, kind: AiParseErrorKind) => void;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** 切片 30（§7.41）：重试固定间隔毫秒数（不做指数退避）。 */
const RETRY_DELAY_MS = 1_000;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
/** 重试等待注入点（测试传即时 resolve）；默认 setTimeout 真等。 */
type DelayLike = (ms: number) => Promise<void>;

const defaultDelay: DelayLike = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 切片 30（§7.41）：可重试判定——网络错误/超时/响应 JSON 解析失败恒可重试；
 * http-status 仅 5xx 与 429 可重试（401/403/400 等其余状态立即抛出走降级）；
 * schema-mismatch / empty-input 为确定性失败，重试同 prompt 无意义，不重试。
 */
function isRetryableParseError(error: AiParseError): boolean {
  if (error.kind === 'network' || error.kind === 'timeout' || error.kind === 'invalid-json') {
    return true;
  }
  if (error.kind === 'http-status') {
    return error.status !== null && (error.status >= 500 || error.status === 429);
  }
  return false;
}

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

/**
 * 从 text[end]（必须是 '}'）向前扫描配平对象块：遇 '}'/']' 压栈期望的开括号，
 * 遇 '{'/'[' 弹栈配平（字符串字面量感知——字面量内的大括号与引号不参与配平，
 * `\"` 转义引号不是字符串边界）；栈空时的 '{' 即块起点。返回块子串（含两端
 * 括号）。以下情形返回 null（上层换锚点重试或放弃）：括号错配、栈空时先遇
 * '['（数组根，非对象块）、扫到串首仍未配平。
 */
function scanBalancedObjectBackward(text: string, end: number): string | null {
  const stack: Array<'{' | '['> = ['{'];
  let inString = false;
  for (let i = end - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if (ch === '"') {
      // 引号是否为字符串边界：紧邻其前的连续反斜杠为偶数（含 0）才是边界
      // （奇数 = \" 转义引号，JSON 语义上不结束/不开始字符串）。
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && text[j] === '\\'; j -= 1) backslashes += 1;
      if (backslashes % 2 === 0) inString = !inString;
      continue;
    }
    if (inString) continue; // 字符串字面量内的大括号不参与配平
    if (ch === '}') {
      stack.push('{');
      continue;
    }
    if (ch === ']') {
      stack.push('[');
      continue;
    }
    if (ch === '{') {
      if (stack[stack.length - 1] !== '{') return null;
      stack.pop();
      if (stack.length === 0) return text.slice(i, end + 1);
      continue;
    }
    if (ch === '[') {
      if (stack[stack.length - 1] !== '[') return null;
      stack.pop();
      continue;
    }
  }
  return null; // 扫到串首仍未配平（锚点 '}' 无对应开括号）
}

/**
 * 切片 33（§7.45 / ai.md v0.24）：尾部平衡 JSON 提取——从字符串末尾向前扫描，
 * 返回最靠后的配平 `{...}` 块。
 *
 * 背景：deepseek-flash 等推理模型把思维链（纯散文、无 <think> 标签）直接拼进
 * content，`JSON.parse(散文+JSON)` 必然失败 → schema-mismatch 降级（L8 主因）。
 * 从尾部向前扫描保证取到最终输出块；思维链中推演/引用的 JSON 片段（含
 * `{\"date\"...}` 转义形式）位于最终块之前、不会被误取——字符串字面量内的大
 * 括号不参与配平。
 *
 * 行为：
 * - 无任何 '}'（或所有锚点扫描失败）→ 返回原文，走既有 JSON.parse 失败路径，
 *   行为与不提取时一致；
 * - 输入是纯 JSON → 最靠后配平块即整个字符串，零回归；
 * - 提取结果仍要过 isRemoteDraftWire 严格守卫——误取的形状不符片段会正常
 *   降级，不比现状差。
 */
export function extractLastBalancedJson(text: string): string {
  // 锚点：最后一个 '}'（目标块必为对象 {…}——wire 根恒为对象；数组根不返回）。
  for (
    let end = text.lastIndexOf('}');
    end !== -1;
    end = text.lastIndexOf('}', end - 1)
  ) {
    const block = scanBalancedObjectBackward(text, end);
    if (block !== null) return block;
  }
  return text;
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
   * 绝对时刻提醒（切片 32 / §7.44 / ai.md v0.23）：用户指定「在某绝对民用时刻
   * 提醒我」（如「明天8点、10点提醒我吃药」）时逐条列出触发时刻；time 必须非
   * null（提醒必带具体时刻，与 start/end 的全天语义不同）。null/缺省/空数组=
   * 未表达（键缺省宽容，旧响应兼容）。与 start 语义独立、可同现；epoch 换算
   * 在 provider 本地完成（v0.16 纪律）。
   */
  reminders?: RemoteDateTimeField[] | null;
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
  /**
   * 已保存条目对话式编辑的编辑基线（切片 34 / ai.md v0.25）：上一张卡片摘要块
   * 带「关联条目 id」且本轮是对该已保存条目的修改时，原样回填该 id；全新事项
   * 一律填 null。null/缺省=未表达（键缺省宽容，reminders v0.23 同构）；非空串
   * 才会被草稿层保留为 targetItemId。存在性校验不在 wire 层（落库层做）。
   */
  targetItemId?: string | null;
}

const WIRE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WIRE_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** 切片 32（§7.44 / ai.md v0.23）：reminders 数组条数上限（prompt 同步约束）。 */
const WIRE_REMINDERS_MAX = 8;

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
  // 切片 34（§7.46 / ai.md v0.25）：编辑基线 targetItemId——键可缺省/null（宽容，
  // reminders v0.23 同构），值出现即从严：非 string 或空串（trim 后为空）整体
  // 拒绝；null 归一为 undefined（未表达）。仅作落库路由信号，不校验条目存在性
  //（落库层 getItemById 校验）。
  const targetItemId = v.targetItemId;
  if (
    targetItemId !== undefined &&
    targetItemId !== null &&
    (typeof targetItemId !== 'string' || targetItemId.length === 0)
  ) {
    return null;
  }
  let reminderChannels: ReminderChannel[] | undefined;
  const reminderChannelsRaw = v.reminderChannels;
  if (reminderChannelsRaw !== undefined && reminderChannelsRaw !== null) {
    if (!isReminderChannelArray(reminderChannelsRaw)) return null;
    reminderChannels = [...reminderChannelsRaw];
  }
  // 切片 32（§7.44 / ai.md v0.23）：绝对时刻提醒数组——键可缺省/null/空数组
  //（旧版响应向前兼容、空数组语义等价未表达，宽容不炸整体），值出现即从严：
  // 每条 date 合法且 time 必须非 null（提醒必带具体时刻），元素形状偏差或
  // 超过 WIRE_REMINDERS_MAX 条整体拒绝（落库面纪律：静默丢弃比报错危险）。
  let reminders: RemoteDateTimeField[] | undefined;
  const remindersRaw = v.reminders;
  if (remindersRaw !== undefined && remindersRaw !== null) {
    if (Array.isArray(remindersRaw) === false || remindersRaw.length > WIRE_REMINDERS_MAX) {
      return null;
    }
    const entriesInvalid = remindersRaw.some(
      (entry) =>
        isRemoteDateTimeField(entry) === false ||
        (entry as RemoteDateTimeField).time === null,
    );
    if (entriesInvalid) return null;
    reminders = remindersRaw as RemoteDateTimeField[];
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
    reminders,
    needsClarification: needsClarification === null ? undefined : needsClarification,
    clarificationPrompt: clarificationPrompt === null ? undefined : clarificationPrompt,
    targetItemId: targetItemId === null ? undefined : targetItemId,
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
  // 切片 32（§7.44 / ai.md v0.23）：绝对时刻提醒——每条民用条目本地换算 epoch
  //（v0.16 纪律，禁止交给模型）；DST gap（resolve 返回 null）该时刻不存在 →
  // 丢弃该条、不炸整体；升序排序 + 同 epoch 去重；空结果归一为 undefined
  //（未表达，落库面跳过）。
  let reminders: number[] | undefined;
  if (wire.reminders !== undefined && wire.reminders !== null && wire.reminders.length > 0) {
    const epochs: number[] = [];
    for (const entry of wire.reminders) {
      const instant = resolveDateTimeField(entry, context.tzid);
      if (instant !== null) {
        epochs.push(instant);
      }
    }
    if (epochs.length > 0) {
      reminders = [...new Set(epochs)].sort((a, b) => a - b);
    }
  }
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
    reminders,
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
    // 切片 34（ai.md v0.25）：编辑基线归一透传——wire 守卫已把 null 归一为
    // undefined，这里恒定透传（空串在守卫层整体拒绝，不可能到达）。
    targetItemId:
      wire.targetItemId !== undefined && wire.targetItemId !== null && wire.targetItemId.length > 0
        ? wire.targetItemId
        : undefined,
    reminderChannels:
      wire.reminderChannels !== undefined && wire.reminderChannels !== null
        ? [...wire.reminderChannels]
        : undefined,
  };
}

/**
 * 切片 32（§7.44 / ai.md v0.23）：调试副通道载荷——请求体/响应体文本快照。
 * 与 lastUsage 同款传输纪律：provider 实例副通道暴露、经 FlashTurnResult 域内
 * 字段携带到 hook，不进入 ParsedItemDraft、不进入 history JSON、不触碰
 * RemoteDraftWire/isRemoteDraftWire。request=发往 chat/completions 的请求体
 * JSON 文本（不含请求头——Authorization 不进任何调试载荷）；response=HTTP
 * 响应体原文（HTTP 非 ok 也记录；网络层抛错/超时为 null）。每轮尝试覆盖
 *（重试取最后一次），成功失败均可查看。
 */
export interface AiTurnDebugSnapshot {
  request: string | null;
  response: string | null;
}

export class OpenAICompatibleProvider implements AiParser {
  private readonly config: OpenAiCompatibleConfig;
  private readonly fetchImpl: FetchLike;
  /** 峰谷分层判峰用时钟（阶段 2b；默认 Date.now，测试注入冻结时刻）。 */
  private readonly nowImpl: () => number;
  /** 切片 30（§7.41）：重试间隔等待注入点（测试传即时 resolve 免真等 1s）。 */
  private readonly delayImpl: DelayLike;
  /**
   * 切片 26（§7.38 D1）：usage 副通道存值——初始 null；parse() 进入即清空，
   * 成功路径返回前才赋值，任何抛错点保持 null（不残留上一轮数值）。
   */
  private lastUsageSnapshot: AiUsageSnapshot | null = null;
  /**
   * 切片 32（§7.44）：调试副通道存值——初始 null；parse() 进入即清空（与
   * lastUsage 同款），requestParse 每轮尝试写入（重试覆盖、成功失败均保留）。
   * 失败轮正是 F1 类缺陷排查主场景，因此与 usage「只报成功轮」刻意不同。
   */
  private lastRequestBody: string | null = null;
  private lastResponseBody: string | null = null;

  constructor(
    config: OpenAiCompatibleConfig,
    fetchImpl: FetchLike = fetch,
    now: () => number = Date.now,
    delay: DelayLike = defaultDelay,
  ) {
    if (
      config.baseUrl.trim().length === 0 ||
      config.apiKey.trim().length === 0 ||
      config.model.trim().length === 0
    ) {
      throw new Error('OpenAICompatibleProvider: baseUrl / apiKey / model 均不能为空');
    }
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.nowImpl = now;
    this.delayImpl = delay;
  }

  /** 切片 26（§7.38）：usage 副通道只读暴露；chat.ts 经 FlashTurnResult 携带到 hook。 */
  get lastUsage(): AiUsageSnapshot | null {
    return this.lastUsageSnapshot;
  }

  /** 切片 32（§7.44）：调试副通道只读暴露；chat.ts 经 FlashTurnResult.debug 携带到 hook。 */
  get lastDebug(): AiTurnDebugSnapshot {
    return { request: this.lastRequestBody, response: this.lastResponseBody };
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
    // 任何抛错点（AiParseError 等）lastUsage 保持 null。重试期间亦保持
    // null——usage 只报成功轮（§7.41）。
    this.lastUsageSnapshot = null;
    // 切片 32（§7.44）：调试副通道同步清空——但与 usage 不同，requestParse
    // 内写入后即使本轮失败也保留（失败轮正是排查主场景），仅跨轮清空。
    this.lastRequestBody = null;
    this.lastResponseBody = null;
    if (input.trim().length === 0) {
      throw new AiParseError('empty-input', 'AI 解析输入为空');
    }

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

    // 切片 30（§7.41）：自动重试循环——maxRetries 来自 retryMax（经
    // parseAiRetryMax 归一：缺省/越界/非整数 → 默认 3；0=关闭即现状）。
    // 可重试错误按固定间隔 RETRY_DELAY_MS 重发（不做指数退避），每次实际
    // 重试前回调 onRetry；耗尽时抛出的错误消息追加「（已重试 N 次）」
    // （仅实际重试过才带计数），供 chat.ts 降级注记透出；不可重试错误
    // （401/403/400/schema-mismatch/empty-input）立即原样抛出。
    const maxRetries = parseAiRetryMax(this.config.retryMax);
    let retriesDone = 0;
    for (;;) {
      try {
        return await this.requestParse(messages, context);
      } catch (e) {
        if (!(e instanceof AiParseError) || !isRetryableParseError(e)) {
          throw e;
        }
        if (retriesDone >= maxRetries) {
          throw retriesDone > 0
            ? new AiParseError(e.kind, `${e.message}（已重试 ${retriesDone} 次）`, e.status)
            : e;
        }
        retriesDone += 1;
        this.config.onRetry?.(retriesDone, maxRetries, e.kind);
        await this.delayImpl(RETRY_DELAY_MS);
      }
    }
  }

  /** 单次尝试（切片 30 重构抽出）：超时 AbortController / fetch / 解析管线。 */
  private async requestParse(
    messages: Array<{ role: string; content: string }>,
    context: AiParseContext,
  ): Promise<ParsedItemDraft> {
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // 切片 32（§7.44）：请求体只构建一次，记录与发送共用同一文本（调试展示
    // 与实际发往服务的字节一致）；请求头不采集（Authorization 不进调试载荷）。
    const requestBodyText = JSON.stringify({
      model: this.config.model,
      messages,
      temperature: 0,
      stream: false,
    });
    this.lastRequestBody = requestBodyText;

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: requestBodyText,
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
        // 切片 32（§7.44）：HTTP 非 ok 也记录响应体原文（错误排查主场景），
        // 错误消息保持只含状态码不变。
        const errorBodyText = await response.text();
        this.lastResponseBody = errorBodyText;
        throw new AiParseError('http-status', `AI 服务返回 HTTP ${response.status}`, response.status);
      }

      const bodyText = await response.text();
      this.lastResponseBody = bodyText;
      let envelope: unknown;
      try {
        envelope = JSON.parse(bodyText);
      } catch {
        throw new AiParseError('invalid-json', 'AI 响应体不是合法 JSON（已拦截，不做补救）');
      }

      // 切片 26（§7.38）：usage 副通道提取——defensive 读取，形状偏差一律
      // null（不炸解析主链）。阶段 2b（v0.21）：platform === 'deepseek' 走
      // 峰谷分层六价估算（isPeakBeijing 判当前时段）；其余平台（含 undefined/
      // custom/无效值）走 v0.20 全价上界两价路径。单价非正数在守卫层已丢弃。
      const usageSnapshot =
        this.config.platform === 'deepseek'
          ? readAiUsageSnapshotTiered(
              envelope,
              {
                cachedPeak: positivePriceOrNull(this.config.priceCachedPeak),
                cachedOffPeak: positivePriceOrNull(this.config.priceCachedOffPeak),
                uncachedPeak: positivePriceOrNull(this.config.priceUncachedPeak),
                uncachedOffPeak: positivePriceOrNull(this.config.priceUncachedOffPeak),
                outputPeak: positivePriceOrNull(this.config.priceOutputPeak),
                outputOffPeak: positivePriceOrNull(this.config.priceOutputOffPeak),
              },
              this.nowImpl(),
            )
          : readAiUsageSnapshot(envelope, {
              input: positivePriceOrNull(this.config.priceInputPerMillion),
              output: positivePriceOrNull(this.config.priceOutputPerMillion),
            });

      const content = extractContent(envelope);
      const candidateText = stripCodeFence(content);
      // 切片 33（§7.45 / ai.md v0.24）：尾部平衡 JSON 提取——思维链散文拼进
      // content 时剥出最终输出块；无配平块原样返回，行为与不提取时一致。
      const balancedText = extractLastBalancedJson(candidateText);
      let candidate: unknown;
      try {
        candidate = JSON.parse(balancedText);
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
