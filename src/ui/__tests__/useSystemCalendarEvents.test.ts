/**
 * useSystemCalendarEvents / useSystemCalendarList 单测（切片 27 阶段 2，AGENTS.md §7.39 D6）。
 *
 * react-test-renderer 探针模式挂载真实 hook（useFlashChat.test.ts 先例）；
 * reader 端口注入内存实现（WatermelonItemRepository 构造注入同一先例），
 * expo-calendar / expo-crypto 仅 mock 模块面（生产实现不被调用）。
 * expo-router useFocusEffect mock 为可手动触发（回页签 bypass 重读验证）；
 * react-native AppState mock 捕获 listener（回前台 bypass 重读验证）。
 *
 * 覆盖：
 * - events hook：未选日历 disabled / web 早退 / 权限拒绝 / 防抖读取 /
 *   缓存命中不重读（矩阵 5）/ 回页签+回前台 bypass 重读（矩阵 6）/
 *   读取失败 error 保留旧 events / retryPermissions 重授权后恢复读取；
 * - list hook：enabled=false 不申请权限（挂载不弹窗）/ granted 出清单 /
 *   denied no-permission / getCalendars 抛错 error / reload 重试。
 */

import { createElement } from 'react';
import TestRenderer, { act } from 'react-test-renderer';


import { AppState, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { useSystemCalendarEvents, useSystemCalendarList } from '../useSystemCalendarEvents';
import type { UseSystemCalendarEventsParams } from '../useSystemCalendarEvents';
import type { SystemCalendarReader } from '../../data/systemCalendarAdapters';
import type {
  SystemCalendarEvent,
  SystemCalendarInfo,
} from '../../domain/systemCalendar/types';

jest.mock('expo-calendar', () => ({
  EntityTypes: { EVENT: 'EVENT' },
  getCalendarsAsync: jest.fn(async () => []),
}));

jest.mock('expo-crypto', () => ({
  Crypto: { digestStringAsync: jest.fn(async () => '0'.repeat(64)) },
}));

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
}));

type AppStateChangeHandler = (state: string) => void;
let appStateHandler: AppStateChangeHandler | null = null;
let appStateSpy: jest.SpyInstance | null = null;

/** 捕获 AppState listener（回前台 bypass 重读验证用；卸载时 mockRestore）。 */
function captureAppStateListener(): void {
  appStateSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(((type: unknown, handler: unknown) => {
      appStateHandler = handler as AppStateChangeHandler;
      return {
        remove: (): void => {
          appStateHandler = null;
        },
      };
    }) as unknown as typeof AppState.addEventListener);
}

function makeEvent(overrides: Partial<SystemCalendarEvent>): SystemCalendarEvent {
  return {
    externalId: 'evt-1',
    calendarId: 'cal-1',
    title: '系统例会',
    notes: null,
    startDate: 1000,
    endDate: 2000,
    allDay: false,
    ...overrides,
  };
}

/** 内存 reader：requestPermissions/getCalendars/getEvents 全部 jest.fn 可断言。 */
function makeReader(overrides: {
  requestPermissions?: SystemCalendarReader['requestPermissions'];
  getCalendars?: SystemCalendarReader['getCalendars'];
  getEvents?: SystemCalendarReader['getEvents'];
}): SystemCalendarReader {
  return {
    requestPermissions: jest.fn(
      overrides.requestPermissions ?? (async () => ({ granted: true })),
    ),
    getCalendars: jest.fn(overrides.getCalendars ?? (async () => [])),
    getEvents: jest.fn(overrides.getEvents ?? (async () => [makeEvent({})])),
  };
}

type EventsResult = ReturnType<typeof useSystemCalendarEvents>;
type ListResult = ReturnType<typeof useSystemCalendarList>;

let latestEvents: EventsResult | undefined;
let latestList: ListResult | undefined;
let eventsParams: UseSystemCalendarEventsParams = {
  calendarIds: [],
  windowStartMs: 0,
  windowEndMs: 100,
};

function EventsProbe(): null {
  latestEvents = useSystemCalendarEvents(eventsParams);
  return null;
}

function ListProbe(): null {
  latestList = useSystemCalendarList({ enabled: listEnabled, reader: listReader });
  return null;
}

let renderer: ReturnType<typeof TestRenderer.create> | null = null;
let listRenderer: ReturnType<typeof TestRenderer.create> | null = null;

let listEnabled = false;
let listReader: SystemCalendarReader = makeReader({});

async function mountEvents(params: UseSystemCalendarEventsParams): Promise<void> {
  eventsParams = params;
  await act(async () => {
    renderer = TestRenderer.create(createElement(EventsProbe));
  });
}

async function updateEvents(params: UseSystemCalendarEventsParams): Promise<void> {
  eventsParams = params;
  await act(async () => {
    renderer?.update(createElement(EventsProbe));
  });
}

