/**
 * 计划 Tab 主视图（切片 14 阶段 5 重构：tasks/slice-14.md 阶段 5 / AGENTS.md §7.21；
 * 原 src/app/index.tsx 移入 (tabs)/plan.tsx）。
 *
 * - 阶段 5：视图切换器移入筛选面板顶部（日程/周/月/日，FilterSheet initialViewKind
 *   + onApply 双参）；移除内嵌快速录入框（创建落点改为全屏新建页 /item/new，
 *   ui.md「快速记录落点 v0.14」）；右下 FAB 新建入口 → router.push('/item/new')；
 *   无导航头标题（(tabs) 布局 headerShown:false，验收 16）；
 * - 阶段 5b 顶栏：左=标签（week ±7 天 / day ±1 天 / month ±1 月步进），右=🔍
 *   （进入 /search 独立搜索页）+ 筛选（激活时红点）+ 「今天」pill（agenda 滚动定位
 *   今日分组；week/day 锚点回今日；month 回本月）；
 * - 阶段 5b 周条：week/day 视图显示今日起 7 天窗 chip 行，横滑（PanResponder）±7 天；
 * - 数据链：observeItemsWithTags 单订阅（默认列表，§7.23 ItemWithRelations）→
 *   视图范围谓词（agenda 全量；week=锚点起 7 天窗；day=单日；month=锚点月；
 *   startAt=null 恒通过进「待办」组）→
 *   filterItems（激活筛选，维度内 OR、维度间 AND）→ groupItemsForAgenda 按天分组 →
 *   FlatList 摊平渲染（header|item 两类行）；本月视图组序倒序（按日期从晚到早）；
 * - 卡片：左侧 4px 分类色条 + Emoji + 标题 + 时间段（formatAgendaTimeRange），
 *   点击进详情页 /item/<id>（task 卡 life://item/<id> 深链同一路由）；
 * - 「已归档」入口移入筛选面板（阶段 5c，仿日程筛选参考图「已删除项目」行）；
 *   行内「转为任务/添加标签」入口由编辑页承接（同等能力）；「归档」入口移至详情页
 *   （用户确认，2026-11-08）；旧 /today /week 页面原样保留不删；搜索移入 /search 独立页（阶段 5b）；
 * - 阶段 5c（真机反馈迭代 2）：①左上标签点击弹年月选择器（MonthPickerPopover 自绘浮层，
 *   今年只显月份/非今年显月+年）；②agenda 上下滑无缝（全量数据链已有），标签跟随首可见
 *   分组月（onViewableItemsChanged）；③月视图空白格修复（MonthCalendarView threshold 降为
 *   0.5，见该组件注释）；④日视图两列结构修复遮挡 + 横滑切前后日（DayTimelineView）；
 *   ⑤‹›箭头仅月视图保留（周/日靠周条与横滑）；⑥周视图单日态（默认：点周条天只切换
 *   选中天，列表按日程排版显示该天记录）+「周」pill 切整周态（7 天按天分组），
 *   整周态点某天回单日态；⑦「已归档」移入筛选面板。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ViewToken } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { itemRepository } from '../../data';
import type { Category } from '../../domain/category';
import { formatLocalDate, getZonedParts } from '../../domain/recurrence/civilTime';
import type { ItemWithRelations } from '../../domain/relations/itemWithRelations';
import type { Tag } from '../../domain/tag';
import { groupItemsForAgenda } from '../../domain/views/agenda';
import type { AgendaViewKind } from '../../domain/views/agenda';
import { EMPTY_ITEM_FILTERS, filterItems, hasActiveFilters } from '../../domain/views/filters';
import type { ItemFilters } from '../../domain/views/filters';
import {
  getDayRange,
  getMonthRangeForCivil,
  getSevenDayWindow,
  resolveDayStart,
  shiftAnchorDay,
  shiftCivilMonth,
} from '../../domain/views/ranges';
import type { CivilMonth } from '../../domain/views/ranges';
import { itemsByDay } from '../../domain/views/itemsByDay';
import { layoutDayEvents } from '../../domain/views/dayTimeline';
import EmptyState from '../../ui/EmptyState';
import FilterSheet from '../../ui/FilterSheet';
import { MonthCalendarView } from '../../ui/MonthCalendarView';
import { MonthPickerPopover } from '../../ui/MonthPickerPopover';
import { DayTimelineView } from '../../ui/DayTimelineView';
import { formatAgendaTimeRange, getDeviceTzid, WEEKDAY_LABELS } from '../../ui/timeFormat';

/** 合法分类色（数据异常回退约定 repository.md v0.14） */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** 分类色缺失/非法时卡片色条回退灰 */
const CARD_STRIPE_FALLBACK = '#DDDDDD';

