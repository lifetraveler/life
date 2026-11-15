/**
 * 快捷推迟 / 时间平移的纯函数（tasks/slice-22.md 阶段 3；AGENTS.md §7.34）。
 *
 * 职责：给定旧时刻（绝对毫秒或 once 民用时间）与偏移分钟数，计算推迟后的
 * 新值。供 useFlashChat 的快捷推迟 chips（+15分钟/+1小时）与「修改成X点」
 * 编辑窄规则（Δ 可为负）共用。
 *
 * 语义约定：
 * - startAt/endAt 是绝对毫秒时间戳，直接加 Δ 即可——绝对时刻连续，天然
 *   DST 安全，无需民用日算术；
 * - once 提醒的触发时刻唯一来源是 onceAt（民用时间，§4.16/§7.26），不能
 *   直接对民用字段做分钟加法（会跨日/跨月出错），必须经
 *   resolveCivilTimeToInstant → 绝对平移 → getZonedParts 往返，fold 取
 *   较早瞬间、gap 返回 null（调用方跳过该提醒的联动）由 civilTime 语义承载；
 * - 只处理 once 提醒；重复提醒（daily/weekly/monthly）的联动不在本函数
 *   职责内（§7.34：推迟仅联动 once 提醒）。
 */

import {
  getZonedParts,
  resolveCivilTimeToInstant,
} from '../recurrence/civilTime';
import type { OnceCivilTime } from '../reminder';

const MS_PER_MINUTE = 60_000;

/** 绝对时刻推迟：startAt + Δ 分钟（Δ 可为负，编辑窄规则复用）。 */
export function computePostponedStartAt(startAt: number, minutes: number): number {
  return startAt + minutes * MS_PER_MINUTE;
}

/**
 * once 提醒的 onceAt 顺延：把民用触发时刻按绝对 Δ 分钟平移后取新民用字段。
 *
 * 返回 null 表示原 onceAt 在其 tzid 下不可解析（春季 gap 存入的脏数据），
 * 调用方应跳过该提醒的联动更新（保留原值），不得静默改写成其他时刻。
 */
export function computePostponedOnceAt(
  onceAt: OnceCivilTime,
  tzid: string,
  minutes: number,
): OnceCivilTime | null {
  const instant = resolveCivilTimeToInstant(
    tzid,
    onceAt.year,
    onceAt.month,
    onceAt.day,
    onceAt.hour,
    onceAt.minute,
  );
  if (instant === null) return null;
  const shifted = getZonedParts(instant + minutes * MS_PER_MINUTE, tzid);
  return {
    year: shifted.year,
    month: shifted.month,
    day: shifted.day,
    hour: shifted.hour,
    minute: shifted.minute,
  };
}