async function mountList(enabled: boolean, reader: SystemCalendarReader): Promise<void> {
  listEnabled = enabled;
  listReader = reader;
  await act(async () => {
    listRenderer = TestRenderer.create(createElement(ListProbe));
  });
}

/** 排空微任务队列（async mock 链多跳 then 的落定；fake timers 下不推进真实时钟）。 */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function focusEffectCallback(): () => void {
  const calls = (useFocusEffect as unknown as jest.Mock).mock.calls;
  const last = calls[calls.length - 1]?.[0];
  if (typeof last !== 'function') {
    throw new Error('useFocusEffect 未注册回调');
  }
  return last as () => void;
}

function appStateListener(): AppStateChangeHandler {
  if (appStateHandler === null) {
    throw new Error('AppState listener 未注册');
  }
  return appStateHandler;
}

const WIN_A = { calendarIds: ['cal-1'], windowStartMs: 0, windowEndMs: 1000 };
const WIN_B = { calendarIds: ['cal-1'], windowStartMs: 1000, windowEndMs: 2000 };

let originalPlatformOs: string;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  originalPlatformOs = Platform.OS;
  captureAppStateListener();
});

afterEach(async () => {
  if (Object.getOwnPropertyDescriptor(Platform, 'OS')?.configurable === true) {
    Object.defineProperty(Platform, 'OS', { value: originalPlatformOs, configurable: true });
  }
  appStateSpy?.mockRestore();
  appStateSpy = null;
  appStateHandler = null;
  renderer?.unmount();
  listRenderer?.unmount();
  renderer = null;
  listRenderer = null;
  jest.useRealTimers();
});

describe('useSystemCalendarEvents（切片 27 live 读取）', () => {
  test('未选日历：disabled，不申请权限不读取', async () => {
    const reader = makeReader({});
    await mountEvents({ ...WIN_A, calendarIds: [], reader });
    await flushMicrotasks();
    jest.advanceTimersByTime(1000);
    await flushMicrotasks();
    expect(latestEvents?.status).toBe('disabled');
    expect(latestEvents?.events).toEqual([]);
    expect(reader.requestPermissions).not.toHaveBeenCalled();
    expect(reader.getEvents).not.toHaveBeenCalled();
  });

  test('web 平台早退：disabled，不读取', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    const reader = makeReader({});
    await mountEvents({ ...WIN_A, reader });
    await flushMicrotasks();
    jest.advanceTimersByTime(1000);
    await flushMicrotasks();
    expect(latestEvents?.status).toBe('disabled');
    expect(latestEvents?.events).toEqual([]);
    expect(reader.getEvents).not.toHaveBeenCalled();
  });

  test('权限拒绝：no-permission，不读取；retryPermissions 授权后恢复读取', async () => {
    const reader = makeReader({
      requestPermissions: jest.fn(async () => ({ granted: false })),
    });
    await mountEvents({ ...WIN_A, reader });
    await flushMicrotasks();
    expect(latestEvents?.status).toBe('no-permission');
    expect(reader.getEvents).not.toHaveBeenCalled();

    // 「重新授权」：换 granted 实现后重试（expo 已授权时直接返回不弹窗语义）
    (reader.requestPermissions as unknown as jest.Mock).mockImplementation(
      async () => ({ granted: true }),
    );
    await act(async () => {
      latestEvents?.retryPermissions();
    });
    await flushMicrotasks();
    // 恢复读取（防抖后）
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await flushMicrotasks();
    expect(latestEvents?.status).toBe('ready');
    expect(reader.getEvents).toHaveBeenCalledWith(['cal-1'], 0, 1000);
  });

  test('授权后窗口读取：300ms 防抖、参数透传、events 就绪', async () => {
    const reader = makeReader({
      getEvents: jest.fn(async () => [makeEvent({}), makeEvent({ externalId: 'evt-2' })]),
    });
    await mountEvents({ ...WIN_A, reader });
    await flushMicrotasks();
    expect(reader.getEvents).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await flushMicrotasks();
    expect(reader.getEvents).toHaveBeenCalledTimes(1);
    expect(reader.getEvents).toHaveBeenCalledWith(['cal-1'], 0, 1000);
    expect(latestEvents?.status).toBe('ready');
    expect(latestEvents?.events).toHaveLength(2);
  });

  test('矩阵 5：切窗再切回已看窗口命中缓存，不重复读取', async () => {
    let callCount = 0;
    const reader = makeReader({
      getEvents: jest.fn(async () => {
        callCount += 1;
        return [makeEvent({ externalId: `call-${callCount}` })];
      }),
    });
    await mountEvents({ ...WIN_A, reader });
    await flushMicrotasks();
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await flushMicrotasks();
    // 切窗口 B（防抖后第 2 次读取）
    await updateEvents({ ...WIN_B, reader });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await flushMicrotasks();
    expect(reader.getEvents).toHaveBeenCalledTimes(2);
    // 切回 A：缓存命中（即时显示 call-1，不重读）
    await updateEvents({ ...WIN_A, reader });
    expect(latestEvents?.events.map((event) => event.externalId)).toEqual(['call-1']);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await flushMicrotasks();
    expect(reader.getEvents).toHaveBeenCalledTimes(2);
    expect(latestEvents?.status).toBe('ready');
  });

  test('矩阵 6：回页签（useFocusEffect）绕过缓存重读当前窗口', async () => {
    const reader = makeReader({});
    await mountEvents({ ...WIN_A, reader });
    await flushMicrotasks();
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await flushMicrotasks();
    expect(reader.getEvents).toHaveBeenCalledTimes(1);
    // 模拟回到本页签：bypass 缓存
    await act(async () => {
      focusEffectCallback()();
    });
    await flushMicrotasks();
    expect(reader.getEvents).toHaveBeenCalledTimes(2);
    expect(latestEvents?.status).toBe('ready');
  });

  test('矩阵 6：AppState 回前台绕过缓存重读当前窗口', async () => {
    const reader = makeReader({});
    await mountEvents({ ...WIN_A, reader });
    await flushMicrotasks();
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await flushMicrotasks();
    expect(reader.getEvents).toHaveBeenCalledTimes(1);
    await act(async () => {
      appStateListener()('active');
    });
    await flushMicrotasks();
    expect(reader.getEvents).toHaveBeenCalledTimes(2);
  });

  test('读取失败：status=error，保留旧 events 不清空', async () => {
    const reader = makeReader({
      getEvents: jest.fn(async () => [makeEvent({})]),
    });
    await mountEvents({ ...WIN_A, reader });
    await flushMicrotasks();
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await flushMicrotasks();
    expect(latestEvents?.status).toBe('ready');
    // 下一次读取失败（回前台触发 bypass 重读）
    (reader.getEvents as unknown as jest.Mock).mockRejectedValueOnce(
      new Error('reader unavailable'),
    );
    await act(async () => {
      appStateListener()('active');
    });
    await flushMicrotasks();
    expect(latestEvents?.status).toBe('error');
    expect(latestEvents?.events).toHaveLength(1);
  });
});

