/**
 * 切片 36（§7.48 / 提案 D3）：全域日程检索组包（纯函数）。
 *
 * 输入 = 调用方经 Repository 取 listItemsWithTags() ∪
 * listArchivedItemsWithTags() 全量列表（切片 31 组包先例同构）；
 * 本层做窗口相交过滤（allDay 按民用日粒度、无时刻条目单列节）+
 * 行式民用化组包 + content 80 字截断 + 上限 50 条 truncated 披露。
 * 不做语义/向量检索——「记忆」成分 = 全域数据 + 模型对窗口的理解
 * （Q2/Q4 定案的自然语言边界）。
 */

import { getZonedParts } from '../recurrence/civilTime';
import type { CivilDate } from '../recurrence/civilTime';
import type { ItemWithRelations } from '../relations/itemWithRelations';

/** 查询窗口（本地时区 epoch ms，resolveQueryWindow 产物）。 */
export interface ScheduleRetrievalWindow {
  startMs: number;
  endMs: number;
}

export interface ScheduleRetrievalResult {
  /** 注入第二段 prompt 的行式日程文本（含截断披露行；空窗口为占位说明）。 */
  context: string;
  /** 实际组包条目数（≤ 50）。 */
  included: number;
  /** 窗口内条目总数超过 50 时 true（context 已含披露指令行）。 */
  truncated: boolean;
}

/** 组包上限（超出取最早 50 条——D3 冻结）。 */
export const RETRIEVAL_MAX_ITEMS = 50;

/** content 截断字数（D3 冻结）。 */
export const CONTENT_SNIPPET_MAX_CHARS = 80;

const WEEKDAY_LABELS: readonly string[] = [
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
  '周日',
];

