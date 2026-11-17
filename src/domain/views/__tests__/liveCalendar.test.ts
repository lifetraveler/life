/**
 * buildLiveCalendarEntries 单测（切片 27 阶段 2，AGENTS.md §7.39 D2/D5/D6）。
 *
 * 覆盖：
 * 1. 窗口过滤（窗口外事件不并入；相交语义跨界事件并入）；
 * 2. D2 去重——单事件精确命中（已导入 sourceUid+startAt 相同 → 隐藏）；
 * 3. D2 去重——重复系列只命中被导入首实例，其余实例正常显示（§7.39 冻结口径）；
 * 4. 合成条目字段映射（id/type/sourceReadOnly/tags/category/时间透传）；
 * 5. 日历元数据映射（color/sourceName 查找；缺失日历回退 null）；
 * 6. content-hash sourceUid 路径（externalId 空 → sha256 前 16 位）；
 * 7. 同 id 去重（两个日历含同一 event.id 只出一条）；
 * 8. 下游消费面：groupItemsForAgenda / itemsByDay / layoutDayEvents 可消费
 *    合成条目且不抛（消费字段覆盖）。
 */

import {
  buildLiveCalendarEntries,
  isLiveCalendarEntry,
} from '../liveCalendar';
import type { LiveCalendarEntry } from '../liveCalendar';
import type { SystemCalendarEvent, SystemCalendarInfo } from '../../systemCalendar/types';
import type { ItemWithRelations } from '../../relations/itemWithRelations';
import { groupItemsForAgenda } from '../agenda';
import { itemsByDay } from '../itemsByDay';
import { layoutDayEvents } from '../dayTimeline';

/** 确定性 sha256 stub：sourceUid 路径不校验摘要本身，仅要求确定可分。 */
const sha256 = async (input: string): Promise<string> => `hash(${input})`;

function makeEvent(overrides: Partial<SystemCalendarEvent>): SystemCalendarEvent {
  return {
    externalId: 'evt-1',
    calendarId: 'cal-1',
    title: '团队例会',
    notes: null,
    startDate: 1000,
    endDate: 2000,
    allDay: false,
    ...overrides,
  };
}

function makeCalendar(overrides: Partial<SystemCalendarInfo>): SystemCalendarInfo {
  return { id: 'cal-1', title: '工作日历', color: '#FF8800', sourceName: 'Toki', ...overrides };
}

function makeImported(
  overrides: Partial<ItemWithRelations> & { sourceUid: string; startAt: number },
): ItemWithRelations {
  return {
    id: `imported-${overrides.sourceUid}`,
    type: 'event',
    title: '已导入的系统事件',
    content: '',
    status: 'active',
    endAt: null,
    allDay: false,
    sourceType: 'system-calendar',
    sourceReadOnly: true,
    categoryId: 'other',
    priority: 0,
    createdAt: 0,
    updatedAt: 0,
    tags: [],
    category: null,
    ...overrides,
  };
}

