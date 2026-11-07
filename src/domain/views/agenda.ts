/**
 * Agenda 视图分组纯函数（tasks/slice-14.md 阶段 2 / AGENTS.md §7.21）。
 *
 * - 按天分组：key 为 tzid 下的民用日期 'YYYY-MM-DD'（复用 recurrence/civilTime 只读导出，
 *   不依赖 new Date 本地时区行为——§4.13 精神；本文件不修改 recurrence/ 任何文件）；
 * - 组标签：'今天' / '明天' / '周X D'（如 '周五 6'）；跨年日期为 'YYYY年M月D日'；
 * - 无 startAt 的项：agenda/week/month 视图进独立「待办」组（置顶）；today 视图并入
 *   「今天」组（任务卡「放在"今天"或"待办"分组（视当前视图而定）」）；
 * - 组内排序：有 startAt 的按 startAt 升序（并列按 createdAt 升序，再按 id 确定化），
 *   无 startAt 的按 createdAt 降序（并列按 id 确定化）；混合组（today 视图）有 startAt 的在前；
 * - archived 项防御性排除（与 groupItemsForView 同一约定，查询层正常已排除）；
 * - 同一 Item 只进一个组（按 id 去重，首见保留）。
 */

import type { CivilDate } from '../recurrence/civilTime';
import { addOneDay, formatLocalDate, getCivilWeekday, getZonedParts } from '../recurrence/civilTime';
import type { ItemWithRelations } from '../relations/itemWithRelations';

/** 视图种类（§7.21：日程 Agenda / 今日 / 本周 / 本月） */
export type AgendaViewKind = 'agenda' | 'today' | 'week' | 'month';

export interface GroupItemsForAgendaInput {
  viewKind: AgendaViewKind;
  /** 「现在」的绝对毫秒时刻（用于今天/明天标签与待办并入今日组的日期判定） */
  nowMs: number;
  /** 民用日期分桶的 IANA 时区（显式传入，不得依赖系统本地时区） */
  tzid: string;
}

export interface AgendaGroup {
  /** 稳定分组键：'unscheduled'（待办组）或民用日期 'YYYY-MM-DD' */
  key: string;
  kind: 'unscheduled' | 'day';
  /** 组头文案：'待办' / '今天' / '明天' / '周X D' / 跨年 'YYYY年M月D日' */
  label: string;
  items: ItemWithRelations[];
}

const WEEKDAY_LABELS: Record<number, string> = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  7: '周日',
};

/** 组内排序：有 startAt 的在前（startAt 升序 → createdAt 升序 → id），无 startAt 的在后（createdAt 降序 → id）。 */
function compareWithinDay(a: ItemWithRelations, b: ItemWithRelations): number {
  if (a.startAt !== null && b.startAt !== null) {
    if (a.startAt !== b.startAt) {
      return a.startAt - b.startAt;
    }
    if (a.createdAt !== b.createdAt) {
      return a.createdAt - b.createdAt;
    }
  } else if (a.startAt === null && b.startAt === null) {
    if (a.createdAt !== b.createdAt) {
      return b.createdAt - a.createdAt;
    }
  } else {
    return a.startAt === null ? 1 : -1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 日期组头文案：今天 / 明天 / 周X D（跨年 'YYYY年M月D日'）。 */
function dayGroupLabel(key: string, date: CivilDate, todayKey: string, tomorrowKey: string): string {
  if (key === todayKey) {
    return '今天';
  }
  if (key === tomorrowKey) {
    return '明天';
  }
  if (date.year !== Number(todayKey.slice(0, 4))) {
    return `${date.year}年${date.month}月${date.day}日`;
  }
  return `${WEEKDAY_LABELS[getCivilWeekday(date)] ?? `周${date.day}`} ${date.day}`;
}

export function groupItemsForAgenda(
  items: ItemWithRelations[],
  input: GroupItemsForAgendaInput,
): AgendaGroup[] {
  const nowParts = getZonedParts(input.nowMs, input.tzid);
  const todayKey = formatLocalDate(nowParts);
  const tomorrowKey = formatLocalDate(addOneDay(nowParts));

  const unscheduled: ItemWithRelations[] = [];
  const byDay = new Map<string, { date: CivilDate; items: ItemWithRelations[] }>();
  const seen = new Set<string>();

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    if (item.status === 'archived') {
      continue;
    }
    if (item.startAt === null && input.viewKind !== 'today') {
      unscheduled.push(item);
      continue;
    }
    // today 视图的未安排项并入「今天」组；其余按 startAt 的民用日期分桶。
    const instant = item.startAt ?? input.nowMs;
    const parts = getZonedParts(instant, input.tzid);
    const key = formatLocalDate(parts);
    const bucket = byDay.get(key);
    if (bucket) {
      bucket.items.push(item);
    } else {
      byDay.set(key, { date: { year: parts.year, month: parts.month, day: parts.day }, items: [item] });
    }
  }

  const groups: AgendaGroup[] = [];
  if (unscheduled.length > 0) {
    groups.push({ key: 'unscheduled', kind: 'unscheduled', label: '待办', items: unscheduled.sort(compareWithinDay) });
  }
  const dayKeys = [...byDay.keys()].sort();
  for (const key of dayKeys) {
    const bucket = byDay.get(key);
    if (!bucket) {
      continue;
    }
    groups.push({
      key,
      kind: 'day',
      label: dayGroupLabel(key, bucket.date, todayKey, tomorrowKey),
      items: bucket.items.sort(compareWithinDay),
    });
  }
  return groups;
}
