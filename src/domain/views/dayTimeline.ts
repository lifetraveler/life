/**
 * 日视图时间轴布局（切片 14 阶段 5b，tasks/slice-14.md 阶段 5b-4）：
 * - 输入为（已按单日范围过滤的）水合条目 + 当天起点毫秒 + tzid；
 * - 时间块以「相对当天 00:00 的分钟」表达（topMin/heightMin），横宽以比例表达
 *   （leftRatio/widthRatio），UI 层再乘以自己的 pxPerHour——纯函数不掺 UI 常量；
 * - 重叠事件聚类：按 startMin 排序后贪心分 lane（lane 复用首个 endMin <= startMin 的
 *   通道），同一聚簇内所有块横向平分（widthRatio = 1/聚簇 lane 数）；
 * - 跨午夜裁剪：startAt 早于当天 → topMin 裁到 0；endAt 晚于次日 00:00 → heightMin
 *   裁到当天剩余分钟（块不跨出 0..1440）；
 * - allDay=true 的项进 allDayItems（UI 放时间轴上方 chip 区），不参与 lane 计算；
 * - startAt === null 的项跳过（时间轴只放有时间的项）；archived 排除；按 id 去重；
 * - 无 endAt 的事件按 DEFAULT_EVENT_MIN=60 分钟呈现；不足 MIN_EVENT_MIN=30 分钟的
 *   块拉到 30 分钟（64px/小时下 32px，可点）。
 *
 * 纯函数：不读设备时区；签名不收 tzid——裁剪基于「相对 dayStartMs 的绝对时刻差」，
 * 分钟差即时区无关（DST gap 日 civil 时刻跳变按真实经过时间呈现，不做 civil 补偿）。
 */

import type { ItemWithRelations } from '../relations/itemWithRelations';

export const DEFAULT_EVENT_MIN = 60;
export const MIN_EVENT_MIN = 30;
/** 一天的分钟数（时间轴裁剪上界）。 */
export const DAY_TOTAL_MIN = 24 * 60;

export interface DayEventBlock {
  item: ItemWithRelations;
  /** 相对当天 00:00 的起始分钟（0..1440，跨午夜事件裁到 0） */
  topMin: number;
  /** 持续分钟（≥ MIN_EVENT_MIN，且 topMin + heightMin ≤ 1440） */
  heightMin: number;
  /** 横向起点比例（lane / laneCount） */
  leftRatio: number;
  /** 横向宽度比例（1 / laneCount） */
  widthRatio: number;
}

export interface DayTimelineLayout {
  timedBlocks: DayEventBlock[];
  allDayItems: ItemWithRelations[];
}

interface LaneState {
  endMin: number;
}

interface TimedEvent {
  item: ItemWithRelations;
  startMin: number;
  endMin: number;
}

function compareTimed(a: TimedEvent, b: TimedEvent): number {
  if (a.startMin !== b.startMin) {
    return a.startMin - b.startMin;
  }
  if (a.endMin !== b.endMin) {
    return a.endMin - b.endMin;
  }
  return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
}

function compareAllDay(a: ItemWithRelations, b: ItemWithRelations): number {
  // 仅对 startAt !== null 的项调用（allDay 分流前已过滤）；?? 0 仅为类型收窄
  const startA = a.startAt ?? 0;
  const startB = b.startAt ?? 0;
  if (startA !== startB) {
    return startA - startB;
  }
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 把聚类好的事件簇结算为等分块。 */
function flushCluster(cluster: Array<{ event: TimedEvent; lane: number }>): DayEventBlock[] {
  const laneCount = Math.max(...cluster.map((entry) => entry.lane + 1), 1);
  return cluster.map((entry) => ({
    item: entry.event.item,
    topMin: entry.event.startMin,
    heightMin: entry.event.endMin - entry.event.startMin,
    leftRatio: entry.lane / laneCount,
    widthRatio: 1 / laneCount,
  }));
}

/**
 * 布局单日时间轴。dayStartMs 须为该民用日 00:00（或 DST gap 日最早存在瞬间，
 * 即 resolveDayStart 的返回值）。
 */
export function layoutDayEvents(
  items: ItemWithRelations[],
  dayStartMs: number,
): DayTimelineLayout {
  const seen = new Set<string>();
  const allDayItems: ItemWithRelations[] = [];
  const timed: TimedEvent[] = [];

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    if (item.status === 'archived' || item.startAt === null) {
      continue;
    }
    if (item.allDay) {
      allDayItems.push(item);
      continue;
    }
    const startMinRaw = Math.floor((item.startAt - dayStartMs) / 60_000);
    const startMin = Math.max(0, Math.min(DAY_TOTAL_MIN, startMinRaw));
    const endRawMs = item.endAt ?? item.startAt + DEFAULT_EVENT_MIN * 60_000;
    const endMinRaw = Math.floor((endRawMs - dayStartMs) / 60_000);
    let endMin = Math.max(0, Math.min(DAY_TOTAL_MIN, endMinRaw));
    if (endMin - startMin < MIN_EVENT_MIN) {
      endMin = Math.min(DAY_TOTAL_MIN, startMin + MIN_EVENT_MIN);
    }
    if (endMin <= startMin) {
      continue;
    }
    timed.push({ item, startMin, endMin });
  }

  allDayItems.sort(compareAllDay);
  timed.sort(compareTimed);

  const blocks: DayEventBlock[] = [];
  const lanes: LaneState[] = [];
  let cluster: Array<{ event: TimedEvent; lane: number }> = [];

  const flush = () => {
    if (cluster.length > 0) {
      blocks.push(...flushCluster(cluster));
      cluster = [];
      lanes.length = 0;
    }
  };

  for (const event of timed) {
    // 与当前聚簇不再重叠（所有 lane 的 endMin 均不晚于本事件 start）→ 结算旧簇
    const overlapsCluster = lanes.some((lane) => lane.endMin > event.startMin);
    if (!overlapsCluster && cluster.length > 0) {
      flush();
    }
    // 分 lane：复用首个 endMin <= start 的通道，否则开新通道
    let laneIndex = lanes.findIndex((lane) => lane.endMin <= event.startMin);
    if (laneIndex === -1) {
      laneIndex = lanes.length;
      lanes.push({ endMin: event.endMin });
    } else {
      lanes[laneIndex].endMin = event.endMin;
    }
    cluster.push({ event, lane: laneIndex });
  }
  flush();

  blocks.sort((a, b) => (a.topMin !== b.topMin ? a.topMin - b.topMin : a.leftRatio - b.leftRatio));
  return { timedBlocks: blocks, allDayItems };
}
