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
 */

import { createElement } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { itemRepository } from '../../data';
import type { ItemRepository } from '../../data';
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
