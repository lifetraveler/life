import { overlapsRange } from '../views/overlaps';
import type { SystemCalendarEvent } from './types';

/**
 * 系统日历事件的所选范围过滤（任务卡实现要求 2）：
 * 语义必须与视图查询一致——复用 domain/views/overlaps.ts 的 overlapsRange
 * （startAt ∈ [rangeStart, rangeEnd) 左闭右开，或 startAt < rangeStart 且 endAt > rangeStart
 * 的跨范围项），不得另写第二份跨天判定。
 * startDate 不可解析的事件由导入管线上游分流为 failed，不进入本过滤。
 */
export function filterEventsInRange(
  events: SystemCalendarEvent[],
  rangeStartMs: number,
  rangeEndMs: number,
): SystemCalendarEvent[] {
  return events.filter(
    (event) =>
      event.startDate !== null &&
      overlapsRange({ startAt: event.startDate, endAt: event.endDate }, rangeStartMs, rangeEndMs),
  );
}
