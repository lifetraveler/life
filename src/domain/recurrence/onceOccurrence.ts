/**
 * 切片 16：once 提醒的 occurrence 展开（提案 docs/proposals/slice-16-reminder-channels.md）。
 *
 * 约束与语义：
 * - once 提醒只有一个 occurrence；触发时刻 = onceAt（民用五元组）在 reminder.tzid
 *   下的确定性换算，DST 语义与 §4.12–4.13 完全一致（gap 无 occurrence、fold 取较早瞬间）。
 * - occurrenceKey 格式：`once:<scheduleId>:<换算后的 epoch 毫秒>`。与 recurring 族
 *   `recurrence:v1|…` 并列构成 identifier 双根前缀族（notifications.md v0.16 增补）。
 * - 键内嵌的毫秒时间戳由 (onceAt, tzid) 经确定性换算得出，仍是确定性标识，
 *   重复展开必然得到同一 occurrenceKey。
 * - 纯 TypeScript：不依赖 React Native / WatermelonDB / expo-notifications。
 */
import type { OnceCivilTime } from '../reminder';
import type { Occurrence } from './types';
import { formatLocalDate, formatLocalTime, resolveCivilTimeToInstant } from './civilTime';

export type BuildOnceOccurrenceInput = {
  scheduleId: string;
  onceAt: OnceCivilTime;
  tzid: string;
};

/**
 * once 提醒的绝对触发时刻（毫秒）。
 *
 * 命名为 resolveOnceFireAt 以避免与 data 层写路径归一函数 resolveOnceAt
 * （reminderRuleMapping.ts，返回 OnceCivilTime）混淆。
 * 返回 null 表示 onceAt 落在春季 DST gap：该民用时刻在 tzid 下不存在，
 * 无 occurrence（§4.12：跳过不平移）。
 */
export function resolveOnceFireAt(onceAt: OnceCivilTime, tzid: string): number | null {
  return resolveCivilTimeToInstant(
    tzid,
    onceAt.year,
    onceAt.month,
    onceAt.day,
    onceAt.hour,
    onceAt.minute,
  );
}

/**
 * 展开 once 提醒的唯一 occurrence；gap 时返回 null。
 */
export function buildOnceOccurrence(input: BuildOnceOccurrenceInput): Occurrence | null {
  const instant = resolveOnceFireAt(input.onceAt, input.tzid);
  if (instant === null) {
    return null;
  }

  return {
    occurrenceKey: `once:${input.scheduleId}:${instant}`,
    localDate: formatLocalDate(input.onceAt),
    localTime: formatLocalTime(input.onceAt.hour, input.onceAt.minute),
    tzid: input.tzid,
    instant,
  };
}
