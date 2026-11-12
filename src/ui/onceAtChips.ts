import type { OnceCivilTime } from '../domain/reminder';
import { addOneDay, getZonedParts } from '../domain/recurrence/civilTime';

/**
 * 切片 17 阶段 2：once 时间录入的快捷 Chips（AGENTS.md §7.28）。
 *
 * 纯函数：输入当前时刻（毫秒）与 tzid，输出 OnceCivilTime 民用五元组。
 * 数值全部来自 getZonedParts（IANA 运行时数据分解），不做任何字符串拼接，
 * 因此 year/month/day/hour/minute 在构造上不可能出现 02-30 之类的非法民用值。
 *
 * 语义约定：
 * - 「+10分钟 / +1小时」为绝对时长语义：now + delta 后再按 tzid 分解民用值，
 *   跨 DST 边界时由运行时 IANA 数据给出正确民用时刻；
 * - 「明早9点」为民用日语义：取 now 在 tzid 下的民用日，addOneDay 后落 09:00，
 *   DST 切换日同样得到合法民用值。
 */

const MINUTE_MS = 60_000;

function toOnceCivilTime(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}): OnceCivilTime {
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

/** now + deltaMinutes 分钟（绝对时长）在 tzid 下的民用五元组。 */
export function onceAtPlusMinutes(now: number, tzid: string, deltaMinutes: number): OnceCivilTime {
  return toOnceCivilTime(getZonedParts(now + deltaMinutes * MINUTE_MS, tzid));
}

/** +10 分钟快捷 Chip。 */
export function onceAtPlusTenMinutes(now: number, tzid: string): OnceCivilTime {
  return onceAtPlusMinutes(now, tzid, 10);
}

/** +1 小时快捷 Chip。 */
export function onceAtPlusOneHour(now: number, tzid: string): OnceCivilTime {
  return onceAtPlusMinutes(now, tzid, 60);
}

/** 「明早9点」快捷 Chip：tzid 下明天的民用日 + 09:00。 */
export function onceAtTomorrowMorningNine(now: number, tzid: string): OnceCivilTime {
  const today = getZonedParts(now, tzid);
  const tomorrow = addOneDay({ year: today.year, month: today.month, day: today.day });
  return {
    year: tomorrow.year,
    month: tomorrow.month,
    day: tomorrow.day,
    hour: 9,
    minute: 0,
  };
}
