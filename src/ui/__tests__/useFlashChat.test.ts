/**
 * useFlashChat 澄清流转 hook 测试（tasks/slice-23.md 阶段 3，AGENTS.md §7.35）。
 *
 * react-test-renderer 挂载真实 hook（先例：MonthCalendarView.test.tsx），
 * Repository / SecureAiConfigStore / reminderScheduler / expo-localization 全部
 * mock；解析走真实 runFlashTurn 本地降级路径（无 Key → degraded=true），
 * merge / editIntent / savePlan / cardPayload 均为真实纯函数——即验证的是
 * 「澄清状态机 + 窄规则 guard + 保存链」的接线行为，而非纯逻辑本身
 * （纯逻辑各有单测）。
 *
 * 覆盖（任务卡验收 3 + 阶段 3 设计）：
 * 1. 澄清轮不出预览卡 + 反问文案 + 降级说明不丢；
 * 2. 续答经 merge 补全出卡（标题沿用、needsClarification 归位）；
 * 3. 澄清待补轮说「改成X点」不被编辑窄规则劫持（否则会误导性提示无时间）；
 * 4. 已出预览卡后新澄清输入清空卡片状态（setDraft(null) 生效）；
 * 5. 强提醒轮直接出卡（alarm 渠道、明天 08:00 不反问，验收 2 本地对照）；
 * 6. 保存出结果卡（kind 'card'、提醒快照含渠道、createReminder 以 alarm 调用）。
 *
 * 切片 25 阶段 2（AGENTS.md §7.37）：认真模式确认——拦截轮 confirm 消息与
 * 应用/放弃的本地处理（不发起 AI 轮次）、待确认期间新输入取消、时间修改不拦、
 * carefulMode=false / 读取失败回退默认模式、澄清先行；远端路径另验
 * bufferedHistory 的提交（应用）与丢弃（放弃）及 title+content 双改合并。
 */

import { createElement } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { itemRepository } from '../../data';
import type { ItemRepository } from '../../data';
import { SecureAiConfigStore } from '../../data/SecureAiConfigStore';
import type { AiConfig } from '../../domain/ai/configStore';
import type { RemoteDraftWire } from '../../domain/ai/openAiCompatible';
import { useFlashChat } from '../useFlashChat';
import type { ConfirmSaveResult, FlashChatMessage } from '../useFlashChat';
import { formatItemDate, formatItemTime } from '../timeFormat';
import { DEFAULT_APP_SETTINGS } from '../../domain/settings';
import type { CreateItemInput, Item } from '../../domain/item';
import type { CreateReminderInput, Reminder } from '../../domain/reminder';
import type { Category } from '../../domain/category';
import type { Tag } from '../../domain/tag';

jest.mock('expo-localization', () => ({
  getCalendars: jest.fn(() => [{ timeZone: 'Asia/Shanghai' }]),
}));

jest.mock('../../data', () => ({
  itemRepository: {
    getCategories: jest.fn(),
    getSettings: jest.fn(),
    listChannelPresets: jest.fn(),
    createItem: jest.fn(),
    updateItemTime: jest.fn(),
    addTagToItem: jest.fn(),
    createReminder: jest.fn(),
    listRemindersByItem: jest.fn(),
    updateReminder: jest.fn(),
  },
}));

jest.mock('../../data/SecureAiConfigStore', () => ({
  SecureAiConfigStore: jest.fn().mockImplementation(() => ({
    load: jest.fn(async () => null),
  })),
}));

jest.mock('../../notifications', () => ({
  reminderScheduler: { reconcile: jest.fn(async () => undefined) },
}));

const TZID = 'Asia/Shanghai';

const CATEGORIES: Category[] = [
  { id: 'other', name: '其他', color: '#9E9E9E', emoji: '📌', priority: 5 },
];

// 模块 mock 后的 itemRepository 仍是仓库接口类型；测试内以 jest.Mocked 驱动。
const repo = itemRepository as unknown as jest.Mocked<ItemRepository>;

// ---------------------------------------------------------------------------
// 切片 25 阶段 2（AGENTS.md §7.37）：认真模式确认测试共用件。
// ---------------------------------------------------------------------------

