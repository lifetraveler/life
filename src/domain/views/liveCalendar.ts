import { filterEventsInRange } from '../systemCalendar/filterEventsInRange';
import { systemEventDisplayTitle } from '../systemCalendar/mapSystemEvent';
import { resolveSystemEventSourceUid } from '../systemCalendar/sourceUid';
import type { Sha256Hex } from '../systemCalendar/sourceUid';
import type { SystemCalendarEvent, SystemCalendarInfo } from '../systemCalendar/types';
import type { ItemWithRelations } from '../relations/itemWithRelations';

/**
 * 切片 27（AGENTS.md §7.39 D2/D6）：系统日历 live 直读条目合成（纯领域函数，不落库）。
 *
 * 输入 hook 已按窗口读取的原始 SystemCalendarEvent 列表 + 日历元数据（color/sourceName）
 * + 当前已水合的导入条目（用于 D2 去重）+ sha256 端口；输出可直接并入四视图
 * 「filterItems 之后、分组/布局之前」的合成视图条目（ItemWithRelations 结构兼容子类型）。
 *
 * 边界冻结（repository.md v0.31）：live 条目不经 Repository 写路径、不落库、
 * 不参与筛选谓词/搜索/提醒调度/小组件快照/闪电录入/导出。
 */

/** live 合成条目：ItemWithRelations 的结构兼容子类型，附加渲染元数据（不改 Item 契约）。 */
export interface LiveCalendarEntry extends ItemWithRelations {
  /** 所属日历色（Android CALENDAR_COLOR）；日历缺失/色缺失 → null（UI 回退灰条）。 */
  liveColor: string | null;
  /** 所属日历来源名（ACCOUNT_NAME）；缺失 → null（UI 不渲染副行）。 */
  liveSourceName: string | null;
}

/** 渲染侧收窄守卫：合成条目携带专属字段，普通条目没有。 */
export function isLiveCalendarEntry(item: ItemWithRelations): item is LiveCalendarEntry {
  return 'liveColor' in item && 'liveSourceName' in item;
}

export interface BuildLiveCalendarEntriesInput {
  /** hook 已读取的窗口内原始事件（未过滤精度由本函数 filterEventsInRange 保证）。 */
  events: SystemCalendarEvent[];
  /** 设备日历元数据（id→color/sourceName 查找表来源）。 */
  calendars: SystemCalendarInfo[];
  /** 当前已水合条目（observeItemsWithTags 结果），仅用于 D2 去重比对。 */
  importedItems: ItemWithRelations[];
  /** sourceUid 解析端口（与导入路径同实现，保证键一致）。 */
  sha256: Sha256Hex;
  rangeStartMs: number;
  rangeEndMs: number;
}

/**
 * D2 重叠去重键：`${sourceUid}::${startAt}`。
 * 隐藏 ⟺ 存在 sourceType='system-calendar' 的已导入项 sourceUid 相同且 startAt 相同
 * （单事件精确命中；重复系列只命中被导入的首实例，其余实例正常显示——§7.39）。
 * 已知限制（如实记录，ui.md 固定文案覆盖）：allDay 导入项 startAt 经
 * normalizeAllDayTimestamps 归一到 tzid 当天 00:00，与 live 原始 startDate 不等，
 * 全天事件去重不命中 → 可能重复显示。
 */
function importedDedupKey(sourceUid: string, startAt: number): string {
  return `${sourceUid}::${startAt}`;
}

export async function buildLiveCalendarEntries(
  input: BuildLiveCalendarEntriesInput,
): Promise<LiveCalendarEntry[]> {
  // 精确窗口过滤（overlapsRange 相交语义；reader 侧 expandReaderWindow 外扩由
  // getEvents 实现内部完成，这里只做精确裁剪）。
  const inRange = filterEventsInRange(input.events, input.rangeStartMs, input.rangeEndMs);

  // D2 去重集合：已导入系统日历项的 sourceUid+startAt。
  const importedKeys = new Set<string>();
  for (const item of input.importedItems) {
    if (item.sourceType === 'system-calendar' && item.sourceUid !== null && item.startAt !== null) {
      importedKeys.add(importedDedupKey(item.sourceUid, item.startAt));
    }
  }

  // calendarId → 渲染元数据查找表（色条 + sourceName 副行；缺失回退 null）。
  const calendarMeta = new Map<string, { color: string | null; sourceName: string | null }>();
  for (const calendar of input.calendars) {
    calendarMeta.set(calendar.id, { color: calendar.color, sourceName: calendar.sourceName });
  }

  const entries: LiveCalendarEntry[] = [];
  // 同 id 去重（首见保留，与 groupItemsForAgenda 语义一致）：两个被选日历含同一
  // 事件（相同 event.id → 相同 sourceUid → 相同合成 id）时只出一条，避免
  // itemsByDay/layoutDayEvents 无 id 去重路径重复渲染。
  const seenIds = new Set<string>();
  for (const event of inRange) {
    if (event.startDate === null || !Number.isFinite(event.startDate)) {
      // filterEventsInRange 已滤 startDate null；防御兜底不抛错（live 渲染路径不冒错）。
      continue;
    }
    const { sourceUid } = await resolveSystemEventSourceUid(event, input.sha256);
    if (importedKeys.has(importedDedupKey(sourceUid, event.startDate))) {
      continue;
    }
    const id = `live:${sourceUid}:${event.startDate}`;
    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    const meta = calendarMeta.get(event.calendarId) ?? null;
    entries.push({
      // 确定性 id：不含随机数/Date.now，纯输入决定（同事件同窗口恒同 id，
      // groupItemsForAgenda 的同 id 去重首见保留语义不受影响）。
      id,
      type: 'event',
      title: systemEventDisplayTitle(event.title),
      content: event.notes ?? '',
      status: 'active',
      startAt: event.startDate,
      endAt: event.endDate,
      allDay: event.allDay,
      sourceType: 'system-calendar',
      sourceUid,
      sourceReadOnly: true,
      categoryId: 'other',
      priority: 0,
      // createdAt/updatedAt 取事件自身时刻：纯函数确定性（不读设备时钟），
      // 组内 startAt 并列时与导入项的稳定次序仍由 id 兜底。
      createdAt: event.startDate,
      updatedAt: event.startDate,
      tags: [],
      category: null,
      liveColor: meta?.color ?? null,
      liveSourceName: meta?.sourceName ?? null,
    });
  }
  return entries;
}
