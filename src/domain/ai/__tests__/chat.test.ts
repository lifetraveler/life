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
    expect(JSON.parse(result.historyAppend[1].text)).toEqual(result.draft);
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
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    expect(result.degraded).toBe(true);
    expect(result.assistantNote).toBe('AI 服务暂不可用（网络错误），已用本地解析');
    expect(result.draft.title).toBe('买菜');
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
