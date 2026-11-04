import type { ImportedItemInput } from '../item';
import { resolveSystemEventSourceUid } from './sourceUid';
import type { Sha256Hex } from './sourceUid';
import type { SourceUidStrategy, SystemCalendarEvent } from './types';

/**
 * 系统日历事件 → 导入输入的映射（任务卡实现要求 3，纯函数）。
 * 产物复用 ICS 导入的 ImportedItemInput 形状；type='event'、sourceType='system-calendar'、
 * sourceReadOnly=true 不从输入传入，由 Repository 落库辅助函数固定写入
 * （与切片 8「sourceType 不从输入传入」同一模式，不触碰冻结输入类型）。
 */

/** 标题缺失/空白时的回退标题（任务卡实现要求 3）。 */
export const SYSTEM_EVENT_FALLBACK_TITLE = '系统日历事件';

export interface MappedSystemEvent {
  /** 与 ICS 导入同一输入形状。 */
  input: ImportedItemInput;
  /** 已解析的 sourceUid（与 input.sourceUid 相同）。 */
  sourceUid: string;
  /** sourceUid 生成策略（结果页统计用）。 */
  strategy: SourceUidStrategy;
}

/** 失败清单/展示用的标题兜底（映射失败时也要求有 title 可记录）。 */
export function systemEventDisplayTitle(title: string | null): string {
  const trimmed = title?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : SYSTEM_EVENT_FALLBACK_TITLE;
}

/**
 * 映射规则（任务卡实现要求 3）：
 * - type='event'（由 Repository 固定写入）；
 * - title 空白 → 「系统日历事件」；
 * - content = event.notes ?? ''；
 * - startAt = startDate 毫秒（缺失/不可解析抛错，调用方记入 failed 清单）；
 * - endAt = endDate 毫秒，缺失 → null；
 * - allDay 沿用系统事件标记（时间归一化在 Repository 走 normalizeAllDayTimestamps）。
 */
export async function mapSystemEventToImportedItem(
  event: SystemCalendarEvent,
  sha256: Sha256Hex,
): Promise<MappedSystemEvent> {
  if (event.startDate === null || !Number.isFinite(event.startDate)) {
    throw new Error('系统事件缺少有效的开始时间（startDate 不可解析）');
  }
  const { sourceUid, strategy } = await resolveSystemEventSourceUid(event, sha256);
  return {
    input: {
      title: systemEventDisplayTitle(event.title),
      content: event.notes ?? '',
      startAt: event.startDate,
      endAt: event.endDate,
      allDay: event.allDay,
      sourceUid,
    },
    sourceUid,
    strategy,
  };
}
