import type { BuildOccurrenceKeyInput } from './types';

const OCCURRENCE_KEY_VERSION = 'v1';

/**
 * 生成确定性的 occurrenceKey（AGENTS.md §4.14）。
 *
 * 只使用四个民用时间字段，不使用 UTC 时间戳：
 *   recurrence:v1|<scheduleId>|<YYYY-MM-DD>|<HH:mm>|<tzid>
 *
 * scheduleId 做 encodeURIComponent，避免其包含 '|' 时与字段分隔符冲突；
 * 这样同一民用时间 occurrence 在重新展开、DST 数据更新后 key 仍保持不变。
 */
export function buildOccurrenceKey(input: BuildOccurrenceKeyInput): string {
  const encodedScheduleId = encodeURIComponent(input.scheduleId);
  return [
    `recurrence:${OCCURRENCE_KEY_VERSION}`,
    encodedScheduleId,
    input.localDate,
    input.localTime,
    input.tzid,
  ].join('|');
}
