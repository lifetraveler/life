/**
 * 今日待办小组件快照（AGENTS.md §7.16 v0.10 + ui.md「Android 桌面小组件（v0.10）」）：
 * - 快照 JSON schema 冻结：{ generatedAt, tzid, groups: { overdue[], scheduled[] } }；
 * - 每项字段：id / title / type / timeLabel / status；§7.21 v0.14（任务卡阶段 5）扩展
 *   `categoryColor`（分类颜色原样携带，无分类/颜色 null → UI 层回退灰点）；
 *   仍不含 content、tags、reminders 细节；
 * - 分组冻结：today 分组（过期 + 已安排）各截前 5；overdue 仅 active，scheduled 含 done；
 * - 排序沿用切片 7 查询返回序（overdue：endAt 升序；scheduled：done 末尾 + startAt 升序），
 *   本纯函数不重排、只防御性过滤 + 截断；
 * - timeLabel 冻结：过期项 = '已过期'；已安排 allDay = '全天'；否则 tzid 下民用时刻 'HH:mm'；
 *   已安排且 startAt 为 null 属防御分支（正常查询不会出现），标签取 '未安排'；
 * - 时区伪影（slice-08 closeout 记录，本切片不修）：应用运行时 Intl 被 polyfill 钉死 UTC，
 *   getZonedParts 实际按 UTC 取字段，timeLabel 与 App 内视图同坐标系，验收如实记录偏移。
 */

import type { ItemStatus, ItemType } from '../item';
import type { ItemWithRelations } from '../relations/itemWithRelations';
import { formatLocalTime, getZonedParts } from '../recurrence/civilTime';

/**
 * SharedPreferences 快照键（AGENTS.md §7.16 冻结）。
 * App 侧经 WidgetSnapshotWriter 写入；小组件侧只读；读写双方共用同一常量。
 */
export const WIDGET_SNAPSHOT_PREFS_KEY = 'widget_today_snapshot_v1';

/** 每组最多条数（契约冻结：top 5）。 */
export const WIDGET_SNAPSHOT_MAX_PER_GROUP = 5;

/** 快照单项（§7.16 v0.10 冻结字段集 + §7.21 v0.14 扩展 categoryColor）。 */
export interface WidgetSnapshotEntry {
  id: string;
  title: string;
  type: ItemType;
  /** 展示用时间标签文本：'已过期' | '全天' | 'HH:mm' | '未安排'（防御） */
  timeLabel: string;
  status: ItemStatus;
  /** 分类颜色原样携带（合法性由 UI 层校验回退）；无分类为 null（v0.14 阶段 5） */
  categoryColor: string | null;
}

/** 快照 JSON 根对象（ui.md v0.10 schema 冻结）。 */
export interface WidgetSnapshot {
  /** 快照生成时刻（毫秒） */
  generatedAt: number;
  /** 生成时的 IANA 时区（运行时伪影：当前恒 'UTC'，见 slice-08 closeout） */
  tzid: string;
  groups: {
    overdue: WidgetSnapshotEntry[];
    scheduled: WidgetSnapshotEntry[];
  };
}

export interface BuildTodayWidgetSnapshotInput {
  /** listOverdueItems(nowMs) 结果（已按 endAt 升序），本函数沿用其顺序 */
  overdue: ItemWithRelations[];
  /** listScheduledItemsInRange(...) 结果（已按 done 末尾 + startAt 升序），本函数沿用其顺序 */
  scheduled: ItemWithRelations[];
  /** 快照生成时刻（毫秒），写入 generatedAt */
  nowMs: number;
  /** 生成时的 IANA 时区，写入 tzid 并用于 'HH:mm' 取字段 */
  tzid: string;
}

/** 过期项：标签恒 '已过期'（契约冻结，不拼 endAt 时刻）。 */
function toOverdueEntry(item: ItemWithRelations): WidgetSnapshotEntry {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    timeLabel: '已过期',
    status: item.status,
    categoryColor: item.category?.color ?? null,
  };
}

/** 已安排项：allDay → '全天'；startAt null（防御）→ '未安排'；否则 tzid 下 'HH:mm'。 */
function toScheduledEntry(item: ItemWithRelations, tzid: string): WidgetSnapshotEntry {
  let timeLabel: string;
  if (item.allDay) {
    timeLabel = '全天';
  } else if (item.startAt === null) {
    timeLabel = '未安排';
  } else {
    const parts = getZonedParts(item.startAt, tzid);
    timeLabel = formatLocalTime(parts.hour, parts.minute);
  }
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    timeLabel,
    status: item.status,
    categoryColor: item.category?.color ?? null,
  };
}

/**
 * 生成今日待办小组件快照（纯函数，不读 DB、不做查询、不重排序）：
 * - overdue 输入防御性过滤为仅 active（listOverdueItems 本就只回 active）后截前 5；
 * - scheduled 输入防御性过滤 archived（查询本就不回 archived；done 保留）后截前 5。
 */
export function buildTodayWidgetSnapshot(
  input: BuildTodayWidgetSnapshotInput,
): WidgetSnapshot {
  const overdue = input.overdue
    .filter((item) => item.status === 'active')
    .slice(0, WIDGET_SNAPSHOT_MAX_PER_GROUP)
    .map(toOverdueEntry);

  const scheduled = input.scheduled
    .filter((item) => item.status !== 'archived')
    .slice(0, WIDGET_SNAPSHOT_MAX_PER_GROUP)
    .map((item) => toScheduledEntry(item, input.tzid));

  return {
    generatedAt: input.nowMs,
    tzid: input.tzid,
    groups: { overdue, scheduled },
  };
}