describe('buildLiveCalendarEntries（切片 27 live 合成）', () => {
  test('窗口过滤：窗口外事件不并入，相交语义跨界事件并入', async () => {
    const entries = await buildLiveCalendarEntries({
      events: [
        makeEvent({ externalId: 'before', startDate: 100, endDate: 200 }),
        makeEvent({ externalId: 'cross', startDate: 500, endDate: 1500 }),
        makeEvent({ externalId: 'inside', startDate: 1200, endDate: 1300 }),
        makeEvent({ externalId: 'after', startDate: 2500, endDate: 3000 }),
      ],
      calendars: [makeCalendar({})],
      importedItems: [],
      sha256,
      rangeStartMs: 1000,
      rangeEndMs: 2000,
    });
    // overlapsRange：cross（start<start,end>start）与 inside（start∈[start,end)）入选
    expect(entries.map((entry) => entry.id)).toEqual([
      'live:cross:500',
      'live:inside:1200',
    ]);
  });

  test('D2 去重：已导入项 sourceUid+startAt 精确命中 → live 行隐藏', async () => {
    const entries = await buildLiveCalendarEntries({
      events: [
        makeEvent({ externalId: 'evt-1', startDate: 1000 }),
        makeEvent({ externalId: 'evt-2', startDate: 1000 }),
      ],
      calendars: [makeCalendar({})],
      importedItems: [makeImported({ sourceUid: 'evt-1', startAt: 1000 })],
      sha256,
      rangeStartMs: 0,
      rangeEndMs: 5000,
    });
    expect(entries.map((entry) => entry.sourceUid)).toEqual(['evt-2']);
  });

  test('D2 去重：重复系列只命中被导入首实例，其余实例正常显示（§7.39）', async () => {
    // 重复系列实例共享 event.id（导入缺陷 L10 场景）：导入只落首实例
    // （sourceUid='series', startAt=1000）；live 侧第二实例 startAt=86400000 不同键，
    // 不被隐藏（「相同 startAt」精确命中语义）。
    const entries = await buildLiveCalendarEntries({
      events: [
        makeEvent({ externalId: 'series', startDate: 1000 }),
        makeEvent({ externalId: 'series', startDate: 86400000 }),
      ],
      calendars: [makeCalendar({})],
      importedItems: [makeImported({ sourceUid: 'series', startAt: 1000 })],
      sha256,
      rangeStartMs: 0,
      rangeEndMs: 200000000,
    });
    // 合成 id 同为 live:series:<startAt>，两个实例 startAt 不同 → 两条；
    // 第二实例不被已导入首实例的键命中。
    expect(entries.map((entry) => entry.startAt)).toEqual([86400000]);
  });

  test('非 system-calendar 来源的导入项不参与去重（sourceType 守卫）', async () => {
    const entries = await buildLiveCalendarEntries({
      events: [makeEvent({ externalId: 'evt-1', startDate: 1000 })],
      calendars: [makeCalendar({})],
      importedItems: [
        makeImported({ sourceType: 'ics', sourceUid: 'evt-1', startAt: 1000 }),
        makeImported({ sourceType: 'local', sourceUid: 'evt-1', startAt: 1000 }),
      ],
      sha256,
      rangeStartMs: 0,
      rangeEndMs: 5000,
    });
    expect(entries).toHaveLength(1);
  });

  test('合成条目字段映射（冻结口径：id/type/sourceReadOnly/categoryId/tags）', async () => {
    const entries = await buildLiveCalendarEntries({
      events: [
        makeEvent({
          externalId: 'evt-x',
          title: '  ',
          notes: '带备注',
          startDate: 1000,
          endDate: 2000,
          allDay: true,
        }),
      ],
      calendars: [makeCalendar({})],
      importedItems: [],
      sha256,
      rangeStartMs: 0,
      rangeEndMs: 5000,
    });
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry).toBeDefined();
    expect(entry.id).toBe('live:evt-x:1000');
    expect(entry.type).toBe('event');
    expect(entry.title).toBe('系统日历事件'); // 空白标题回退 SYSTEM_EVENT_FALLBACK_TITLE
    expect(entry.content).toBe('带备注');
    expect(entry.status).toBe('active');
    expect(entry.startAt).toBe(1000);
    expect(entry.endAt).toBe(2000);
    expect(entry.allDay).toBe(true);
    expect(entry.sourceType).toBe('system-calendar');
    expect(entry.sourceUid).toBe('evt-x');
    expect(entry.sourceReadOnly).toBe(true);
    expect(entry.categoryId).toBe('other');
    expect(entry.priority).toBe(0);
    expect(entry.tags).toEqual([]);
    expect(entry.category).toBeNull();
    expect(entry.createdAt).toBe(1000);
    expect(entry.updatedAt).toBe(1000);
  });

  test('日历元数据映射：color/sourceName 查找命中；未知日历回退 null', async () => {
    const entries = await buildLiveCalendarEntries({
      events: [
        makeEvent({ externalId: 'known', calendarId: 'cal-1', startDate: 1000 }),
        makeEvent({ externalId: 'unknown', calendarId: 'cal-ghost', startDate: 1000 }),
      ],
      calendars: [makeCalendar({ color: '#000000', sourceName: 'baikal' })],
      importedItems: [],
      sha256,
      rangeStartMs: 0,
      rangeEndMs: 5000,
    });
    const known = entries.find((entry) => entry.sourceUid === 'known');
    const unknown = entries.find((entry) => entry.sourceUid === 'unknown');
    expect(known?.liveColor).toBe('#000000');
    expect(known?.liveSourceName).toBe('baikal');
    expect(unknown?.liveColor).toBeNull();
    expect(unknown?.liveSourceName).toBeNull();
  });

  test('content-hash sourceUid：externalId 空 → sha256 前 16 位', async () => {
    const entries = await buildLiveCalendarEntries({
      events: [
        makeEvent({ externalId: '   ', calendarId: 'cal-1', startDate: 1000, endDate: 2000 }),
      ],
      calendars: [makeCalendar({})],
      importedItems: [],
      sha256,
      rangeStartMs: 0,
      rangeEndMs: 5000,
    });
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry).toBeDefined();
    // 内容哈希输入=`${calendarId}|${title??''}|${startDate??''}|${endDate??''}`
    // （sourceUid.ts buildContentHashInput；title 非 null 原样进串）
    expect(entry.sourceUid).toBe('hash(cal-1|团队例会|1000|2000)'.slice(0, 16));
    expect(entry.id).toBe(`live:${entry.sourceUid}:1000`);
  });

  test('同 id 去重：两个日历含同一 event.id 时只出一条（首见保留）', async () => {
    const entries = await buildLiveCalendarEntries({
      events: [
        makeEvent({ externalId: 'dup', calendarId: 'cal-1', startDate: 1000 }),
        makeEvent({ externalId: 'dup', calendarId: 'cal-2', startDate: 1000 }),
      ],
      calendars: [makeCalendar({}), makeCalendar({ id: 'cal-2', color: '#00FF00' })],
      importedItems: [],
      sha256,
      rangeStartMs: 0,
      rangeEndMs: 5000,
    });
    expect(entries).toHaveLength(1);
    // 首见保留：元数据取第一个日历（cal-1）
    expect(entries[0]?.liveColor).toBe('#FF8800');
  });

  test('startDate null 事件防御跳过（不抛错）', async () => {
    const entries = await buildLiveCalendarEntries({
      events: [makeEvent({ externalId: 'bad', startDate: null, endDate: null })],
      calendars: [makeCalendar({})],
      importedItems: [],
      sha256,
      rangeStartMs: 0,
      rangeEndMs: 5000,
    });
    expect(entries).toEqual([]);
  });
});

