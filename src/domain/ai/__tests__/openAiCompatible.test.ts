/**
 * OpenAICompatibleProvider 测试：注入 fake fetch，验证请求形状与错误分类。
 * 安全断言：任何错误消息都不得包含 apiKey。
 */

import { OpenAICompatibleProvider, stripCodeFence } from '../openAiCompatible';
import { AiParseError } from '../errors';
import type { AiParseContext } from '../types';
import { resolveCivilTimeToInstant } from '../../recurrence/civilTime';

const TZID = 'Asia/Shanghai';
const mustAt = (y: number, m: number, d: number, h: number, min: number): number => {
  const instant = resolveCivilTimeToInstant(TZID, y, m, d, h, min);
  if (instant === null) throw new Error('测试期望时间落进 DST gap，请换基准时间');
  return instant;
};
const NOW = mustAt(2026, 11, 10, 10, 0);
const CONTEXT: AiParseContext = { now: NOW, tzid: TZID, history: [] };
const API_KEY = 'sk-test-secret-key-do-not-leak';

const validDraftJson = JSON.stringify({
  title: '开会',
  content: '',
  type: 'event',
  startAt: NOW + 3600_000,
  endAt: null,
  allDay: false,
  categoryId: 'work',
  tags: [],
  priority: null,
  recurrence: null,
  reminderOffsetMinutes: null,
});

type FetchCall = { url: string; init: RequestInit | undefined };

function makeFetch(
  responder: (url: string, init: RequestInit) => Promise<Response> | Response,
): { fetchImpl: (url: string, init?: RequestInit) => Promise<Response>; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  return {
    calls,
    fetchImpl: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(responder(url, init ?? {}));
    },
  };
}

function okEnvelope(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content } }],
    }),
    { status: 200 },
  );
}

function makeProvider(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider(
    {
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: API_KEY,
      model: 'deepseek-chat',
    },
    fetchImpl,
  );
}

