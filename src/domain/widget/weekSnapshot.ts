/**
 * 周视图小组件快照（切片 14 阶段 7b，docs/proposals/slice-14-widget-phase7.md 已确认）：
 * - 键：WIDGET_WEEK_SNAPSHOT_PREFS_KEY（'widget_week_snapshot_v1'，提案新增，
 *   widget_today_snapshot_v1 冻结键不变）；
 * - 范围：今天起 7 天（含今天，第 8 天 00:00 左开终点），按天分组，每天最多
 *   WIDGET_WEEK_MAX_PER_DAY 条（护栏，防极端数据量撑爆 SharedPreferences）；
 *   只含已安排项（有 start_at），过期/无时间待办不进周页（提案定案：过期组仅属于
 *   今日页三段式）；
 * - JSON schema：{ generatedAt, tzid, days: [{ civilKey, dayLabel, entries[] }] }；
 *   7 天恒在（空天也保留组，渲染层画组头）；
 * - dayLabel 与 App 日程分组同规则（src/domain/views/agenda.ts dayGroupLabel）：
 *   今天 / 明天 / '周X D'（week 页从今天起算，不存在跨年——最多明天+6 天可能跨年！
 *   跨年时走周X D 仍正确：weekday 按民用日计算，年份不进标签。App 跨年走
 *   'YYYY年M月D日' 仅因组头需消歧，周页 7 天窗口保留周X D 即可读，提案未冻结标签）；
 * - timeLabel 沿用今日快照规则：allDay = '全天'，否则 'HH:mm'（复用
 *   snapshot.ts toScheduledEntry，注释与时区伪影说明见该文件）；
 * - narrowWidgetWeekSnapshot：读取端最小形状收窄（不信任存储内容），单日损坏跳过该日。
 */

import type { ItemWithRelations } from '../relations/itemWithRelations';
import {
  addOneDay,
  formatLocalDate,
  getZonedParts,
} from '../recurrence/civilTime';
import { resolveDayStart } from '../views/ranges';
import type { WidgetSnapshotEntry } from './snapshot';
import { narrowSnapshotEntry, toScheduledEntry } from './snapshot';

/** SharedPreferences 周快照键（阶段 7b 提案新增；今日键 widget_today_snapshot_v1 不变）。 */
export const WIDGET_WEEK_SNAPSHOT_PREFS_KEY = 'widget_week_snapshot_v1';

/** 周页天数（今天起 7 天，提案定案）。 */
export const WIDGET_WEEK_DAY_COUNT = 7;

/** 每天最多条数（护栏；超出截断，见提案）。 */
export const WIDGET_WEEK_MAX_PER_DAY = 20;

/** 周快照单日分组。 */
export interface WidgetWeekDayGroup {
  /** 稳定分组键：民用日期 'YYYY-MM-DD'（渲染 key / 测试断言用） */
  civilKey: string;
  /** 组头文案：'今天' / '明天' / '周X D'（与 App 日程分组同规则） */
  dayLabel: string;
  entries: WidgetSnapshotEntry[];
}

/** 周快照 JSON 根对象。 */
export interface WidgetWeekSnapshot {
  /** 快照生成时刻（毫秒） */
  generatedAt: number;
  /** 生成时的 IANA 时区（时区伪影说明见 snapshot.ts 头注释） */
  tzid: string;
  /** 恒 7 组（今天起，按天升序；空天 entries 为空数组） */
  days: WidgetWeekDayGroup[];
}

