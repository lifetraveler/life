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

import { StrictMode, createElement } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { itemRepository } from '../../data';
import type { ItemRepository } from '../../data';
import { SecureAiConfigStore } from '../../data/SecureAiConfigStore';
import type { AiConfig } from '../../domain/ai/configStore';
import type { RemoteDraftWire } from '../../domain/ai/openAiCompatible';
import { formatAiUsageLine } from '../../domain/ai/usage';
import type { AiUsageSnapshot } from '../../domain/ai/usage';
import { useFlashChat } from '../useFlashChat';
import type { ConfirmSaveResult, FlashChatMessage } from '../useFlashChat';
import { formatItemDate, formatItemTime } from '../timeFormat';
import { DEFAULT_APP_SETTINGS } from '../../domain/settings';
import type { CreateItemInput, Item, UpdateItemInput } from '../../domain/item';
import type { ItemWithRelations } from '../../domain/relations/itemWithRelations';
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
    getItemById: jest.fn(),
    updateItem: jest.fn(),
    deleteReminder: jest.fn(),
    removeTagFromItem: jest.fn(),
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

// 切片 34（§7.46）：update 落库链测试共用件——已保存条目基线（ItemWithRelations
// 形状，getItemById 返回）与其 once/重复提醒行。
function makeBaselineItem(overrides: Partial<ItemWithRelations> = {}): ItemWithRelations {
  return {
    ...makeCreatedItem({ type: 'event', title: '旧标题', categoryId: 'work' }),
    id: 'item-001',
    tags: [{ id: 'tag-1', name: '生活', color: null, emoji: null, createdAt: 1000 }],
    category: CATEGORIES[0] ?? null,
    ...overrides,
  };
}

