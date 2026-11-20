/**
 * OpenAICompatibleProvider 测试：注入 fake fetch，验证请求形状与错误分类。
 * 安全断言：任何错误消息都不得包含 apiKey。
 */

import { OpenAICompatibleProvider, stripCodeFence, extractLastBalancedJson, isRemoteDraftWire, wireToParsedItemDraft } from '../openAiCompatible';
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

  it('切片 33 端到端：思维链散文拼进 content → 尾部提取后解析成功（根因 A）', async () => {
    // deepseek-flash 真机形态：纯散文推理 + 推演中带残缺 JSON + 末尾完整 wire。
    const cot =
      '用户想在明天提醒。我先推演一下格式：{\\"date\\":\\"2026-11-11\\"} 这样对吗？' +
      '再想想 end 怎么填。最终输出：\n' +
      validWireJson;
    const { fetchImpl } = makeFetch(() => okEnvelope(cot));
    const provider = makeProvider(fetchImpl);
    const draft = await provider.parse('明天下午3点开会', CONTEXT);
    expect(draft.title).toBe('开会');
    expect(draft.startAt).toBe(mustAt(2026, 11, 11, 15, 0));
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

describe('extractLastBalancedJson（切片 33 §7.45 尾部平衡提取）', () => {
  const WIRE = '{"title":"开会","tags":["工作"],"start":{"date":"2026-11-11","time":"15:00"}}';

  it('纯 JSON 输入原样返回（零回归）', () => {
    expect(extractLastBalancedJson(WIRE)).toBe(WIRE);
    expect(extractLastBalancedJson('{"a":1}')).toBe('{"a":1}');
    expect(extractLastBalancedJson('{"a":{"b":[1,2,{"c":3}]}}')).toBe(
      '{"a":{"b":[1,2,{"c":3}]}}',
    );
    expect(extractLastBalancedJson('  {"a":1}  ')).toBe('{"a":1}');
  });

  it('CoT 散文 + 末尾 JSON → 只取最靠后配平块', () => {
    const cot = `用户提到明天开会。需要提取 title 和 start。\n结论：${WIRE}`;
    expect(extractLastBalancedJson(cot)).toBe(WIRE);
  });

  it('CoT 推演中的 JSON 片段（含转义引号形式）不被误取', () => {
    const cot =
      '备选 {\\"date\\":\\"2026-11-11\\"} 或 {"draft":true} 都不对。最终：' +
      WIRE;
    expect(extractLastBalancedJson(cot)).toBe(WIRE);
  });

  it('字符串字面量内的大括号/中括号/引号不参与配平', () => {
    const tricky = '{"note":"含 } ] { [ 的字符串","tags":["a]b"]}尾注';
    expect(extractLastBalancedJson(tricky)).toBe(
      '{"note":"含 } ] { [ 的字符串","tags":["a]b"]}',
    );
  });

  it('字符串内的转义引号（\\"）不是字符串边界', () => {
    const tricky = '{"note":"他说 \\"好了}\\" 然后离开","tags":[]}';
    expect(extractLastBalancedJson(tricky)).toBe(tricky);
  });

  it('无配平块（纯散文 / 截断 JSON / 括号错配）→ 原样返回走既有失败路径', () => {
    expect(extractLastBalancedJson('完全没有大括号的散文')).toBe(
      '完全没有大括号的散文',
    );
    expect(extractLastBalancedJson('{"title":"截断的')).toBe('{"title":"截断的');
    expect(extractLastBalancedJson('{"a":[1,2}')).toBe('{"a":[1,2}');
    expect(extractLastBalancedJson('[1,2]')).toBe('[1,2]'); // 数组根不返回也原样
  });

  it('JSON 后尾随说明文字 → 仍取 JSON 块；嵌套 []/{} 混合正确配平', () => {
    expect(extractLastBalancedJson(`${WIRE} 以上就是结果。`)).toBe(WIRE);
    const nested = '推演 [a,b] 后输出 {"a":{"b":[1,{"c":[2]}],"d":null}} 完成';
    expect(extractLastBalancedJson(nested)).toBe(
      '{"a":{"b":[1,{"c":[2]}],"d":null}}',
    );
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

  it('澄清/渠道字段（切片 23 §7.35）：合法值透传，null/false/空串归一 undefined', () => {
    const clarifying = isRemoteDraftWire(
      patchWire({
        needsClarification: true,
        clarificationPrompt: '你要在什么时间提醒你开会？',
        reminderChannels: ['alarm'],
      }),
    );
    expect(clarifying).not.toBeNull();
    const draft = wireToParsedItemDraft(clarifying as NonNullable<typeof clarifying>, CONTEXT);
    expect(draft.needsClarification).toBe(true);
    expect(draft.clarificationPrompt).toBe('你要在什么时间提醒你开会？');
    expect(draft.reminderChannels).toEqual(['alarm']);

    // null → 归一 undefined（未表达，落库走 defaultChannels）
    const nulled = isRemoteDraftWire(
      patchWire({ needsClarification: null, clarificationPrompt: null, reminderChannels: null }),
    );
    expect(nulled).not.toBeNull();
    const nulledDraft = wireToParsedItemDraft(nulled as NonNullable<typeof nulled>, CONTEXT);
    expect(nulledDraft.needsClarification).toBeUndefined();
    expect(nulledDraft.clarificationPrompt).toBeUndefined();
    expect(nulledDraft.reminderChannels).toBeUndefined();

    // false / 空串 → 归一 undefined（澄清信号只在 true 时表达）
    const falsy = isRemoteDraftWire(patchWire({ needsClarification: false, clarificationPrompt: '' }));
    expect(falsy).not.toBeNull();
    const falsyDraft = wireToParsedItemDraft(falsy as NonNullable<typeof falsy>, CONTEXT);
    expect(falsyDraft.needsClarification).toBeUndefined();
    expect(falsyDraft.clarificationPrompt).toBeUndefined();
  });

  it('澄清/渠道字段键缺省（旧版 12 键 wire）→ 通过（ai.md v0.19 对 v0.16 缺键规则的偏离）', () => {
    // validWire 即旧版形状：不含三新字段。
    expect(isRemoteDraftWire(validWire)).not.toBeNull();
  });

  it('澄清/渠道字段非法值整体拒绝（值出现即从严）', () => {
    expect(isRemoteDraftWire(patchWire({ needsClarification: 'yes' }))).toBeNull();
    expect(isRemoteDraftWire(patchWire({ clarificationPrompt: 123 }))).toBeNull();
    expect(isRemoteDraftWire(patchWire({ reminderChannels: [] }))).toBeNull();
    expect(isRemoteDraftWire(patchWire({ reminderChannels: ['bogus'] }))).toBeNull();
    expect(isRemoteDraftWire(patchWire({ reminderChannels: ['system-notification', 'alarm'] }))).toBeNull();
    // 非互斥网络渠道组合通过
    expect(isRemoteDraftWire(patchWire({ reminderChannels: ['webhook', 'apprise'] }))).not.toBeNull();
  });
});

describe('buildHistoryBriefing 注入 system 消息（切片 23 阶段 2）', () => {
  // 与 prompt.test.ts 同基准：民用换算后 2026-11-11 15:00 Asia/Shanghai。
  const BRIEF_START = new Date('2026-11-11T15:00:00+08:00').getTime();

  it('history 含草稿 JSON → system content 附带摘要块（民用时间，无毫秒泄漏）', async () => {
    const { fetchImpl, calls } = makeFetch(() => okEnvelope(validWireJson));
    const provider = makeProvider(fetchImpl);
    await provider.parse('改成7点半', {
      now: NOW,
      tzid: TZID,
      history: [
        { role: 'user', text: '明天下午3点开会' },
        {
          role: 'assistant',
          text: JSON.stringify({
            title: '开会',
            content: '',
            type: 'event',
            startAt: BRIEF_START,
            endAt: null,
            allDay: false,
          }),
        },
      ],
    });
    const body = JSON.parse(calls[0].init?.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages[0]?.content ?? '';
    expect(body.messages[0]?.role).toBe('system');
    expect(system).toContain('上一张卡片草稿摘要（修改时以此为准，禁止新建条目）：');
    expect(system).toContain('- 标题：开会');
    expect(system).toContain('- 时间：2026-11-11 15:00（时区 Asia/Shanghai）');
    expect(system).not.toContain(String(BRIEF_START));
    // history 消息本体原样透传（user/assistant 顺序保持，草稿 JSON 不被替换）。
    expect(body.messages[1]).toEqual({ role: 'user', content: '明天下午3点开会' });
    expect(body.messages[2]?.role).toBe('assistant');
    expect(body.messages[body.messages.length - 1]).toEqual({
      role: 'user',
      content: '改成7点半',
    });
  });

  it('history 无草稿（assistant 为 note 文本）→ 不附摘要块，单轮行为不变', async () => {
    const { fetchImpl, calls } = makeFetch(() => okEnvelope(validWireJson));
    const provider = makeProvider(fetchImpl);
    await provider.parse('改成明天', {
      now: NOW,
      tzid: TZID,
      history: [
        { role: 'user', text: '提醒我开会' },
        { role: 'assistant', text: '已改为 2026-11-11 15:00' },
      ],
    });
    const body = JSON.parse(calls[0].init?.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages[0]?.content ?? '';
    // 静态 prompt 指令节本身含「上一张卡片草稿摘要」字样，须以完整渲染块头判定。
    expect(system).not.toContain('上一张卡片草稿摘要（修改时以此为准，禁止新建条目）：');
    expect(system).toContain('当前时间：');
  });
});

describe('OpenAICompatibleProvider.lastUsage（切片 26 / AGENTS.md §7.38）', () => {
  /** 信封带 usage 的 200 响应（DeepSeek/OpenAI chat-completions 形态）。 */
  function okEnvelopeWithUsage(content: string, usage: unknown): Response {
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content } }],
        usage,
      }),
      { status: 200 },
    );
  }

  const fullUsage = {
    prompt_tokens: 1000,
    completion_tokens: 200,
    prompt_tokens_details: { cached_tokens: 600 },
  };

  function makeProviderWithPrices(
    fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
    prices?: { priceInputPerMillion?: number; priceOutputPerMillion?: number },
  ): OpenAICompatibleProvider {
    return new OpenAICompatibleProvider(
      {
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: API_KEY,
        model: 'deepseek-chat',
        ...prices,
      },
      fetchImpl,
    );
  }

  it('构造后 lastUsage 初始为 null', () => {
    const { fetchImpl } = makeFetch(() => okEnvelope(validWireJson));
    const provider = makeProviderWithPrices(fetchImpl);
    expect(provider.lastUsage).toBeNull();
  });

  it('成功轮：envelope usage 完整 + 两价齐备 → 快照全段（费用按全价上界估算）', async () => {
    const { fetchImpl } = makeFetch(() => okEnvelopeWithUsage(validWireJson, fullUsage));
    const provider = makeProviderWithPrices(fetchImpl, {
      priceInputPerMillion: 2,
      priceOutputPerMillion: 8,
    });
    await provider.parse('明天下午3点开会', CONTEXT);
    expect(provider.lastUsage).toEqual({
      promptTokens: 1000,
      completionTokens: 200,
      cachedPromptTokens: 600,
      estimatedCost: 0.0036, // (1000*2 + 200*8) / 1e6
    });
  });

  it('成功轮：envelope 无 usage / usage 畸形 → lastUsage null（不炸主链）', async () => {
    const noUsage = makeFetch(() => okEnvelope(validWireJson));
    const p1 = makeProvider(noUsage.fetchImpl);
    await p1.parse('明天下午3点开会', CONTEXT);
    expect(p1.lastUsage).toBeNull();

    const badUsage = makeFetch(() =>
      okEnvelopeWithUsage(validWireJson, {
        prompt_tokens: 'garbage',
        completion_tokens: 200,
      }),
    );
    const p2 = makeProvider(badUsage.fetchImpl);
    await expect(p2.parse('明天下午3点开会', CONTEXT)).resolves.toMatchObject({ title: '开会' });
    expect(p2.lastUsage).toBeNull();
  });

  it('成功轮：单价缺省 → token/缓存段照常，estimatedCost null', async () => {
    const { fetchImpl } = makeFetch(() => okEnvelopeWithUsage(validWireJson, fullUsage));
    const provider = makeProviderWithPrices(fetchImpl);
    await provider.parse('明天下午3点开会', CONTEXT);
    expect(provider.lastUsage).toEqual({
      promptTokens: 1000,
      completionTokens: 200,
      cachedPromptTokens: 600,
      estimatedCost: null,
    });
  });

  it('recurrence 分支（{...draft, startAt: local} 返回路径）同样携带 lastUsage', async () => {
    const draftWithRecurrence = JSON.stringify({
      title: '喝水',
      content: '',
      type: 'task',
      start: { date: '2026-11-10', time: '09:00' },
      end: null,
      allDay: false,
      categoryId: 'health',
      tags: [],
      priority: null,
      recurrence: { frequency: 'daily', localTime: { hour: 9, minute: 0 } },
      reminderOffsetMinutes: null,
      reminderDelayMinutes: null,
    });
    const { fetchImpl } = makeFetch(() => okEnvelopeWithUsage(draftWithRecurrence, fullUsage));
    const provider = makeProviderWithPrices(fetchImpl);
    const draft = await provider.parse('每天9点喝水', CONTEXT);
    expect(draft.startAt).toBe(mustAt(2026, 11, 11, 9, 0));
    expect(provider.lastUsage).not.toBeNull();
    expect(provider.lastUsage?.promptTokens).toBe(1000);
  });

  it('失败轮：parse 抛 AiParseError（schema-mismatch）→ lastUsage 保持 null', async () => {
    // envelope 有 usage，但 content JSON 未通过结构守卫 → 抛错路径不得赋值。
    const { fetchImpl } = makeFetch(() =>
      okEnvelopeWithUsage('not-json-at-all', fullUsage),
    );
    const provider = makeProviderWithPrices(fetchImpl);
    await expect(provider.parse('明天下午3点开会', CONTEXT)).rejects.toMatchObject({
      kind: 'invalid-json',
    });
    expect(provider.lastUsage).toBeNull();
  });

  it('失败轮：HTTP 500 → lastUsage null；下一轮成功后恢复赋值（不残留失败态也不误留旧值）', async () => {
    let status = 500;
    const { fetchImpl } = makeFetch(() =>
      status === 500
        ? new Response('boom', { status: 500 })
        : okEnvelopeWithUsage(validWireJson, fullUsage),
    );
    const provider = makeProviderWithPrices(fetchImpl);
    await expect(provider.parse('明天下午3点开会', CONTEXT)).rejects.toMatchObject({
      kind: 'http-status',
    });
    expect(provider.lastUsage).toBeNull();

    status = 200;
    await provider.parse('明天下午3点开会', CONTEXT);
    expect(provider.lastUsage?.promptTokens).toBe(1000);
  });

  it('连续两轮：第二轮 envelope 无 usage → lastUsage 回落 null（不残留第一轮数值）', async () => {
    let withUsage = true;
    const { fetchImpl } = makeFetch(() =>
      withUsage
        ? okEnvelopeWithUsage(validWireJson, fullUsage)
        : okEnvelope(validWireJson),
    );
    const provider = makeProviderWithPrices(fetchImpl);
    await provider.parse('明天下午3点开会', CONTEXT);
    expect(provider.lastUsage?.promptTokens).toBe(1000);

    withUsage = false;
    await provider.parse('改成明天', CONTEXT);
    expect(provider.lastUsage).toBeNull();
  });
});

