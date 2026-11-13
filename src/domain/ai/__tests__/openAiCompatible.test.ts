/**
 * OpenAICompatibleProvider 测试：注入 fake fetch，验证请求形状与错误分类。
 * 安全断言：任何错误消息都不得包含 apiKey。
 */

import { OpenAICompatibleProvider, stripCodeFence, isRemoteDraftWire, wireToParsedItemDraft } from '../openAiCompatible';
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

// v0.16：模型输出民用时间 wire，epoch 由 provider 本地换算。
const validWireJson = JSON.stringify({
  title: '开会',
  content: '',
  type: 'event',
  start: { date: '2026-11-11', time: '15:00' },
  end: null,
  allDay: false,
  categoryId: 'work',
  tags: [],
  priority: null,
  recurrence: null,
  reminderOffsetMinutes: null,
  reminderDelayMinutes: null,
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
    const { fetchImpl, calls } = makeFetch(() => okEnvelope(validWireJson));
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
    const { fetchImpl, calls } = makeFetch(() => okEnvelope(validWireJson));
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

  it('recurrence 非空时 startAt 本地重算（模型给的首日被覆盖）', async () => {
    const draftWithRecurrence = JSON.stringify({
      title: '喝水',
      content: '',
      type: 'task',
      start: { date: '2026-11-10', time: '09:00' },
      end: null,
      allDay: false,
      categoryId: 'health',
      tags: ['健康'],
      priority: null,
      recurrence: { frequency: 'daily', localTime: { hour: 9, minute: 0 } },
      reminderOffsetMinutes: null,
      reminderDelayMinutes: null,
    });
    const { fetchImpl } = makeFetch(() => okEnvelope(draftWithRecurrence));
    const provider = makeProvider(fetchImpl);
    const draft = await provider.parse('每天9点喝水', CONTEXT);
    // daily 9:00，NOW=2026-11-10 10:00 → 今天 09:00 已过 → 明天 09:00。
    expect(draft.startAt).toBe(mustAt(2026, 11, 11, 9, 0));
    expect(draft.recurrence).toEqual({
      frequency: 'daily',
      localTime: { hour: 9, minute: 0 },
    });
  });

  it('recurrence 非空且模型 start 为 null 时本地补算', async () => {
    const draftNullStart = JSON.stringify({
      title: '晨会',
      content: '',
      type: 'event',
      start: null,
      end: null,
      allDay: false,
      categoryId: 'work',
      tags: [],
      priority: null,
      recurrence: {
        frequency: 'weekly',
        weekdays: [3],
        localTime: { hour: 8, minute: 0 },
      },
      reminderOffsetMinutes: null,
      reminderDelayMinutes: null,
    });
    const { fetchImpl } = makeFetch(() => okEnvelope(draftNullStart));
    const provider = makeProvider(fetchImpl);
    const draft = await provider.parse('每周三8点晨会', CONTEXT);
    // NOW=2026-11-10 周二 → 下一个周三 = 2026-11-11 08:00。
    expect(draft.startAt).toBe(mustAt(2026, 11, 11, 8, 0));
  });

  it('民用时间本地换算：start 15:00 → 次日 15:00 的毫秒时间戳', async () => {
    const { fetchImpl } = makeFetch(() => okEnvelope(validWireJson));
    const provider = makeProvider(fetchImpl);
    const draft = await provider.parse('明天下午3点开会', CONTEXT);
    expect(draft.startAt).toBe(mustAt(2026, 11, 11, 15, 0));
    expect(draft.allDay).toBe(false);
    expect(draft.endAt).toBeNull();
  });

  it('content 带 ```json 围栏时剥离后仍能解析', async () => {
    const fenced = '```json\n' + validWireJson + '\n```';
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
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
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

describe('isRemoteDraftWire / wireToParsedItemDraft（v0.16 民用 wire）', () => {
  const validWire: Record<string, unknown> = {
    title: '开会',
    content: '',
    type: 'event',
    start: { date: '2026-11-11', time: '15:00' },
    end: { date: '2026-11-11', time: '16:00' },
    allDay: false,
    categoryId: 'work',
    tags: ['工作'],
    priority: 2,
    recurrence: null,
    reminderOffsetMinutes: 10,
    reminderDelayMinutes: null,
  };
  const patchWire = (patch: Record<string, unknown>): unknown => ({ ...validWire, ...patch });

  it('合法 wire 通过守卫并整体换算（含 end）', () => {
    const wire = isRemoteDraftWire(validWire);
    expect(wire).not.toBeNull();
    const draft = wireToParsedItemDraft(wire as NonNullable<typeof wire>, CONTEXT);
    expect(draft.startAt).toBe(mustAt(2026, 11, 11, 15, 0));
    expect(draft.endAt).toBe(mustAt(2026, 11, 11, 16, 0));
    expect(draft.allDay).toBe(false);
    expect(draft.tags).toEqual(['工作']);
  });

  it('非法形状整体拒绝：不存在的日历日 / 非法时刻 / 空标题 / 越界优先级', () => {
    const bad = (patch: Record<string, unknown>): unknown => ({ ...validWire, ...patch });
    expect(isRemoteDraftWire(bad({ start: { date: '2026-02-30', time: '15:00' } }))).toBeNull();
    expect(isRemoteDraftWire(bad({ start: { date: '2026-13-01', time: '15:00' } }))).toBeNull();
    expect(isRemoteDraftWire(bad({ start: { date: '2026-11-11', time: '25:00' } }))).toBeNull();
    expect(isRemoteDraftWire(bad({ title: '  ' }))).toBeNull();
    expect(isRemoteDraftWire(bad({ priority: 4 }))).toBeNull();
    expect(isRemoteDraftWire(bad({ start: { date: '11/12/2026', time: null } }))).toBeNull();
    expect(isRemoteDraftWire(bad({ recurrence: { frequency: 'hourly' } }))).toBeNull();
  });

  it('time null → 全天 00:00；start 显式 null → startAt null 且 end 一并丢弃；start 键缺失整体拒绝', () => {
    const allDayWire = isRemoteDraftWire(
      patchWire({ start: { date: '2026-11-11', time: null }, allDay: true, end: null }),
    );
    expect(allDayWire).not.toBeNull();
    const allDayDraft = wireToParsedItemDraft(allDayWire as NonNullable<typeof allDayWire>, CONTEXT);
    expect(allDayDraft.allDay).toBe(true);
    expect(allDayDraft.startAt).toBe(mustAt(2026, 11, 11, 0, 0));

    const noTimeWire = isRemoteDraftWire(patchWire({ start: null, end: null }));
    expect(noTimeWire).not.toBeNull();
    const noTimeDraft = wireToParsedItemDraft(noTimeWire as NonNullable<typeof noTimeWire>, CONTEXT);
    expect(noTimeDraft.startAt).toBeNull();
    expect(noTimeDraft.endAt).toBeNull();
    expect(noTimeDraft.allDay).toBe(false);

    // start 键缺失（undefined）属于形状不完整：整体拒绝，不做补救。
    const { start: _s, end: _e, ...noTimeBase } = validWire;
    expect(isRemoteDraftWire(noTimeBase)).toBeNull();
  });

  it('DST gap 时刻换算为 null（America/New_York 2026-03-08 02:30）', () => {
    const nyNow = resolveCivilTimeToInstant('America/New_York', 2026, 3, 9, 12, 0);
    if (nyNow === null) throw new Error('NY 基准时间不应为 null');
    const nyContext: AiParseContext = { now: nyNow, tzid: 'America/New_York', history: [] };
    const wire = isRemoteDraftWire(
      patchWire({ start: { date: '2026-03-08', time: '02:30' }, end: null }),
    );
    expect(wire).not.toBeNull();
    const draft = wireToParsedItemDraft(wire as NonNullable<typeof wire>, nyContext);
    expect(draft.startAt).toBeNull();
  });

  it('tags 复制不共享引用', () => {
    const wire = isRemoteDraftWire(validWire) as NonNullable<ReturnType<typeof isRemoteDraftWire>>;
    const draft = wireToParsedItemDraft(wire, CONTEXT);
    draft.tags.push('改动');
    expect(wire.tags).toEqual(['工作']);
  });

  it('reminderDelayMinutes 透传：与 offset 语义独立，可同现分别填写（切片 19 §7.30）', () => {
    const wire = isRemoteDraftWire(patchWire({ reminderDelayMinutes: 30 }));
    expect(wire).not.toBeNull();
    const draft = wireToParsedItemDraft(wire as NonNullable<typeof wire>, CONTEXT);
    expect(draft.reminderDelayMinutes).toBe(30);
    expect(draft.reminderOffsetMinutes).toBe(10); // offset 原样保留，互不覆盖
  });

  it('reminderDelayMinutes 非法值整体拒绝：0 / 2.5 / 非数字；键缺失拒绝', () => {
    expect(isRemoteDraftWire(patchWire({ reminderDelayMinutes: 0 }))).toBeNull();
    expect(isRemoteDraftWire(patchWire({ reminderDelayMinutes: 2.5 }))).toBeNull();
    expect(isRemoteDraftWire(patchWire({ reminderDelayMinutes: '30' }))).toBeNull();
    const { reminderDelayMinutes: _d, ...noDelay } = validWire;
    expect(isRemoteDraftWire(noDelay)).toBeNull();
  });
});