/** 认真模式开启的设置（拦截用例覆写 getSettings；默认模式用例不覆写）。 */
const CAREFUL_SETTINGS = { ...DEFAULT_APP_SETTINGS, carefulMode: true };

// clearAllMocks 不清 mockImplementation：远端用例的 implementation 若泄漏到
// 后续本地用例会全部走远端路径——beforeEach 统一复位为「无 Key」默认。
const SecureStoreClass = SecureAiConfigStore as unknown as jest.Mock;

// 远端用例经由全局 fetch mock 驱动 OpenAICompatibleProvider（其默认 fetchImpl
// 在构造时读取全局 fetch，先安装 mock 再触发 runFlashTurn 即可命中）。
const globalScope = globalThis as { fetch?: unknown };
const originalFetch = globalScope.fetch;

type CapturedRequest = { messages?: { role: string; content: string }[] };
const fetchBodies: CapturedRequest[] = [];

const REMOTE_CONFIG: AiConfig = {
  active: {
    provider: 'openai-compatible',
    baseUrl: 'https://ai.example/v1',
    apiKey: 'key-test',
    model: 'test-model',
  },
};

function makeWire(overrides: Partial<RemoteDraftWire>): RemoteDraftWire {
  return {
    title: '项目周会',
    content: '',
    type: 'event',
    start: { date: '2030-01-15', time: '10:00' },
    end: null,
    allDay: false,
    categoryId: 'work',
    tags: [],
    priority: null,
    recurrence: null,
    reminderOffsetMinutes: null,
    reminderDelayMinutes: null,
    ...overrides,
  };
}

function makeEnvelope(wire: RemoteDraftWire): string {
  return JSON.stringify({
    choices: [{ message: { content: JSON.stringify(wire) } }],
  });
}

/** 安装全局 fetch mock：每次请求按序消费 wires（未配置轮回退默认 wire）。 */
function installFetchMock(wires: RemoteDraftWire[]): void {
  globalScope.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(
      typeof init?.body === 'string' ? init.body : '{}',
    ) as CapturedRequest;
    fetchBodies.push(body);
    const wire = wires.shift() ?? makeWire({});
    return {
      ok: true,
      status: 200,
      text: async () => makeEnvelope(wire),
    } as unknown as Response;
  });
}

