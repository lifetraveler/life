/**
 * chatPersistence 纯函数单测（切片 38 阶段 1，AGENTS.md §7.50 Q2/Q3）：
 * - toPersistedChatMessages：confirm / 调试入口消息（debugPayload）排除，其余全量映射；
 * - fromPersistedChatRows：seq 平铺、card payload 解析失败降级 text、末卡播种
 *   （最后一条带 seedJson 的 card 行；payload 降级不影响 seed 可用性）。
 */

import {
  fromPersistedChatRows,
  parseCardPayload,
  toPersistedChatMessages,
  type RestoredChatState,
} from '../chatPersistence';
import type { FlashChatMessage } from '../useFlashChat';
import type { PersistedChatMessage } from '../../data/ChatMessageRepository';

function makeValidPayloadJson(): string {
  return JSON.stringify({
    itemId: 'item-1',
    title: '起床闹钟',
    content: '',
    type: 'task',
    startAt: 1700000000000,
    endAt: null,
    allDay: false,
    category: { id: 'work', name: '工作', color: '#ff0000', emoji: null },
    reminders: [
      {
        id: 'r1',
        frequency: 'once',
        localTimeHour: 8,
        localTimeMinute: 0,
        weekdays: [],
        dayOfMonth: 1,
        onceAt: { year: 2026, month: 1, day: 1, hour: 8, minute: 0 },
        tzid: 'Asia/Shanghai',
        channels: ['system-notification'],
      },
    ],
  });
}

function makeMessage(overrides: Partial<FlashChatMessage> = {}): FlashChatMessage {
  return {
    id: 1,
    role: 'user',
    text: '明天八点叫我',
    kind: 'text',
    ...overrides,
  };
}

describe('toPersistedChatMessages（persist 过滤映射）', () => {
  it('text/card 全量映射：seq=id、cardPayload JSON.stringify、seedJson 直传', () => {
    const cardMessage = makeMessage({
      id: 2,
      role: 'assistant',
      kind: 'card',
      text: '已保存《起床闹钟》',
      cardPayload: JSON.parse(makeValidPayloadJson()),
      seedJson: '{"title":"起床闹钟"}',
    });
    const result = toPersistedChatMessages([makeMessage(), cardMessage]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      seq: 1,
      role: 'user',
      text: '明天八点叫我',
      kind: 'text',
      cardPayloadJson: null,
      seedJson: null,
    });
    expect(result[1].kind).toBe('card');
    expect(JSON.parse(result[1].cardPayloadJson ?? '')).toMatchObject({ itemId: 'item-1' });
    expect(result[1].seedJson).toBe('{"title":"起床闹钟"}');
  });

  it('confirm 轮与调试入口消息（debugPayload）排除（Q2 瞬态交互态不落库）', () => {
    const result = toPersistedChatMessages([
      makeMessage(),
      makeMessage({ id: 2, kind: 'confirm', confirmPayload: undefined } as Partial<FlashChatMessage> as FlashChatMessage),
      makeMessage({ id: 3, kind: 'text', text: 'AI 服务异常，正在重试（1/3）…', debugPayload: { request: '{}', response: 'x' } } as unknown as FlashChatMessage),
    ]);
    expect(result.map((entry) => entry.seq)).toEqual([1]);
  });

  it('无 cardPayload 的 card（理论态）落库 cardPayloadJson=null，恢复侧降级', () => {
    const result = toPersistedChatMessages([
      makeMessage({ id: 1, role: 'assistant', kind: 'card', text: '卡' }),
    ]);
    expect(result[0].kind).toBe('card');
    expect(result[0].cardPayloadJson).toBeNull();
  });
});

