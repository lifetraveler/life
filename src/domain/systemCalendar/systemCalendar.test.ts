import { filterEventsInRange } from './filterEventsInRange';
import { expandReaderWindow } from './readerWindow';
import {
  SYSTEM_EVENT_FALLBACK_TITLE,
  mapSystemEventToImportedItem,
  systemEventDisplayTitle,
} from './mapSystemEvent';
import { buildContentHashInput, resolveSystemEventSourceUid } from './sourceUid';
import type { Sha256Hex } from './sourceUid';
import type { SystemCalendarEvent } from './types';

/**
 * 切片 9 领域单测：sourceUid 解析（event-id / content-hash）、事件映射、范围过滤。
 * expo-crypto 原生模块在 Jest 不可用 → 注入确定性 stub，只验证管线行为
 * （同输入恒定、异输入互异、取前 16 位）。
 */

/** 确定性伪 SHA-256（FNV-1a 双哈希拼 32 位 hex）：仅满足「确定性 + 分布性」断言需要。 */
const stubSha256: Sha256Hex = async (input: string): Promise<string> => {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h1 ^= input.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  let h2 = 0x9e3779b9 ^ input.length;
  for (let i = input.length - 1; i >= 0; i -= 1) {
    h2 = Math.imul(h2 ^ input.charCodeAt(i), 0x85ebca6b);
  }
  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
  return `${hex(h1)}${hex(h2)}${hex(h1 ^ h2)}${hex(h2 ^ h1)}`;
};

function makeEvent(overrides: Partial<SystemCalendarEvent> = {}): SystemCalendarEvent {
  return {
    externalId: 'ev-1',
    calendarId: 'cal-1',
    title: '团队周会',
    notes: null,
    startDate: 1000,
    endDate: 2000,
    allDay: false,
    ...overrides,
  };
}

describe('buildContentHashInput', () => {
  it('按任务卡格式拼接 calendarId|title|startAt|endAt', () => {
    expect(
      buildContentHashInput({ calendarId: 'cal1', title: 'T', startDate: 123, endDate: 456 }),
    ).toBe('cal1|T|123|456');
  });

  it('title 为 null 与 endAt 为 null 时以空串占位（保持分隔符结构）', () => {
    expect(
      buildContentHashInput({ calendarId: 'cal1', title: null, startDate: 123, endDate: null }),
    ).toBe('cal1||123|');
  });
});

describe('resolveSystemEventSourceUid', () => {
  it('event.id 非空 → 直接使用 event.id，策略 event-id（§7.15 优先级）', async () => {
    const result = await resolveSystemEventSourceUid(makeEvent({ externalId: 'native-42' }), stubSha256);
    expect(result).toEqual({ sourceUid: 'native-42', strategy: 'event-id' });
  });

  it.each([null, '', '   '])('event.id=%p → 内容哈希前 16 位，策略 content-hash', async (externalId) => {
    const event = makeEvent({ externalId });
    const result = await resolveSystemEventSourceUid(event, stubSha256);
    const digest = await stubSha256(buildContentHashInput(event));
    expect(result.strategy).toBe('content-hash');
    expect(result.sourceUid).toBe(digest.slice(0, 16));
    expect(result.sourceUid).toHaveLength(16);
  });

  it('同一事件（无 id）多次解析结果恒定（确定性）', async () => {
    const event = makeEvent({ externalId: null, title: '稳定事件', startDate: 5000, endDate: null });
    const first = await resolveSystemEventSourceUid(event, stubSha256);
    const second = await resolveSystemEventSourceUid(event, stubSha256);
    expect(first.sourceUid).toBe(second.sourceUid);
  });

  it('标题/开始时刻不同 → 内容哈希不同（去重键互异）', async () => {
    const base = makeEvent({ externalId: null });
    const otherTitle = await resolveSystemEventSourceUid(
      { ...base, title: '另一个标题' },
      stubSha256,
    );
    const otherStart = await resolveSystemEventSourceUid(
      { ...base, startDate: 1100 },
      stubSha256,
    );
    const original = await resolveSystemEventSourceUid(base, stubSha256);
    expect(new Set([original.sourceUid, otherTitle.sourceUid, otherStart.sourceUid]).size).toBe(3);
  });
});