/** FlatList 行模型：组头（含今天高亮）或卡片 */
interface AgendaRowHeader {
  kind: 'header';
  key: string;
  label: string;
  isToday: boolean;
  count: number;
}

interface AgendaRowItem {
  kind: 'item';
  key: string;
  /** 所属分组民用日键（YYYY-MM-DD；agenda 标签跟随滚动时解析月份用） */
  civilKey: string;
  item: ItemWithRelations;
}

type AgendaRow = AgendaRowHeader | AgendaRowItem;

/** Agenda 卡片（任务卡：左侧 4px 分类色条 + Emoji + 标题 + 时间段；点击进详情） */
function AgendaItemCard({
  item,
  tzid,
  onPress,
}: {
  item: ItemWithRelations;
  tzid: string;
  onPress: (itemId: string) => void;
}) {
  const timeLabel = formatAgendaTimeRange(item, tzid);
  const stripeColor =
    item.category?.color && HEX_COLOR_PATTERN.test(item.category.color)
      ? item.category.color
      : CARD_STRIPE_FALLBACK;
  const emoji = item.category?.emoji ?? null;
  return (
    <Pressable style={styles.card} onPress={() => onPress(item.id)}>
      <View style={[styles.cardStripe, { backgroundColor: stripeColor }]} />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {emoji ? `${emoji} ${item.title}` : item.title}
        </Text>
        {timeLabel ? <Text style={styles.cardTime}>{timeLabel}</Text> : null}
      </View>
    </Pressable>
  );
}

