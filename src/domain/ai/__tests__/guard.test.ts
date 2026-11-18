/**
 * isParsedItemDraft / isChatMessageList 校验测试。
 */

import {
  isChatMessageList,
  isParsedItemDraft,
} from '../guard';
import type { RecurrenceRule } from '../../recurrence/types';

/** 返回 object：测试要喂给守卫的就是"任意形状"，非法 override 不该被类型层拦下。 */
function validDraft(overrides: Record<string, unknown> = {}): object {
  return {
    title: '开会',
    content: '',
    type: 'event',
    startAt: 1000,
    endAt: null,
    allDay: false,
    categoryId: 'work',
    tags: ['周会'],
    priority: 2,
    recurrence: null,
    reminderOffsetMinutes: null,
    reminderDelayMinutes: null,
    ...overrides,
  };
}

const validDaily: RecurrenceRule = {
  frequency: 'daily',
  localTime: { hour: 9, minute: 0 },
};

describe('isParsedItemDraft', () => {
  it('接受合法的完整草稿，tags 返回拷贝', () => {
    const tags = ['购物'];
    const draft: unknown = validDraft({ tags });
    const parsed = isParsedItemDraft(draft);
    expect(parsed).not.toBeNull();
    if (parsed === null) return;
    // tags 是浅拷贝：外部改原数组不影响草稿。
    tags.push('垃圾数据');
    expect(parsed.tags).toEqual(['购物']);
  });

  it('全部可空字段为 null 也合法', () => {
    const draft: unknown = validDraft({
      startAt: null,
      allDay: true,
      categoryId: null,
      tags: [],
      priority: null,
      reminderOffsetMinutes: null,
    });
    expect(isParsedItemDraft(draft)).not.toBeNull();
  });

  it('接受未知多余字段（向前兼容）', () => {
    const draft: unknown = { ...validDraft(), extraField: '未来字段' };
    expect(isParsedItemDraft(draft)).not.toBeNull();
  });

  it('拒绝非对象与数组', () => {
    expect(isParsedItemDraft(null)).toBeNull();
    expect(isParsedItemDraft(42)).toBeNull();
    expect(isParsedItemDraft('x')).toBeNull();
    expect(isParsedItemDraft([validDraft()])).toBeNull();
  });

  it('title 必须是非空字符串', () => {
    expect(isParsedItemDraft(validDraft({ title: '' }))).toBeNull();
    expect(isParsedItemDraft(validDraft({ title: 3 }))).toBeNull();
  });

  it('content 必须是字符串', () => {
    expect(isParsedItemDraft(validDraft({ content: 1 }))).toBeNull();
  });

  it('type 必须是 note/task/event', () => {
    expect(isParsedItemDraft(validDraft({ type: 'todo' }))).toBeNull();
  });

  it('startAt/endAt 必须是有限数或 null', () => {
    expect(isParsedItemDraft(validDraft({ startAt: '15' }))).toBeNull();
    expect(isParsedItemDraft(validDraft({ startAt: Number.NaN }))).toBeNull();
    expect(isParsedItemDraft(validDraft({ startAt: Number.POSITIVE_INFINITY }))).toBeNull();
    expect(isParsedItemDraft(validDraft({ endAt: '5点' }))).toBeNull();
  });

  it('allDay 必须是布尔', () => {
    expect(isParsedItemDraft(validDraft({ allDay: 'true' }))).toBeNull();
  });

  it('tags 必须是字符串数组', () => {
    expect(isParsedItemDraft(validDraft({ tags: '购物' }))).toBeNull();
    expect(isParsedItemDraft(validDraft({ tags: [1] }))).toBeNull();
  });

  it('priority 必须是 0..3 整数或 null', () => {
    expect(isParsedItemDraft(validDraft({ priority: 4 }))).toBeNull();
    expect(isParsedItemDraft(validDraft({ priority: 2.5 }))).toBeNull();
    expect(isParsedItemDraft(validDraft({ priority: '2' }))).toBeNull();
  });

  it('reminderOffsetMinutes 必须是 ≥1 整数或 null', () => {
    expect(isParsedItemDraft(validDraft({ reminderOffsetMinutes: 0 }))).toBeNull();
    expect(isParsedItemDraft(validDraft({ reminderOffsetMinutes: -5 }))).toBeNull();
    expect(isParsedItemDraft(validDraft({ reminderOffsetMinutes: 1.5 }))).toBeNull();
    expect(isParsedItemDraft(validDraft({ reminderOffsetMinutes: '30' }))).toBeNull();
  });

  it('reminderDelayMinutes 必须是 ≥1 整数或 null（切片 19 §7.30）', () => {
    expect(isParsedItemDraft(validDraft({ reminderDelayMinutes: 10 }))).not.toBeNull();
    expect(isParsedItemDraft(validDraft({ reminderDelayMinutes: 0 }))).toBeNull();
    expect(isParsedItemDraft(validDraft({ reminderDelayMinutes: -10 }))).toBeNull();
    expect(isParsedItemDraft(validDraft({ reminderDelayMinutes: 2.5 }))).toBeNull();
    expect(isParsedItemDraft(validDraft({ reminderDelayMinutes: '10' }))).toBeNull();
    // 键缺失属于形状不完整：整体拒绝（与 reminderOffsetMinutes 同纪律）。
    const { reminderDelayMinutes: _d, ...noDelay } = validDraft() as Record<string, unknown>;
    expect(isParsedItemDraft(noDelay)).toBeNull();
  });

  it('recurrence 残缺时整体拒绝（不静默降级为单次）', () => {
    expect(isParsedItemDraft(validDraft({ recurrence: { frequency: 'daily' } }))).toBeNull();
    expect(
      isParsedItemDraft(
        validDraft({
          recurrence: { frequency: 'daily', localTime: { hour: 24, minute: 0 } },
        }),
      ),
    ).toBeNull();
    expect(
      isParsedItemDraft(
        validDraft({
          recurrence: {
            frequency: 'weekly',
            weekdays: [0],
            localTime: { hour: 9, minute: 0 },
          },
        }),
      ),
    ).toBeNull();
    expect(
      isParsedItemDraft(
        validDraft({
          recurrence: {
            frequency: 'monthly',
            dayOfMonth: 32,
            localTime: { hour: 9, minute: 0 },
          },
        }),
      ),
    ).toBeNull();
    expect(
      isParsedItemDraft(
        validDraft({
          recurrence: {
            frequency: 'hourly',
            localTime: { hour: 9, minute: 0 },
          },
        }),
      ),
    ).toBeNull();
  });

  it('recurrence 三种合法形状都接受', () => {
    expect(isParsedItemDraft(validDraft({ recurrence: validDaily }))).not.toBeNull();
    expect(
      isParsedItemDraft(
        validDraft({
          recurrence: {
            frequency: 'weekly',
            weekdays: [1, 3, 5],
            localTime: { hour: 20, minute: 30 },
          },
        }),
      ),
    ).not.toBeNull();
    expect(
      isParsedItemDraft(
        validDraft({
          recurrence: {
            frequency: 'monthly',
            dayOfMonth: 15,
            localTime: { hour: 9, minute: 0 },
          },
        }),
      ),
    ).not.toBeNull();
  });
});