describe('mapSystemEventToImportedItem', () => {
  it('常规事件：字段按任务卡规则映射，sourceUid/strategy 透传', async () => {
    const mapped = await mapSystemEventToImportedItem(
      makeEvent({ externalId: 'ev-9', title: '发布评审', notes: '带笔记', allDay: false }),
      stubSha256,
    );
    expect(mapped.input).toEqual({
      title: '发布评审',
      content: '带笔记',
      startAt: 1000,
      endAt: 2000,
      allDay: false,
      sourceUid: 'ev-9',
    });
    expect(mapped.strategy).toBe('event-id');
    expect(mapped.sourceUid).toBe('ev-9');
  });

  it.each([
    [null, SYSTEM_EVENT_FALLBACK_TITLE],
    ['   ', SYSTEM_EVENT_FALLBACK_TITLE],
  ])('title=%p → 回退「系统日历事件」', async (title, expected) => {
    const mapped = await mapSystemEventToImportedItem(makeEvent({ title }), stubSha256);
    expect(mapped.input.title).toBe(expected);
  });

  it('notes 为 null → content 为空串；endDate 为 null → endAt 为 null', async () => {
    const mapped = await mapSystemEventToImportedItem(
      makeEvent({ externalId: null, notes: null, endDate: null }),
      stubSha256,
    );
    expect(mapped.input.content).toBe('');
    expect(mapped.input.endAt).toBeNull();
    expect(mapped.input.allDay).toBe(false);
  });

  it('allDay=true 沿用系统事件标记', async () => {
    const mapped = await mapSystemEventToImportedItem(
      makeEvent({ allDay: true, endDate: null }),
      stubSha256,
    );
    expect(mapped.input.allDay).toBe(true);
  });

  it('startDate 缺失/不可解析 → 抛错（调用方记入 failed 清单）', async () => {
    await expect(
      mapSystemEventToImportedItem(makeEvent({ startDate: null }), stubSha256),
    ).rejects.toThrow(/startDate 不可解析/);
    await expect(
      mapSystemEventToImportedItem(makeEvent({ startDate: Number.NaN }), stubSha256),
    ).rejects.toThrow(/startDate 不可解析/);
  });

  it('content-hash 策略下 sourceUid 同步写入 input.sourceUid', async () => {
    const mapped = await mapSystemEventToImportedItem(makeEvent({ externalId: null }), stubSha256);
    expect(mapped.strategy).toBe('content-hash');
    expect(mapped.input.sourceUid).toBe(mapped.sourceUid);
  });
});

describe('systemEventDisplayTitle', () => {
  it('空白/null → 回退标题；非空白 → trim 后原文', () => {
    expect(systemEventDisplayTitle(null)).toBe(SYSTEM_EVENT_FALLBACK_TITLE);
    expect(systemEventDisplayTitle('  ')).toBe(SYSTEM_EVENT_FALLBACK_TITLE);
    expect(systemEventDisplayTitle('  会议  ')).toBe('会议');
  });
});

describe('filterEventsInRange', () => {
  // 范围 [100, 200)，语义与 overlapsRange 一致（左闭右开 + 跨范围）。
  const START = 100;
  const END = 200;

  it('startAt ∈ [start, end) → 纳入', () => {
    expect(filterEventsInRange([makeEvent({ startDate: 150, endDate: 180 })], START, END)).toHaveLength(1);
    expect(filterEventsInRange([makeEvent({ startDate: 100, endDate: 150 })], START, END)).toHaveLength(1);
  });

  it('startAt = end（右开）→ 排除', () => {
    expect(filterEventsInRange([makeEvent({ startDate: 200, endDate: 300 })], START, END)).toHaveLength(0);
  });

  it('跨范围（startAt < start 且 endAt > start）→ 纳入', () => {
    expect(filterEventsInRange([makeEvent({ startDate: 50, endDate: 150 })], START, END)).toHaveLength(1);
  });

  it('已结束（endAt = start 或 startAt < start 且 endAt null）→ 排除', () => {
    expect(filterEventsInRange([makeEvent({ startDate: 50, endDate: 100 })], START, END)).toHaveLength(0);
    expect(filterEventsInRange([makeEvent({ startDate: 50, endDate: null })], START, END)).toHaveLength(0);
  });

  it('startDate 不可解析 → 排除（上游应已分流为 failed，此处为防御）', () => {
    expect(filterEventsInRange([makeEvent({ startDate: null, endDate: 150 })], START, END)).toHaveLength(0);
  });

  it('全部落选 → 空数组', () => {
    const events = [
      makeEvent({ startDate: 10, endDate: 20 }),
      makeEvent({ startDate: 300, endDate: 400 }),
    ];
    expect(filterEventsInRange(events, START, END)).toEqual([]);
  });
});

describe('expandReaderWindow', () => {
  const START = 1_000_000;
  const END = 2_000_000;

  it('两侧各外扩 READER_WINDOW_WIDEN_MS（1 天）', () => {
    const w = expandReaderWindow(START, END);
    expect(w.startMs).toBe(START - 86_400_000);
    expect(w.endMs).toBe(END + 86_400_000);
  });

  it('不修改调用方传入的原始值', () => {
    let s = START;
    let e = END;
    expandReaderWindow(s, e);
    expect(s).toBe(START);
    expect(e).toBe(END);
  });

  it('外扩幅度覆盖「昨天开始今天结束」的跨范围事件', () => {
    // 事件开始于 rangeStart - 12h、结束于 rangeStart + 2h：原生包含式查询会丢弃它，
    // 外扩后 BEGIN(= rangeStart-12h) >= readerStart(= rangeStart-24h) 且 END <= readerEnd → 能返回。
    const rangeStart = 100_000;
    const eventBegin = rangeStart - 12 * 60 * 60 * 1000;
    const w = expandReaderWindow(rangeStart, rangeStart + 86_400_000);
    expect(eventBegin >= w.startMs).toBe(true);
  });
});
