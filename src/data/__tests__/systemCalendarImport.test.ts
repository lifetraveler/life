import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import type { SystemCalendarEvent } from '../../domain/systemCalendar/types';
import type { Sha256Hex } from '../../domain/systemCalendar/sourceUid';
import ItemModel from '../../db/models/ItemModel';
import ItemTagModel from '../../db/models/ItemTagModel';
import ReminderModel from '../../db/models/ReminderModel';
import TagModel from '../../db/models/TagModel';
import { schema } from '../../db/schema';
import type { SystemCalendarReader } from '../systemCalendarAdapters';
import { WatermelonItemRepository } from '../WatermelonItemRepository';

/**
 * 切片 9 系统日历导入管线的仓库层单测（repository.md v0.9「系统日历导入接口」）：
 * 真实 WatermelonDB + LokiJS 内存适配器（同 importExport 基准）；
 * expo-calendar/expo-crypto 原生模块在 Jest 不可用 → 经构造函数第三参注入
 * 内存 reader 与确定性 sha256 stub；时区固定 Asia/Shanghai。
 */

let dbCounter = 0;

// LokiJS 默认开启 500ms autosave，setInterval 会挂住 Node 事件循环，测试后必须 close。
const createdAdapters: LokiJSAdapter[] = [];

function extractLokiHandle(adapter: LokiJSAdapter): { close: () => void } | null {
  const viaDriver = (adapter as unknown as { _driver?: { loki?: { close: () => void } } })
    ._driver;
  if (viaDriver?.loki) {
    return viaDriver.loki;
  }
  const viaBridge = (
    adapter as unknown as {
      _dispatcher?: { _worker?: { _bridge?: { driver?: { loki?: { close: () => void } } } } };
    }
  )._dispatcher;
  return viaBridge?._worker?._bridge?.driver?.loki ?? null;
}

/** 确定性伪 SHA-256（同 domain/systemCalendar 单测的 stub，FNV-1a 双哈希拼 32 位 hex）。 */
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

interface ReaderCall {
  calendarIds: string[];
  rangeStartMs: number;
  rangeEndMs: number;
}

function makeReader(events: SystemCalendarEvent[], calls: ReaderCall[]): SystemCalendarReader {
  return {
    async requestPermissions() {
      return { granted: true };
    },
    async getCalendars() {
      return [];
    },
    async getEvents(calendarIds, rangeStartMs, rangeEndMs) {
      calls.push({ calendarIds: [...calendarIds], rangeStartMs, rangeEndMs });
      return events;
    },
  };
}

interface TestContext {
  repository: WatermelonItemRepository;
  db: Database;
}