describe('isChatMessageList', () => {
  it('接受合法对话列表', () => {
    expect(
      isChatMessageList([
        { role: 'user', text: '提醒我明天开会' },
        { role: 'assistant', text: '好的，已解析' },
      ]),
    ).toBe(true);
  });

  it('拒绝非法 role / 非字符串 text / 非数组', () => {
    expect(isChatMessageList([{ role: 'system', text: 'x' }])).toBe(false);
    expect(isChatMessageList([{ role: 'user', text: 1 }])).toBe(false);
    expect(isChatMessageList('聊天记录')).toBe(false);
  });
});

describe('isParsedItemDraft：澄清与渠道字段（切片 23 §7.35）', () => {
  it('三字段全合法 → 通过并原值返回（渠道数组拷贝）', () => {
    const channels = ['alarm'];
    const input = validDraft({
      needsClarification: true,
      clarificationPrompt: '你要在什么时间提醒你吃药？',
      reminderChannels: channels,
    });
    const value = isParsedItemDraft(input);
    expect(value).not.toBeNull();
    if (value === null) return;
    expect(value.needsClarification).toBe(true);
    expect(value.clarificationPrompt).toBe('你要在什么时间提醒你吃药？');
    expect(value.reminderChannels).toEqual(['alarm']);
    // 渠道数组是浅拷贝：外部改原数组不影响草稿。
    channels.push('污染');
    expect(value.reminderChannels).toEqual(['alarm']);
  });

  it('键缺省（旧版响应）→ 通过：三新字段均为可选（ai.md v0.19 对 v0.17 缺键规则的偏离）', () => {
    expect(isParsedItemDraft(validDraft({}))).not.toBeNull();
  });

  it('非法值整体拒绝：needsClarification 非布尔 / clarificationPrompt 非字符串 / 渠道形状', () => {
    expect(isParsedItemDraft({ ...validDraft({}), needsClarification: 'yes' })).toBeNull();
    expect(isParsedItemDraft({ ...validDraft({}), clarificationPrompt: 123 })).toBeNull();
    expect(isParsedItemDraft({ ...validDraft({}), reminderChannels: [] })).toBeNull();
    expect(isParsedItemDraft({ ...validDraft({}), reminderChannels: ['bogus'] })).toBeNull();
    // expo 家族互斥（§7.30）：system-notification 与 alarm 不得同现
    expect(
      isParsedItemDraft({ ...validDraft({}), reminderChannels: ['system-notification', 'alarm'] }),
    ).toBeNull();
  });

  it('非 expo 互斥组合合法：webhook/apprise 同现', () => {
    const value = isParsedItemDraft({ ...validDraft({}), reminderChannels: ['webhook', 'apprise'] });
    expect(value).not.toBeNull();
    if (value === null) return;
    expect(value.reminderChannels).toEqual(['webhook', 'apprise']);
  });
});

