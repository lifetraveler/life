/**
 * runScheduleQueryTurn 编排单测（切片 36 阶段 1，AGENTS.md §7.48 提案 D2/D6）：
 * 注入 fake fetch 验证两段调用顺序（窗口解析 → 回答生成）、窗口回退披露、
 * D6 降级路径（无 Key / 第二段失败 / 返回为空）、usage=第二段终态、
 * debug=第一段快照、重试计数披露。
 */

import { runScheduleQueryTurn, QUERY_WINDOW_FALLBACK_NOTICE } from '../scheduleQuery';
import type { AiConfig, AiProviderConfig } from '../configStore';
import type { Item } from '../../item';
import type { Category } from '../../category';
import type { ItemWithRelations } from '../../relations/itemWithRelations';

const TZ = 'Asia/Shanghai';
const NOW = Date.UTC(2026, 10, 23, 2, 0); // 2026-11-23 10:00 上海
const dayStart = (y: number, m1: number, d: number): number => Date.UTC(y, m1 - 1, d) - 8 * 3600_000;
const at = (y: number, m1: number, d: number, h: number, min: number): number =>
  dayStart(y, m1, d) + (h * 60 + min) * 60_000;

const STAGE1_WINDOW_JSON = '{"start":{"date":"2026-11-24"},"end":{"date":"2026-11-26"}}';
const STAGE1_ENVELOPE = JSON.stringify({
  choices: [{ message: { role: 'assistant', content: STAGE1_WINDOW_JSON } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
});
const STAGE2_ANSWER = '11月24日至26日共有 1 个安排：11-24 周二 09:00 体检。';
const STAGE2_ENVELOPE = JSON.stringify({
  choices: [{ message: { role: 'assistant', content: STAGE2_ANSWER } }],
  usage: { prompt_tokens: 20, completion_tokens: 8 },
});

const HEALTH: Category = { id: 'health', name: '健康', color: null, emoji: '💊', priority: 0 };

let seq = 0;
function makeItem(overrides: Partial<Item> & { category?: Category | null } = {}): ItemWithRelations {
  seq += 1;
  const base: Item = {
    id: `item-${seq}`,
    type: 'task',
    title: '体检',
    content: '',
    status: 'active',
    startAt: at(2026, 11, 24, 9, 0),
    endAt: null,
    allDay: false,
    sourceType: 'local',
    sourceUid: null,
    sourceReadOnly: false,
    categoryId: 'other',
    priority: 0,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const { category = null, ...itemOverrides } = overrides;
  return { ...base, ...itemOverrides, tags: [], category };
}

const ACTIVE: AiProviderConfig = {
  provider: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
};

function makeConfig(active: AiProviderConfig | null): AiConfig {
  return {
    slots: { deepseek: null, volcano: null, bailian: null, xiaomi: null, custom: active },
    active,
    activePlatform: 'custom',
  };
}

type FetchCall = { url: string; init: RequestInit | undefined };

function makeSequenceFetch(responses: Array<Response | Error>): {
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  return {
    calls,
    fetchImpl: (input, init) => {
      calls.push({ url: String(input), init });
      const next = responses.shift();
      if (next instanceof Error) {
        return Promise.reject(next);
      }
      if (next === undefined) {
        return Promise.reject(new Error('测试 fetch 序列耗尽'));
      }
      return Promise.resolve(next);
    },
  };
}

function parseBody(call: FetchCall): { model: string; messages: Array<{ role: string; content: string }> } {
  expect(typeof call.init?.body).toBe('string');
  return JSON.parse(call.init?.body as string);
}

function makeDeps(
  overrides: Partial<Parameters<typeof runScheduleQueryTurn>[0]> & { fetchResponses?: Array<Response | Error> } = {},
): { deps: Parameters<typeof runScheduleQueryTurn>[0]; calls: FetchCall[] } {
  const { fetchResponses = [new Response(STAGE1_ENVELOPE, { status: 200 }), new Response(STAGE2_ENVELOPE, { status: 200 })], ...rest } = overrides;
  const { fetchImpl, calls } = makeSequenceFetch(fetchResponses);
  return {
    calls,
    deps: {
      config: makeConfig(ACTIVE),
      now: NOW,
      tzid: TZ,
      question: '未来几天有什么安排',
      items: [makeItem({ category: HEALTH })],
      fetchImpl,
      ...rest,
    },
  };
}

describe('runScheduleQueryTurn（查询轮编排，切片 36）', () => {
  it('两段成功：先窗口解析后回答生成；answer 无披露；usage=第二段；debug=第一段快照', async () => {
    const { deps, calls } = makeDeps();
    const result = await runScheduleQueryTurn(deps);

    expect(calls).toHaveLength(2);
    const body1 = parseBody(calls[0]);
    expect(body1.model).toBe('test-model');
    expect(body1.messages).toHaveLength(2);
    expect(body1.messages[0].role).toBe('system');
    expect(body1.messages[0].content).toContain('任务：判断用户问题涉及的时间窗口。');
    expect(body1.messages[0].content).toContain('{"start":{"date":"YYYY-MM-DD"},"end":{"date":"YYYY-MM-DD"}}');
    expect(body1.messages[1].role).toBe('user');
    expect(body1.messages[1].content).toContain('用户问题：未来几天有什么安排');

    const body2 = parseBody(calls[1]);
    expect(body2.messages[0].content).toContain('任务：基于下方给出的窗口内日程数据');
    expect(body2.messages[1].content).toContain('查询窗口：2026-11-24 至 2026-11-26');
    expect(body2.messages[1].content).toContain('11-24 周二 09:00 体检（💊 健康）');
    expect(body2.messages[1].content).toContain('用户问题：未来几天有什么安排');

    expect(result.degraded).toBe(false);
    expect(result.answer).toBe(STAGE2_ANSWER);
    expect(result.windowText).toBe('2026-11-24 至 2026-11-26');
    expect(result.usage).toEqual({
      promptTokens: 20,
      completionTokens: 8,
      cachedPromptTokens: null,
      estimatedCost: null,
    });
    // debug = 第一段（窗口解析轮）request/response 快照
    expect(result.debug).not.toBeNull();
    expect(JSON.parse(result.debug?.request ?? '')).toEqual(body1);
    expect(result.debug?.response).toBe(STAGE1_ENVELOPE);
  });

  it('第一段输出无法解析（非 JSON）→ 默认窗口 + 回退披露 + 第二段照常', async () => {
    const stage1 = new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: '抱歉，我无法判断。' } }] }),
      { status: 200 },
    );
    const { deps, calls } = makeDeps({ fetchResponses: [stage1, new Response(STAGE2_ENVELOPE, { status: 200 })] });
    const result = await runScheduleQueryTurn(deps);

    expect(calls).toHaveLength(2);
    expect(result.degraded).toBe(false);
    expect(result.answer).toBe(`${STAGE2_ANSWER}\n\n${QUERY_WINDOW_FALLBACK_NOTICE}`);
    expect(result.windowText).toBe('2026-11-23 至 2026-11-29');
    expect(result.usage?.promptTokens).toBe(20);
    expect(result.debug?.response).toBe(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: '抱歉，我无法判断。' } }] }),
    );
  });

  it('第一段形状不合法（守卫拒绝）→ 回退默认窗口（不降级）', async () => {
    const stage1 = new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"start":1,"end":2}' } }] }),
      { status: 200 },
    );
    const { deps } = makeDeps({ fetchResponses: [stage1, new Response(STAGE2_ENVELOPE, { status: 200 })] });
    const result = await runScheduleQueryTurn(deps);
    expect(result.degraded).toBe(false);
    expect(result.answer).toContain(QUERY_WINDOW_FALLBACK_NOTICE);
    expect(result.windowText).toBe('2026-11-23 至 2026-11-29');
  });

  it('第一段网络错误 → 不降级；stage1Debug 保留错误响应；第二段成功', async () => {
    // aiRetryMax 默认 3：第一段首试 + 3 次重试全网络错（4 次调用）后耗尽，
    // 回退默认窗口；第二段成功（第 5 次）。
    const { deps, calls } = makeDeps({
      fetchResponses: [
        new Error('network down'),
        new Error('network down'),
        new Error('network down'),
        new Error('network down'),
        new Response(STAGE2_ENVELOPE, { status: 200 }),
      ],
    });
    const result = await runScheduleQueryTurn(deps);
    expect(calls).toHaveLength(5);
    expect(result.degraded).toBe(false);
    expect(result.answer).toContain(QUERY_WINDOW_FALLBACK_NOTICE);
    // 网络错误无响应体：response 保持 null，request 快照仍在
    expect(result.debug?.response).toBeNull();
    expect(result.debug?.request).toContain('test-model');
    expect(result.usage?.completionTokens).toBe(8);
  });

  it('第二段 HTTP 500 → D6 降级：本地行式回答 + 披露；usage null；debug=第一段', async () => {
    const { deps } = makeDeps({
      // aiRetryMax 0 = 关闭重试（切片 30 档位）：第二段单次 500 即耗尽。
      aiRetryMax: 0,
      fetchResponses: [new Response(STAGE1_ENVELOPE, { status: 200 }), new Response('boom', { status: 500 })],
    });
    const result = await runScheduleQueryTurn(deps);

    expect(result.degraded).toBe(true);
    expect(result.windowText).toBe('2026-11-24 至 2026-11-26');
    expect(result.answer).toBe(
      '2026-11-24 至 2026-11-26日程：\n11-24 周二 09:00 体检（💊 健康）\n\nAI 摘要生成失败（服务异常），已用本地日程列表回答。',
    );
    expect(result.usage).toBeNull();
    expect(result.degradedNotice).toBe('AI 摘要生成失败（服务异常），已用本地日程列表回答。');
    expect(result.debug?.response).toBe(STAGE1_ENVELOPE);
  });

  it('第二段返回空白 → 降级（返回为空）', async () => {
    const stage2 = new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: '   ' } }] }),
      { status: 200 },
    );
    const { deps } = makeDeps({
      fetchResponses: [new Response(STAGE1_ENVELOPE, { status: 200 }), stage2],
    });
    const result = await runScheduleQueryTurn(deps);
    expect(result.degraded).toBe(true);
    expect(result.degradedNotice).toBe('AI 摘要生成失败（返回为空），已用本地日程列表回答。');
    expect(result.usage).toBeNull();
  });

  it('无 Key（config null / active null）→ 本地降级不发起请求；debug null', async () => {
    const { deps, calls } = makeDeps({ config: null });
    const result = await runScheduleQueryTurn(deps);
    expect(calls).toHaveLength(0);
    expect(result.degraded).toBe(true);
    expect(result.degradedNotice).toBe('未配置 AI Key，已用本地日程列表回答。');
    expect(result.windowText).toBe('2026-11-23 至 2026-11-29');
    expect(result.answer).toContain('11-24 周二 09:00 体检');
    expect(result.usage).toBeNull();
    expect(result.debug).toBeNull();

    const emptyActive = makeDeps({ config: makeConfig(null) });
    const result2 = await runScheduleQueryTurn(emptyActive.deps);
    expect(emptyActive.calls).toHaveLength(0);
    expect(result2.degradedNotice).toBe('未配置 AI Key，已用本地日程列表回答。');
  });

  it('窗口内无条目降级回答 → 「窗口内没有安排。」', async () => {
    const { deps } = makeDeps({ config: null, items: [makeItem({ title: '无关', startAt: at(2026, 12, 20, 9, 0) })] });
    const result = await runScheduleQueryTurn(deps);
    expect(result.answer).toBe(
      '2026-11-23 至 2026-11-29日程：\n窗口内没有安排。\n\n未配置 AI Key，已用本地日程列表回答。',
    );
  });

  it('aiRetryMax 透传：第二段 500 两次（max=1）→ 披露「（已重试 1 次）」；onRetry 回调', async () => {
    const retryCalls: Array<[number, number]> = [];
    const { deps } = makeDeps({
      aiRetryMax: 1,
      onRetry: (attempt, maxRetries) => retryCalls.push([attempt, maxRetries]),
      fetchResponses: [
        new Response(STAGE1_ENVELOPE, { status: 200 }),
        new Response('boom-1', { status: 500 }),
        new Response('boom-2', { status: 500 }),
      ],
    });
    const result = await runScheduleQueryTurn(deps);
    expect(result.degraded).toBe(true);
    expect(result.degradedNotice).toBe(
      'AI 摘要生成失败（服务异常（已重试 1 次）），已用本地日程列表回答。',
    );
    expect(retryCalls).toEqual([[1, 1]]);
  }, 10_000);

  it('question 空白 → 向上抛（调用方 send() 已拦空，此处兜底）', async () => {
    const { deps } = makeDeps({ question: '   ' });
    await expect(runScheduleQueryTurn(deps)).rejects.toThrow('runScheduleQueryTurn: question is empty');
  });

  it('错误消息不含 apiKey（传输层纪律在查询轮同样成立）', async () => {
    const { deps } = makeDeps({
      fetchResponses: [
        new Response(STAGE1_ENVELOPE, { status: 200 }),
        new Response('unauthorized', { status: 401 }),
      ],
    });
    const result = await runScheduleQueryTurn(deps);
    expect(result.degradedNotice).not.toContain('sk-test');
    expect(JSON.stringify(result)).not.toContain('sk-test');
  });
});
