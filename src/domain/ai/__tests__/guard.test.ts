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
