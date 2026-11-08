/**
 * 计划 Tab 主视图（切片 14 阶段 5 重构：tasks/slice-14.md 阶段 5 / AGENTS.md §7.21；
 * 原 src/app/index.tsx 移入 (tabs)/plan.tsx）。
 *
 * - 阶段 5：视图切换器移入筛选面板顶部（日程/周/月/日，FilterSheet initialViewKind
 *   + onApply 双参）；移除内嵌快速录入框（创建落点改为全屏新建页 /item/new，
 *   ui.md「快速记录落点 v0.14」）；右下 FAB 新建入口 → router.push('/item/new')；
 *   无导航头标题（(tabs) 布局 headerShown:false，验收 16）；
 * - 阶段 5b 顶栏：左=‹ 标签 ›（agenda 仅标签纯展示；week ±7 天 / day ±1 天 /
 *   month ±1 月步进），右=🔍（进入 /search 独立搜索页）+ 筛选（激活时红点）
 *   + 「今天」pill（agenda 滚动定位今日分组；week/day 锚点回今日；month 回本月）；
 * - 阶段 5b 周条：week/day 视图显示今日起 7 天窗 chip 行，横滑（PanResponder）±7 天，
 *   点某天 → day 视图锚点换到该天；
 * - 数据链：observeItemsWithTags 单订阅（默认列表，§7.23 ItemWithRelations）→
 *   视图范围谓词（agenda 全量；week=今日起 7 天窗；day=单日；month=锚点月；
 *   startAt=null 恒通过进「待办」组）→
 *   filterItems（激活筛选，维度内 OR、维度间 AND）→ groupItemsForAgenda 按天分组 →
 *   FlatList 摊平渲染（header|item 两类行）；本月视图组序倒序（按日期从晚到早）；
 * - 卡片：左侧 4px 分类色条 + Emoji + 标题 + 时间段（formatAgendaTimeRange），
 *   点击进详情页 /item/<id>（task 卡 life://item/<id> 深链同一路由）；
 * - 链接行：仅「已归档」（设置入口移入「我的」Tab）；行内「转为任务/添加标签」入口
 *   由编辑页承接（同等能力）；「归档」入口移至详情页（用户确认，2026-11-08）；
 *   旧 /today /week 页面原样保留不删；搜索移入 /search 独立页（阶段 5b）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
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

  // 视图时间范围：agenda=全量；week=锚点日起 7 天窗；day=锚点单日；month=锚点月（[start, end) 左闭右开）
  const viewRange = useMemo(() => {
    if (viewKind === 'agenda') {
      return null;
    }
    if (viewKind === 'week') {
      return getSevenDayWindow(anchorMs, viewTime.tzid);
    }
    if (viewKind === 'day') {
      return getDayRange(anchorMs, viewTime.tzid);
    }
    return getMonthRangeForCivil(viewTime.tzid, anchorMonth.year, anchorMonth.month);
  }, [anchorMonth, anchorMs, viewKind, viewTime]);

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
        result.push({ kind: 'item', key: `item-${group.key}-${itemRecord.id}`, item: itemRecord });
      }
    }
    return result;
  }, [displayedGroups, todayKey]);

  const emptyMessage = useMemo(() => {
    if (viewKind === 'week') {
      return '近 7 天没有安排';
    }
    if (viewKind === 'day') {
      return '当天没有安排';
    }
    if (viewKind === 'month') {
      return '本月没有安排';
    }
    return '暂无日程';
  }, [viewKind]);

  // —— 阶段 5b 顶栏与周条 ——
  const partsOf = useCallback(
    (ms: number) => getZonedParts(ms, viewTime.tzid),
    [viewTime.tzid],
  );

  /** 顶栏标签：随视图变化（agenda 月名纯展示；week 窗口起止；day 单日；month 年月）。 */
  const topBarTitle = useMemo(() => {
    const fmtMonth = (year: number, month: number): string =>
      month === 1 ? `${year}年1月` : `${month}月`;
    if (viewKind === 'agenda') {
      const parts = partsOf(viewTime.nowMs);
      return fmtMonth(parts.year, parts.month);
    }
    if (viewKind === 'month') {
      return `${anchorMonth.year}年${anchorMonth.month}月`;
    }
    const start = partsOf(viewKind === 'day' ? anchorMs : viewRange?.startMs ?? anchorMs);
    if (viewKind === 'day') {
      const weekday = WEEKDAY_LABELS[start.weekday] ?? '';
      return `${start.year}年${start.month}月${start.day}日 ${weekday}`;
    }
    const end = partsOf(viewRange?.endMs ? viewRange.endMs - 1 : anchorMs);
    const sameMonth = start.year === end.year && start.month === end.month;
    const endLabel = sameMonth
      ? `${end.day}日`
      : end.year === start.year
        ? `${end.month}月${end.day}日`
        : `${end.year}年${end.month}月${end.day}日`;
    return `${start.year === end.year ? '' : `${start.year}年`}${start.month}月${start.day}日 - ${endLabel}`;
  }, [anchorMonth, anchorMs, partsOf, viewKind, viewRange, viewTime.nowMs]);

  /** 顶栏 ‹ ›：week ±7 天、day ±1 天（civil 推算，DST 安全）、month ±1 月；agenda 无步进。 */
  const stepAnchor = useCallback(
    (dir: 1 | -1): void => {
      if (viewKind === 'week') {
        setAnchorMs((prev) => shiftAnchorDay(prev, viewTime.tzid, 7 * dir));
      } else if (viewKind === 'day') {
        setAnchorMs((prev) => shiftAnchorDay(prev, viewTime.tzid, dir));
      } else if (viewKind === 'month') {
        setAnchorMonth((prev) => shiftCivilMonth(prev, dir));
      }
    },
    [viewKind, viewTime.tzid],
  );

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

  /** 周条 7 天：锚点窗内各民用日（today 标记与 day 视图选中标记）。 */
  const weekStripDays = useMemo(() => {
    if (viewKind !== 'week' && viewKind !== 'day') {
      return [];
    }
    const range = getSevenDayWindow(anchorMs, viewTime.tzid);
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
        isSelected: viewKind === 'day' && key === formatLocalDate(getZonedParts(anchorMs, viewTime.tzid)),
      });
    }
    return days;
  }, [anchorMs, todayKey, viewKind, viewTime.tzid]);

  /** 点周条某天 → 进入 day 视图并锚定该天。 */
  const selectWeekStripDay = useCallback(
    (startMs: number): void => {
      setAnchorMs(startMs);
      setViewKind('day');
    },
    [],
  );

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
      {/* 阶段 5b 统一顶栏：左=‹ 标签 ›（agenda 纯标签），右=🔍 筛选 今天 */}
      <View style={styles.topBar}>
        <View style={styles.navGroup}>
          {viewKind !== 'agenda' ? (
            <Pressable
              hitSlop={8}
              style={({ pressed }) => [styles.navArrow, pressed && styles.iconPressed]}
              onPress={() => stepAnchor(-1)}
              accessibilityLabel="上一段"
            >
              <Ionicons name="chevron-back" size={20} color="#111111" />
            </Pressable>
          ) : null}
          <Text style={styles.topBarTitle}>{topBarTitle}</Text>
          {viewKind !== 'agenda' ? (
            <Pressable
              hitSlop={8}
              style={({ pressed }) => [styles.navArrow, pressed && styles.iconPressed]}
              onPress={() => stepAnchor(1)}
              accessibilityLabel="下一段"
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

      {/* 链接行：设置入口移入「我的」Tab；已归档保留 */}
      <View style={styles.linksRow}>
        <Link href="/archived" asChild>
          <Pressable hitSlop={8}>
            <Text style={styles.linkText}>已归档</Text>
          </Pressable>
        </Link>
      </View>

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
        /* 日视图：纵向时间轴 + 全天/待办 chip 区（阶段 5b） */
        <DayTimelineView
          dayStartMs={dayTimeline.dayStartMs}
          layout={dayTimeline.layout}
          unscheduled={dayTimeline.unscheduled}
          nowMs={viewTime.nowMs}
          tzid={viewTime.tzid}
          onSelectItem={openItemDetail}
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

      {/* 筛选面板：即时生效（阶段 5b）——点条件/视图立即提交，X/遮罩直接关 */}
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
        onClose={() => {
          setFilterSheetVisible(false);
        }}
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
  // 链接行
  linksRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 8,
    marginBottom: 10,
  },
  linkText: {
    fontSize: 13,
    color: '#2563eb',
  },
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