function makeBaselineReminder(id: string, hour: number, overrides: Partial<Reminder> = {}): Reminder {
  return {
    id,
    itemId: 'item-001',
    frequency: 'once',
    localTimeHour: 0,
    localTimeMinute: 0,
    weekdays: [],
    dayOfMonth: 0,
    onceAt: { year: 2030, month: 1, day: 15, hour, minute: 0 },
    tzid: TZID,
    startAt: new Date(`2030-01-15T${String(hour).padStart(2, '0')}:00:00+08:00`).getTime(),
    enabled: true,
    channels: ['system-notification'],
    channelConfigs: {},
    lastFiredOccurrenceKey: null,
    lastReconciledAt: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
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
  repo.getItemById.mockResolvedValue(null);
  repo.updateItem.mockImplementation(async (id: string, patch: UpdateItemInput) => ({
    ...makeBaselineItem(),
    id,
    title: patch.title ?? '',
    content: patch.content ?? '',
    type: patch.type ?? 'task',
    categoryId: patch.categoryId ?? 'other',
    priority: patch.priority ?? 0,
    updatedAt: 2000,
  }));
  repo.deleteReminder.mockResolvedValue(undefined);
  repo.removeTagFromItem.mockResolvedValue(undefined);
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
    expect(cards[0]?.cardPayload?.reminders[0]?.channels).toEqual(['alarm']);
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

describe('useFlashChat：消息 id 唯一性（切片 25 阶段 2 真机缺陷修补）', () => {
  /**
   * 真机缺陷回归（m00248，MuMu fabric 实测）：push()/pushCard() 旧写法在
   * setMessages updater 内读 nextIdRef.current（自增在外），React 18 并发重放
   * 更新队列时相邻两条消息读到同一 id，FlatList 报「two children with the same
   * key '.$2'」（澄清轮 user + 反问两条相邻 push 必现，logcat 15:17 两次复现）。
   * jest 环境不触发 fabric 的队列重放路径（无法红绿复现），本 describe 以
   * StrictMode 施压并固化不变量：任意轮次后全部消息 id 唯一——结构性修复
   * （id 在 updater 外捕获为闭包常量）在任何重放语义下均成立。
   */
  let latestStrict: ReturnType<typeof useFlashChat> | undefined;

  function StrictProbe(): null {
    latestStrict = useFlashChat();
    return null;
  }

  async function mountStrict(): Promise<void> {
    latestStrict = undefined;
    await act(async () => {
      TestRenderer.create(createElement(StrictMode, null, createElement(StrictProbe)));
    });
  }

  function strictHook(): ReturnType<typeof useFlashChat> {
    if (latestStrict === undefined) throw new Error('hook 未挂载');
    return latestStrict;
  }

  function expectUniqueIds(): void {
    const ids = strictHook().messages.map((message) => message.id);
    expect(new Set(ids).size).toBe(ids.length);
  }

  it('澄清轮（相邻 user+assistant push）：全部消息 id 唯一', async () => {
    await mountStrict();
    await act(async () => {
      await strictHook().send('提醒我吃药');
    });
    expect(strictHook().messages).toHaveLength(3); // user + 反问 + 降级说明
    expectUniqueIds();
  });

  it('出卡轮（push + pushCard 相邻）：全部消息 id 唯一', async () => {
    await mountStrict();
    await act(async () => {
      await strictHook().send('明天上午8点叫我起床');
    });
    expect(strictHook().messages).toHaveLength(2);
    expectUniqueIds();
  });

  it('拦截轮（push + pushConfirm 相邻）：全部消息 id 唯一且 confirm 载荷正常', async () => {
    repo.getSettings.mockResolvedValue(CAREFUL_SETTINGS);
    await mountStrict();
    await act(async () => {
      await strictHook().send('明天开会');
    });
    await act(async () => {
      await strictHook().send('地点在第三会议室');
    });
    const messages = strictHook().messages;
    expect(messages).toHaveLength(4);
    expectUniqueIds();
    expect(messages.filter((message) => message.kind === 'confirm')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 切片 26 阶段 2（AGENTS.md §7.38）：AI 用量展示——远端解析轮在 AI 回复消息尾
// 追加一行用量摘要（formatAiUsageLine）；开关关闭/本地降级轮/设置读取失败不
// 展示；认真模式拦截轮无 AI 回复消息故无用量行（首轮的行不受影响）。
// ---------------------------------------------------------------------------

const USAGE_SNAPSHOT: AiUsageSnapshot = {
  promptTokens: 1000,
  completionTokens: 200,
  cachedPromptTokens: 600,
  estimatedCost: null,
};

/** 信封顶层 usage（切片 26 契约：usage 取自 chat-completions 信封，非模型 JSON）。 */
const RAW_USAGE = {
  prompt_tokens: 1000,
  completion_tokens: 200,
  prompt_tokens_details: { cached_tokens: 600 },
};

function makeEnvelopeWithUsage(wire: RemoteDraftWire, usage: unknown): string {
  return JSON.stringify({
    choices: [{ message: { content: JSON.stringify(wire) } }],
    usage,
  });
}

describe('useFlashChat：AI 用量展示（切片 26 阶段 2，§7.38）', () => {
  /** 带 usage 的远端 fetch mock（轮次按序消费，全部回 200 + 同一 usage）。 */
  function installUsageFetchMock(wires: RemoteDraftWire[]): void {
    globalScope.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as CapturedRequest;
      fetchBodies.push(body);
      const wire = wires.shift() ?? makeWire({});
      return {
        ok: true,
        status: 200,
        text: async () => makeEnvelopeWithUsage(wire, RAW_USAGE),
      } as unknown as Response;
    });
  }

  /** 远端配置 + 指定开关状态（默认开启用量展示）。 */
  function enableRemote(showAiUsage = true, extraSettings: Record<string, unknown> = {}): void {
    SecureStoreClass.mockImplementation(() => ({
      load: jest.fn(async () => REMOTE_CONFIG),
    }));
    repo.getSettings.mockResolvedValue({
      ...DEFAULT_APP_SETTINGS,
      showAiUsage,
      ...extraSettings,
    });
  }

  function usageLines(): string[] {
    return assistantTexts().filter((text) => text.startsWith('📊 用量'));
  }

  afterEach(() => {
    globalScope.fetch = originalFetch;
  });

  it('远端成功轮 + 开关开启：AI 回复后追加用量行（无费用段，紧跟解析说明）', async () => {
    enableRemote();
    installUsageFetchMock([makeWire({})]);
    await mountHook();
    await act(async () => {
      await hook().send('明天上午十点项目周会');
    });

    const lines = usageLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(formatAiUsageLine(USAGE_SNAPSHOT));
    expect(lines[0]).toContain('输入 1000 tokens');
    expect(lines[0]).toContain('缓存 600');
    expect(lines[0]).toContain('输出 200');
    expect(lines[0]).not.toContain('≈'); // 单价未配 → 无费用段
    // 顺序：用量行是最后一条消息（紧跟解析说明之后），仍是普通文本消息。
    const messages = hook().messages;
    expect(messages[messages.length - 1]?.text).toBe(lines[0]);
    expect(messages[messages.length - 1]?.kind).toBe('text');
    // 主链不受影响：卡片照常出。
    expect(hook().draft?.title).toBe('项目周会');
  });

  it('开关默认关闭（旧数据回退 false）：远端成功轮不追加用量行', async () => {
    enableRemote(false);
    installUsageFetchMock([makeWire({})]);
    await mountHook();
    await act(async () => {
      await hook().send('明天上午十点项目周会');
    });

    expect(usageLines()).toHaveLength(0);
    expect(hook().draft).not.toBeNull();
  });

  it('本地降级轮（远端 500）：无 usage 不展示，开关开启也不显示', async () => {
    enableRemote();
    globalScope.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'boom',
    })) as unknown as typeof globalThis.fetch;
    await mountHook();
    await act(async () => {
      await hook().send('明天上午十点项目周会');
    });

    expect(usageLines()).toHaveLength(0);
    expect(hook().draft).not.toBeNull();
  });

  it('设置读取失败回退默认（不展示），主链照常出卡', async () => {
    enableRemote();
    repo.getSettings.mockRejectedValue(new Error('settings unavailable'));
    installUsageFetchMock([makeWire({})]);
    await mountHook();
    await act(async () => {
      await hook().send('明天上午十点项目周会');
    });

    expect(usageLines()).toHaveLength(0);
    expect(hook().draft).not.toBeNull();
  });

  it('单价齐备：用量行含估算费用段（1000×2+200×8 → ≈0.003600）', async () => {
    SecureStoreClass.mockImplementation(() => ({
      load: jest.fn(async () => ({
        active: {
          ...REMOTE_CONFIG.active,
          priceInputPerMillion: 2,
          priceOutputPerMillion: 8,
        },
      })),
    }));
    repo.getSettings.mockResolvedValue({ ...DEFAULT_APP_SETTINGS, showAiUsage: true });
    installUsageFetchMock([makeWire({})]);
    await mountHook();
    await act(async () => {
      await hook().send('明天上午十点项目周会');
    });

    expect(usageLines()).toEqual([
      '📊 用量：输入 1000 tokens（缓存 600） · 输出 200 · ≈0.003600',
    ]);
  });

  it('认真模式拦截轮：无 AI 回复消息故无新增用量行（首轮用量行保留）', async () => {
    enableRemote(true, { carefulMode: true });
    installUsageFetchMock([makeWire({}), makeWire({ content: '改为线上会议' })]);
    await mountHook();
    await act(async () => {
      await hook().send('明天上午十点项目周会');
    });
    await act(async () => {
      await hook().send('会议地点在第三会议室');
    });

    expect(confirmMessages()).toHaveLength(1);
    // turn1 出卡轮的用量行仍在；拦截轮（turn2）不追加第二条。
    expect(usageLines()).toHaveLength(1);
  });
});

describe('useFlashChat：AI 调试入口消息（切片 32，§7.44）', () => {
  /** 与用量 describe 同款远端 fetch mock（轮次按序消费）。 */
  function installDebugFetchMock(wires: RemoteDraftWire[], failure?: { status: number; body: string }): void {
    globalScope.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as CapturedRequest;
      fetchBodies.push(body);
      if (failure !== undefined) {
        return {
          ok: false,
          status: failure.status,
          text: async () => failure.body,
        } as unknown as Response;
      }
      const wire = wires.shift() ?? makeWire({});
      return {
        ok: true,
        status: 200,
        text: async () => makeEnvelopeWithUsage(wire, RAW_USAGE),
      } as unknown as Response;
    });
  }

  /** 远端配置 + 开关状态。 */
  function enableRemoteForDebug(
    extraSettings: Record<string, unknown> = {},
  ): void {
    SecureStoreClass.mockImplementation(() => ({
      load: jest.fn(async () => REMOTE_CONFIG),
    }));
    repo.getSettings.mockResolvedValue({
      ...DEFAULT_APP_SETTINGS,
      ...extraSettings,
    });
  }

  function debugMessages(): FlashChatMessage[] {
    return hook().messages.filter((message) => message.debugPayload !== undefined);
  }

  afterEach(() => {
    globalScope.fetch = originalFetch;
  });

  it('远端成功轮 + showAiRequest 开：入口消息携带 debugPayload（请求体含 model、不含 API Key）', async () => {
    enableRemoteForDebug({ showAiRequest: true });
    installDebugFetchMock([makeWire({})]);
    await mountHook();
    await act(async () => {
      await hook().send('明天上午十点项目周会');
    });

    const debugs = debugMessages();
    expect(debugs).toHaveLength(1);
    expect(debugs[0]?.text).toBe('🔍 AI 调试：点击查看本轮 AI 输入/输出');
    const payload = debugs[0]?.debugPayload;
    expect(payload?.request).not.toBeNull();
    expect(payload?.request).toContain('"model":"test-model"');
    expect(payload?.request).not.toContain('test-api-key');
    expect(payload?.response).not.toBeNull();
    expect(payload?.response).toContain('choices')
    expect(payload?.draft).toContain('项目周会');
  });

  it('远端成功轮 + 两开关全关：无入口消息（现状不变）', async () => {
    enableRemoteForDebug();
    installDebugFetchMock([makeWire({})]);
    await mountHook();
    await act(async () => {
      await hook().send('明天上午十点项目周会');
    });
    expect(debugMessages()).toHaveLength(0);
  });

  it('失败降级轮（HTTP 500 耗尽重试）+ 开关开：入口消息文案区分降级、载荷仍携带', async () => {
    enableRemoteForDebug({ showAiRequest: true, aiRetryMax: 0 });
    installDebugFetchMock([], { status: 500, body: '{"error":{"message":"boom"}}' });
    await mountHook();
    await act(async () => {
      await hook().send('明天上午十点项目周会');
    });

    const debugs = debugMessages();
    expect(debugs).toHaveLength(1);
    expect(debugs[0]?.text).toBe('🔍 AI 调试：远端解析失败已降级，点击查看请求/响应');
    const payload = debugs[0]?.debugPayload;
    expect(payload?.request).toContain('"model":"test-model"');
    expect(payload?.response).toBe('{"error":{"message":"boom"}}');
    // 失败降级轮 draft = 本地兜底草稿（仍有解析结果可查）。
    expect(payload?.draft).toContain('项目周会');
  });

  it('无 Key 本地轮：debug 恒 null，两开关开也无入口消息', async () => {
    SecureStoreClass.mockImplementation(() => ({
      load: jest.fn(async () => null),
    }));
    repo.getSettings.mockResolvedValue({
      ...DEFAULT_APP_SETTINGS,
      showAiRequest: true,
      showAiResponse: true,
    });
    await mountHook();
    await act(async () => {
      await hook().send('明天上午十点项目周会');
    });
    expect(debugMessages()).toHaveLength(0);
  });
});

