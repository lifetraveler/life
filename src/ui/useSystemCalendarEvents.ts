/**
 * 切片 27（AGENTS.md §7.39 D6）：系统日历 live 直读 hook（UI 层，不落库）。
 *
 * useSystemCalendarEvents：按 (calendarIds, 窗口) 读取系统事件，供 plan.tsx 经
 * buildLiveCalendarEntries 合成视图条目后并入四视图。刷新时机冻结：窗口变化
 * （300ms 防抖）+ AppState 回前台 + useFocusEffect，不做后台轮询。
 * 缓存：per (calendarIds, windowKey) 内存缓存——切回已看窗口直接命中不重读；
 * 回前台/回页签刷新绕过缓存（外部增删事件可见）。缓存超 64 个窗口整体清空
 * （防长会话无界增长，MVP 取舍，如实记录）。
 *
 * useSystemCalendarList：筛选面板「日历显示」区消费——读取设备日历清单 +
 * 权限态，供分组渲染与「重新授权」。
 *
 * 边界：web 平台早退（expo-calendar 无 web 实现）；reader 端口可注入内存实现
 * 供单测（WatermelonItemRepository 构造注入同一先例）；本文件不触碰数据库。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { expoSystemCalendarReader } from '../data/systemCalendarAdapters';
import type { SystemCalendarReader } from '../data/systemCalendarAdapters';
import type { SystemCalendarEvent, SystemCalendarInfo } from '../domain/systemCalendar/types';

/** live 事件缓存容量上限（窗口数；超过整体清空）。 */
const LIVE_CACHE_MAX_WINDOWS = 64;
/** 窗口变化防抖（ms）。 */
const WINDOW_DEBOUNCE_MS = 300;
/**
 * requestPermissions 兜底超时（ms）。真机（MuMu 12 / Android 15）复现：
 * 用户拒绝一次后 canAskAgain=false，系统对后续权限请求以「秒杀
 * GrantPermissionsActivity」方式自动拒绝，expo-calendar 15.0.8 该路径的
 * JS promise 永不落定（既不 resolve 也不 reject），面板会卡在 loading。
 * 超时按拒绝处理（denied），恢复路径仍走 doFetch 自愈/重新授权按钮。
 */
const PERMISSION_REQUEST_TIMEOUT_MS = 8000;