describe('live 条目下游消费面（切片 27：分组/月历/时间轴不抛且可分组）', () => {
  /** 合成两条 live 条目（同日两个时刻），验证三个下游纯函数消费字段覆盖。 */
  async function buildTwoEntries(): Promise<LiveCalendarEntry[]> {
    return buildLiveCalendarEntries({
      events: [
        makeEvent({ externalId: 'a', startDate: 1000, endDate: 2000 }),
        makeEvent({ externalId: 'b', startDate: 5000, endDate: null }),
      ],
      calendars: [makeCalendar({})],
      importedItems: [],
      sha256,
      rangeStartMs: 0,
      rangeEndMs: 10000,
    });
  }

  test('isLiveCalendarEntry 收窄：合成条目 true、普通条目 false', async () => {
    const entries = await buildTwoEntries();
    expect(entries.every((entry) => isLiveCalendarEntry(entry))).toBe(true);
    const imported = makeImported({ sourceUid: 'x', startAt: 1 });
    expect(isLiveCalendarEntry(imported)).toBe(false);
  });

  test('groupItemsForAgenda 可消费 live 条目（按天分组不抛）', async () => {
    const entries = await buildTwoEntries();
    const groups = groupItemsForAgenda(entries, {
      viewKind: 'agenda',
      nowMs: 1000,
      tzid: 'UTC',
    });
    // 两条均 startAt 非 null → 落时间分组（UTC 同一天）
    const total = groups.reduce((sum, group) => sum + group.items.length, 0);
    expect(total).toBe(2);
  });

  test('itemsByDay 可消费 live 条目（月历格分桶不抛）', async () => {
    const entries = await buildTwoEntries();
    const byDay = itemsByDay(entries, 'UTC');
    const total = [...byDay.values()].reduce((sum, list) => sum + list.length, 0);
    expect(total).toBe(2);
  });

  test('layoutDayEvents 可消费 live 条目（时间轴布局不抛）', async () => {
    const entries = await buildTwoEntries();
    const layout = layoutDayEvents(entries, 0);
    // a（endAt 2000，非 allDay）→ timed 块；b（endAt null → DEFAULT_EVENT_MIN 兜底，
    // 非 allDay）→ timed 块；均不抛。
    expect(layout.timedBlocks.length).toBe(2);
    expect(layout.allDayItems).toHaveLength(0);
  });
});