describe('isParsedItemDraft：reminders 绝对时刻提醒（切片 32 §7.44）', () => {
  it('键缺省（旧版响应）→ 通过且 reminders undefined（宽容纪律与澄清三字段同款）', () => {
    const value = isParsedItemDraft(validDraft({}));
    expect(value).not.toBeNull();
    if (value === null) return;
    expect(value.reminders).toBeUndefined();
  });

  it('合法正整数数组 → 通过并返回拷贝', () => {
    const reminders = [1000, 2000, 3000];
    const value = isParsedItemDraft(validDraft({ reminders }));
    expect(value).not.toBeNull();
    if (value === null) return;
    expect(value.reminders).toEqual([1000, 2000, 3000]);
    // 数组浅拷贝：外部改原数组不影响草稿。
    reminders.push(9999);
    expect(value.reminders).toEqual([1000, 2000, 3000]);
  });

  it('值从严整体拒绝：非数组 / 空数组 / 非正整数元素（0、负数、小数、非数字）', () => {
    expect(isParsedItemDraft({ ...validDraft({}), reminders: 'not-array' })).toBeNull();
    expect(isParsedItemDraft({ ...validDraft({}), reminders: [] })).toBeNull();
    expect(isParsedItemDraft({ ...validDraft({}), reminders: [0] })).toBeNull();
    expect(isParsedItemDraft({ ...validDraft({}), reminders: [-1000] })).toBeNull();
    expect(isParsedItemDraft({ ...validDraft({}), reminders: [1.5] })).toBeNull();
    expect(isParsedItemDraft({ ...validDraft({}), reminders: ['1000'] })).toBeNull();
    expect(isParsedItemDraft({ ...validDraft({}), reminders: [1000, null] })).toBeNull();
    expect(isParsedItemDraft({ ...validDraft({}), reminders: [Number.NaN] })).toBeNull();
    expect(isParsedItemDraft({ ...validDraft({}), reminders: [Number.POSITIVE_INFINITY] })).toBeNull();
  });
});