describe('OpenAICompatibleProvider DeepSeek 峰谷分层（阶段 2b / v0.21）', () => {
  /** 信封带 usage 的 200 响应（本 describe 本地副本；上一块的 helper 不跨 describe 可见）。 */
  function okEnvelopeWithUsage(content: string, usage: unknown): Response {
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content } }],
        usage,
      }),
      { status: 200 },
    );
  }

  const TIER_USAGE = {
    prompt_tokens: 1000,
    completion_tokens: 200,
    prompt_tokens_details: { cached_tokens: 600 },
  };
  const TIER_PRICES = {
    priceCachedPeak: 0.04,
    priceCachedOffPeak: 0.02,
    priceUncachedPeak: 2,
    priceUncachedOffPeak: 1,
    priceOutputPeak: 8,
    priceOutputOffPeak: 4,
  };
  /** 北京时间（UTC+8）民用时刻 → epoch（测试冻结判峰时钟用）。 */
  function atBeijing(year: number, month: number, day: number, hour: number, minute: number): number {
    return Date.UTC(year, month - 1, day, hour, minute) - 8 * 60 * 60 * 1000;
  }

  function makeTieredProvider(
    fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
    now: () => number,
  ): OpenAICompatibleProvider {
    return new OpenAICompatibleProvider(
      {
        baseUrl: 'https://api.deepseek.com',
        apiKey: API_KEY,
        model: 'deepseek-flash',
        platform: 'deepseek',
        ...TIER_PRICES,
      },
      fetchImpl,
      now,
    );
  }

  it('platform=deepseek + 六价齐备：高峰时刻走高峰档（clock 注入冻结周一 10:00）', async () => {
    const MON_1000 = atBeijing(2026, 11, 16, 10, 0);
    const { fetchImpl } = makeFetch(() => okEnvelopeWithUsage(validWireJson, TIER_USAGE));
    const provider = makeTieredProvider(fetchImpl, () => MON_1000);
    await provider.parse('明天下午3点开会', CONTEXT);
    // (600*0.04 + 400*2 + 200*8)/1e6 = 0.002424（peak 档）
    expect(provider.lastUsage).toEqual({
      promptTokens: 1000,
      completionTokens: 200,
      cachedPromptTokens: 600,
      estimatedCost: 0.002424,
    });
  });

  it('同配置周六 10:00（空闲档）换空闲价', async () => {
    const SAT_1000 = atBeijing(2026, 11, 21, 10, 0);
    const { fetchImpl } = makeFetch(() => okEnvelopeWithUsage(validWireJson, TIER_USAGE));
    const provider = makeTieredProvider(fetchImpl, () => SAT_1000);
    await provider.parse('明天下午3点开会', CONTEXT);
    // (600*0.02 + 400*1 + 200*4)/1e6 = 0.001212（off-peak 档）
    expect(provider.lastUsage?.estimatedCost).toBe(0.001212);
  });

  it('platform=deepseek 但六价全缺：estimatedCost null，token 段照常', async () => {
    const MON_1000 = atBeijing(2026, 11, 16, 10, 0);
    const { fetchImpl } = makeFetch(() => okEnvelopeWithUsage(validWireJson, TIER_USAGE));
    const provider = new OpenAICompatibleProvider(
      {
        baseUrl: 'https://api.deepseek.com',
        apiKey: API_KEY,
        model: 'deepseek-flash',
        platform: 'deepseek',
      },
      fetchImpl,
      () => MON_1000,
    );
    await provider.parse('明天下午3点开会', CONTEXT);
    expect(provider.lastUsage?.promptTokens).toBe(1000);
    expect(provider.lastUsage?.estimatedCost).toBeNull();
  });

  it('platform 缺省（undefined）即使带六价也走 v0.20 全价两价路径', async () => {
    const MON_1000 = atBeijing(2026, 11, 16, 10, 0);
    const { fetchImpl } = makeFetch(() => okEnvelopeWithUsage(validWireJson, TIER_USAGE));
    const provider = new OpenAICompatibleProvider(
      {
        baseUrl: 'https://api.deepseek.com',
        apiKey: API_KEY,
        model: 'deepseek-flash',
        ...TIER_PRICES,
        priceInputPerMillion: 1,
        priceOutputPerMillion: 4,
      },
      fetchImpl,
      () => MON_1000,
    );
    await provider.parse('明天下午3点开会', CONTEXT);
    // 全价上界：(1000*1 + 200*4)/1e6 = 0.0018（不拆缓存段）
    expect(provider.lastUsage?.estimatedCost).toBe(0.0018);
  });
});