/** createItem mock 返回值：§4.24 语义——时间字段恒 null（时间只走 updateItemTime）。 */
function makeCreatedItem(input: CreateItemInput): Item {
  return {
    id: 'item-new',
    type: input.type,
    title: input.title,
    content: input.content ?? '',
    status: 'active',
    startAt: null,
    endAt: null,
    allDay: false,
    sourceType: 'local',
    sourceUid: null,
    sourceReadOnly: false,
    categoryId: input.categoryId ?? 'other',
    priority: input.priority ?? 0,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeCreatedReminder(input: CreateReminderInput): Reminder {
  return {
    id: 'rem-new',
    itemId: input.itemId,
    frequency: input.frequency,
    localTimeHour: input.localTimeHour,
    localTimeMinute: input.localTimeMinute,
    weekdays: input.weekdays ?? [],
    dayOfMonth: input.dayOfMonth ?? 0,
    onceAt: input.onceAt ?? null,
    tzid: input.tzid,
    startAt: input.startAt,
    enabled: input.enabled,
    channels: input.channels ?? ['system-notification'],
    channelConfigs: {},
    lastFiredOccurrenceKey: null,
    lastReconciledAt: null,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

/** 每次 render 都把最新 hook 返回值镜像到模块级变量（月历测试同款探测模式）。 */
let latest: ReturnType<typeof useFlashChat> | undefined;

function Probe(): null {
  latest = useFlashChat();
  return null;
}

async function mountHook(): Promise<void> {
  latest = undefined;
  await act(async () => {
    TestRenderer.create(createElement(Probe));
  });
}

function hook(): ReturnType<typeof useFlashChat> {
  if (latest === undefined) throw new Error('hook 未挂载');
  return latest;
}

function assistantTexts(): string[] {
  return hook()
    .messages.filter((message: FlashChatMessage) => message.role === 'assistant')
    .map((message) => message.text);
}

/** confirm 类消息（认真模式确认卡片，切片 25）。 */
function confirmMessages(): FlashChatMessage[] {
  return hook().messages.filter((message) => message.kind === 'confirm');
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.getCategories.mockResolvedValue(CATEGORIES);
  repo.getSettings.mockResolvedValue(DEFAULT_APP_SETTINGS);
  repo.listChannelPresets.mockResolvedValue([]);
  repo.createItem.mockImplementation(async (input: CreateItemInput) =>
    makeCreatedItem(input),
  );
  repo.updateItemTime.mockImplementation(async () =>
    makeCreatedItem({ type: 'task', title: '占位' }),
  );
  repo.addTagToItem.mockImplementation(
    async (_itemId: string, name: string): Promise<Tag> => ({
      id: 'tag-new',
      name,
      color: null,
      emoji: null,
      createdAt: 1000,
    }),
  );
  repo.createReminder.mockImplementation(async (input: CreateReminderInput) =>
    makeCreatedReminder(input),
  );
  repo.listRemindersByItem.mockResolvedValue([]);
  SecureStoreClass.mockImplementation(() => ({
    load: jest.fn(async () => null),
  }));
});

describe('useFlashChat：主动澄清流转（切片 23 阶段 3，§7.35）', () => {
  it('澄清轮不出预览卡：draft 清空 + 反问文案 + 降级说明不丢（无 Key 本地路径）', async () => {
    await mountHook();
    await act(async () => {
      await hook().send('提醒我吃药');
    });

    expect(hook().draft).toBeNull();
    const texts = assistantTexts();
    expect(texts).toContain('你要在什么时间提醒你吃药？');
    expect(texts).toContain('未配置 AI Key，已用本地解析');
    expect(hook().messages[0]).toMatchObject({ role: 'user', text: '提醒我吃药' });
  });

  it('续答轮补全出卡：标题沿用澄清草稿，时间落今天 14:00，needsClarification 归位', async () => {
    await mountHook();
    await act(async () => {
      await hook().send('提醒我吃药');
    });
    await act(async () => {
      await hook().send('下午2点');
    });

    const draft = hook().draft;
    expect(draft).not.toBeNull();
    expect(draft?.title).toBe('吃药');
    expect(draft?.needsClarification).toBeUndefined();
    // formatItemTime → 'YYYY-MM-DD HH:mm'：同时锁日期（今天）与时刻。
    expect(formatItemTime(draft?.startAt ?? 0, TZID)).toBe(
      `${formatItemDate(Date.now(), TZID)} 14:00`,
    );
  });

  it('澄清待补轮说「改成下午2点」不被窄规则劫持（走解析合并出卡而非误导性提示）', async () => {
    await mountHook();
    await act(async () => {
      await hook().send('提醒我吃药');
    });
    await act(async () => {
      await hook().send('改成下午2点');
    });

    const draft = hook().draft;
    expect(draft).not.toBeNull();
    expect(draft?.title).toBe('吃药');
    expect(formatItemTime(draft?.startAt ?? 0, TZID)).toBe(
      `${formatItemDate(Date.now(), TZID)} 14:00`,
    );
    // 窄规则若劫持：草稿无 startAt → resolveEditStartAt null → 追加 EDIT_UNTIMED_NOTE。
    expect(assistantTexts()).not.toContain(
      '该条目没有具体时间（或为全天），暂时不支持这样修改；可在详情页设置时间。',
    );
  });

  it('已出预览卡后新澄清输入清空卡片状态（setDraft(null) 生效）', async () => {
    await mountHook();
    await act(async () => {
      await hook().send('明天开会');
    });
    expect(hook().draft).not.toBeNull();

    await act(async () => {
      await hook().send('提醒我吃药');
    });
    expect(hook().draft).toBeNull();
    expect(assistantTexts()).toContain('你要在什么时间提醒你吃药？');
  });

  it('强提醒轮直接出卡：alarm 渠道 + 明天 08:00，不反问（验收 2 本地对照）', async () => {
    await mountHook();
    await act(async () => {
      await hook().send('明天上午8点叫我起床');
    });

    const draft = hook().draft;
    expect(draft).not.toBeNull();
    expect(draft?.needsClarification).toBeUndefined();
    expect(draft?.reminderChannels).toEqual(['alarm']);
    // 上海无 DST：+24h 即民用明天；同时锁时刻 08:00。
    expect(formatItemTime(draft?.startAt ?? 0, TZID)).toBe(
      `${formatItemDate(Date.now() + 86_400_000, TZID)} 08:00`,
    );
  });

  it('保存出结果卡：kind card、提醒快照含渠道、createReminder 以 alarm 调用', async () => {
    await mountHook();
    await act(async () => {
      await hook().send('明天上午8点叫我起床');
    });
    const title = hook().draft?.title ?? '';

    let result!: ConfirmSaveResult;
    await act(async () => {
      result = await hook().confirmSave();
    });

    expect(result.ok).toBe(true);
    expect(repo.createReminder).toHaveBeenCalledTimes(1);
    expect(repo.createReminder.mock.calls[0]?.[0]).toMatchObject({
      channels: ['alarm'],
    });
    const cards = hook().messages.filter((message) => message.kind === 'card');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.cardPayload?.title).toBe(title);
    expect(cards[0]?.cardPayload?.reminder?.channels).toEqual(['alarm']);
    // 保存后草稿清空（切片 15 既有行为，澄清/出卡状态一并复位）。
    expect(hook().draft).toBeNull();
  });
});

describe('useFlashChat：认真模式确认（切片 25 阶段 2，§7.37）', () => {
  /** 标准拦截链：turn1 出卡（明天开会）→ turn2 补内容（触发确认）。 */
  async function mountAndIntercept(): Promise<void> {
    repo.getSettings.mockResolvedValue(CAREFUL_SETTINGS);
    await mountHook();
    await act(async () => {
      await hook().send('明天开会');
    });
    await act(async () => {
      await hook().send('地点在第三会议室');
    });
  }

  it('拦截轮追加 confirm 消息且草稿不变（不出新卡、缓冲 history 进载荷）', async () => {
    await mountAndIntercept();
    const before = hook().draft;
    expect(before).not.toBeNull();

    const confirms = confirmMessages();
    expect(confirms).toHaveLength(1);
    const payload = confirms[0]?.confirmPayload;
    expect(payload).toBeDefined();
    expect(payload?.resolved).toBe(false);
    expect(payload?.pendingDraft).toMatchObject({
      title: '开会',
      content: '地点在第三会议室',
    });
    expect(payload?.changes).toEqual([
      { field: 'content', label: '内容', from: '', to: '地点在第三会议室' },
    ]);
    expect(payload?.bufferedHistory).toHaveLength(2);
    expect(payload?.bufferedHistory[0]).toMatchObject({
      role: 'user',
      text: '地点在第三会议室',
    });
    const bufferedDraft = JSON.parse(payload?.bufferedHistory[1]?.text ?? '{}') as {
      title?: string;
      content?: string;
    };
    expect(bufferedDraft).toMatchObject({ title: '开会', content: '地点在第三会议室' });

    // 消息流：拦截轮不提交 assistantNote，user 消息照常入列。
    expect(hook().messages).toHaveLength(4);
    expect(hook().messages[2]).toMatchObject({ role: 'user', text: '地点在第三会议室' });
    expect(assistantTexts().filter((text) => text.includes('未配置 AI Key'))).toHaveLength(1);
    // 草稿保持旧状态（同一引用未变）。
    expect(hook().draft).toBe(before);
  });

  it('应用确认：提交缓冲 history 与拟提交草稿，预览卡刷新，后续 diff 以新草稿为基线', async () => {
    await mountAndIntercept();
    const before = hook().draft;
    const confirmId = confirmMessages()[0]?.confirmPayload?.confirmId;
    expect(confirmId).toBeDefined();

    await act(async () => {
      hook().applyConfirm(confirmId ?? -1);
    });

    const applied = hook().draft;
    expect(applied).not.toBeNull();
    expect(applied?.title).toBe('开会');
    expect(applied?.content).toBe('地点在第三会议室');
    expect(applied?.startAt).toBe(before?.startAt);
    expect(applied?.allDay).toBe(true);
    expect(confirmMessages()[0]?.confirmPayload?.resolved).toBe(true);

    // 应用后草稿成为新基线：再补一句 → 新一轮确认（content 累加）。
    await act(async () => {
      await hook().send('记得带投影仪');
    });
    const confirms = confirmMessages();
    expect(confirms).toHaveLength(2);
    expect(confirms[1]?.confirmPayload?.changes).toEqual([
      {
        field: 'content',
        label: '内容',
        from: '地点在第三会议室',
        to: '地点在第三会议室；记得带投影仪',
      },
    ]);
  });

  it('放弃确认：草稿与 history 均不动，追加放弃文本，重复放弃不重复追加', async () => {
    await mountAndIntercept();
    const before = hook().draft;

    await act(async () => {
      hook().dismissConfirm(confirmMessages()[0]?.confirmPayload?.confirmId ?? -1);
    });

    expect(hook().draft).toBe(before);
    expect(confirmMessages()[0]?.confirmPayload?.resolved).toBe(true);
    expect(assistantTexts().filter((text) => text.includes('已放弃本次修改'))).toHaveLength(1);

    // 幂等：已 resolved 后再次放弃不追加第二条文本。
    await act(async () => {
      hook().dismissConfirm(confirmMessages()[0]?.confirmPayload?.confirmId ?? -1);
    });
    expect(assistantTexts().filter((text) => text.includes('已放弃本次修改'))).toHaveLength(1);
  });

  it('待确认期间新输入取消 pending：旧确认 resolved，新意图正常出卡且标题不被旧卡污染', async () => {
    repo.getSettings.mockResolvedValue(CAREFUL_SETTINGS);
    await mountHook();
    await act(async () => {
      await hook().send('明天上午8点叫我起床');
    });
    const oldTitle = hook().draft?.title ?? '';
    await act(async () => {
      await hook().send('地点在第三会议室');
    });
    expect(confirmMessages()).toHaveLength(1);

    // 带新时刻 + 新主题词 = 全新意图：pending 取消、正常出卡、标题用新词。
    await act(async () => {
      await hook().send('明天下午3点部门例会');
    });
    const confirms = confirmMessages();
    expect(confirms).toHaveLength(1);
    expect(confirms[0]?.confirmPayload?.resolved).toBe(true);
    const draft = hook().draft;
    expect(draft?.title).toBe('部门例会');
    expect(draft?.title).not.toBe(oldTitle);
    expect(formatItemTime(draft?.startAt ?? 0, TZID)).toBe(
      `${formatItemDate(Date.now() + 86_400_000, TZID)} 15:00`,
    );
  });

  it('改时间不拦：编辑窄规则照常处理，不出确认', async () => {
    repo.getSettings.mockResolvedValue(CAREFUL_SETTINGS);
    await mountHook();
    await act(async () => {
      await hook().send('明天上午8点开会');
    });
    await act(async () => {
      await hook().send('改成明天上午9点');
    });
    expect(confirmMessages()).toHaveLength(0);
    const draft = hook().draft;
    expect(draft?.title).toBe('开会');
    expect(formatItemTime(draft?.startAt ?? 0, TZID)).toBe(
      `${formatItemDate(Date.now() + 86_400_000, TZID)} 09:00`,
    );
  });

  it('carefulMode=false 全走默认模式：拦截范围冻结，行为与切片 24 一致', async () => {
    // 不覆写 getSettings：beforeEach 已给 DEFAULT_APP_SETTINGS（carefulMode=false）。
    await mountHook();
    await act(async () => {
      await hook().send('明天开会');
    });
    await act(async () => {
      await hook().send('地点在第三会议室');
    });
    expect(confirmMessages()).toHaveLength(0);
    expect(hook().draft?.title).toBe('开会');
    expect(hook().draft?.content).toBe('地点在第三会议室');
  });

  it('getSettings 读取失败回退默认模式（不拦，直接出卡）', async () => {
    repo.getSettings.mockResolvedValue(CAREFUL_SETTINGS);
    await mountHook();
    await act(async () => {
      await hook().send('明天开会');
    });
    // 拦截轮开关重读失败 → 回退 false → 不拦。
    repo.getSettings.mockRejectedValueOnce(new Error('db locked'));
    await act(async () => {
      await hook().send('地点在第三会议室');
    });
    expect(confirmMessages()).toHaveLength(0);
    expect(hook().draft?.content).toBe('地点在第三会议室');
  });

  it('carefulMode 开启时澄清先行：澄清轮分支不受守卫影响', async () => {
    repo.getSettings.mockResolvedValue(CAREFUL_SETTINGS);
    await mountHook();
    await act(async () => {
      await hook().send('明天开会');
    });
    await act(async () => {
      await hook().send('提醒我吃药');
    });
    expect(confirmMessages()).toHaveLength(0);
    expect(hook().draft).toBeNull();
    expect(assistantTexts()).toContain('你要在什么时间提醒你吃药？');
  });
});

describe('useFlashChat：认真模式 history 提交（远端路径）', () => {
  beforeEach(() => {
    fetchBodies.length = 0;
    SecureStoreClass.mockImplementation(() => ({
      load: jest.fn(async () => REMOTE_CONFIG),
    }));
    repo.getSettings.mockResolvedValue(CAREFUL_SETTINGS);
  });

  afterEach(() => {
    globalScope.fetch = originalFetch;
  });

  async function mountAndInterceptRemote(): Promise<void> {
    installFetchMock([
      makeWire({}),
      makeWire({ content: '改为线上会议' }),
      makeWire({ content: '改为线上会议' }),
    ]);
    await mountHook();
    await act(async () => {
      await hook().send('明天上午十点项目周会');
    });
    await act(async () => {
      await hook().send('会议地点在第三会议室');
    });
  }

  it('应用确认后：缓冲 history 于下一轮提交进远端请求', async () => {
    await mountAndInterceptRemote();
    const confirmId = confirmMessages()[0]?.confirmPayload?.confirmId;
    expect(confirmId).toBeDefined();
    await act(async () => {
      hook().applyConfirm(confirmId ?? -1);
    });
    await act(async () => {
      await hook().send('再补充一句');
    });

    expect(fetchBodies).toHaveLength(3);
    const messages = fetchBodies[2]?.messages ?? [];
    expect(messages).toHaveLength(6); // system + turn1 对 + turn2 对（缓冲→应用）+ user
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]).toMatchObject({ role: 'user', content: '明天上午十点项目周会' });
    const turn1Draft = JSON.parse(messages[2]?.content ?? '{}') as { title?: string };
    expect(messages[2]?.role).toBe('assistant');
    expect(turn1Draft).toMatchObject({ title: '项目周会' });
    expect(messages[3]).toMatchObject({ role: 'user', content: '会议地点在第三会议室' });
    const turn2Draft = JSON.parse(messages[4]?.content ?? '{}') as {
      title?: string;
      content?: string;
    };
    expect(messages[4]?.role).toBe('assistant');
    expect(turn2Draft).toMatchObject({ title: '项目周会', content: '改为线上会议' });
    expect(messages[5]).toMatchObject({ role: 'user', content: '再补充一句' });
  });

  it('放弃确认后：被弃轮不进远端请求 history', async () => {
    await mountAndInterceptRemote();
    await act(async () => {
      hook().dismissConfirm(confirmMessages()[0]?.confirmPayload?.confirmId ?? -1);
    });
    expect(hook().draft?.content).toBe(''); // 草稿保持旧状态
    await act(async () => {
      await hook().send('再补充一句');
    });

    expect(fetchBodies).toHaveLength(3);
    const messages = fetchBodies[2]?.messages ?? [];
    expect(messages).toHaveLength(4); // system + turn1 对 + user（无 turn2 对）
    expect(messages.map((message) => message.content).join('\n')).not.toContain(
      '会议地点在第三会议室',
    );
    expect(hook().draft?.content).toBe('');
  });

  it('title 与 content 同轮双改：合并为一条确认消息（两行摘要）', async () => {
    installFetchMock([
      makeWire({}),
      makeWire({ title: '项目评审会', content: '地点改为线上会议' }),
    ]);
    await mountHook();
    await act(async () => {
      await hook().send('明天上午十点项目周会');
    });
    await act(async () => {
      await hook().send('会议地点在第三会议室');
    });

    const confirms = confirmMessages();
    expect(confirms).toHaveLength(1);
    expect(confirms[0]?.confirmPayload?.changes).toEqual([
      { field: 'title', label: '标题', from: '项目周会', to: '项目评审会' },
      { field: 'content', label: '内容', from: '', to: '地点改为线上会议' },
    ]);
  });
});
