/**
 * 闪电添加单轮编排测试（tasks/slice-15.md 阶段 3）：
 * 无 Key 降级 / 有 Key 走远程 / 远程失败降级并合并 / history 记录。
 */

import { runFlashTurn } from '../chat';
import type { ChatMessage, ParsedItemDraft } from '../types';

describe('runFlashTurn（阶段 3 编排）', () => {
  const NOW = new Date('2026-11-10T10:00:00+08:00').getTime();
  const TZID = 'Asia/Shanghai';

  function remoteBody(wire: unknown): string {
    return JSON.stringify({
      choices: [{ message: { content: JSON.stringify(wire) } }],
    });
  }

  function okFetch(body: string): typeof fetch {
    return (async () =>
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;
  }

  // v0.16：远程模型输出民用 wire，provider 本地换算为 ParsedItemDraft。
  const remoteWire = {
    title: '开周会',
    content: '',
    type: 'event',
    start: { date: '2026-11-11', time: '15:00' },
    end: null,
    allDay: false,
    categoryId: 'work',
    tags: [] as string[],
    priority: 2,
    recurrence: null,
    reminderOffsetMinutes: null,
    reminderDelayMinutes: null,
  };

  const config = {
    active: {
      provider: 'openai-compatible' as const,
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test-secret-key-do-not-leak',
      model: 'test-model',
      timeoutMs: undefined,
    },
  };

  it('无 Key → 本地降级解析，附降级提示与 history 追加', async () => {
    const result = await runFlashTurn('明天买菜', {
      config: null,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: null,
    });
    expect(result.degraded).toBe(true);
    expect(result.assistantNote).toBe('未配置 AI Key，已用本地解析');
    expect(result.draft.title).toBe('买菜');
    expect(result.historyAppend[0]).toEqual({ role: 'user', text: '明天买菜' });
    // 切片 33（§7.45 / ai.md v0.24）：history assistant 文本 = 民用序列化
    // （serializeDraftForHistory），不再是域形状逐字段相等——毫秒被 few-shot
    // 同化是 deepseek-flash 降级根因 B，history 一律民用。
    const historyDraft = JSON.parse(result.historyAppend[1].text) as Record<string, unknown>;
    expect(historyDraft.title).toBe('买菜');
    expect(historyDraft.startAt).toEqual({ date: '2026-11-11', time: null }); // allDay → time null
    expect(historyDraft.endAt).toBeNull();
    expect(result.historyAppend[1].text).not.toContain(String(NOW));
  });

  it('有 Key → 远程解析成功，不做本地合并', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(remoteBody(remoteWire), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const previousDraft: ParsedItemDraft = {
      title: '旧标题',
      content: '',
      type: 'event',
      startAt: new Date('2026-11-11T15:00:00+08:00').getTime(),
      endAt: null,
      allDay: false,
      categoryId: 'work',
      tags: [],
      priority: 2,
      recurrence: null,
      reminderOffsetMinutes: null,
      reminderDelayMinutes: null,
    };
    const result = await runFlashTurn('改成后天下午3点', {
      config,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft,
      fetchImpl,
    });

    expect(result.degraded).toBe(false);
    expect(result.assistantNote).toBe('已更新卡片');
    expect(result.draft.title).toBe('开周会'); // 远程全量草稿，不经合并
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions');
    const auth = (calls[0].init?.headers as Record<string, string>)['Authorization'];
    expect(auth).toBe('Bearer sk-test-secret-key-do-not-leak');
  });

  it('远程 500 → 降级本地解析并与上一轮卡片合并', async () => {
    const history: ChatMessage[] = [{ role: 'user', text: '明天上午10点交材料' }];
    const previousDraft: ParsedItemDraft = {
      title: '交材料',
      content: '',
      type: 'task',
      startAt: new Date('2026-11-11T10:00:00+08:00').getTime(),
      endAt: null,
      allDay: false,
      categoryId: null,
      tags: [],
      priority: null,
      recurrence: null,
      reminderOffsetMinutes: null,
      reminderDelayMinutes: null,
    };
    const result = await runFlashTurn('改成后天', {
      config,
      now: NOW,
      tzid: TZID,
      history,
      previousDraft,
      // 切片 30（§7.41）：与重试无关的降级语义测试显式关闭重试（0=关闭即现状），
      // 避免默认 3 引入的 3 次重试真等与注记计数尾巴。
      aiRetryMax: 0,
      fetchImpl: (async () =>
        new Response('boom', { status: 500 })) as unknown as typeof fetch,
    });

    expect(result.degraded).toBe(true);
    expect(result.assistantNote).toBe('AI 服务暂不可用（服务异常），已用本地解析');
    // 纠正句只表达日期：标题沿用上一轮，时间更新为后天 00:00 全天。
    expect(result.draft.title).toBe('交材料');
    expect(result.draft.allDay).toBe(true);
    expect(result.draft.startAt).toBe(
      new Date('2026-11-12T00:00:00+08:00').getTime(),
    );
  });

  it('远程网络异常 → 降级本地解析', async () => {
    const result = await runFlashTurn('明天买菜', {
      config,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: null,
      // 切片 30（§7.41）：与重试无关的降级语义测试显式关闭重试（0=关闭即现状）。
      aiRetryMax: 0,
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    expect(result.degraded).toBe(true);
    expect(result.assistantNote).toBe('AI 服务暂不可用（网络错误），已用本地解析');
    expect(result.draft.title).toBe('买菜');
  });

  it('降级补充轮：标题沿用上一轮主题词，本轮原词并入 content（验收反馈修补）', async () => {
    const history: ChatMessage[] = [
      { role: 'user', text: '我要预约我的体检' },
      { role: 'assistant', text: JSON.stringify({ title: '预约体检' }) },
      { role: 'user', text: '明天上午的体检' },
      { role: 'assistant', text: JSON.stringify({ title: '预约体检' }) },
    ];
    const previousDraft: ParsedItemDraft = {
      title: '预约体检',
      content: '',
      type: 'task',
      startAt: new Date('2026-11-12T00:00:00+08:00').getTime(),
      endAt: null,
      allDay: true,
      categoryId: null,
      tags: [],
      priority: null,
      recurrence: null,
      reminderOffsetMinutes: null,
      reminderDelayMinutes: null,
    };
    const result = await runFlashTurn('预约到西安交通大学第二附属医院', {
      config,
      now: NOW,
      tzid: TZID,
      history,
      previousDraft,
      // 切片 30（§7.41）：与重试无关的降级语义测试显式关闭重试（0=关闭即现状），
      // 避免默认 3 引入的 3 次重试真等与注记计数尾巴。
      aiRetryMax: 0,
      fetchImpl: (async () =>
        new Response('boom', { status: 500 })) as unknown as typeof fetch,
    });
    expect(result.degraded).toBe(true);
    // 标题不被本轮剩余原文覆盖，本轮原词进 content 作补充说明。
    expect(result.draft.title).toBe('预约体检');
    expect(result.draft.content).toBe('预约到西安交通大学第二附属医院');
    // 时间/分类等未表达字段沿用上一轮（合并语义不变）。
    expect(result.draft.startAt).toBe(
      new Date('2026-11-12T00:00:00+08:00').getTime(),
    );
    expect(result.draft.allDay).toBe(true);
    // history 追加的是调整后的草稿（下一轮 briefing 连续性）。
    expect(result.historyAppend?.[1]?.text).toContain('预约体检');
    expect(result.historyAppend?.[1]?.text).toContain('西安交通大学第二附属医院');
  });

  it('降级纠正轮标题未表达时行为不变（改成后天回归）', async () => {
    const history: ChatMessage[] = [{ role: 'user', text: '明天上午10点交材料' }];
    const previousDraft: ParsedItemDraft = {
      title: '交材料',
      content: '旧补充',
      type: 'task',
      startAt: new Date('2026-11-11T10:00:00+08:00').getTime(),
      endAt: null,
      allDay: false,
      categoryId: null,
      tags: [],
      priority: null,
      recurrence: null,
      reminderOffsetMinutes: null,
      reminderDelayMinutes: null,
    };
    const result = await runFlashTurn('改成后天', {
      config,
      now: NOW,
      tzid: TZID,
      history,
      previousDraft,
      // 切片 30（§7.41）：与重试无关的降级语义测试显式关闭重试（0=关闭即现状），
      // 避免默认 3 引入的 3 次重试真等与注记计数尾巴。
      aiRetryMax: 0,
      fetchImpl: (async () =>
        new Response('boom', { status: 500 })) as unknown as typeof fetch,
    });
    expect(result.draft.title).toBe('交材料');
    // 标题未表达 → 不触发 content 并入，既有 content 保留。
    expect(result.draft.content).toBe('旧补充');
  });

  it('空输入拒绝执行', async () => {
    await expect(
      runFlashTurn('   ', {
        config: null,
        now: NOW,
        tzid: TZID,
        history: [],
        previousDraft: null,
      }),
    ).rejects.toThrow('runFlashTurn: input is empty');
  });
});

describe('runFlashTurn tags 继承边界（切片 24 §7.36 / slice-23 遗留 2）', () => {
  const NOW = new Date('2026-11-10T10:00:00+08:00').getTime();
  const TZID = 'Asia/Shanghai';

  function draftOf(overrides: Partial<ParsedItemDraft>): ParsedItemDraft {
    return {
      title: '下午散步',
      content: '',
      type: 'event',
      startAt: new Date('2026-11-11T15:00:00+08:00').getTime(),
      endAt: null,
      allDay: false,
      categoryId: 'personal',
      tags: ['心情'],
      priority: null,
      recurrence: null,
      reminderOffsetMinutes: null,
      reminderDelayMinutes: null,
      ...overrides,
    };
  }

  it('全新意图（叫醒输入）不继承上一轮 tags（遗留 2 回归）', async () => {
    const result = await runFlashTurn('明天上午8点叫我起床', {
      config: null,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: draftOf({}),
    });
    // 合并确实发生（时间取本轮解析值），但 tags 不再沾上一轮。
    expect(result.draft.startAt).toBe(
      new Date('2026-11-11T08:00:00+08:00').getTime(),
    );
    expect(result.draft.tags).toEqual([]);
  });

  it('编辑词轮（「改成…」）仍继承上一轮 tags', async () => {
    const result = await runFlashTurn('改成后天下午3点', {
      config: null,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: draftOf({ title: '交材料', tags: ['工作'] }),
    });
    expect(result.draft.tags).toEqual(['工作']);
    expect(result.draft.startAt).toBe(
      new Date('2026-11-12T15:00:00+08:00').getTime(),
    );
  });

  it('澄清待补轮的续答继承 tags（§7.35 同一事项补全）且澄清信号归位', async () => {
    const result = await runFlashTurn('明天上午8点', {
      config: null,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: draftOf({
        title: '提醒吃药',
        tags: ['健康'],
        startAt: null,
        needsClarification: true,
        clarificationPrompt: '你要在什么时间提醒你吃药？',
      }),
    });
    expect(result.draft.tags).toEqual(['健康']);
    expect(result.draft.startAt).toBe(
      new Date('2026-11-11T08:00:00+08:00').getTime(),
    );
    expect(result.draft.needsClarification).toBeUndefined();
    expect(result.draft.clarificationPrompt).toBeUndefined();
  });
});

describe('runFlashTurn 标题守卫三态（切片 25 §7.37 / slice-24 closeout 遗留 1）', () => {
  const NOW = new Date('2026-11-10T10:00:00+08:00').getTime();
  const TZID = 'Asia/Shanghai';

  function draftOf(overrides: Partial<ParsedItemDraft>): ParsedItemDraft {
    return {
      title: '起床',
      content: '',
      type: 'task',
      startAt: new Date('2026-11-11T08:00:00+08:00').getTime(),
      endAt: null,
      allDay: false,
      categoryId: null,
      tags: [],
      priority: null,
      recurrence: null,
      reminderOffsetMinutes: null,
      reminderDelayMinutes: null,
      ...overrides,
    };
  }

  function failingFetch(): typeof fetch {
    return (async () =>
      new Response('boom', { status: 500 })) as unknown as typeof fetch;
  }

  it('全新意图（带新时刻）不沿用上一张卡标题（遗留 1 回归）', async () => {
    const result = await runFlashTurn('后天下午3点开会', {
      config: null,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: draftOf({}),
      fetchImpl: failingFetch(),
    });
    // 本轮带新时刻、无编辑词、非澄清语境 → 按全新意图出卡，标题取本轮解析值，
    // 「起床」不再误留（修复前：title 起床 + 原词并入 content）。
    expect(result.draft.title).toBe('开会');
    expect(result.draft.startAt).toBe(
      new Date('2026-11-12T15:00:00+08:00').getTime(),
    );
    expect(result.draft.content).toBe('');
  });

  it('编辑词轮仍沿用上一轮标题（标题被剩余原文表达时）', async () => {
    const result = await runFlashTurn('改成后天下午3点开会', {
      config: null,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: draftOf({ title: '交材料', content: '旧补充' }),
      fetchImpl: failingFetch(),
    });
    // 编辑词轮命中守卫第 1 支：标题沿用上一轮，本轮原词以「；」并入 content。
    expect(result.draft.title).toBe('交材料');
    expect(result.draft.content).toBe('旧补充；改成后天下午3点开会');
    expect(result.draft.startAt).toBe(
      new Date('2026-11-12T15:00:00+08:00').getTime(),
    );
  });

  it('澄清续答轮沿用上一轮标题（续答带新时刻与细节，时间表达不否决本支）', async () => {
    const result = await runFlashTurn('明早8点在西安交大二附院', {
      config: null,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: draftOf({
        title: '提醒吃药',
        startAt: null,
        needsClarification: true,
        clarificationPrompt: '你要在什么时间提醒你吃药？',
      }),
    });
    // 澄清续答命中守卫第 2 支：即便续答自带新时刻，标题仍沿用待补卡的
    // 上一轮主题词，原词并入 content（与切片 23 语义一致）。
    expect(result.draft.title).toBe('提醒吃药');
    expect(result.draft.content).toBe('明早8点在西安交大二附院');
    expect(result.draft.startAt).toBe(
      new Date('2026-11-11T08:00:00+08:00').getTime(),
    );
    expect(result.draft.needsClarification).toBeUndefined();
  });
});

describe('runFlashTurn usage 传输边界（切片 26 / AGENTS.md §7.38，ai.md v0.20）', () => {
  const NOW = new Date('2026-11-10T10:00:00+08:00').getTime();
  const TZID = 'Asia/Shanghai';

  // 与上方 describe 相同的 remote wire / config（本 describe 内自持，避免耦合上游改动）。
  const remoteWire = {
    title: '开周会',
    content: '',
    type: 'event',
    start: { date: '2026-11-11', time: '15:00' },
    end: null,
    allDay: false,
    categoryId: 'work',
    tags: [] as string[],
    priority: 2,
    recurrence: null,
    reminderOffsetMinutes: null,
    reminderDelayMinutes: null,
  };
  const config = {
    active: {
      provider: 'openai-compatible' as const,
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test-secret-key-do-not-leak',
      model: 'test-model',
      timeoutMs: undefined,
    },
  };

  function okFetch(body: string): typeof fetch {
    return (async () =>
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;
  }

  function remoteBody(wire: unknown, usage?: unknown): string {
    return JSON.stringify({
      choices: [{ message: { content: JSON.stringify(wire) } }],
      ...(usage !== undefined ? { usage } : {}),
    });
  }

  it('远端成功轮：usage 携带 provider.lastUsage 快照（envelope 有 usage 时）', async () => {
    const result = await runFlashTurn('明天下午3点开周会', {
      config,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: null,
      fetchImpl: okFetch(
        remoteBody(remoteWire, {
          prompt_tokens: 1000,
          completion_tokens: 200,
          prompt_tokens_details: { cached_tokens: 600 },
        }),
      ),
    });
    expect(result.degraded).toBe(false);
    expect(result.usage).toEqual({
      promptTokens: 1000,
      completionTokens: 200,
      cachedPromptTokens: 600,
      estimatedCost: null, // 单价未配置：只出 token 段
    });
  });

  it('远端成功轮：envelope 无 usage → result.usage null；history JSON 不携带 usage 字段', async () => {
    const result = await runFlashTurn('明天下午3点开周会', {
      config,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: null,
      fetchImpl: okFetch(remoteBody(remoteWire)),
    });
    expect(result.usage).toBeNull();
    const historyDraft = JSON.parse(result.historyAppend[1].text) as Record<string, unknown>;
    expect(historyDraft.title).toBe('开周会');
    expect('usage' in historyDraft).toBe(false);
    expect('usage' in result.draft).toBe(false);
  });

  it('降级轮（HTTP 500）与无 Key 轮：usage 恒 null（本地解析无 usage）', async () => {
    const failingFetch = (async () =>
      new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const degraded = await runFlashTurn('明天买菜', {
      config,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: null,
      fetchImpl: failingFetch,
    });
    expect(degraded.degraded).toBe(true);
    expect(degraded.usage).toBeNull();

    const noKey = await runFlashTurn('明天买菜', {
      config: null,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: null,
    });
    expect(noKey.degraded).toBe(true);
    expect(noKey.usage).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 切片 30（AGENTS.md §7.41）：重试耗尽 → 降级注记透传「（已重试 N 次）」；
// 重试中成功 → 正常返回；aiRetryMax=0 → 关闭即现状。
// ---------------------------------------------------------------------------

describe('runFlashTurn 重试披露（切片 30 / AGENTS.md §7.41）', () => {
  const NOW = new Date('2026-11-10T10:00:00+08:00').getTime();
  const TZID = 'Asia/Shanghai';

  const config = {
    active: {
      provider: 'openai-compatible' as const,
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test-secret-key-do-not-leak',
      model: 'test-model',
      timeoutMs: undefined,
    },
  };

  function alwaysFailFetch(): typeof fetch {
    return (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
  }

  it('重试耗尽（aiRetryMax=2）：降级注记追加（已重试 2 次），onRetry 回调 2 次', async () => {
    const retryCalls: Array<[number, number]> = [];
    const result = await runFlashTurn('明天买菜', {
      config,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: null,
      aiRetryMax: 2,
      onRetry: (attempt, maxRetries) => retryCalls.push([attempt, maxRetries]),
      fetchImpl: alwaysFailFetch(),
    });
    expect(result.degraded).toBe(true);
    expect(result.assistantNote).toBe(
      'AI 服务暂不可用（网络错误），已用本地解析（已重试 2 次）',
    );
    expect(retryCalls).toEqual([
      [1, 2],
      [2, 2],
    ]);
    // 降级轮 usage 恒 null（usage 只报成功轮）。
    expect(result.usage).toBeNull();
  });

  it('aiRetryMax=0：关闭即现状——单次失败立即降级，注记无重试计数', async () => {
    const result = await runFlashTurn('明天买菜', {
      config,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: null,
      aiRetryMax: 0,
      fetchImpl: alwaysFailFetch(),
    });
    expect(result.degraded).toBe(true);
    expect(result.assistantNote).toBe('AI 服务暂不可用（网络错误），已用本地解析');
  });
});

// ---------------------------------------------------------------------------
// 切片 32（AGENTS.md §7.44 / ai.md v0.23）：调试查看器副通道——远端轮恒携带
// debug（含失败降级轮），无 Key 本地轮 null；debug 不进 draft/history JSON。
// ---------------------------------------------------------------------------

describe('runFlashTurn debug 副通道（切片 32 / AGENTS.md §7.44）', () => {
  const NOW = new Date('2026-11-10T10:00:00+08:00').getTime();
  const TZID = 'Asia/Shanghai';

  function remoteBody(wire: unknown): string {
    return JSON.stringify({
      choices: [{ message: { content: JSON.stringify(wire) } }],
    });
  }

  function okFetch(body: string): typeof fetch {
    return (async () =>
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;
  }

  const remoteWire = {
    title: '开周会',
    content: '',
    type: 'event',
    start: { date: '2026-11-11', time: '15:00' },
    end: null,
    allDay: false,
    categoryId: 'work',
    tags: [],
    priority: 2,
    recurrence: null,
    reminderOffsetMinutes: null,
    reminderDelayMinutes: null,
  };

  const config = {
    active: {
      provider: 'openai-compatible' as const,
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test-secret-key-do-not-leak',
      model: 'test-model',
      timeoutMs: undefined,
    },
  };

  it('远端成功轮：debug 恒携带（request=发送请求体不含 apiKey，response=信封原文）；不进 draft/history', async () => {
    const envelope = remoteBody(remoteWire);
    const result = await runFlashTurn('明天下午3点开周会', {
      config,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: null,
      fetchImpl: okFetch(envelope),
    });
    expect(result.degraded).toBe(false);
    expect(result.debug).not.toBeNull();
    expect(result.debug?.request).not.toBeNull();
    expect(result.debug?.request).toContain('明天下午3点开周会');
    expect(result.debug?.request).toContain('"model":"test-model"');
    expect(result.debug?.request).not.toContain('sk-test-secret-key-do-not-leak');
    expect(result.debug?.response).toBe(envelope);
    // 传输边界：debug 不进 draft / history JSON。
    expect('debug' in result.draft).toBe(false);
    expect('debug' in result.historyAppend[0]).toBe(false);
    expect('debug' in result.historyAppend[1]).toBe(false);
  });

  it('失败降级轮（HTTP 500）：debug 仍携带失败尝试的请求/响应（排障面），aiRetryMax=0 单次尝试', async () => {
    const failingFetch = (async () =>
      new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const result = await runFlashTurn('明天买菜', {
      config,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: null,
      aiRetryMax: 0,
      fetchImpl: failingFetch,
    });
    expect(result.degraded).toBe(true);
    expect(result.debug).not.toBeNull();
    expect(result.debug?.request).toContain('明天买菜');
    expect(result.debug?.response).toBe('boom');
  });

  it('无 Key 本地轮：debug null（无远端往返可记录）', async () => {
    const result = await runFlashTurn('明天买菜', {
      config: null,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: null,
    });
    expect(result.debug).toBeNull();
  });

  it('远端成功轮：history assistant 文本为民用序列化（start/end {date,time}，不含毫秒）', async () => {
    const envelope = remoteBody(remoteWire);
    const result = await runFlashTurn('明天下午3点开周会', {
      config,
      now: NOW,
      tzid: TZID,
      history: [],
      previousDraft: null,
      fetchImpl: okFetch(envelope),
    });
    expect(result.degraded).toBe(false);
    expect(result.historyAppend[1].role).toBe('assistant');
    const historyDraft = JSON.parse(result.historyAppend[1].text) as Record<string, unknown>;
    expect(historyDraft.title).toBe('开周会');
    // 民用形状（ai.md v0.24）：非 allDay → time 具体时刻。
    expect(historyDraft.startAt).toEqual({ date: '2026-11-11', time: '15:00' });
    expect(historyDraft.endAt).toBeNull();
    // 根因 B 防回归：history 文本不得再出现毫秒 epoch。
    expect(result.historyAppend[1].text).not.toContain(
      String(new Date('2026-11-11T15:00:00+08:00').getTime()),
    );
  });
});
