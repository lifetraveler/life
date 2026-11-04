import * as Calendar from 'expo-calendar';
import * as Crypto from 'expo-crypto';

import type { Sha256Hex } from '../domain/systemCalendar/sourceUid';
import type { SystemCalendarEvent, SystemCalendarInfo } from '../domain/systemCalendar/types';
import { expandReaderWindow } from '../domain/systemCalendar/readerWindow';

/**
 * 切片 9：系统日历读取端口与生产适配（data 层专责）。
 * 领域层与 WatermelonItemRepository 只消费 SystemCalendarReader / Sha256Hex 端口；
 * expo-calendar / expo-crypto 原生模块在 Jest 不可用，测试经
 * WatermelonItemRepository 构造函数第三参注入内存实现。
 */

/** 系统日历读取端口（生产实现 = expoSystemCalendarReader；测试注入内存实现）。 */
export interface SystemCalendarReader {
  /**
   * 申请日历读取权限（切片 9 方案 A：经 expo-calendar requestCalendarPermissionsAsync，
   * 该实现以单一系统弹窗同时请求 READ_CALENDAR 与 WRITE_CALENDAR，为库的 Android 读取路径所限）。
   */
  requestPermissions(): Promise<{ granted: boolean }>;
  /** 返回设备上可读取的 EVENT 日历列表（API 返回什么就透传什么，如实记录）。 */
  getCalendars(): Promise<SystemCalendarInfo[]>;
  /** 读取指定日历在 [rangeStartMs, rangeEndMs) 的事件，字段归一为领域纯类型。 */
  getEvents(
    calendarIds: string[],
    rangeStartMs: number,
    rangeEndMs: number,
  ): Promise<SystemCalendarEvent[]>;
}

/**
 * 切片 9 权限事实（方案 A，用户确认）：expo-calendar 15.0.8 的 Android 读取路径
 * （getCalendarsAsync / getEventsAsync / requestCalendarPermissionsAsync）强制同时校验
 * READ_CALENDAR 与 WRITE_CALENDAR（ALL 语义），运行时经 requestCalendarPermissionsAsync
 * 以单一系统弹窗请求两权限。App 不调用任何写入系统日历的 API（无写回调用路径）。
 */

/** expo-calendar 返回的 string | Date → 绝对毫秒；缺失/不可解析为 null。 */
function toEpochMs(value: string | Date | null | undefined): number | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toDomainEvent(raw: Calendar.Event): SystemCalendarEvent {
  const externalId =
    typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id : null;
  return {
    externalId,
    calendarId: raw.calendarId,
    title: typeof raw.title === 'string' && raw.title.trim().length > 0 ? raw.title : null,
    notes: typeof raw.notes === 'string' ? raw.notes : null,
    startDate: toEpochMs(raw.startDate),
    endDate: toEpochMs(raw.endDate),
    allDay: raw.allDay === true,
  };
}

/** 生产实现：expo-calendar（Android 真机）。空 calendarIds 直接返回空（不出无意义调用）。 */
export const expoSystemCalendarReader: SystemCalendarReader = {
  async requestPermissions(): Promise<{ granted: boolean }> {
    const response = await Calendar.requestCalendarPermissionsAsync();
    return { granted: response.granted };
  },

  async getCalendars(): Promise<SystemCalendarInfo[]> {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    return calendars.map((cal) => ({
      id: cal.id,
      title: typeof cal.title === 'string' ? cal.title : '',
    }));
  },

  async getEvents(
    calendarIds: string[],
    rangeStartMs: number,
    rangeEndMs: number,
  ): Promise<SystemCalendarEvent[]> {
    if (calendarIds.length === 0) {
      return [];
    }
    // expo-calendar 15.0.8 Android 原生 Instances 查询为纯包含式（BEGIN >= start AND END <= end），
    // 跨范围事件会被丢弃在原生层；外扩 1 天读取窗口让它们返回，
    // 精确范围过滤仍由 domain filterEventsInRange 执行（契约语义不变）。
    const readerWindow = expandReaderWindow(rangeStartMs, rangeEndMs);
    const events = await Calendar.getEventsAsync(
      calendarIds,
      new Date(readerWindow.startMs),
      new Date(readerWindow.endMs),
    );
    return events.map(toDomainEvent);
  },
};

/** 生产实现：expo-crypto SHA-256（方案 B，用户确认引入；HEX 编码为默认值）。 */
export const sha256Hex: Sha256Hex = (input: string): Promise<string> =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input);

/** WatermelonItemRepository 第三参注入形状。 */
export interface SystemCalendarDeps {
  reader: SystemCalendarReader;
  sha256: Sha256Hex;
}

/** 默认依赖：生产实现（现有单参/双参调用点不受影响）。 */
export const defaultSystemCalendarDeps = (): SystemCalendarDeps => ({
  reader: expoSystemCalendarReader,
  sha256: sha256Hex,
});