/** 给 reader.requestPermissions 套超时兜底（超时=reject，所有调用点均按拒绝处理）。 */
function requestPermissionsWithTimeout(
  reader: SystemCalendarReader,
): Promise<{ granted: boolean }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('permission request timeout'));
    }, PERMISSION_REQUEST_TIMEOUT_MS);
    reader
      .requestPermissions()
      .then((response) => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

/** 状态枚举显式化：plan.tsx/面板按态渲染（无权限/加载中/错误互斥）。 */
export type SystemCalendarEventsStatus =
  | 'disabled' // web 或未选日历（displayCalendarIds 空）
  | 'no-permission' // 权限拒绝（面板提示 + 重新授权）
  | 'loading' // 首次读取中
  | 'ready' // 当前窗口有数据（缓存命中或读取完成）
  | 'error'; // 读取失败（保留旧数据）

export interface UseSystemCalendarEventsParams {
  /** 选中的系统日历 id（settings.displayCalendarIds）；空数组 = 功能关闭。 */
  calendarIds: string[];
  /** live 窗口起点（含）。 */
  windowStartMs: number;
  /** live 窗口终点（不含）。 */
  windowEndMs: number;
  /** 端口注入（单测内存实现）；缺省用生产 expo 实现。 */
  reader?: SystemCalendarReader;
}

export interface UseSystemCalendarEventsResult {
  events: SystemCalendarEvent[];
  status: SystemCalendarEventsStatus;
  /** 权限拒绝态的「重新授权」：重走 requestPermissions（expo 已授权时直接返回不弹窗）。 */
  retryPermissions: () => void;
}

const noop = (): void => undefined;

export function useSystemCalendarEvents(
  params: UseSystemCalendarEventsParams,
): UseSystemCalendarEventsResult {
  const { calendarIds, windowStartMs, windowEndMs } = params;
  const reader = params.reader ?? expoSystemCalendarReader;
  const isWeb = Platform.OS === 'web';
  const enabled = !isWeb && calendarIds.length > 0;

  const idsKey = useMemo(() => calendarIds.join(','), [calendarIds]);
  const windowKey = `${idsKey}@${windowStartMs}-${windowEndMs}`;

  const [events, setEvents] = useState<SystemCalendarEvent[]>([]);
  const [status, setStatus] = useState<SystemCalendarEventsStatus>('disabled');
  const [permissionState, setPermissionState] = useState<'unknown' | 'granted' | 'denied'>(
    'unknown',
  );

  const cacheRef = useRef<Map<string, SystemCalendarEvent[]>>(new Map());
  const inFlightKeyRef = useRef<string | null>(null);
  const currentKeyRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 当前 key 的快照（AppState/focus 触发时读最新值，回调恒稳定）
  const latestRef = useRef({ windowKey, enabled, permissionState, idsKey, calendarIds });
  latestRef.current = { windowKey, enabled, permissionState, idsKey, calendarIds };

  const doFetch = useCallback(
    async (bypassCache: boolean): Promise<void> => {
      const snapshot = latestRef.current;
      if (!snapshot.enabled) {
        return;
      }
      if (snapshot.permissionState !== 'granted') {
        // 权限恢复自愈（真机矩阵发现的缺陷：拒绝态下用户改回授权后，
        // events hook 永远卡在 no-permission）。拒绝态先重走 requestPermissions：
        // OS 层已授权（设置页改权/外部授权）时 expo 直接返回 granted 不弹窗；
        // 仍拒绝则维持 no-permission。授权后置状态并 return，由主调度 effect
        // 自行重驱动（缓存命中或防抖读取）。
        try {
          const response = await requestPermissionsWithTimeout(reader);
          setPermissionState(response.granted ? 'granted' : 'denied');
        } catch (error: unknown) {
          setPermissionState('denied');
        }
        return;
      }
      const key = snapshot.windowKey;
      const cache = cacheRef.current;
      if (!bypassCache && cache.has(key)) {
        // 矩阵 5：切回已看窗口直接命中，不重复读取
        currentKeyRef.current = key;
        setEvents(cache.get(key) ?? []);
        setStatus('ready');
        return;
      }
      if (inFlightKeyRef.current === key) {
        // 同 key in-flight 去重（回前台/回页签与挂载读取并发时只发一次）
        return;
      }
      inFlightKeyRef.current = key;
      currentKeyRef.current = key;
      setStatus((prev) => (prev === 'ready' ? 'ready' : 'loading'));
      try {
        const fetched = await reader.getEvents(
          snapshot.calendarIds,
          windowStartMs,
          windowEndMs,
        );
        if (cache.size >= LIVE_CACHE_MAX_WINDOWS) {
          cache.clear();
        }
        cache.set(key, fetched);
        if (currentKeyRef.current === key) {
          setEvents(fetched);
          setStatus('ready');
        }
      } catch (error: unknown) {
        if (currentKeyRef.current === key) {
          setStatus('error'); // 保留旧 events（外部读取失败不清空视图）
        }
      } finally {
        if (inFlightKeyRef.current === key) {
          inFlightKeyRef.current = null;
        }
      }
    },
    // windowStartMs/windowEndMs/reader 進 closure；latestRef 已覆盖窗口与 ids，
    // 这里只依赖 reader（稳定引用）避免 doFetch 身份抖动。
    [reader, windowStartMs, windowEndMs],
  );

  // 权限：enabled 且未知时申请（expo 已授权时直接返回，不重复弹窗）
  useEffect(() => {
    if (!enabled || permissionState !== 'unknown') {
      return;
    }
    let cancelled = false;
    void requestPermissionsWithTimeout(reader)
      .then((response) => {
        if (!cancelled) {
          setPermissionState(response.granted ? 'granted' : 'denied');
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPermissionState('denied');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, permissionState, reader]);

  // 主读取调度：key 变化 → 缓存命中即时显示；否则 300ms 防抖后读取
  useEffect(() => {
    if (!enabled) {
      setStatus('disabled');
      setEvents([]);
      currentKeyRef.current = null;
      return;
    }
    if (permissionState !== 'granted') {
      setStatus(permissionState === 'denied' ? 'no-permission' : 'loading');
      return;
    }
    const cache = cacheRef.current;
    if (cache.has(windowKey)) {
      currentKeyRef.current = windowKey;
      setEvents(cache.get(windowKey) ?? []);
      setStatus('ready');
      return;
    }
    setStatus((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void doFetch(false);
    }, WINDOW_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, permissionState, windowKey, doFetch]);

  // AppState 回前台 → 绕过缓存重读当前窗口（矩阵 6：外部增删事件可见）
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void doFetch(true);
      }
    });
    return () => {
      subscription.remove();
    };
  }, [doFetch]);

  // useFocusEffect 回页签 → 绕过缓存重读当前窗口
  useFocusEffect(
    useCallback(() => {
      void doFetch(true);
      return noop;
    }, [doFetch]),
  );

  const retryPermissions = useCallback((): void => {
    void requestPermissionsWithTimeout(reader)
      .then((response) => {
        setPermissionState(response.granted ? 'granted' : 'denied');
      })
      .catch(() => {
        setPermissionState('denied');
      });
  }, [reader]);

  if (isWeb) {
    // web 早退：expo-calendar 无 web 实现（ui.md：面板区不渲染 + hook 早退）
    return { events: [], status: 'disabled', retryPermissions: noop };
  }
  return { events, status, retryPermissions };
}

export interface UseSystemCalendarListResult {
  status: 'loading' | 'ready' | 'no-permission' | 'error';
  calendars: SystemCalendarInfo[];
  /** 「重新授权」/重试：重走 requestPermissions + getCalendars。 */
  reload: () => void;
}

/**
 * 设备日历清单（筛选面板「日历显示」区消费）。enabled=false 时完全不动
 * （plan 页挂载即调用也不请求权限——权限只在「面板打开或已选日历」时申请）。
 */
export function useSystemCalendarList(params: {
  enabled: boolean;
  reader?: SystemCalendarReader;
}): UseSystemCalendarListResult {
  const { enabled } = params;
  const reader = params.reader ?? expoSystemCalendarReader;
  const isWeb = Platform.OS === 'web';
  const active = enabled && !isWeb;
  const [status, setStatus] = useState<'loading' | 'ready' | 'no-permission' | 'error'>(
    'loading',
  );
  const [calendars, setCalendars] = useState<SystemCalendarInfo[]>([]);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    if (!active) {
      setStatus('loading');
      setCalendars([]);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    const load = async (): Promise<void> => {
      try {
        const permission = await requestPermissionsWithTimeout(reader);
        if (!permission.granted) {
          if (!cancelled) {
            setStatus('no-permission');
            setCalendars([]);
          }
          return;
        }
        const list = await reader.getCalendars();
        if (!cancelled) {
          setCalendars(list);
          setStatus('ready');
        }
      } catch {
        if (!cancelled) {
          setStatus('error');
          setCalendars([]);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [active, reader, reloadCounter]);

  const reload = useCallback((): void => {
    setReloadCounter((n) => n + 1);
  }, []);

  return { status, calendars, reload };
}