describe('OpenAICompatibleProvider', () => {
  it('构造时 baseUrl/apiKey/model 为空抛普通 Error', () => {
    expect(
      () =>
        new OpenAICompatibleProvider(
          { baseUrl: '', apiKey: 'k', model: 'm' },
          jest.fn(),
        ),
    ).toThrow();
  });

  it('空输入抛 empty-input 且不发起请求', async () => {
    const { fetchImpl } = makeFetch(() => new Response('{}'));
    const provider = makeProvider(fetchImpl);
    await expect(provider.parse('   ', CONTEXT)).rejects.toMatchObject({
      kind: 'empty-input',
    });
  });

  it('发请求带 Authorization Bearer 与正确 URL/model/temperature', async () => {
    const { fetchImpl, calls } = makeFetch(() => okEnvelope(validDraftJson));
    const provider = makeProvider(fetchImpl);
    const draft = await provider.parse('明天下午3点开会', CONTEXT);
    expect(draft.title).toBe('开会');

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe('https://api.deepseek.com/v1/chat/completions');
    const headers = call.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(call.init?.body as string) as {
      model: string;
      temperature: number;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('deepseek-chat');
    expect(body.temperature).toBe(0);
    expect(body.stream).toBe(false);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('2026');
    expect(body.messages[body.messages.length - 1]).toEqual({
      role: 'user',
      content: '明天下午3点开会',
    });
  });

  it('history 作为前置消息发送（user/assistant 顺序保持）', async () => {
    const { fetchImpl, calls } = makeFetch(() => okEnvelope(validDraftJson));
    const provider = makeProvider(fetchImpl);
    await provider.parse('改成明天', {
      now: NOW,
      tzid: TZID,
      history: [
        { role: 'user', text: '提醒我开会' },
        { role: 'assistant', text: '已解析' },
      ],
    });
    const body = JSON.parse(calls[0].init?.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages.slice(1, 3)).toEqual([
      { role: 'user', content: '提醒我开会' },
      { role: 'assistant', content: '已解析' },
    ]);
  });

  it('content 带 ```json 围栏时剥离后仍能解析', async () => {
    const fenced = '```json\n' + validDraftJson + '\n```';
    const { fetchImpl } = makeFetch(() => okEnvelope(fenced));
    const provider = makeProvider(fetchImpl);
    await expect(provider.parse('开会', CONTEXT)).resolves.toMatchObject({
      title: '开会',
    });
  });

  it('HTTP 500 → http-status 错误且 status=500，消息不含 apiKey', async () => {
    const { fetchImpl } = makeFetch(
      () => new Response('server exploded', { status: 500 }),
    );
    const provider = makeProvider(fetchImpl);
    const error = await provider.parse('开会', CONTEXT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiParseError);
    const aiError = error as AiParseError;
    expect(aiError.kind).toBe('http-status');
    expect(aiError.status).toBe(500);
    expect(aiError.message).not.toContain(API_KEY);
  });

  it('响应体不是 JSON → invalid-json', async () => {
    const { fetchImpl } = makeFetch(() => new Response('<html>oops</html>'));
    const provider = makeProvider(fetchImpl);
    await expect(provider.parse('开会', CONTEXT)).rejects.toMatchObject({
      kind: 'invalid-json',
    });
  });

  it('信封缺 choices → schema-mismatch', async () => {
    const { fetchImpl } = makeFetch(
      () => new Response(JSON.stringify({ error: 'no choices' })),
    );
    const provider = makeProvider(fetchImpl);
    await expect(provider.parse('开会', CONTEXT)).rejects.toMatchObject({
      kind: 'schema-mismatch',
    });
  });

  it('content 不是 JSON → invalid-json', async () => {
    const { fetchImpl } = makeFetch(() => okEnvelope('抱歉我不太明白'));
    const provider = makeProvider(fetchImpl);
    await expect(provider.parse('开会', CONTEXT)).rejects.toMatchObject({
      kind: 'invalid-json',
    });
  });

  it('content JSON 未过结构守卫 → schema-mismatch', async () => {
    const bad = JSON.stringify({ title: '开会', startAt: '15' });
    const { fetchImpl } = makeFetch(() => okEnvelope(bad));
    const provider = makeProvider(fetchImpl);
    await expect(provider.parse('开会', CONTEXT)).rejects.toMatchObject({
      kind: 'schema-mismatch',
    });
  });

  it('fetch 网络异常 → network 错误，消息不含 apiKey', async () => {
    const fetchImpl = () => Promise.reject(new TypeError('fetch failed'));
    const provider = makeProvider(fetchImpl);
    const error = await provider.parse('开会', CONTEXT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiParseError);
    expect((error as AiParseError).kind).toBe('network');
    expect((error as AiParseError).message).not.toContain(API_KEY);
  });

  it('AbortError → timeout', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    const fetchImpl = () => Promise.reject(abortError);
    const provider = makeProvider(fetchImpl);
    await expect(provider.parse('开会', CONTEXT)).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('stripCodeFence 剥围栏、无围栏原样返回', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  describe('testConnection（阶段 2）', () => {
    it('200 → ok 且请求体为最小 ping（max_tokens=1）', async () => {
      const { fetchImpl, calls } = makeFetch(() => new Response('{"x":1}', { status: 200 }));
      const provider = makeProvider(fetchImpl);
      const result = await provider.testConnection();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      const init = calls[0]?.init;
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.max_tokens).toBe(1);
      expect(body.model).toBe('deepseek-chat');
    });

    it('401 → ok:false，原因含认证失败且不含 apiKey', async () => {
      const { fetchImpl } = makeFetch(() => new Response('unauthorized', { status: 401 }));
      const provider = makeProvider(fetchImpl);
      const result = await provider.testConnection();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain('认证失败');
        expect(result.reason).not.toContain(API_KEY);
      }
    });

    it('500 → ok:false，原因带 HTTP 状态', async () => {
      const { fetchImpl } = makeFetch(() => new Response('boom', { status: 500 }));
      const provider = makeProvider(fetchImpl);
      const result = await provider.testConnection();
      expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('500') });
    });

    it('AbortError → 连接超时', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      const { fetchImpl } = makeFetch(() => {
        throw abortError;
      });
      const provider = makeProvider(fetchImpl);
      const result = await provider.testConnection();
      expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('超时') });
    });

    it('其他 fetch 异常 → 网络错误', async () => {
      const { fetchImpl } = makeFetch(() => {
        throw new Error('ECONNREFUSED');
      });
      const provider = makeProvider(fetchImpl);
      const result = await provider.testConnection();
      expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('网络错误') });
    });
  });
});