// ---------------------------------------------------------------------------
// 切片 30（AGENTS.md §7.41）：传输层自动重试——可重试=网络/超时/5xx/429/响应
// JSON 解析失败；不可重试=401/403/400/schema-mismatch 立即抛出；固定间隔
// 1000ms；耗尽披露「（已重试 N 次）」；usage 只报成功轮。
// ---------------------------------------------------------------------------

describe('OpenAICompatibleProvider 自动重试（切片 30 §7.41）', () => {
  const zeroDelay = async (): Promise<void> => undefined;

  function makeRetryProvider(
    fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
    retryMax: number | undefined,
    onRetry?: (attempt: number, maxRetries: number, kind: string) => void,
    delays?: number[],
  ): OpenAICompatibleProvider {
    return new OpenAICompatibleProvider(
      {
        baseUrl: 'https://api.example.com/v1',
        apiKey: API_KEY,
        model: 'test-model',
        retryMax,
        onRetry,
      },
      fetchImpl,
      Date.now,
      // 注入等待记录器：断言固定间隔 1000ms，同时避免测试真等 1s。
      async (ms: number) => {
        delays?.push(ms);
      },
    );
  }

  /** 顺序响应队列：依次弹出；队列空后重复最后一项。 */
  function sequenceFetch(
    steps: Array<Response | Error>,
  ): (url: string, init: RequestInit) => Promise<Response> {
    let index = 0;
    return async () => {
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      if (step instanceof Error) {
        throw step;
      }
      return step;
    };
  }

  it('网络错误一次后成功：重试一次返回草稿，onRetry 回调 (1, maxRetries)', async () => {
    const onRetryCalls: Array<[number, number, string]> = [];
    const provider = makeRetryProvider(
      sequenceFetch([new Error('ECONNREFUSED'), okEnvelope(validWireJson)]),
      3,
      (attempt, maxRetries, kind) => onRetryCalls.push([attempt, maxRetries, kind]),
    );
    const draft = await provider.parse('明天下午3点开会', CONTEXT);
    expect(draft.title).toBe('开会');
  });

  it('重试间隔恒 1000ms 且只在实际重试前等待（次数 = 重试次数）', async () => {
    const delays: number[] = [];
    const provider = makeRetryProvider(
      sequenceFetch([new Error('boom'), new Error('boom'), okEnvelope(validWireJson)]),
      3,
      undefined,
      delays,
    );
    await provider.parse('明天下午3点开会', CONTEXT);
    expect(delays).toEqual([1000, 1000]);
  });

  it('HTTP 500 → 重试成功；429 → 重试成功', async () => {
    const provider = makeRetryProvider(
      sequenceFetch([new Response('oops', { status: 500 }), okEnvelope(validWireJson)]),
      3,
    );
    const draft = await provider.parse('明天下午3点开会', CONTEXT);
    expect(draft.title).toBe('开会');

    const provider429 = makeRetryProvider(
      sequenceFetch([new Response('slow down', { status: 429 }), okEnvelope(validWireJson)]),
      3,
    );
    const draft429 = await provider429.parse('明天下午3点开会', CONTEXT);
    expect(draft429.title).toBe('开会');
  });

  it('HTTP 401 / 400 不可重试：单次调用立即抛出，onRetry 不回调', async () => {
    const onRetryCalls: Array<[number, number, string]> = [];
    const provider = makeRetryProvider(
      sequenceFetch([new Response('bad key', { status: 401 })]),
      3,
      (attempt, maxRetries, kind) => onRetryCalls.push([attempt, maxRetries, kind]),
    );
    await expect(provider.parse('明天下午3点开会', CONTEXT)).rejects.toThrow(AiParseError);
    expect(onRetryCalls).toEqual([]);
  });

  it('schema-mismatch 不可重试：同 prompt 重试无意义，立即抛出', async () => {
    const badShape = JSON.stringify({ title: '缺字段的残缺对象' });
    const provider = makeRetryProvider(
      sequenceFetch([
        okEnvelope(badShape),
        okEnvelope(badShape),
        okEnvelope(badShape),
        okEnvelope(badShape),
      ]),
      3,
    );
    await expect(provider.parse('明天下午3点开会', CONTEXT)).rejects.toMatchObject({
      kind: 'schema-mismatch',
    });
  });

  it('响应体非合法 JSON → 重试后成功（invalid-json 可重试）', async () => {
    const provider = makeRetryProvider(
      sequenceFetch([
        new Response('not-json-at-all', { status: 200 }),
        okEnvelope(validWireJson),
      ]),
      3,
    );
    const draft = await provider.parse('明天下午3点开会', CONTEXT);
    expect(draft.title).toBe('开会');
  });

  it('重试耗尽：错误消息追加「（已重试 N 次）」，fetch 调用 1+N 次，onRetry N 次', async () => {
    const onRetryCalls: Array<[number, number, string]> = [];
    let calls = 0;
    const countingFetch = async (): Promise<Response> => {
      calls += 1;
      throw new Error('ECONNREFUSED');
    };
    const provider = makeRetryProvider(countingFetch, 2, (attempt, maxRetries, kind) =>
      onRetryCalls.push([attempt, maxRetries, kind]),
    );
    await expect(provider.parse('明天下午3点开会', CONTEXT)).rejects.toThrow(
      /（已重试 2 次）$/,
    );
    expect(calls).toBe(3); // 首次 + 2 次重试
    expect(onRetryCalls).toEqual([
      [1, 2, 'network'],
      [2, 2, 'network'],
    ]);
  });

  it('retryMax=0（关闭）：单次尝试，消息不带重试计数', async () => {
    let calls = 0;
    const provider = makeRetryProvider(async () => {
      calls += 1;
      throw new Error('ECONNREFUSED');
    }, 0);
    await expect(provider.parse('明天下午3点开会', CONTEXT)).rejects.toThrow(
      /^AI 请求失败：ECONNREFUSED$/,
    );
    expect(calls).toBe(1);
  });

  it('retryMax 缺省 → 默认 3（共 4 次尝试）；超时错误同样可重试', async () => {
    let calls = 0;
    const provider = makeRetryProvider(async () => {
      calls += 1;
      if (calls < 4) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      return okEnvelope(validWireJson);
    }, undefined);
    const draft = await provider.parse('明天下午3点开会', CONTEXT);
    expect(draft.title).toBe('开会');
    expect(calls).toBe(4);
  });
});