function makeContext(
  events: SystemCalendarEvent[],
  calls: ReaderCall[] = [],
): TestContext {
  dbCounter += 1;
  const adapter = new LokiJSAdapter({
    dbName: `test-system-import-${dbCounter}`,
    schema,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  createdAdapters.push(adapter);
  const database = new Database({
    adapter,
    modelClasses: [ItemModel, TagModel, ItemTagModel, ReminderModel],
  });
  return {
    repository: new WatermelonItemRepository(database, () => 'Asia/Shanghai', {
      reader: makeReader(events, calls),
      sha256: stubSha256,
    }),
    db: database,
  };
}

afterAll(() => {
  for (const adapter of createdAdapters) {
    extractLokiHandle(adapter)?.close();
  }
  createdAdapters.length = 0;
});

/** 范围：2026-11 全月（UTC 毫秒）；事件以此区间为基准构造。 */
const RANGE_START = Date.UTC(2026, 10, 1);
const RANGE_END = Date.UTC(2026, 11, 1);

let eventCounter = 0;

function makeEvent(overrides: Partial<SystemCalendarEvent> = {}): SystemCalendarEvent {
  eventCounter += 1;
  return {
    externalId: `evt-${eventCounter}`,
    calendarId: 'cal-1',
    title: `系统事件 ${eventCounter}`,
    notes: null,
    startDate: Date.UTC(2026, 10, 10, 2, 30),
    endDate: Date.UTC(2026, 10, 10, 3, 30),
    allDay: false,
    ...overrides,
  };
}

/** 直接落一行本地可编辑的 system-calendar 项（sourceReadOnly=false，用于冲突用例）。 */
async function insertEditableSystemCalendarItem(
  db: Database,
  fields: { title: string; sourceUid: string; startAt: number; endAt: number },
): Promise<string> {
  const created = await db.write(() =>
    db.get<ItemModel>('items').create((record) => {
      record.type = 'event';
      record.title = fields.title;
      record.content = '本地创建的条目';
      record.status = 'active';
      record.startAt = fields.startAt;
      record.endAt = fields.endAt;
      record.allDay = false;
      record.sourceType = 'system-calendar';
      record.sourceUid = fields.sourceUid;
      record.sourceReadOnly = false;
    }),
  );
  return created.id;
}

describe('importSystemCalendarEvents', () => {
  // makeEvent 的编号跨用例递增（externalId/title 均含编号）；每例归零，
  // 保证断言里写死的 evt-N / 系统事件 N 与当前用例造出的事件一一对应。
  beforeEach(() => {
    eventCounter = 0;
  });

  it('常规导入：event-id 策略，落库 type=event/sourceType=system-calendar/sourceReadOnly=true', async () => {
    const events = [
      makeEvent({ title: '发布评审', notes: '带备注' }),
      makeEvent({ externalId: 'evt-raw-2', title: '另一场', allDay: true, endDate: null }),
    ];
    const calls: ReaderCall[] = [];
    const { repository } = makeContext(events, calls);

    const result = await repository.importSystemCalendarEvents({
      calendarIds: ['cal-1'],
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
    });

    expect(result).toMatchObject({
      imported: 2,
      skippedDuplicate: 0,
      skippedReadOnlyConflict: 0,
      failed: [],
      totalRead: 2,
      outOfRangeCount: 0,
      sourceUidStrategies: { 'event-id': 2, 'content-hash': 0 },
    });

    const first = await repository.findItemBySource('system-calendar', 'evt-1');
    expect(first).not.toBeNull();
    expect(first).toMatchObject({
      type: 'event',
      title: '发布评审',
      content: '带备注',
      startAt: Date.UTC(2026, 10, 10, 2, 30),
      endAt: Date.UTC(2026, 10, 10, 3, 30),
      allDay: false,
      sourceType: 'system-calendar',
      sourceUid: 'evt-1',
      sourceReadOnly: true,
    });

    // reader 收到去重后的 calendarIds 与原始范围（毫秒直传）。
    expect(calls).toEqual([
      { calendarIds: ['cal-1'], rangeStartMs: RANGE_START, rangeEndMs: RANGE_END },
    ]);
  });

  it('重导同一批事件：imported=0，全部计 skippedDuplicate（验收 8 的单测形态）', async () => {
    const events = [makeEvent(), makeEvent()];
    const calls: ReaderCall[] = [];
    const { repository } = makeContext(events, calls);
    const input = {
      calendarIds: ['cal-1'],
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
    };

    const first = await repository.importSystemCalendarEvents(input);
    expect(first.imported).toBe(2);

    const second = await repository.importSystemCalendarEvents(input);
    expect(second).toMatchObject({
      imported: 0,
      skippedDuplicate: 2,
      totalRead: 2,
      sourceUidStrategies: { 'event-id': 2, 'content-hash': 0 },
    });

    // 库里仍然只有 2 条（不重复插入）。
    const byUid1 = await repository.findItemBySource('system-calendar', 'evt-1');
    const byUid2 = await repository.findItemBySource('system-calendar', 'evt-2');
    expect(byUid1).not.toBeNull();
    expect(byUid2).not.toBeNull();
  });

  it('externalId 缺失 → content-hash 策略，sourceUid=摘要前 16 位', async () => {
    const event = makeEvent({ externalId: null, title: '无 id 事件' });
    const { repository } = makeContext([event]);

    const result = await repository.importSystemCalendarEvents({
      calendarIds: ['cal-1'],
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
    });

    expect(result.imported).toBe(1);
    expect(result.sourceUidStrategies).toEqual({ 'event-id': 0, 'content-hash': 1 });

    const digest = await stubSha256('cal-1|无 id 事件|' + event.startDate + '|' + event.endDate);
    const expectedUid = digest.slice(0, 16);
    const found = await repository.findItemBySource('system-calendar', expectedUid);
    expect(found?.sourceUid).toBe(expectedUid);
  });

  it('命中本地可编辑项（sourceReadOnly=false）→ skippedReadOnlyConflict，且不覆盖该条', async () => {
    const event = makeEvent({ externalId: 'evt-local', title: '系统侧新标题' });
    const { repository, db } = makeContext([event]);
    const localId = await insertEditableSystemCalendarItem(db, {
      title: '本地旧标题',
      sourceUid: 'evt-local',
      startAt: event.startDate as number,
      endAt: event.endDate as number,
    });

    const result = await repository.importSystemCalendarEvents({
      calendarIds: ['cal-1'],
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
    });

    expect(result).toMatchObject({
      imported: 0,
      skippedDuplicate: 0,
      skippedReadOnlyConflict: 1,
    });

    const after = await repository.getItemById(localId);
    expect(after?.title).toBe('本地旧标题');
  });

  it('范围外事件 → outOfRangeCount 计数、不导入', async () => {
    const events = [
      makeEvent({ startDate: Date.UTC(2026, 9, 15), endDate: Date.UTC(2026, 9, 15, 1) }),
      makeEvent({ startDate: Date.UTC(2026, 11, 5), endDate: Date.UTC(2026, 11, 5, 1) }),
    ];
    const { repository } = makeContext(events);

    const result = await repository.importSystemCalendarEvents({
      calendarIds: ['cal-1'],
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
    });

    expect(result).toMatchObject({ imported: 0, totalRead: 2, outOfRangeCount: 2, failed: [] });
  });

  it('startDate 不可解析 → 计入 failed（externalId/title/reason），totalRead 仍计数', async () => {
    const events = [makeEvent({ startDate: null }), makeEvent()];
    const { repository } = makeContext(events);

    const result = await repository.importSystemCalendarEvents({
      calendarIds: ['cal-1'],
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
    });

    expect(result.totalRead).toBe(2);
    expect(result.imported).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({
      externalId: expect.any(String),
      title: '系统事件 1',
    });
    expect(result.failed[0].reason).toContain('startDate 不可解析');
  });

  it('单条失败不阻断其他条（endAt < startAt 落 failed，合法事件照常导入）', async () => {
    const events = [
      makeEvent({
        title: '时间倒挂',
        startDate: Date.UTC(2026, 10, 10, 5, 0),
        endDate: Date.UTC(2026, 10, 10, 4, 0),
      }),
      makeEvent({ title: '正常事件' }),
    ];
    const { repository } = makeContext(events);

    const result = await repository.importSystemCalendarEvents({
      calendarIds: ['cal-1'],
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
    });

    expect(result.imported).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].title).toBe('时间倒挂');
    const ok = await repository.findItemBySource('system-calendar', 'evt-2');
    expect(ok?.title).toBe('正常事件');
  });

  it('calendarIds 去重（重复 id 只读一次）；空列表不出 reader 调用', async () => {
    const events = [makeEvent()];
    const calls: ReaderCall[] = [];
    const { repository } = makeContext(events, calls);

    await repository.importSystemCalendarEvents({
      calendarIds: ['cal-1', 'cal-2', 'cal-1'],
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
    });
    expect(calls[0].calendarIds).toEqual(['cal-1', 'cal-2']);

    calls.length = 0;
    const empty = await repository.importSystemCalendarEvents({
      calendarIds: [],
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
    });
    expect(calls).toHaveLength(0);
    expect(empty).toMatchObject({ imported: 0, totalRead: 0 });
  });

  it('非法范围（start >= end / 非有限数）直接抛错', async () => {
    const { repository } = makeContext([]);
    await expect(
      repository.importSystemCalendarEvents({
        calendarIds: ['cal-1'],
        rangeStartMs: RANGE_END,
        rangeEndMs: RANGE_START,
      }),
    ).rejects.toThrow('rangeStartMs must be earlier than rangeEndMs');
    await expect(
      repository.importSystemCalendarEvents({
        calendarIds: ['cal-1'],
        rangeStartMs: Number.NaN,
        rangeEndMs: RANGE_END,
      }),
    ).rejects.toThrow('must be finite numbers');
  });

  it('150 条事件跨批（100/批）全部导入；allDay 事件按设备时区归一化到当天 00:00', async () => {
    const events: SystemCalendarEvent[] = [];
    for (let i = 0; i < 150; i += 1) {
      events.push(makeEvent({ title: `批量事件 ${i + 1}` }));
    }
    const { repository } = makeContext(events);

    const result = await repository.importSystemCalendarEvents({
      calendarIds: ['cal-1'],
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
    });
    expect(result.imported).toBe(150);

    // allDay：2026-11-10 03:30 +08（= UTC 09:30）→ 归一为 2026-11-10 00:00 +08（UTC 16:00 前一日）。
    const allDayEvent = makeEvent({
      title: '全天事件',
      allDay: true,
      endDate: null,
      startDate: Date.UTC(2026, 10, 9, 19, 30),
    });
    const { repository: repo2 } = makeContext([allDayEvent]);
    const r2 = await repo2.importSystemCalendarEvents({
      calendarIds: ['cal-1'],
      rangeStartMs: RANGE_START,
      rangeEndMs: RANGE_END,
    });
    expect(r2.imported).toBe(1);
    const found = await repo2.findItemBySource('system-calendar', allDayEvent.externalId ?? '');
    expect(found?.allDay).toBe(true);
    expect(found?.startAt).toBe(Date.UTC(2026, 10, 9, 16, 0));
  });
});