describe('fromPersistedChatRows（启动恢复）', () => {
  function makeRow(overrides: Partial<PersistedChatMessage> = {}): PersistedChatMessage {
    return {
      seq: 1,
      role: 'user',
      text: '明天八点叫我',
      kind: 'text',
      cardPayloadJson: null,
      seedJson: null,
      ...overrides,
    };
  }

  it('seq 升序平铺：id=seq、role/text/kind 原样（nextIdRef 延续由调用方处理）', () => {
    const state: RestoredChatState = fromPersistedChatRows([
      makeRow({ seq: 1 }),
      makeRow({ seq: 2, role: 'assistant', text: '回复' }),
    ]);
    expect(state.messages.map((message) => message.id)).toEqual([1, 2]);
    expect(state.messages[1].role).toBe('assistant');
    expect(state.messages[1].kind).toBe('text');
    expect(state.seedText).toBeNull();
  });

  it('card 行合法 payload：恢复 kind=card + cardPayload 对象', () => {
    const state = fromPersistedChatRows([
      makeRow({
        seq: 2,
        role: 'assistant',
        kind: 'card',
        text: '已保存',
        cardPayloadJson: makeValidPayloadJson(),
      }),
    ]);
    expect(state.messages[0].kind).toBe('card');
    expect(state.messages[0].cardPayload).toMatchObject({ itemId: 'item-1', title: '起床闹钟' });
  });

  it('card 行 payload 解析失败降级 text：text 保留不炸列表（Q3）', () => {
    const state = fromPersistedChatRows([
      makeRow({ seq: 2, role: 'assistant', kind: 'card', text: '残卡', cardPayloadJson: '{"itemId":' }),
    ]);
    expect(state.messages[0].kind).toBe('text');
    expect(state.messages[0].cardPayload).toBeUndefined();
    expect(state.messages[0].text).toBe('残卡');
  });

  it('card 行 cardPayloadJson=null：降级 text', () => {
    const state = fromPersistedChatRows([
      makeRow({ seq: 1, role: 'assistant', kind: 'card', text: '裸卡', cardPayloadJson: null }),
    ]);
    expect(state.messages[0].kind).toBe('text');
  });

  it('末卡播种：最后一条带 seedJson 的 card 行胜出（升序遍历末值覆盖）；text 行 seed 忽略', () => {
    const state = fromPersistedChatRows([
      makeRow({ seq: 1, kind: 'text', seedJson: '{"title":"伪种子"}' }),
      makeRow({ seq: 2, role: 'assistant', kind: 'card', text: '卡一', cardPayloadJson: makeValidPayloadJson(), seedJson: '{"title":"第一张"}' }),
      makeRow({ seq: 3, kind: 'text' }),
      makeRow({ seq: 4, role: 'assistant', kind: 'card', text: '卡二', cardPayloadJson: makeValidPayloadJson(), seedJson: '{"title":"第二张"}' }),
    ]);
    expect(state.seedText).toBe('{"title":"第二张"}');
    // seedJson 纯透传（flash.tsx 不消费）；text 行的 seed 不参与播种选择但字段保留。
    expect(state.messages[0].seedJson).toBe('{"title":"伪种子"}');
    expect(state.messages[3].seedJson).toBe('{"title":"第二张"}');
  });

  it('payload 降级不影响 seed 可用性：seedJson 独立于 cardPayloadJson', () => {
    const state = fromPersistedChatRows([
      makeRow({
        seq: 5,
        role: 'assistant',
        kind: 'card',
        text: '坏卡',
        cardPayloadJson: 'not-json',
        seedJson: '{"title":"可用"}',
      }),
    ]);
    expect(state.messages[0].kind).toBe('text');
    expect(state.seedText).toBe('{"title":"可用"}');
  });
});