describe('isRemoteDraftWire / wireToParsedItemDraft：reminders 绝对时刻（切片 32 §7.44）', () => {
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

  it('键缺省（旧版 13 键 wire）→ 通过且 draft.reminders undefined；null 与 [] 同样宽容（[] 丢弃为 undefined）', () => {
    expect(isRemoteDraftWire(validWire)).not.toBeNull();
    expect(wireToParsedItemDraft(validWire as never, CONTEXT).reminders).toBeUndefined();

    const nullWire = isRemoteDraftWire({ ...validWire, reminders: null });
    expect(nullWire).not.toBeNull();
    expect(wireToParsedItemDraft(nullWire as never, CONTEXT).reminders).toBeUndefined();

    const emptyWire = isRemoteDraftWire({ ...validWire, reminders: [] });
    expect(emptyWire).not.toBeNull();
    expect(wireToParsedItemDraft(emptyWire as never, CONTEXT).reminders).toBeUndefined();
  });

  it('值从严整体拒绝：非数组 / 条目超 8 / 条目 time 为 null / 条目日期非法', () => {
    expect(isRemoteDraftWire({ ...validWire, reminders: 'not-array' })).toBeNull();
    expect(isRemoteDraftWire({ ...validWire, reminders: {} })).toBeNull();
    // 9 条 → 超出 WIRE_REMINDERS_MAX
    const nine = Array.from({ length: 9 }, (_, i) => ({
      date: '2026-11-20',
      time: `1${i % 10}:00`,
    }));
    expect(isRemoteDraftWire({ ...validWire, reminders: nine })).toBeNull();
    expect(
      isRemoteDraftWire({ ...validWire, reminders: [{ date: '2026-11-20', time: null }] }),
    ).toBeNull();
    expect(
      isRemoteDraftWire({ ...validWire, reminders: [{ date: '2026-13-40', time: '08:00' }] }),
    ).toBeNull();
    expect(isRemoteDraftWire({ ...validWire, reminders: [{ date: '2026-11-20' }] })).toBeNull();
  });

  it('恰好 8 条 → 通过（边界合法）', () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({
      date: '2026-11-20',
      time: `1${i}:00`,
    }));
    expect(isRemoteDraftWire({ ...validWire, reminders: eight })).not.toBeNull();
  });

  it('合法民用数组 → 逐条换算 epoch ms 升序返回；乱序与重复条目去重排序', () => {
    const wire = isRemoteDraftWire({
      ...validWire,
      reminders: [
        { date: '2026-11-12', time: '10:00' },
        { date: '2026-11-11', time: '08:00' },
        { date: '2026-11-12', time: '10:00' },
      ],
    });
    expect(wire).not.toBeNull();
    const draft = wireToParsedItemDraft(wire as never, CONTEXT);
    expect(draft.reminders).toEqual([
      mustAt(2026, 11, 11, 8, 0),
      mustAt(2026, 11, 12, 10, 0),
    ]);
  });

  it('DST gap 条目丢弃不整体拒绝（America/New_York 2026-03-08 02:30）；其余条目保留', () => {
    const nyContext: AiParseContext = { now: NOW, tzid: 'America/New_York', history: [] };
    const wire = isRemoteDraftWire({
      ...validWire,
      reminders: [
        { date: '2026-03-08', time: '02:30' }, // gap → 换算 null → 丢弃
        { date: '2026-03-08', time: '09:00' }, // 合法保留
      ],
    });
    expect(wire).not.toBeNull();
    const draft = wireToParsedItemDraft(wire as never, nyContext);
    const nyNine = resolveCivilTimeToInstant('America/New_York', 2026, 3, 8, 9, 0);
    expect(nyNine).not.toBeNull();
    expect(draft.reminders).toEqual([nyNine as number]);
  });

  it('全部条目均为 DST gap → reminders undefined（空集丢弃）', () => {
    const nyContext: AiParseContext = { now: NOW, tzid: 'America/New_York', history: [] };
    const wire = isRemoteDraftWire({
      ...validWire,
      reminders: [{ date: '2026-03-08', time: '02:30' }],
    });
    expect(wire).not.toBeNull();
    expect(wireToParsedItemDraft(wire as never, nyContext).reminders).toBeUndefined();
  });
});

