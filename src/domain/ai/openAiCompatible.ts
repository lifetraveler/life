/**
 * 切片 15 阶段 1：OpenAI 兼容 Provider（OpenAI / DeepSeek 等自定义 API Key）。
 *
 * 职责（§7.24）：调用 /chat/completions，取 choices[0].message.content，
 * 剥离可能的 ```json 围栏后 JSON.parse，经 isParsedItemDraft 严格校验。
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
import { isParsedItemDraft } from './guard';
import { AI_SYSTEM_PROMPT, buildNowFacts } from './prompt';
import type { AiParseContext, AiParser, ChatMessage, ParsedItemDraft } from './types';

export interface OpenAiCompatibleConfig {
  /** 例如 https://api.openai.com/v1 或 https://api.deepseek.com/v1（自动去掉末尾斜杠） */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 请求超时毫秒数；缺省 20000 */
  timeoutMs?: number;
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

export class OpenAICompatibleProvider implements AiParser {
  private readonly config: OpenAiCompatibleConfig;
  private readonly fetchImpl: FetchLike;

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
    if (input.trim().length === 0) {
      throw new AiParseError('empty-input', 'AI 解析输入为空');
    }
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: `${AI_SYSTEM_PROMPT}\n\n${buildNowFacts(context)}` },
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

      const content = extractContent(envelope);
      const candidateText = stripCodeFence(content);
      let candidate: unknown;
      try {
        candidate = JSON.parse(candidateText);
      } catch {
        throw new AiParseError('invalid-json', 'AI 返回内容不是合法 JSON（已拦截，不做补救）');
      }

      const draft = isParsedItemDraft(candidate);
      if (draft === null) {
        throw new AiParseError('schema-mismatch', 'AI 返回 JSON 未通过 isParsedItemDraft 校验（已拦截）');
      }
      return draft;
    } finally {
      clearTimeout(timer);
    }
  }
}