describe('useFlashChat：已保存条目对话式编辑（切片 34，§7.46 / 提案 D4）', () => {
  // 远端路径前置（认真模式 history 提交 describe 同款）：无 Key 会走本地降级，
  // 降级轮无 targetItemId（提案 §3 边界），update 链测试必须挂远端配置。
  beforeEach(() => {
    fetchBodies.length = 0;
    SecureStoreClass.mockImplementation(() => ({
      load: jest.fn(async () => REMOTE_CONFIG),
    }));
  });

  afterEach(() => {
    globalScope.fetch = originalFetch;
  });

  it('update 落库链：全量 patch + once 集合 replace 差异 + tags 差异 + 「已更新」卡 + 播种带 itemId', async () => {
    repo.getItemById.mockResolvedValue(makeBaselineItem());
    repo.listRemindersByItem.mockResolvedValue([
      makeBaselineReminder('r1', 10),
      makeBaselineReminder('r2', 14),
      makeBaselineReminder('r-weekly', 10, {
        frequency: 'weekly',
        onceAt: null,
        weekdays: [3],
        localTimeHour: 10,
        localTimeMinute: 0,
        startAt: new Date('2030-01-15T10:00:00+08:00').getTime(),
      }),
    ]);
    installFetchMock([
      makeWire({
        targetItemId: 'item-001',
        start: { date: '2030-01-15', time: '14:00' },
        tags: ['学习'],
        reminders: [{ date: '2030-01-15', time: '14:00' }],
      }),
    ]);
    await mountHook();
    await act(async () => {
      await hook().send('改成下午2点，提醒改到2点');
    });
    expect(hook().draft?.targetItemId).toBe('item-001');

    let result!: ConfirmSaveResult;
    await act(async () => {
      result = await hook().confirmSave();
    });
    expect(result.ok).toBe(true);

    // 全量 patch：只含内容字段，无时间字段（时间只走 updateItemTime，§4.24）。
    expect(repo.updateItem).toHaveBeenCalledTimes(1);
    const [updateId, updatePatch] = repo.updateItem.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(updateId).toBe('item-001');
    expect(updatePatch.title).toBe('项目周会');
    expect('startAt' in updatePatch).toBe(false);
    expect('endAt' in updatePatch).toBe(false);
    expect('allDay' in updatePatch).toBe(false);
    expect(repo.updateItemTime).toHaveBeenCalledWith('item-001', {
      startAt: new Date('2030-01-15T14:00:00+08:00').getTime(),
      endAt: null,
      allDay: false,
    });

    // once 集合 replace：基线 10:00 删除；基线 14:00 与 weekly 行保留；
    // 目标 14:00 epoch 已命中基线 → 不重复创建……
    expect(repo.deleteReminder).toHaveBeenCalledTimes(1);
    expect(repo.deleteReminder).toHaveBeenCalledWith('r1');
    expect(repo.createReminder).not.toHaveBeenCalled();

    // tags 差异（normalizeTagName 归一）：目标['学习'] vs 基线['生活']。
    expect(repo.addTagToItem).toHaveBeenCalledWith('item-001', '学习');
    expect(repo.removeTagFromItem).toHaveBeenCalledWith('item-001', 'tag-1');

    // 措辞与卡片快照（toKeep 含 weekly 与 14:00 基线行）。
    const cards = hook().messages.filter((message) => message.kind === 'card');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.text).toBe('已更新《项目周会》');
    expect(cards[0]?.cardPayload?.itemId).toBe('item-001');
    const cardReminderIds = (cards[0]?.cardPayload?.reminders ?? []).map((r) => r.id);
    expect(cardReminderIds).toContain('r2');
    expect(cardReminderIds).toContain('r-weekly');
    expect(cardReminderIds).not.toContain('r1');
    expect(cardReminderIds).toHaveLength(2);

    // 播种带 itemId（D2）：下一轮请求的摘要块渲染「关联条目 id」行（D3 链路）。
    installFetchMock([makeWire({ targetItemId: 'item-001' })]);
    await act(async () => {
      await hook().send('把内容改成复盘纪要');
    });
    const lastBody = JSON.stringify(fetchBodies[fetchBodies.length - 1] ?? {});
    expect(lastBody).toContain('关联条目 id：item-001');
  });

  it('update 新增 once 提醒：目标 epoch 基线没有 → createReminder（提醒增）', async () => {
    repo.getItemById.mockResolvedValue(makeBaselineItem());
    repo.listRemindersByItem.mockResolvedValue([makeBaselineReminder('r1', 10)]);
    installFetchMock([
      makeWire({
        targetItemId: 'item-001',
        start: { date: '2030-01-15', time: '14:00' },
        reminders: [
          { date: '2030-01-15', time: '10:00' },
          { date: '2030-01-15', time: '14:00' },
        ],
      }),
    ]);
    await mountHook();
    await act(async () => {
      await hook().send('提醒改成10点和下午2点');
    });
    await act(async () => {
      await hook().confirmSave();
    });
    // replace：10:00 命中基线保留；14:00 新增创建；无删除。
    expect(repo.deleteReminder).not.toHaveBeenCalled();
    expect(repo.createReminder).toHaveBeenCalledTimes(1);
    expect(repo.createReminder.mock.calls[0]?.[0]).toMatchObject({
      itemId: 'item-001',
      frequency: 'once',
      onceAt: { year: 2030, month: 1, day: 15, hour: 14, minute: 0 },
    });
  });

  it('降级：targetItemId 指向不存在条目 → 按 create 处理 + 披露置首（提案 D4-a）', async () => {
    repo.getItemById.mockResolvedValue(null);
    installFetchMock([makeWire({ targetItemId: 'item-404' })]);
    await mountHook();
    await act(async () => {
      await hook().send('改一下那个条目');
    });
    let result!: ConfirmSaveResult;
    await act(async () => {
      result = await hook().confirmSave();
    });
    expect(result.ok).toBe(true);
    expect(repo.createItem).toHaveBeenCalledTimes(1);
    expect(repo.updateItem).not.toHaveBeenCalled();
    expect(result.notice).toContain('目标条目不存在或已被删除，已按新建处理');
    const cards = hook().messages.filter((message) => message.kind === 'card');
    expect(cards[0]?.text).toBe('已添加《项目周会》');
  });

  it('降级：sourceReadOnly 导入条目 → 按 create 处理 + 披露（只读护栏沿用，提案 D4-a）', async () => {
    repo.getItemById.mockResolvedValue(makeBaselineItem({ sourceReadOnly: true }));
    installFetchMock([makeWire({ targetItemId: 'item-001' })]);
    await mountHook();
    await act(async () => {
      await hook().send('改一下那个条目');
    });
    let result!: ConfirmSaveResult;
    await act(async () => {
      result = await hook().confirmSave();
    });
    expect(result.ok).toBe(true);
    expect(repo.updateItem).not.toHaveBeenCalled();
    expect(repo.createItem).toHaveBeenCalledTimes(1);
    expect(result.notice).toContain('目标条目为外部导入只读条目，已按新建处理');
  });

  it('回归：wire 无 targetItemId → 走 create（全新意图语义不变，§7.46 边界）', async () => {
    installFetchMock([makeWire({})]);
    await mountHook();
    await act(async () => {
      await hook().send('新建条目');
    });
    await act(async () => {
      await hook().confirmSave();
    });
    expect(repo.getItemById).not.toHaveBeenCalled();
    expect(repo.updateItem).not.toHaveBeenCalled();
    expect(repo.createItem).toHaveBeenCalledTimes(1);
    const cards = hook().messages.filter((message) => message.kind === 'card');
    expect(cards[0]?.text).toBe('已添加《项目周会》');
  });
});