function civilDateOrdinal(date: CivilDate): number {
  return date.year * 10000 + date.month * 100 + date.day;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 条目与窗口的分类结果：无时刻（startAt null）/ 时段（含 allDay）。 */
type ClassifiedItem =
  | { kind: 'untimed'; item: ItemWithRelations }
  | { kind: 'timed'; item: ItemWithRelations; startAt: number };

/**
 * 窗口相交判定：
 * - startAt === null → 无时刻条目（不参与相交与时间排序）；
 * - allDay → 民用日粒度相交（startAt 为本地日起点，endAt 按 ICS 排他
 *   惯例以 endAt-1ms 取尾日；尾日早于首日时归一为首日）；
 * - 其余 → epoch 区间相交（endAt null 视为瞬时点 [startAt, startAt]）。
 */
function classifyWithWindow(
  item: ItemWithRelations,
  window: ScheduleRetrievalWindow,
  tzid: string,
): ClassifiedItem | null {
  if (item.startAt === null) {
    return { kind: 'untimed', item };
  }
  if (item.allDay) {
    const startDay = getZonedParts(item.startAt, tzid);
    const startOrdinal = civilDateOrdinal(startDay);
    let endOrdinal = startOrdinal;
    if (item.endAt !== null && item.endAt > item.startAt) {
      const endDay = getZonedParts(item.endAt - 1, tzid);
      endOrdinal = Math.max(startOrdinal, civilDateOrdinal(endDay));
    }
    const windowStartDay = getZonedParts(window.startMs, tzid);
    const windowEndDay = getZonedParts(window.endMs, tzid);
    const windowStartOrdinal = civilDateOrdinal(windowStartDay);
    const windowEndOrdinal = civilDateOrdinal(windowEndDay);
    if (startOrdinal > windowEndOrdinal || endOrdinal < windowStartOrdinal) {
      return null;
    }
    return { kind: 'timed', item, startAt: item.startAt };
  }
  const endEffective = item.endAt ?? item.startAt;
  if (item.startAt > window.endMs || endEffective < window.startMs) {
    return null;
  }
  return { kind: 'timed', item, startAt: item.startAt };
}

function formatCategorySuffix(item: ItemWithRelations): string {
  const category = item.category;
  if (category === null) {
    return '';
  }
  return category.emoji === null ? `（${category.name}）` : `（${category.emoji} ${category.name}）`;
}

function formatStatusSuffix(item: ItemWithRelations): string {
  // 已归档条目经 listArchivedItemsWithTags 进入（Q4 全域定案），标注避免
  // 模型把归档条目当作当前安排；归档+已完成两态可叠加。
  const marks: string[] = [];
  if (item.status === 'archived') {
    marks.push('[已归档]');
  }
  if (item.status === 'done') {
    marks.push('[已完成]');
  }
  return marks.join('');
}

function formatContentSuffix(item: ItemWithRelations): string {
  const content = item.content.trim();
  if (content.length === 0) {
    return '';
  }
  const flat = content.replace(/\s+/gu, ' ');
  const snippet =
    flat.length > CONTENT_SNIPPET_MAX_CHARS
      ? `${flat.slice(0, CONTENT_SNIPPET_MAX_CHARS)}…`
      : flat;
  return ` 备注：${snippet}`;
}

function formatTimedRow(item: ItemWithRelations, tzid: string): string {
  const parts = getZonedParts(item.startAt ?? 0, tzid);
  const weekday = WEEKDAY_LABELS[parts.weekday - 1];
  const timeLabel = item.allDay ? '全天' : `${pad2(parts.hour)}:${pad2(parts.minute)}`;
  return `${weekday} ${timeLabel} ${item.title}${formatCategorySuffix(item)}${formatStatusSuffix(
    item,
  )}${formatContentSuffix(item)}`;
}

function formatUntimedRow(item: ItemWithRelations): string {
  return `${item.title}${formatCategorySuffix(item)}${formatStatusSuffix(item)}${formatContentSuffix(
    item,
  )}`;
}

/**
 * 全域检索组包（D3 冻结）。行格式：
 * `周三 09:00 体检（健康）[已完成] 备注：<content 前 80 字>`；
 * allDay 时间为「全天」；无时刻条目单列「无时刻待办」节（不参与时间
 * 排序）；上限 50 条（时段条目按 startAt 升序取最早，超出 truncated）。
 */
export function buildScheduleRetrievalContext(
  items: readonly ItemWithRelations[],
  window: ScheduleRetrievalWindow,
  tzid: string,
): ScheduleRetrievalResult {
  const timed: Array<{ kind: 'timed'; item: ItemWithRelations; startAt: number }> = [];
  const untimed: Array<{ kind: 'untimed'; item: ItemWithRelations }> = [];
  for (const item of items) {
    const classified = classifyWithWindow(item, window, tzid);
    if (classified === null) {
      continue;
    }
    if (classified.kind === 'untimed') {
      untimed.push(classified);
    } else {
      timed.push(classified);
    }
  }
  // 时段条目按 startAt 升序（同刻按传入顺序，sort 稳定）。
  timed.sort((a, b) => a.startAt - b.startAt);

  const totalCount = timed.length + untimed.length;
  const truncated = totalCount > RETRIEVAL_MAX_ITEMS;
  const included = Math.min(totalCount, RETRIEVAL_MAX_ITEMS);

  const lines: string[] = [];
  for (const entry of timed) {
    if (lines.length >= RETRIEVAL_MAX_ITEMS) {
      break;
    }
    lines.push(formatTimedRow(entry.item, tzid));
  }
  if (untimed.length > 0 && lines.length < RETRIEVAL_MAX_ITEMS) {
    lines.push('【无时刻待办】');
    for (const entry of untimed) {
      if (lines.length >= RETRIEVAL_MAX_ITEMS) {
        break;
      }
      lines.push(`- ${formatUntimedRow(entry.item)}`);
    }
  }

  if (lines.length === 0) {
    return { context: '（窗口内没有日程条目。）', included: 0, truncated };
  }
  if (truncated) {
    lines.push('（日程较多，本次仅显示前 50 条，请在回答末尾提及仅展示前 50 条。）');
  }
  return { context: lines.join('\n'), included, truncated };
}