describe('useSystemCalendarList（筛选面板日历清单）', () => {
  function makeCalendar(overrides: Partial<SystemCalendarInfo>): SystemCalendarInfo {
    return { id: 'cal-1', title: '工作日历', color: '#FF8800', sourceName: 'Toki', ...overrides };
  }

  test('enabled=false：不申请权限（plan 页挂载不弹窗），状态 loading', async () => {
    const reader = makeReader({});
    await mountList(false, reader);
    await flushMicrotasks();
    expect(latestList?.status).toBe('loading');
    expect(latestList?.calendars).toEqual([]);
    expect(reader.requestPermissions).not.toHaveBeenCalled();
  });

  test('enabled=true + 授权：ready 出清单', async () => {
    const reader = makeReader({
      getCalendars: jest.fn(async () => [
        makeCalendar({}),
        makeCalendar({ id: 'cal-2', sourceName: null }),
      ]),
    });
    await mountList(true, reader);
    await flushMicrotasks();
    expect(latestList?.status).toBe('ready');
    expect(latestList?.calendars).toHaveLength(2);
  });

  test('enabled=true + 拒绝：no-permission（面板提示+重新授权路径）', async () => {
    const reader = makeReader({ requestPermissions: async () => ({ granted: false }) });
    await mountList(true, reader);
    await flushMicrotasks();
    expect(latestList?.status).toBe('no-permission');
    expect(latestList?.calendars).toEqual([]);
  });

  test('getCalendars 抛错：error（重试按钮路径）', async () => {
    const reader = makeReader({
      getCalendars: jest.fn(async () => {
        throw new Error('provider unavailable');
      }),
    });
    await mountList(true, reader);
    await flushMicrotasks();
    expect(latestList?.status).toBe('error');
    expect(latestList?.calendars).toEqual([]);
  });

  test('reload：重走 requestPermissions + getCalendars', async () => {
    const reader = makeReader({
      getCalendars: jest.fn(async () => [makeCalendar({})]),
    });
    await mountList(true, reader);
    await flushMicrotasks();
    expect(reader.getCalendars).toHaveBeenCalledTimes(1);
    await act(async () => {
      latestList?.reload();
    });
    await flushMicrotasks();
    expect(reader.getCalendars).toHaveBeenCalledTimes(2);
    expect(latestList?.status).toBe('ready');
  });
});