export interface BuildWeekWidgetSnapshotInput {
  /** listScheduledItemsInRange(day0, day7 终点) 结果（startAt 升序），沿用其顺序 */
  items: ItemWithRelations[];
  /** 7 个民用日起点毫秒（getWidgetWeekDayStarts().dayStartsMs） */
  dayStartsMs: number[];
  /** 快照生成时刻（毫秒），写入 generatedAt */
  nowMs: number;
  /** 生成时的 IANA 时区 */
  tzid: string;
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

/**
 * 计算周页的民用日起点：今天起 7 天各日 00:00（DST gap 取当天最早存在整点，
 * 语义同 getTodayRange），外加第 8 天 00:00 作为查询右开终点。
 * 纯函数（只依赖 civilTime/ranges 域模块），写入器与 taskHandler 兜底共用。
 */
export function getWidgetWeekDayStarts(
  nowMs: number,
  tzid: string,
): { dayStartsMs: number[]; rangeEndMs: number } {
  const parts = getZonedParts(nowMs, tzid);
  let date = { year: parts.year, month: parts.month, day: parts.day };
  const dayStartsMs: number[] = [];
  for (let i = 0; i < WIDGET_WEEK_DAY_COUNT; i += 1) {
    dayStartsMs.push(resolveDayStart(tzid, date));
    date = addOneDay(date);
  }
  return { dayStartsMs, rangeEndMs: resolveDayStart(tzid, date) };
}

/**
 * 生成周视图小组件快照（纯函数）：
 * - 输入过滤 archived（查询本就不回）与 startAt null（无时间项不属于周页，防御跳过）；
 * - 按民用日分桶：取满足 dayStartsMs[i] <= startAt 的最大 i（正常输入只含 7 天内项；
 *   越界项落在最后一桶，查询端负责范围，这里不再二次丢弃——保持与今日快照
 *   「只防御性过滤+截断，不重排」同一克制口径）；
 * - 组内沿用输入顺序（done 末尾 + startAt 升序）截护栏条数，逐条走 toScheduledEntry；
 * - 7 天恒在（空天也产出组），dayLabel 今天/明天/'周X D'。
 */
export function buildWeekWidgetSnapshot(
  input: BuildWeekWidgetSnapshotInput,
): WidgetWeekSnapshot {
  const { dayStartsMs } = input;
  if (dayStartsMs.length !== WIDGET_WEEK_DAY_COUNT) {
    throw new Error(
      `buildWeekWidgetSnapshot: expected ${WIDGET_WEEK_DAY_COUNT} day starts, got ${dayStartsMs.length}`,
    );
  }
  const dayItems: ItemWithRelations[][] = dayStartsMs.map(() => []);
  for (const item of input.items) {
    if (item.status === 'archived' || item.startAt === null) {
      continue;
    }
    let bucket = -1;
    for (let i = dayStartsMs.length - 1; i >= 0; i -= 1) {
      if (item.startAt >= dayStartsMs[i]) {
        bucket = i;
        break;
      }
    }
    if (bucket >= 0) {
      dayItems[bucket].push(item);
    }
  }

  const days: WidgetWeekDayGroup[] = dayStartsMs.map((dayStartMs, index) => {
    const parts = getZonedParts(dayStartMs, input.tzid);
    const civilDate = { year: parts.year, month: parts.month, day: parts.day };
    let dayLabel: string;
    if (index === 0) {
      dayLabel = '今天';
    } else if (index === 1) {
      dayLabel = '明天';
    } else {
      const weekday = WEEKDAY_LABELS[parts.weekday] ?? `周${parts.weekday}`;
      dayLabel = `${weekday} ${parts.day}`;
    }
    const entries = dayItems[index]
      .slice(0, WIDGET_WEEK_MAX_PER_DAY)
      .map((item) => toScheduledEntry(item, input.tzid));
    return {
      civilKey: formatLocalDate(civilDate),
      dayLabel,
      entries,
    };
  });

  return {
    generatedAt: input.nowMs,
    tzid: input.tzid,
    days,
  };
}

/**
 * 最小形状收窄（读取端防御，同 WidgetSnapshotWriter.narrowWidgetSnapshot 口径）：
 * 根对象 generatedAt/tzid/days 缺失或类型不对 → null；单个 day 形状不对 → 跳过该日；
 * 单条 entry 走 snapshot.ts 的 narrowSnapshotEntry（categoryColor 宽松读）。
 */
export function narrowWidgetWeekSnapshot(value: unknown): WidgetWeekSnapshot | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const root = value as Record<string, unknown>;
  if (typeof root.generatedAt !== 'number' || typeof root.tzid !== 'string') {
    return null;
  }
  if (!Array.isArray(root.days)) {
    return null;
  }
  const days: WidgetWeekDayGroup[] = root.days.flatMap((day) => {
    if (typeof day !== 'object' || day === null) {
      return [];
    }
    const d = day as Record<string, unknown>;
    if (
      typeof d.civilKey !== 'string'
      || typeof d.dayLabel !== 'string'
      || !Array.isArray(d.entries)
    ) {
      return [];
    }
    return [
      {
        civilKey: d.civilKey,
        dayLabel: d.dayLabel,
        entries: d.entries.flatMap((entry) => {
          const narrowed = narrowSnapshotEntry(entry);
          return narrowed === null ? [] : [narrowed];
        }),
      },
    ];
  });
  return { generatedAt: root.generatedAt, tzid: root.tzid, days };
}
