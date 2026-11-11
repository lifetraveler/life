/**
 * 切片 6：详情页/编辑页展示用时间格式化（纯函数，不依赖 React Native）。
 *
 * 契约（AGENTS.md §4.23 / §4.27）：
 * - startAt / endAt 是绝对时刻，展示时按「设备当前 IANA 时区」解释；
 * - 所有“民用时间”格式化必须显式传入 tzid（§4.13 精神），不得依赖 new Date 的本地时区行为；
 * - 民用分解复用 src/domain/recurrence/civilTime.ts 的只读导出（不修改 recurrence/）。
 */

import { formatLocalDate, formatLocalTime, getZonedParts } from '../domain/recurrence/civilTime';
import type { Reminder, ReminderFrequency } from '../domain/reminder';

/**
 * 设备当前 IANA 时区（§4.27：详情页按设备当前 IANA 时区格式化）；取不到时回退 UTC。
 * 切片 11 变更 A：实现收口到 src/data/deviceTimezone（expo-localization 来源，
 * 不再依赖 Intl.DateTimeFormat），此处仅再导出，避免两处读时区逻辑分叉。
 */
export { getDeviceTzid } from '../data/deviceTimezone';

/** 绝对时刻 → 'YYYY-MM-DD HH:mm'（显式 tzid） */
export function formatItemTime(instant: number, tzid: string): string {
  const parts = getZonedParts(instant, tzid);
  return `${formatLocalDate(parts)} ${formatLocalTime(parts.hour, parts.minute)}`;
}

/** 绝对时刻 → 'YYYY-MM-DD'（显式 tzid） */
export function formatItemDate(instant: number, tzid: string): string {
  return formatLocalDate(getZonedParts(instant, tzid));
}

/**
 * 详情页 startAt 行文本（§4.23：allDay=true 时 startAt 表示设备时区当天 00:00）：
 * - null → '未安排'
 * - allDay → '全天 YYYY-MM-DD'
 * - 否则 → 'YYYY-MM-DD HH:mm'
 */
export function formatItemStart(
  startAt: number | null,
  allDay: boolean,
  tzid: string,
): string {
  if (startAt === null) {
    return '未安排';
  }
  if (allDay) {
    return `全天 ${formatItemDate(startAt, tzid)}`;
  }
  return formatItemTime(startAt, tzid);
}

/**
 * 详情页 endAt 行文本（§4.23：allDay 时 endAt 可为 null；验收 7 允许“不展示或标注全天”）：
 * - null → '未设置'
 * - allDay → '全天'
 * - 否则 → 'YYYY-MM-DD HH:mm'
 */
export function formatItemEnd(endAt: number | null, allDay: boolean, tzid: string): string {
  if (endAt === null) {
    return '未设置';
  }
  if (allDay) {
    return '全天';
  }
  return formatItemTime(endAt, tzid);
}

/**
 * 切片 14 阶段 2：Agenda 卡片时间段文案（纯函数）。
 * - 未安排（startAt=null）→ null（卡片不渲染时间行）；
 * - allDay → '全天'；
 * - 有 endAt 且与 startAt 同一民用日 → 'HH:mm - HH:mm'；
 * - 有 endAt 但跨民用日 → 'YYYY-MM-DD HH:mm - YYYY-MM-DD HH:mm'；
 * - 无 endAt → 'HH:mm'。
 * 民用分解按显式 tzid（复用 civilTime 只读导出，§4.13 精神）。
 */
export function formatAgendaTimeRange(
  time: { startAt: number | null; endAt: number | null; allDay: boolean },
  tzid: string,
): string | null {
  if (time.startAt === null) {
    return null;
  }
  if (time.allDay) {
    return '全天';
  }
  const startParts = getZonedParts(time.startAt, tzid);
  const start = formatLocalTime(startParts.hour, startParts.minute);
  if (time.endAt === null) {
    return start;
  }
  const endParts = getZonedParts(time.endAt, tzid);
  const endTime = formatLocalTime(endParts.hour, endParts.minute);
  const end = formatLocalDate(startParts) === formatLocalDate(endParts)
    ? endTime
    : `${formatLocalDate(endParts)} ${endTime}`;
  return `${start} - ${end}`;
}

export const WEEKDAY_LABELS: Record<number, string> = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  7: '周日',
};

/** 「每周」前缀用的短标签（避免“每周周一”重复） */
const WEEKDAY_SHORT_LABELS: Record<number, string> = {
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
  7: '日',
};

function frequencyHeadline(frequency: ReminderFrequency): string {
  switch (frequency) {
    case 'daily':
      return '每天';
    case 'weekly':
      return '每周';
    case 'monthly':
      return '每月';
    case 'once':
      // 切片 16：once 无规则时间语义，具体时刻由 onceAt 提供（阶段 3 渲染）。
      return '单次';
  }
}

/**
 * 详情页 reminder 列表行摘要：
 * - daily → '每天 09:00'
 * - weekly → '每周一、周三 09:00'
 * - monthly → '每月 15 日 09:00'
 * - once → '单次（时区）'（切片 16：localTime 是占位零值，不渲染伪 00:00；
 *   onceAt 民用时刻展示属阶段 3 UI）
 * 后缀始终带规则时区（规则时间按 tzid 的民用时间触发，与设备时区无关）。
 */
export function formatReminderRuleSummary(reminder: Pick<Reminder, 'frequency' | 'localTimeHour' | 'localTimeMinute' | 'weekdays' | 'dayOfMonth' | 'tzid'>): string {
  const time = formatLocalTime(reminder.localTimeHour, reminder.localTimeMinute);
  let head: string;
  let timeSuffix: string;
  if (reminder.frequency === 'weekly') {
    const labels = reminder.weekdays
      .slice()
      .sort((a, b) => a - b)
      .map((day) => WEEKDAY_SHORT_LABELS[day] ?? `周${day}`)
      .join('、');
    head = `每周${labels}`;
    timeSuffix = ` ${time}`;
  } else if (reminder.frequency === 'monthly') {
    head = `每月 ${reminder.dayOfMonth} 日`;
    timeSuffix = ` ${time}`;
  } else if (reminder.frequency === 'once') {
    head = frequencyHeadline(reminder.frequency);
    timeSuffix = '';
  } else {
    head = frequencyHeadline(reminder.frequency);
    timeSuffix = ` ${time}`;
  }
  return `${head}${timeSuffix}（${reminder.tzid}）`;
}