export default function PlanScreen() {
  const router = useRouter();
  const [items, setItems] = useState<ItemWithRelations[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  // 阶段 5：视图模式 + 筛选（视图切换 UI 在筛选面板顶部）
  const [viewKind, setViewKind] = useState<AgendaViewKind>('agenda');
  const [activeFilters, setActiveFilters] = useState<ItemFilters>(EMPTY_ITEM_FILTERS);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  // 阶段 5c 周视图双态：'day'=单日态（周条选中的那天，日程排版）| 'whole'=整周态（7 天按天分组）。
  // 仅 viewKind==='week' 时有意义；「周」pill 切换。
  const [weekMode, setWeekMode] = useState<'day' | 'whole'>('day');
  // 阶段 5c 年月选择器（MonthPickerPopover）：点击左上标签弹出
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  // 阶段 5c agenda 标签跟随：首可见分组所属民用月（onViewableItemsChanged 更新）
  const [agendaTopMonth, setAgendaTopMonth] = useState<CivilMonth>(() => {
    const parts = getZonedParts(Date.now(), getDeviceTzid());
    return { year: parts.year, month: parts.month };
  });

  // 视图时间坐标：挂载时固化（today.tsx 同款模式）——页面存续期间「今天」不漂移。
  const [viewTime] = useState(() => {
    const tzid = getDeviceTzid();
    return { tzid, nowMs: Date.now() };
  });

  // 阶段 5b 锚点：week/day 用 anchorMs（民用日锚点），month 用 anchorMonth（民用月锚点）。
  // 「今天」pill / 周条横滑 / 顶栏 ‹ › 都只改锚点；viewTime 保持固化供回位与「今天」判定。
  const [anchorMs, setAnchorMs] = useState(() => viewTime.nowMs);
  const [anchorMonth, setAnchorMonth] = useState<CivilMonth>(() => {
    const parts = getZonedParts(viewTime.nowMs, viewTime.tzid);
    return { year: parts.year, month: parts.month };
  });

  // agenda「今天」pill：滚动定位今日分组行
  const listRef = useRef<FlatList<AgendaRow> | null>(null);

  // 月历页缓冲（无极双向滚动）：每页一个民用月；锚点月不在缓冲中时重置为 [前, 当前, 后]
  const [monthPages, setMonthPages] = useState<CivilMonth[]>(() => [anchorMonth]);
  useEffect(() => {
    setMonthPages((prev) => {
      const target = `${anchorMonth.year}-${anchorMonth.month}`;
      if (prev.some((page) => `${page.year}-${page.month}` === target)) {
        return prev;
      }
      return [shiftCivilMonth(anchorMonth, -1), anchorMonth, shiftCivilMonth(anchorMonth, 1)];
    });
  }, [anchorMonth]);

  const prependMonthPage = useCallback((): void => {
    setMonthPages((prev) => {
      const first = prev[0];
      if (!first) {
        return prev;
      }
      const candidate = shiftCivilMonth(first, -1);
      return prev.some((page) => page.year === candidate.year && page.month === candidate.month)
        ? prev
        : [candidate, ...prev];
    });
  }, []);

  const appendMonthPage = useCallback((): void => {
    setMonthPages((prev) => {
      const last = prev[prev.length - 1];
      if (!last) {
        return prev;
      }
      const candidate = shiftCivilMonth(last, 1);
      return prev.some((page) => page.year === candidate.year && page.month === candidate.month)
        ? prev
        : [...prev, candidate];
    });
  }, []);

  useEffect(() => itemRepository.observeItemsWithTags(setItems), []);
  useEffect(() => itemRepository.observeTags(setAllTags), []);

  // 分类视觉：挂载时取一次；每次打开筛选面板再现取（设置页改色后即生效）
  const refreshCategories = useCallback((): void => {
    void itemRepository
      .getCategories()
      .then((loaded) => {
        setCategories(loaded);
      })
      .catch((error: unknown) => {
        console.warn('[slice-14] getCategories failed:', error);
      });
  }, []);

  useEffect(() => {
    refreshCategories();
  }, [refreshCategories]);

  const openFilterSheet = useCallback((): void => {
    refreshCategories();
    setFilterSheetVisible(true);
  }, [refreshCategories]);

  /** FAB 短按：新建条目 → 全屏新建页。 */
  const openNewItem = useCallback((): void => {
    router.push('/item/new');
  }, [router]);

  /** FAB 长按：闪电录入占位（切片 15 上线前的提示，阶段 5b 拍板）。 */
  const showFlashPlaceholder = useCallback((): void => {
    Alert.alert('闪电录入', '即将上线');
  }, []);

  const openItemDetail = useCallback(
    (itemId: string): void => {
      router.push(`/item/${itemId}`);
    },
    [router],
  );

  const filtersActive = hasActiveFilters(activeFilters);

  // 视图时间范围：agenda=全量；week=锚点起 7 天窗（整周态）或锚点单日（单日态）；
  // day=锚点单日；month=锚点月（[start, end) 左闭右开）
  const viewRange = useMemo(() => {
    if (viewKind === 'agenda') {
      return null;
    }
    if (viewKind === 'week') {
      // 阶段 5c 周双态：单日态按单日取数（列表=该天记录，日程排版）；整周态按 7 天窗
      return weekMode === 'whole'
        ? getSevenDayWindow(anchorMs, viewTime.tzid)
        : getDayRange(anchorMs, viewTime.tzid);
    }
    if (viewKind === 'day') {
      return getDayRange(anchorMs, viewTime.tzid);
    }
    return getMonthRangeForCivil(viewTime.tzid, anchorMonth.year, anchorMonth.month);
  }, [anchorMonth, anchorMs, viewKind, viewTime, weekMode]);

  // 「今天」民用日期键（组头高亮判定，与 agenda 分组键同源：civilTime）
  const todayKey = useMemo(
    () => formatLocalDate(getZonedParts(viewTime.nowMs, viewTime.tzid)),
    [viewTime],
  );

  // 数据链：范围谓词（agenda 不限范围；startAt=null 恒通过）→ 筛选 → 分组
  const agendaGroups = useMemo(() => {
    const ranged =
      viewRange !== null
        ? items.filter(
            (item) =>
              item.startAt === null ||
              (item.startAt >= viewRange.startMs && item.startAt < viewRange.endMs),
          )
        : items;
    const filtered = filterItems(ranged, activeFilters);
    return groupItemsForAgenda(filtered, {
      viewKind,
      nowMs: viewTime.nowMs,
      tzid: viewTime.tzid,
    });
  }, [activeFilters, items, viewKind, viewRange, viewTime]);

  // 月历数据：锚点月范围内、经筛选后的条目按民用日分桶（月历格 chip 用；
  // 无 startAt 的待办天然不进格子）。agendaGroups 的分组结果对月历无用，独立计算。
  const monthDayItems = useMemo(() => {
    if (viewKind !== 'month' || viewRange === null) {
      return new Map<string, ItemWithRelations[]>();
    }
    const ranged = items.filter(
      (item) =>
        item.startAt !== null && item.startAt >= viewRange.startMs && item.startAt < viewRange.endMs,
    );
    return itemsByDay(filterItems(ranged, activeFilters), viewTime.tzid);
  }, [activeFilters, items, viewKind, viewRange, viewTime.tzid]);

  // 日视图时间轴布局：当日范围内经筛选的条目 → layoutDayEvents（阶段 5b）
  const dayTimeline = useMemo(() => {
    if (viewKind !== 'day' || viewRange === null) {
      return null;
    }
    const ranged = items.filter(
      (item) =>
        item.startAt !== null && item.startAt >= viewRange.startMs && item.startAt < viewRange.endMs,
    );
    const filtered = filterItems(ranged, activeFilters);
    return {
      layout: layoutDayEvents(filtered, viewRange.startMs),
      unscheduled: filtered.filter((item) => item.startAt === null),
      dayStartMs: viewRange.startMs,
    };
  }, [activeFilters, items, viewKind, viewRange]);

  /** 月历点格子 → 进入 day 视图并锚定该民用日（civilKey='YYYY-MM-DD'）。 */
  const selectCalendarDay = useCallback(
    (civilKey: string): void => {
      const [yearPart, monthPart, dayPart] = civilKey.split('-');
      const year = Number(yearPart);
      const month = Number(monthPart);
      const day = Number(dayPart);
      if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return;
      }
      setAnchorMs(resolveDayStart(viewTime.tzid, { year, month, day }));
      setAnchorMonth({ year, month });
      setViewKind('day');
    },
    [viewTime.tzid],
  );

  // 本月视图组序倒序（按日期从晚到早承载「本月」范围）
  const displayedGroups = useMemo(() => {
    if (viewKind === 'month') {
      return [...agendaGroups].reverse();
    }
    return agendaGroups;
  }, [agendaGroups, viewKind]);

  // 摊平为 FlatList 行：组头 + 组内卡片
  const rows = useMemo<AgendaRow[]>(() => {
    const result: AgendaRow[] = [];
    for (const group of displayedGroups) {
      result.push({
        kind: 'header',
        key: `header-${group.key}`,
        label: group.label,
        isToday: group.kind === 'day' && group.key === todayKey,
        count: group.items.length,
      });
      for (const itemRecord of group.items) {
        result.push({
          kind: 'item',
          key: `item-${group.key}-${itemRecord.id}`,
          civilKey: group.key,
          item: itemRecord,
        });
      }
    }
    return result;
  }, [displayedGroups, todayKey]);

  const emptyMessage = useMemo(() => {
    if (viewKind === 'week') {
      // 阶段 5c 周双态：单日态提示与 day 视图一致
      return weekMode === 'whole' ? '近 7 天没有安排' : '当天没有安排';
    }
    if (viewKind === 'day') {
      return '当天没有安排';
    }
    if (viewKind === 'month') {
      return '本月没有安排';
    }
    return '暂无日程';
  }, [viewKind, weekMode]);

  // —— 阶段 5b/5c 顶栏与周条 ——
  const partsOf = useCallback(
    (ms: number) => getZonedParts(ms, viewTime.tzid),
    [viewTime.tzid],
  );

  /** 年月标签（阶段 5c 任务 0）：今年只显「11月」，非今年显「2027年1月」。 */
  const monthLabelOf = useCallback(
    (year: number, month: number): string => {
      const now = getZonedParts(viewTime.nowMs, viewTime.tzid);
      return year === now.year ? `${month}月` : `${year}年${month}月`;
    },
    [viewTime],
  );

  /** 单日标签：今年「11月7日 周六」，非今年「2027年11月7日 周六」（阶段 5c 任务 0）。 */
  const dayLabelOf = useCallback(
    (ms: number): string => {
      const parts = partsOf(ms);
      const weekday = WEEKDAY_LABELS[parts.weekday] ?? '';
      const now = getZonedParts(viewTime.nowMs, viewTime.tzid);
      const yearPrefix = parts.year === now.year ? '' : `${parts.year}年`;
      return `${yearPrefix}${parts.month}月${parts.day}日 ${weekday}`;
    },
    [partsOf, viewTime],
  );

  /**
   * 顶栏标签（阶段 5c）：agenda=首可见分组月（跟随上下滑）；month=锚点月；
   * day=锚点单日；week=整周态 7 天窗跨度（跨年才带年）/ 单日态锚点单日。
   */
  const topBarTitle = useMemo(() => {
    if (viewKind === 'agenda') {
      return monthLabelOf(agendaTopMonth.year, agendaTopMonth.month);
    }
    if (viewKind === 'month') {
      return monthLabelOf(anchorMonth.year, anchorMonth.month);
    }
    if (viewKind === 'day') {
      return dayLabelOf(anchorMs);
    }
    // week：单日态=选中那天；整周态=窗口起止（跨度含年才带年）
    if (weekMode === 'day') {
      return dayLabelOf(anchorMs);
    }
    const range = getSevenDayWindow(anchorMs, viewTime.tzid);
    const start = partsOf(range.startMs);
    const end = partsOf(range.endMs - 1);
    const sameMonth = start.year === end.year && start.month === end.month;
    const endLabel = sameMonth
      ? `${end.day}日`
      : end.year === start.year
        ? `${end.month}月${end.day}日`
        : `${end.year}年${end.month}月${end.day}日`;
    const startYearPrefix = start.year === end.year ? '' : `${start.year}年`;
    return `${startYearPrefix}${start.month}月${start.day}日 - ${endLabel}`;
  }, [agendaTopMonth, anchorMonth, anchorMs, dayLabelOf, monthLabelOf, partsOf, viewKind, viewTime, weekMode]);

  /** 顶栏 ‹ ›（阶段 5c 收敛：仅月视图保留，week/day 靠周条与横滑切日）。 */
  const stepAnchor = useCallback((dir: 1 | -1): void => {
    setAnchorMonth((prev) => shiftCivilMonth(prev, dir));
  }, []);

  /** 「今天」pill：agenda 滚动定位今日分组；week/day 锚点回今日；month 回本月。 */
  const goToday = useCallback((): void => {
    if (viewKind === 'week' || viewKind === 'day') {
      setAnchorMs(viewTime.nowMs);
      return;
    }
    if (viewKind === 'month') {
      const parts = getZonedParts(viewTime.nowMs, viewTime.tzid);
      setAnchorMonth({ year: parts.year, month: parts.month });
      return;
    }
    const index = rows.findIndex((row) => row.kind === 'header' && row.key === `header-${todayKey}`);
    if (index >= 0) {
      listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true });
    }
  }, [rows, todayKey, viewKind, viewTime]);

  /** 「周」pill（阶段 5c 任务 6）：单日态 ↔ 整周态切换；仅周视图渲染。 */
  const toggleWeekMode = useCallback((): void => {
    setWeekMode((prev) => (prev === 'day' ? 'whole' : 'day'));
  }, []);

  /**
   * 点周条某天（阶段 5c 任务 5/6）：
   * - 日视图：换天；
   * - 周视图单日态：只切换选中天（不跳视图，列表仍按日程排版显示该天）；
   * - 周视图整周态：切回单日态并选中该天（用户拍板 m00931-②）。
   */
  const selectWeekStripDay = useCallback((startMs: number): void => {
    setAnchorMs(startMs);
    setWeekMode('day');
  }, []);

  /** 周条 7 天：锚点窗内各民用日；单日态（day 视图或周视图单日态）高亮锚点日，整周态无高亮。 */
  const weekStripDays = useMemo(() => {
    if (viewKind !== 'week' && viewKind !== 'day') {
      return [];
    }
    const range = getSevenDayWindow(anchorMs, viewTime.tzid);
    const anchorKey = formatLocalDate(getZonedParts(anchorMs, viewTime.tzid));
    const highlightSelection = viewKind === 'day' || (viewKind === 'week' && weekMode === 'day');
    const days: Array<{ key: string; startMs: number; dayOfMonth: number; weekdayLabel: string; isToday: boolean; isSelected: boolean }> = [];
    for (let i = 0; i < 7; i += 1) {
      const startMs = shiftAnchorDay(range.startMs, viewTime.tzid, i);
      const parts = getZonedParts(startMs, viewTime.tzid);
      const key = formatLocalDate(parts);
      days.push({
        key,
        startMs,
        dayOfMonth: parts.day,
        weekdayLabel: WEEKDAY_LABELS[parts.weekday]?.slice(1) ?? '',
        isToday: key === todayKey,
        isSelected: highlightSelection && key === anchorKey,
      });
    }
    return days;
  }, [anchorMs, todayKey, viewKind, viewTime.tzid, weekMode]);

  /**
   * 年月选择器（阶段 5c 任务 0）：选择后按当前视图落点——
   * month→切月；week/day→锚定该月 1 日；agenda→滚动定位该月第一组。
   */
  const applyMonthPick = useCallback(
    (year: number, month: number): void => {
      setMonthPickerVisible(false);
      setAnchorMonth({ year, month });
      if (viewKind === 'month') {
        return;
      }
      if (viewKind === 'week' || viewKind === 'day') {
        setAnchorMs(resolveDayStart(viewTime.tzid, { year, month, day: 1 }));
        return;
      }
      // agenda：滚动到该月第一组（civilKey 零填充 YYYY-MM-DD，前缀匹配 'YYYY-MM-'；
      // 「待办」组（无时间项）key 非日期形态被正则排除）
      const prefix = `${year}-${month < 10 ? `0${month}` : month}-`;
      const index = rows.findIndex(
        (row) =>
          row.kind === 'header' &&
          row.key.startsWith(`header-${prefix}`) &&
          /^header-\d{4}-\d{2}-/.test(row.key),
      );
      if (index >= 0) {
        listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true });
      }
    },
    [rows, viewKind, viewTime],
  );

  /** agenda 标签跟随（阶段 5c 任务 1）：取首可见行的民用日，更新顶栏月份。 */
  const handleViewableItemsChanged = useRef(
    (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      const first = info.viewableItems[0]?.item as AgendaRow | undefined;
      if (!first) {
        return;
      }
      const civilKey = first.kind === 'header' ? first.key.slice('header-'.length) : first.civilKey;
      const monthPart = civilKey.slice(0, 7); // 'YYYY-MM'
      const [yearPart, monthDigits] = monthPart.split('-');
      const year = Number(yearPart);
      const month = Number(monthDigits);
      if (!Number.isInteger(year) || !Number.isInteger(month)) {
        return;
      }
      setAgendaTopMonth((prev) => (prev.year === year && prev.month === month ? prev : { year, month }));
    },
  ).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  // 周条横滑：水平拖过阈值 ±7 天（PanResponder 只接管移动，chip 的 onPress 不受影响）
  const weekStripPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx <= -40) {
            setAnchorMs((prev) => shiftAnchorDay(prev, viewTime.tzid, 7));
          } else if (gesture.dx >= 40) {
            setAnchorMs((prev) => shiftAnchorDay(prev, viewTime.tzid, -7));
          }
        },
      }),
    [viewTime.tzid],
  );

  const rowKeyExtractor = useCallback((row: AgendaRow): string => row.key, []);

  const renderRow = useCallback(
    ({ item: row }: { item: AgendaRow }) => {
      if (row.kind === 'header') {
        return (
          <View style={styles.groupHeader}>
            <View style={[styles.groupHeaderPill, row.isToday && styles.groupHeaderPillToday]}>
              <Text style={[styles.groupHeaderText, row.isToday && styles.groupHeaderTextToday]}>
                {row.label}
              </Text>
            </View>
            <Text style={styles.groupHeaderCount}>{row.count}</Text>
          </View>
        );
      }
      return <AgendaItemCard item={row.item} tzid={viewTime.tzid} onPress={openItemDetail} />;
    },
    [openItemDetail, viewTime.tzid],
  );

  return (
    <View style={styles.container}>
      {/* 阶段 5c 统一顶栏：左=标签（点击弹年月选择器；‹›仅月视图），右=🔍 筛选 [周] 今天 */}
      <View style={styles.topBar}>
        <View style={styles.navGroup}>
          {viewKind === 'month' ? (
            <Pressable
              hitSlop={8}
              style={({ pressed }) => [styles.navArrow, pressed && styles.iconPressed]}
              onPress={() => stepAnchor(-1)}
              accessibilityLabel="上一月"
            >
              <Ionicons name="chevron-back" size={20} color="#111111" />
            </Pressable>
          ) : null}
          <Pressable
            style={({ pressed }) => [styles.titlePressable, pressed && styles.iconPressed]}
            onPress={() => setMonthPickerVisible(true)}
            accessibilityLabel="选择年月"
          >
            <Text style={styles.topBarTitle}>{topBarTitle}</Text>
            <Ionicons
              name={monthPickerVisible ? 'chevron-up' : 'chevron-down'}
              size={14}
              color="#666666"
            />
          </Pressable>
          {viewKind === 'month' ? (
            <Pressable
              hitSlop={8}
              style={({ pressed }) => [styles.navArrow, pressed && styles.iconPressed]}
              onPress={() => stepAnchor(1)}
              accessibilityLabel="下一月"
            >
              <Ionicons name="chevron-forward" size={20} color="#111111" />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.rightGroup}>
          <Pressable
            hitSlop={8}
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
            onPress={() => router.push('/search')}
            accessibilityLabel="搜索"
          >
            <Ionicons name="search-outline" size={22} color="#111111" />
          </Pressable>
          <Pressable
            hitSlop={8}
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
            onPress={openFilterSheet}
            accessibilityLabel="筛选"
          >
            <Ionicons name="options-outline" size={22} color="#111111" />
            {filtersActive ? <View style={styles.filterDot} /> : null}
          </Pressable>
          {viewKind === 'week' ? (
            /* 「周」pill（阶段 5c 任务 6）：周视图单日态↔整周态，激活态黑底白字区分 */
            <Pressable
              hitSlop={8}
              style={[styles.weekModePill, weekMode === 'whole' && styles.weekModePillActive]}
              onPress={toggleWeekMode}
              accessibilityLabel={weekMode === 'whole' ? '切回单日' : '切换整周列表'}
            >
              <Text
                style={[
                  styles.weekModePillText,
                  weekMode === 'whole' && styles.weekModePillTextActive,
                ]}
              >
                周
              </Text>
            </Pressable>
          ) : null}
          <Pressable hitSlop={8} style={styles.todayPill} onPress={goToday}>
            <Text style={styles.todayPillText}>今天</Text>
          </Pressable>
        </View>
      </View>

      {/* 阶段 5b 周条：week/day 视图显示 7 天窗 chip 行，横滑 ±7 天，点某天进日视图 */}
      {weekStripDays.length > 0 ? (
        <View style={styles.weekStrip} {...weekStripPanResponder.panHandlers}>
          {weekStripDays.map((day) => (
            <Pressable
              key={day.key}
              style={({ pressed }) => [
                styles.weekStripDay,
                day.isSelected && styles.weekStripDaySelected,
                pressed && styles.iconPressed,
              ]}
              onPress={() => selectWeekStripDay(day.startMs)}
            >
              <Text
                style={[
                  styles.weekStripWeekday,
                  day.isToday && styles.weekStripWeekdayToday,
                  day.isSelected && styles.weekStripTextSelected,
                ]}
              >
                {day.weekdayLabel}
              </Text>
              <Text
                style={[
                  styles.weekStripDayNum,
                  day.isToday && styles.weekStripDayNumToday,
                  day.isSelected && styles.weekStripTextSelected,
                ]}
              >
                {day.dayOfMonth}
              </Text>
              {day.isToday && !day.isSelected ? <View style={styles.weekStripTodayDot} /> : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* 阶段 5c：已归档入口移入筛选面板（原 linksRow 删除） */}

      {viewKind === 'month' ? (
        /* 月历视图：富月历，无极双向滚动，点格进日视图（阶段 5b） */
        <MonthCalendarView
          months={monthPages}
          dayItems={monthDayItems}
          todayKey={todayKey}
          onSelectDay={selectCalendarDay}
          onPrependMonth={prependMonthPage}
          onAppendMonth={appendMonthPage}
        />
      ) : viewKind === 'day' && dayTimeline !== null ? (
        /* 日视图：纵向时间轴 + 全天/待办 chip 区（阶段 5b）；横滑切前后日（阶段 5c 任务 3） */
        <DayTimelineView
          dayStartMs={dayTimeline.dayStartMs}
          layout={dayTimeline.layout}
          unscheduled={dayTimeline.unscheduled}
          nowMs={viewTime.nowMs}
          tzid={viewTime.tzid}
          onSelectItem={openItemDetail}
          onShiftDay={(delta) => setAnchorMs((prev) => shiftAnchorDay(prev, viewTime.tzid, delta))}
        />
      ) : (
        <FlatList<AgendaRow>
          ref={listRef}
          style={styles.list}
          data={rows}
          renderItem={renderRow}
          keyExtractor={rowKeyExtractor}
          ListEmptyComponent={<EmptyState message={emptyMessage} />}
          contentContainerStyle={rows.length === 0 ? styles.listEmpty : undefined}
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onScrollToIndexFailed={(info) => {
            // 分组行未渲染完成时先跳近似位置再重试（RN 官方建议模式）
            listRef.current?.scrollToOffset({ offset: info.highestMeasuredFrameIndex * 72, animated: false });
            setTimeout(() => {
              listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0, animated: true });
            }, 50);
          }}
        />
      )}

      {/* FAB：新建条目 → 全屏新建页（阶段 5）；长按=闪电录入占位提示（切片 15 上线，阶段 5b） */}
      <Pressable
        style={styles.fab}
        onPress={openNewItem}
        onLongPress={showFlashPlaceholder}
        delayLongPress={400}
        hitSlop={4}
      >
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </Pressable>

      {/* 筛选面板：即时生效（阶段 5b）——点条件/视图立即提交，X/遮罩直接关；
          已归档行 + 底部操作行（阶段 5c 任务 7/8） */}
      <FilterSheet
        visible={filterSheetVisible}
        categories={categories}
        tags={allTags}
        filters={activeFilters}
        viewKind={viewKind}
        onChange={(nextFilters, nextViewKind) => {
          setActiveFilters(nextFilters);
          setViewKind(nextViewKind);
        }}
        onOpenArchived={() => {
          setFilterSheetVisible(false);
          router.push('/archived');
        }}
        onClose={() => {
          setFilterSheetVisible(false);
        }}
      />

      {/* 年月选择器浮层（阶段 5c 任务 0）：锚定当前标签月；自绘零依赖 */}
      <MonthPickerPopover
        visible={monthPickerVisible}
        anchor={
          viewKind === 'month'
            ? anchorMonth
            : viewKind === 'agenda'
              ? agendaTopMonth
              : partsOf(anchorMs)
        }
        onSelect={applyMonthPick}
        onClose={() => setMonthPickerVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  // 阶段 5b 顶栏：左=‹ 标签 ›，右=🔍 筛选 今天
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  navGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  navArrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
    marginHorizontal: 2,
  },
  // 阶段 5c：标签可点（弹年月选择器），右侧小箭头指示
  titlePressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginHorizontal: 2,
    paddingVertical: 4,
  },
  rightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPressed: {
    opacity: 0.6,
  },
  todayPill: {
    marginLeft: 4,
    borderRadius: 999,
    backgroundColor: '#111111',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  todayPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // 阶段 5c：「周」pill（周视图工具栏），激活态黑底白字与「今天」pill 同款区分
  weekModePill: {
    marginLeft: 4,
    borderRadius: 999,
    backgroundColor: '#F0F0F0',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  weekModePillActive: {
    backgroundColor: '#111111',
  },
  weekModePillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333333',
  },
  weekModePillTextActive: {
    color: '#FFFFFF',
  },
  filterDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E53935',
  },
  // 阶段 5b 周条：7 天 chip 行
  weekStrip: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 6,
  },
  weekStripDay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    backgroundColor: '#FAFAFA',
  },
  weekStripDaySelected: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  weekStripWeekday: {
    fontSize: 11,
    color: '#888888',
  },
  weekStripWeekdayToday: {
    color: '#111111',
    fontWeight: '700',
  },
  weekStripDayNum: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333333',
  },
  weekStripDayNumToday: {
    color: '#111111',
  },
  weekStripTextSelected: {
    color: '#FFFFFF',
  },
  weekStripTodayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#111111',
  },
  // 链接行（阶段 5c 删除：已归档入口移入筛选面板）
  // Agenda 列表
  list: {
    flex: 1,
  },
  listEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
    marginBottom: 8,
  },
  groupHeaderPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: '#F0F0F0',
  },
  groupHeaderPillToday: {
    backgroundColor: '#111111',
  },
  groupHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333333',
  },
  groupHeaderTextToday: {
    color: '#ffffff',
  },
  groupHeaderCount: {
    fontSize: 12,
    color: '#999999',
  },
  card: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    backgroundColor: '#FAFAFA',
    marginBottom: 8,
    overflow: 'hidden',
  },
  cardStripe: {
    width: 4,
  },
  cardBody: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  cardTitle: {
    fontSize: 15,
    color: '#111111',
    lineHeight: 20,
  },
  cardTime: {
    fontSize: 12,
    color: '#888888',
    marginTop: 3,
  },
  // FAB（阶段 5）：右下角圆形新建入口，压在列表之上
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
});