describe('OpenAICompatibleProvider.lastDebug（切片 32 §7.44 / ai.md v0.23 副通道）', () => {
  it('构造后 lastDebug 双段均为 null', () => {
    const { fetchImpl } = makeFetch(() => okEnvelope(validWireJson));
    const provider = makeProvider(fetchImpl);
    expect(provider.lastDebug).toEqual({ request: null, response: null });
  });

  it('成功轮：request = 实际发送请求体（不含 headers），response = 信封原文', async () => {
    const envelope = okEnvelope(validWireJson);
    const envelopeText = await envelope.clone().text();
    const { fetchImpl, calls } = makeFetch(() => envelope);
    const provider = makeProvider(fetchImpl);
    await provider.parse('明天下午3点开会', CONTEXT);

    const debug = provider.lastDebug;
    expect(debug.request).not.toBeNull();
    expect(debug.request).not.toContain(API_KEY); // headers 不采集，Authorization 不入副通道
    const recordedBody = JSON.parse(debug.request ?? '{}');
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();
    const sentBody = typeof firstCall?.init?.body === 'string' ? JSON.parse(firstCall.init.body) : {};
    expect(recordedBody).toEqual(sentBody);
    expect(recordedBody.model).toBe('deepseek-chat');
    expect(recordedBody.temperature).toBe(0);
    expect(recordedBody.stream).toBe(false);
    expect(debug.response).toBe(envelopeText);
  });

  it('失败轮（HTTP 500）：request 照常记录，response = 错误响应文本', async () => {
    const { fetchImpl } = makeFetch(() => new Response('{"error":{"message":"boom"}}', { status: 500 }));
    const provider = makeProvider(fetchImpl);
    await expect(provider.parse('明天下午3点开会', CONTEXT)).rejects.toThrow();
    const debug = provider.lastDebug;
    expect(debug.request).not.toBeNull();
    expect(debug.response).toBe('{"error":{"message":"boom"}}');
  });

  it('失败轮（schema-mismatch）：信封可读 → response = 信封原文（成功失败均保留，供排障）', async () => {
    const { fetchImpl } = makeFetch(() => okEnvelope('not-a-json'));
    const provider = makeProvider(fetchImpl);
    await expect(provider.parse('明天下午3点开会', CONTEXT)).rejects.toThrow();
    const debug = provider.lastDebug;
    expect(debug.request).not.toBeNull();
    expect(debug.response).toContain('not-a-json'); // response = 信封原文（含 choices 包裹）
  });

  it('进入下一轮 parse 即清空（不残留上一轮载荷），失败轮同样先清空', async () => {
    const { fetchImpl } = makeFetch(() => new Response('boom', { status: 500 }));
    const provider = new OpenAICompatibleProvider(
      { baseUrl: 'https://api.deepseek.com/v1', apiKey: API_KEY, model: 'deepseek-chat', retryMax: 0 },
      fetchImpl,
    );
    await expect(provider.parse('第一轮', CONTEXT)).rejects.toThrow();
    expect(provider.lastDebug.request).not.toBeNull();
    await expect(provider.parse('第二轮', CONTEXT)).rejects.toThrow();
    // 第二轮请求体应包含新一轮 prompt，且不含上一轮输入
    expect(provider.lastDebug.request).not.toContain('第一轮');
    expect(provider.lastDebug.request).toContain('第二轮');
  });

  it('重试耗尽：lastDebug 反映最后一次尝试（每轮覆盖）', async () => {
    let calls = 0;
    const { fetchImpl } = makeFetch(() => {
      calls += 1;
      return new Response(`{"error":{"message":"boom-${calls}"}}`, { status: 500 });
    });
    const provider = makeProvider(fetchImpl);
    await expect(provider.parse('明天下午3点开会', CONTEXT)).rejects.toThrow(/已重试 3 次/);
    expect(provider.lastDebug.response).toContain('boom-4'); // 1 次初始 + 3 次重试 = 第 4 次尝试
  });
});