describe('parseCardPayload（严格守卫）', () => {
  it('合法载荷通过并保留全部字段', () => {
    const parsed = parseCardPayload(makeValidPayloadJson());
    expect(parsed).toMatchObject({ itemId: 'item-1', type: 'task' });
    expect(parsed?.reminders).toHaveLength(1);
    expect(parsed?.category).toMatchObject({ id: 'work' });
  });

  it('JSON 语法错误/非对象/null 拒绝', () => {
    expect(parseCardPayload('{bad json')).toBeNull();
    expect(parseCardPayload('[1]')).toBeNull();
    expect(parseCardPayload('null')).toBeNull();
  });

  it('字段类型/枚举越界拒绝：type/category/reminders 元素/onceAt/minute', () => {
    expect(parseCardPayload(JSON.stringify({ itemId: 'i', title: 't', content: '', type: 'memo', startAt: null, endAt: null, allDay: false, category: null, reminders: [] }))).toBeNull();
    expect(parseCardPayload(JSON.stringify({ itemId: '', title: 't', content: '', type: 'task', startAt: null, endAt: null, allDay: false, category: null, reminders: [] }))).toBeNull();
    expect(parseCardPayload(JSON.stringify({ itemId: 'i', title: 't', content: '', type: 'task', startAt: 'x', endAt: null, allDay: false, category: null, reminders: [] }))).toBeNull();
    expect(parseCardPayload(JSON.stringify({ itemId: 'i', title: 't', content: '', type: 'task', startAt: null, endAt: null, allDay: 'yes', category: null, reminders: [] }))).toBeNull();
    expect(parseCardPayload(JSON.stringify({ itemId: 'i', title: 't', content: '', type: 'task', startAt: null, endAt: null, allDay: false, category: { id: '', name: 'x', color: null, emoji: null }, reminders: [] }))).toBeNull();
    expect(parseCardPayload(JSON.stringify({ itemId: 'i', title: 't', content: '', type: 'task', startAt: null, endAt: null, allDay: false, category: null, reminders: 'no' }))).toBeNull();
    expect(parseCardPayload(JSON.stringify({ itemId: 'i', title: 't', content: '', type: 'task', startAt: null, endAt: null, allDay: false, category: null, reminders: [{ id: 'r', frequency: 'hourly', localTimeHour: 8, localTimeMinute: 0, weekdays: [], dayOfMonth: 1, onceAt: null, tzid: 'Asia/Shanghai', channels: [] }] }))).toBeNull();
    expect(parseCardPayload(JSON.stringify({ itemId: 'i', title: 't', content: '', type: 'task', startAt: null, endAt: null, allDay: false, category: null, reminders: [{ id: 'r', frequency: 'once', localTimeHour: 8, localTimeMinute: 0, weekdays: [], dayOfMonth: 1, onceAt: { year: 2026, month: 13, day: 1, hour: 8, minute: 0 }, tzid: 'Asia/Shanghai', channels: [] }] }))).toMatchObject({ itemId: 'i' });
    // onceAt 只校验整数性：月历有效性（02-30）由落库层 CivilTime 换算判定（与实现注释一致）；
    // 非整数才拒绝。
    expect(parseCardPayload(JSON.stringify({ itemId: 'i', title: 't', content: '', type: 'task', startAt: null, endAt: null, allDay: false, category: null, reminders: [{ id: 'r', frequency: 'once', localTimeHour: 8, localTimeMinute: 0, weekdays: [], dayOfMonth: 1, onceAt: { year: 'x', month: 1, day: 1, hour: 8, minute: 0 }, tzid: 'Asia/Shanghai', channels: [] }] }))).toBeNull();
    expect(parseCardPayload(JSON.stringify({ itemId: 'i', title: 't', content: '', type: 'task', startAt: null, endAt: null, allDay: false, category: null, reminders: [{ id: 'r', frequency: 'once', localTimeHour: 8, localTimeMinute: 0.5, weekdays: [], dayOfMonth: 1, onceAt: null, tzid: 'Asia/Shanghai', channels: [] }] }))).toBeNull();
    expect(parseCardPayload(JSON.stringify({ itemId: 'i', title: 't', content: '', type: 'task', startAt: null, endAt: null, allDay: false, category: null, reminders: [{ id: 'r', frequency: 'once', localTimeHour: 24, localTimeMinute: 0, weekdays: [], dayOfMonth: 1, onceAt: null, tzid: 'Asia/Shanghai', channels: [] }] }))).toBeNull();
    expect(parseCardPayload(JSON.stringify({ itemId: 'i', title: 't', content: '', type: 'task', startAt: null, endAt: null, allDay: false, category: null, reminders: [{ id: 'r', frequency: 'once', localTimeHour: 8, localTimeMinute: 60, weekdays: [], dayOfMonth: 1, onceAt: null, tzid: 'Asia/Shanghai', channels: [] }] }))).toBeNull();
    expect(parseCardPayload(JSON.stringify({ itemId: 'i', title: 't', content: '', type: 'task', startAt: null, endAt: null, allDay: false, category: null, reminders: [{ id: 'r', frequency: 'once', localTimeHour: 8, localTimeMinute: 0, weekdays: [], dayOfMonth: 1, onceAt: null, tzid: 'Asia/Shanghai', channels: 'alarm' }] }))).toBeNull();
  });
});
