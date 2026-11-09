/**
 * 计划 Tab 主视图（切片 14 阶段 5 重构：tasks/slice-14.md 阶段 5 / AGENTS.md §7.21；
 * 原 src/app/index.tsx 移入 (tabs)/plan.tsx）。
 *
 * - 阶段 5：视图切换器移入筛选面板顶部（日程/周/月/日，FilterSheet initialViewKind
 *   + onApply 双参）；移除内嵌快速录入框（创建落点改为全屏新建页 /item/new，
 *   ui.md「快速记录落点 v0.14」）；右下 FAB 新建入口 → router.push('/item/new')；
 *   无导航头标题（(tabs) 布局 headerShown:false，验收 16）；
 * - 阶段 5b 顶栏：左=标签（点击弹年月选择器），右=🔍（进入 /search 独立搜索页）
 *   + 筛选（激活时红点）+「今天」pill（agenda 滚动定位今日分组；week/day 锚点回
 *   今日；month 回本月）；
 * - 阶段 5d 顶栏标签统一：四视图一律只显月（本年「11月」/非本年「2025年11月」）；
 *   agenda 仍跟随首可见分组月，week/day 跟随锚点民用月，month 跟随锚点月；
 * - 阶段 5d 周条=自然周（周一~周日，getWeekStart），替代 5b 的「锚点起 7 天」；
 *   周视图整周态窗口同步改为自然周（getWeekRange）；7 天头横滑=整周 ±1；
 * - 数据链：observeItemsWithTags 单订阅（默认列表，§7.23 ItemWithRelations）→
 *   视图范围谓词（agenda 全量；week=整周态自然周/单日态单日；day=单日；month=锚点月；
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
 * - 阶段 5d（真机反馈迭代 3）：①顶栏标签统一只显月+年月选择联动（month→切月、
 *   day→同月同日、week→周序不变切到目标月同序自然周，nthMondayDateOfMonth）；
 *   ②周条改自然周（周一~周日），整周态窗口同步；③周视图内容区横滑=选中日 ±1
 *   （整周态=整周 ±7），7 天头横滑=整周 ±7；选中日走出当前自然周时周条整体切换；
 *   ④周条/日视图切换平移动效（Animated，150/200ms）；⑤月历空格子去框；
 *   ⑥日视图顶部与周条拉开 16px（区块间距标准值 SECTION_GAP=16）。
 * - 阶段 5e（真机反馈迭代 4）：①agenda 重构为月窗口——3 月窗口（生效月±1）无边界
 *   滚动（prepend/append 同月历模式），每页首行月名标题行，左上标签=生效月随视口联动，
 *   年月选择器选月=重置窗口并定位该月标题行（无数据也生效），「待办」组跟随生效月页首；
 *   ②周/日视图不再混入无时间待办（「待办」组仅日程视图显示）；③周条 chip 定高+
 *   今天黑点绝对定位（修复选中切日时行高跳动）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  FlatList,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ViewToken,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { itemRepository } from '../../data';
import type { Category } from '../../domain/category';
import { daysInMonth, formatLocalDate, getZonedParts } from '../../domain/recurrence/civilTime';
import type { ItemWithRelations } from '../../domain/relations/itemWithRelations';
import type { Tag } from '../../domain/tag';
import { groupItemsForAgenda } from '../../domain/views/agenda';
import type { AgendaViewKind } from '../../domain/views/agenda';
import { EMPTY_ITEM_FILTERS, filterItems, hasActiveFilters } from '../../domain/views/filters';
import type { ItemFilters } from '../../domain/views/filters';
import {
  getDayRange,
  getMonthRangeForCivil,
  getWeekRange,
  getWeekStart,
  nthMondayDateOfMonth,
  resolveDayStart,
  shiftAnchorDay,
  shiftCivilMonth,
  weekIndexInMonth,
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

/**
 * 区块间距标准值（阶段 5d 定档）：顶栏/周条/内容区之间的纵向间距统一 16，
 * 后续新模块沿用该值（用户要求参考成熟设计模式定标准）。
 */
const SECTION_GAP = 16;
// agenda 月名行整块高度（marginTop 28 + height 53 + marginBottom 4），定位 offset 用
const AGENDA_MONTH_HEADER_BLOCK = 85;
// 日程列表底部 filler（阶段 5g）：「今天」组常接近列表末尾，末尾内容不足一屏时
// 滚动上限（max offset）会卡在「今天组头贴顶之前」（真机实测 header offset 1027.5
// > max offset 970，差 57.5 永远滚不到）——底部补约一屏留白保证今日组可贴顶。
const AGENDA_TAIL_PAD_RATIO = 0.9;

/**
 * agenda 定位目标（阶段 5f）：「今天」pill/冷启动定位到今日分组头（kind='day'，
 * 无今日组时回退月名行）；年月选择器定位到目标月名行（kind='month'）。
 */
type AgendaJumpTarget = { kind: 'day'; civilKey: string } | { kind: 'month'; month: CivilMonth };

/** FlatList 行模型：组头（含今天高亮）或卡片 */
interface AgendaRowHeader {
  kind: 'header';
  key: string;
  label: string;
  isToday: boolean;
  count: number;
  /** 阶段 5e：月名标题行（agenda 月窗口每页首行，定位/联动锚点恒存在） */
  isMonthHeader?: boolean;
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
  const { height: windowHeight } = useWindowDimensions();
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

  /** 年月标签（阶段 5c 任务 0；阶段 5e 前移供月窗口行复用）：今年只显「11月」，非今年显「2027年1月」。 */
  const monthLabelOf = useCallback(
    (year: number, month: number): string => {
      const now = getZonedParts(viewTime.nowMs, viewTime.tzid);
      return year === now.year ? `${month}月` : `${year}年${month}月`;
    },
    [viewTime],
  );

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

  // —— 阶段 5e agenda 月窗口：与月历同款分页模式 ——
  // 窗口=[生效月±1]（生效月=agendaTopMonth），上下滑到边缘自动 prepend/append，无边界。
  const [agendaPages, setAgendaPages] = useState<CivilMonth[]>(() => {
    const parts = getZonedParts(Date.now(), getDeviceTzid());
    const current: CivilMonth = { year: parts.year, month: parts.month };
    // 顶部多留一页缓冲：data 顶恰为生效月时 offset 恒 0、Android overscroll 不发
    // onScroll，prepend 守卫会永远收不到触发（5e 死锁实锤）；2 页缓冲保证下滑必产生
    // 滚动事件，链条自启动。
    return [
      shiftCivilMonth(current, -2),
      shiftCivilMonth(current, -1),
      current,
      shiftCivilMonth(current, 1),
    ];
  });
  useEffect(() => {
    // 生效月不在窗口时（年月选择器远跳/今天回位）重置为 [前, 当前, 后]
    setAgendaPages((prev) => {
      const target = `${agendaTopMonth.year}-${agendaTopMonth.month}`;
      if (prev.some((page) => `${page.year}-${page.month}` === target)) {
        return prev;
      }
      return [
        shiftCivilMonth(agendaTopMonth, -1),
        agendaTopMonth,
        shiftCivilMonth(agendaTopMonth, 1),
      ];
    });
  }, [agendaTopMonth]);

  // prepend/append 期间 viewability 联动暂停：插入页会触发一次以缓冲页为首行的
  // 回调，若不忽略会把「生效月」错移到缓冲页（5e 实测曾连环 prepend 到 2024）。
  const isPrependingRef = useRef(false);
  // 最近一次 prepend 的新顶页：overscroll 后无滚动事件，viewability 不会再来，
  // handleAgendaScroll 用它在防重入窗后把「生效月」同步到新顶页（标签联动）。
  const lastPrependedRef = useRef<CivilMonth | null>(null);
  // append 防重入（见 appendAgendaPage 注释）
  const isAppendingRef = useRef(false);
  // 不做 prepend 锚定（不用 mVCP、不补偿 offset）：滚到顶触发 prepend 是用户主动
  // 行为，新页自然顶到 y=0 才是「无缝看上月」；任何锚定都会形成「顶部黑洞」锁死。
  const prependAgendaPage = useCallback((): void => {
    isPrependingRef.current = true;
    // 1200ms：慢滑手势本身约 1.2s，拖动中 y<50 的 onScroll 会连发多帧——窗口小于
    // 手势时长时一次滑动会连续 prepend 2-3 页（实测），拉齐手势时长后一滑一页。
    setTimeout(() => {
      isPrependingRef.current = false;
    }, 1200);
    const first = agendaPages[0];
    if (!first) {
      return;
    }
    const candidate = shiftCivilMonth(first, -1);
    if (agendaPages.some((page) => page.year === candidate.year && page.month === candidate.month)) {
      return;
    }
    lastPrependedRef.current = candidate;
    setAgendaPages([candidate, ...agendaPages]);
  }, [agendaPages]);

  const appendAgendaPage = useCallback((): void => {
    if (isAppendingRef.current) {
      return;
    }
    isAppendingRef.current = true;
    // 与 prepend 同款防重入（1200ms）：尾部空月页只有一个月名行高，onEndReached
    // 在滚动中反复满足阈值时（0.5 屏）会连发 append——实测上滑 3 次连翻到 2027-06。
    setTimeout(() => {
      isAppendingRef.current = false;
    }, 1200);
    setAgendaPages((prev) => {
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

  // 视图时间范围：agenda=全量；week=整周态自然周（周一~周日）或单日态单日；
  // day=锚点单日；month=锚点月（[start, end) 左闭右开）
  const viewRange = useMemo(() => {
    if (viewKind === 'agenda') {
      return null;
    }
    if (viewKind === 'week') {
      // 阶段 5c 周双态 + 5d 自然周：单日态按单日取数（列表=该天记录，日程排版）；
      // 整周态取锚点所在自然周（周一 00:00 ~ 下周一 00:00）
      return weekMode === 'whole'
        ? getWeekRange(anchorMs, viewTime.tzid)
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

  // 数据链：范围谓词（agenda 不限范围；startAt=null 恒通过）→ 筛选 → 分组。
  // 阶段 5e：周/日视图（含周单日态）不再混入无时间待办——它们是"某天"的视图，
  // 「待办」组仅在日程视图显示。
  const agendaGroups = useMemo(() => {
    const ranged =
      viewRange !== null
        ? items.filter(
            (item) =>
              item.startAt === null ||
              (item.startAt >= viewRange.startMs && item.startAt < viewRange.endMs),
          )
        : items;
    const scoped = viewKind === 'agenda' ? ranged : ranged.filter((item) => item.startAt !== null);
    const filtered = filterItems(scoped, activeFilters);
    return groupItemsForAgenda(filtered, {
      viewKind,
      nowMs: viewTime.nowMs,
      tzid: viewTime.tzid,
    });
  }, [activeFilters, items, viewKind, viewRange, viewTime]);

  // 月历数据：锚点月范围内、经筛选后的条目按民用日分桶（月历格 chip 用；
  // 无 startAt 的待办天然不进格子）。agendaGroups 的分组结果对月历无用，独立计算。
  // 月历 chip 分桶（阶段 5e 改全量）：标签联动会把 anchorMonth 切到视口月，若按
  // anchorMonth 过滤，翻页后其它月 chip 会空掉——全量分桶一次算好，各页共享。
  const monthDayItems = useMemo(() => {
    if (viewKind !== 'month') {
      return new Map<string, ItemWithRelations[]>();
    }
    return itemsByDay(filterItems(items, activeFilters), viewTime.tzid);
  }, [activeFilters, items, viewKind, viewTime.tzid]);

  // 月历定位（阶段 5e）：今天回位/年月选择时 scrollToIndex 到目标月页
  const [monthJumpKey, setMonthJumpKey] = useState(0);
  const monthJumpTargetRef = useRef<CivilMonth | null>(null);
  const jumpMonthTo = useCallback((target: CivilMonth): void => {
    monthJumpTargetRef.current = target;
    setMonthJumpKey((n) => n + 1);
  }, []);

  // 日视图时间轴布局：当日范围内经筛选的条目 → layoutDayEvents（阶段 5b）
  const dayTimeline = useMemo(() => {
    if (viewKind !== 'day' || viewRange === null) {
      return null;
    }
    // 与当日区间「相交」即入选（5e 后补）：跨天任务在后续日也要呈现——
    // layoutDayEvents 内部会把块裁剪到 0..1440，第二天呈现为 00:00 到结束时刻。
    const ranged = items.filter(
      (item) =>
        item.startAt !== null &&
        item.startAt < viewRange.endMs &&
        (item.endAt ?? item.startAt) > viewRange.startMs,
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

  // —— 阶段 5e：agenda 月窗口数据 ——
  // 每页=月名标题行（恒存在，供定位与标签联动）+ 该月按日分组行；
  // 「待办」组（无时间项）跟随生效月（agendaTopMonth）页首。
  const agendaRows = useMemo<AgendaRow[]>(() => {
    if (viewKind !== 'agenda') {
      return [];
    }
    const result: AgendaRow[] = [];
    const todoSource = filterItems(
      items.filter((item) => item.startAt === null),
      activeFilters,
    );
    for (const page of agendaPages) {
      result.push({
        kind: 'header',
        key: `month-${page.year}-${page.month}`,
        label: monthLabelOf(page.year, page.month),
        isToday: false,
        count: 0,
        isMonthHeader: true,
      });
      if (
        page.year === agendaTopMonth.year &&
        page.month === agendaTopMonth.month &&
        todoSource.length > 0
      ) {
        const todoGroups = groupItemsForAgenda(todoSource, {
          viewKind: 'agenda',
          nowMs: viewTime.nowMs,
          tzid: viewTime.tzid,
        });
        for (const group of todoGroups) {
          result.push({
            kind: 'header',
            key: `header-${group.key}`,
            label: group.label,
            isToday: false,
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
      }
      const range = getMonthRangeForCivil(viewTime.tzid, page.year, page.month);
      const ranged = items.filter(
        (item) =>
          item.startAt !== null && item.startAt >= range.startMs && item.startAt < range.endMs,
      );
      const groups = groupItemsForAgenda(filterItems(ranged, activeFilters), {
        viewKind: 'agenda',
        nowMs: viewTime.nowMs,
        tzid: viewTime.tzid,
      });
      for (const group of groups) {
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
    }
    return result;
  }, [
    activeFilters,
    agendaPages,
    agendaTopMonth,
    items,
    monthLabelOf,
    todayKey,
    viewKind,
    viewTime,
  ]);

  // agenda 定位（年月选择器/今天 pill/冷启动）：jumpKey 进 FlatList key 触发重挂载
  // 重置窗口，再命令式 scrollToOffset 到目标月名行顶。不用 initialScrollIndex——
  // Fabric 实测其估算定位不稳定、失败还会走 onScrollToIndexFailed 兜底把视口拉回
  // offset 0（5e 实锤）。offset 用月名行定高块精确计算：非生效月页只有 1 个月名行，
  // 目标行 index = pages 里的页序号，offset = index × 块高。
  const initialJumpParts = getZonedParts(viewTime.nowMs, viewTime.tzid);
  const agendaJumpTargetRef = useRef<AgendaJumpTarget | null>({
    kind: 'day',
    civilKey: formatLocalDate(initialJumpParts),
  });
  const [agendaJumpKey, setAgendaJumpKey] = useState(1);
  useEffect(() => {
    if (viewKind !== 'agenda' || agendaJumpTargetRef.current === null) {
      return;
    }
    const target = agendaJumpTargetRef.current;
    const parseMonth = (civilKey: string): CivilMonth => {
      const [yearPart, monthPart] = civilKey.split('-');
      return { year: Number(yearPart), month: Number(monthPart) };
    };
    if (target.kind === 'day') {
      // 今日组头定位（5f）：滚到 header-<todayKey> 行；无今日组（当天无安排）回退月名行。
      // 定位目标统一降级为月定位（今天组行用 scrollToIndex，Fabric 首帧常未测量，
      // 失败走 FlatList onScrollToIndexFailed 的 400ms 重试兜底）。
      const rowIndex = agendaRows.findIndex(
        (row) => row.kind === 'header' && row.key === `header-${target.civilKey}`,
      );
      if (rowIndex >= 0) {
        const timer = setTimeout(() => {
          // Fabric 实锤（5g）：scrollToIndex 对 window 外未测量行静默无效果（不滚、
          // 也不触发 onScrollToIndexFailed）——先按平均行高估算 offset 把窗口推近，
          // 目标行渲染测量后用 measureInWindow 实测窗口坐标精修贴顶
          // （Android item 内 onLayout.y 是 transform 局部值，不可用）。
          listRef.current?.scrollToOffset({
            offset: Math.max(0, rowIndex * AGENDA_MONTH_HEADER_BLOCK),
            animated: false,
          });
          setTimeout(() => {
            const header = todayHeaderRef.current;
            const wrap = agendaListWrapRef.current;
            if (header && wrap) {
              header.measureInWindow((hx, hy) => {
                wrap.measureInWindow((wx, wy) => {
                  const targetOffset = lastAgendaOffsetRef.current + (hy - wy);
                  listRef.current?.scrollToOffset({
                    offset: Math.max(0, targetOffset),
                    // animated:true：Android 实测（5g）小步程序滚动（<60px）会被
                    // FlatList 忽略（est 大跳有效、精修小跳无效），动画滚动不受影响
                    animated: true,
                  });
                });
              });
            } else {
              listRef.current?.scrollToIndex({ index: rowIndex, viewPosition: 0, animated: false });
            }
          }, 120);
          agendaJumpTargetRef.current = null;
        }, 400);
        return () => clearTimeout(timer);
      }
      // 首帧 agendaRows 可能为空（observer 未推送）——不清目标，等 rows 到位后本
      // effect 随 agendaRows 依赖重跑再定位（冷启动实测必须保留）。
      return undefined;
    }
    // 走到这里 target.kind 必为 'month'（'day' 分支已全部 return）
    const month: CivilMonth = target.month;
    const index = agendaPages.findIndex((page) => page.year === month.year && page.month === month.month);
    if (index < 0) {
      return;
    }
    const timer = setTimeout(() => {
      listRef.current?.scrollToOffset({
        offset: index * AGENDA_MONTH_HEADER_BLOCK,
        animated: false,
      });
      agendaJumpTargetRef.current = null;
    }, 400);
    return () => clearTimeout(timer);
  }, [agendaJumpKey, agendaPages, agendaRows, viewKind]);

  const emptyMessage = useMemo(() => {
    if (viewKind === 'week') {
      // 阶段 5c 周双态；阶段 5d 整周态=自然周语义
      return weekMode === 'whole' ? '本周没有安排' : '当天没有安排';
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

  /** 年月标签：见上方 monthLabelOf（阶段 5e 前移到 viewTime 之后）。 */

  /**
   * 顶栏标签（阶段 5d 统一）：四视图一律只显民用月——本年「11月」/非本年「2025年11月」。
   * agenda=首可见分组月（跟随上下滑）；week/day=锚点民用月；month=锚点月。
   */
  const topBarTitle = useMemo(() => {
    if (viewKind === 'agenda') {
      return monthLabelOf(agendaTopMonth.year, agendaTopMonth.month);
    }
    if (viewKind === 'month') {
      return monthLabelOf(anchorMonth.year, anchorMonth.month);
    }
    const parts = partsOf(anchorMs);
    return monthLabelOf(parts.year, parts.month);
  }, [agendaTopMonth, anchorMonth, anchorMs, monthLabelOf, partsOf, viewKind]);

  /** 顶栏 ‹ ›（阶段 5c 收敛：仅月视图保留，week/day 靠周条与横滑切日）。 */
  const stepAnchor = useCallback((dir: 1 | -1): void => {
    setAnchorMonth((prev) => shiftCivilMonth(prev, dir));
  }, []);

  /** 「今天」pill：agenda 回本月窗口并定位月名行；week/day 锚点回今日；month 回本月。 */
  const goToday = useCallback((): void => {
    if (viewKind === 'week' || viewKind === 'day') {
      setAnchorMs(viewTime.nowMs);
      return;
    }
    if (viewKind === 'month') {
      const parts = getZonedParts(viewTime.nowMs, viewTime.tzid);
      setAnchorMonth({ year: parts.year, month: parts.month });
      jumpMonthTo({ year: parts.year, month: parts.month });
      return;
    }
    const parts = getZonedParts(viewTime.nowMs, viewTime.tzid);
    const target: CivilMonth = { year: parts.year, month: parts.month };
    setAgendaTopMonth(target);
    setAgendaPages([
      shiftCivilMonth(target, -2),
      shiftCivilMonth(target, -1),
      target,
      shiftCivilMonth(target, 1),
    ]);
    // 5f：「今天」pill 定位到今日分组头（无今日组时 effect 内回退月名行）
    agendaJumpTargetRef.current = { kind: 'day', civilKey: todayKey };
    setAgendaJumpKey((n) => n + 1);
  }, [viewKind, viewTime, todayKey]);

  // prepend 守卫（阶段 5e）：不用 onStartReached——mVCP 锚定后视口恒停在锚行顶
  // （距顶≈一个月名行高 89px），onStartReached 的 0.5 屏阈值会持续满足形成无限
  // prepend；改判 offset<50（<月名行高，仅用户真滚到 9 月行顶才触发），
  // isPrependingRef 防重入，去重由 prependAgendaPage 内部保证。
  // 触发源只挂用户手势结束事件（onScrollEndDrag/onMomentumScrollEnd，阶段 5g）：
  // onScroll 在 FlatList 重挂（key 变化）首帧也会以 y=0 触发一次，会把「点今天」
  // 定位好的今天组头顶下去一次（真机 gt_far6 实锤）；程序滚动不产生手势事件。
  const handleAgendaScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (isPrependingRef.current) {
        return;
      }
      if (event.nativeEvent.contentOffset.y < 50) {
        prependAgendaPage();
        // overscroll 死角：prepend 后视口顶=新页月名行（offset 0），之后不会再有
        // 滚动事件触发 viewability——防重入窗（300ms）结束后把生效月同步到新顶页。
        const candidate = lastPrependedRef.current;
        if (candidate !== null) {
          const month = candidate;
          setTimeout(() => {
            setAgendaTopMonth(month);
          }, 350);
        }
      }
    },
    [prependAgendaPage],
  );

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

  // 周条起点：锚点所在自然周的周一 00:00（阶段 5d：周条=自然周，非锚点起 7 天）。
  // 选中日（anchorMs）±1 走出当前自然周时，周一变化 → 周条整体切到新自然周。
  const weekStartMs = useMemo(
    () => (viewKind === 'week' || viewKind === 'day' ? getWeekStart(anchorMs, viewTime.tzid) : 0),
    [anchorMs, viewKind, viewTime.tzid],
  );

  // 周条切换动效（阶段 5d）：自然周变化时按切换方向平移淡入（36px，150ms）
  const stripAnim = useRef(new Animated.Value(0)).current;
  const prevWeekStartRef = useRef(weekStartMs);
  useEffect(() => {
    if (prevWeekStartRef.current === weekStartMs) {
      return;
    }
    const direction = weekStartMs > prevWeekStartRef.current ? 1 : -1;
    prevWeekStartRef.current = weekStartMs;
    stripAnim.setValue(direction * 36);
    Animated.timing(stripAnim, {
      toValue: 0,
      duration: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [stripAnim, weekStartMs]);

  /** 周条 7 天：自然周（周一~周日）各民用日；单日态高亮锚点日，整周态无高亮。 */
  const weekStripDays = useMemo(() => {
    if (viewKind !== 'week' && viewKind !== 'day' || weekStartMs === 0) {
      return [];
    }
    const anchorKey = formatLocalDate(getZonedParts(anchorMs, viewTime.tzid));
    const highlightSelection = viewKind === 'day' || (viewKind === 'week' && weekMode === 'day');
    const days: Array<{ key: string; startMs: number; dayOfMonth: number; weekdayLabel: string; isToday: boolean; isSelected: boolean }> = [];
    for (let i = 0; i < 7; i += 1) {
      const startMs = shiftAnchorDay(weekStartMs, viewTime.tzid, i);
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
  }, [anchorMs, todayKey, viewKind, viewTime.tzid, weekMode, weekStartMs]);

  /**
   * 年月选择器（阶段 5c 任务 0；阶段 5d 联动）：
   * - month → 切锚点月；
   * - day → 同月同日（当前日号超出目标月天数时收敛到月末）；
   * - week → 周序不变：当前自然周在「周一所在月」是第几周，就切到目标月同序
   *   自然周的周一（nthMondayDateOfMonth，不足回退最后一周）；周条跟随新锚点；
   * - agenda → 滚动定位该月第一组。
   */
  const applyMonthPick = useCallback(
    (year: number, month: number): void => {
      setMonthPickerVisible(false);
      if (viewKind === 'month') {
        setAnchorMonth({ year, month });
        jumpMonthTo({ year, month });
        return;
      }
      if (viewKind === 'day') {
        const parts = partsOf(anchorMs);
        const day = Math.min(parts.day, daysInMonth(year, month));
        setAnchorMs(resolveDayStart(viewTime.tzid, { year, month, day }));
        return;
      }
      if (viewKind === 'week') {
        const weekIndex = weekIndexInMonth(anchorMs, viewTime.tzid);
        const monday = nthMondayDateOfMonth(viewTime.tzid, year, month, weekIndex);
        setAnchorMs(resolveDayStart(viewTime.tzid, monday));
        return;
      }
      // agenda（阶段 5e 月窗口）：生效月切到目标月，同步重置窗口（本轮渲染即含目标
      // 月名行），jumpKey 重挂载 + scrollToOffset 定位——无论该月有无数据都生效。
      const picked: CivilMonth = { year, month };
      setAgendaTopMonth(picked);
      setAgendaPages([
        shiftCivilMonth(picked, -2),
        shiftCivilMonth(picked, -1),
        picked,
        shiftCivilMonth(picked, 1),
      ]);
      agendaJumpTargetRef.current = { kind: 'month', month: picked };
      setAgendaJumpKey((n) => n + 1);
    },
    [viewKind],
  );

  /** agenda 标签跟随（阶段 5c 任务 1）：取首可见行的民用日，更新顶栏月份。 */
  const handleViewableItemsChanged = useRef(
    (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      if (isPrependingRef.current) {
        return;
      }
      const first = info.viewableItems[0]?.item as AgendaRow | undefined;
      if (!first) {
        return;
      }
      // 月名行 key='month-YYYY-MM'；日期组头 key='header-YYYY-MM-DD'；待办组头='header-unscheduled'
      const civilKey =
        first.kind === 'header'
          ? first.key.startsWith('month-')
            ? `${first.key.slice('month-'.length)}-01`
            : first.key.slice('header-'.length)
          : first.civilKey;
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

  // 周条横滑（7 天头）：水平拖过阈值 = 整体切周 ±1（自然周对齐后 ±7 天恒落在周一）
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

  // 内容区横滑（阶段 5d，仅周视图）：单日态=选中日 ±1；整周态=整周 ±1。
  // 纵向意图（|dx| ≤ |dy|*1.5）不接管，FlatList 滚动不受影响。
  const contentPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderRelease: (_event, gesture) => {
          const delta = weekMode === 'whole' ? 7 : 1;
          if (gesture.dx <= -40) {
            setAnchorMs((prev) => shiftAnchorDay(prev, viewTime.tzid, delta));
          } else if (gesture.dx >= 40) {
            setAnchorMs((prev) => shiftAnchorDay(prev, viewTime.tzid, -delta));
          }
        },
      }),
    [viewTime.tzid, weekMode],
  );

  const rowKeyExtractor = useCallback((row: AgendaRow): string => row.key, []);

  // 今日组头 ref（阶段 5g）：Android FlatList 子项用 transform 定位，item 内 View 的
  // onLayout.y 恒≈局部 0（真机实测 24），拿不到 content offset——精修定位改用
  // measureInWindow 实测窗口坐标（header 窗口 y - 列表窗口 y + 当前 offset）。
  const todayHeaderRef = useRef<View | null>(null);
  const agendaListWrapRef = useRef<View | null>(null);
  const lastAgendaOffsetRef = useRef(0);

  const renderRow = useCallback(
    ({ item: row }: { item: AgendaRow }) => {
      if (row.kind === 'header') {
        if (row.isMonthHeader === true) {
          // 阶段 5e：月名标题行（agenda 月窗口每页首行，比日期组头醒目）
          return (
            <View style={styles.monthHeaderRow}>
              <Text style={styles.monthHeaderText}>{row.label}</Text>
            </View>
          );
        }
        return (
          <View
            ref={row.isToday ? todayHeaderRef : undefined}
            style={styles.groupHeader}
          >
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

      {/* 阶段 5d 周条：自然周（周一~周日）chip 行，横滑=整周 ±1，点某天切选中日；
          自然周变化时平移动效 */}
      {weekStripDays.length > 0 ? (
        <Animated.View
          style={[styles.weekStrip, { transform: [{ translateX: stripAnim }] }]}
          {...weekStripPanResponder.panHandlers}
        >
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
        </Animated.View>
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
          onVisibleMonthChange={setAnchorMonth}
          jumpToMonth={monthJumpTargetRef.current}
          jumpKey={monthJumpKey}
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
      ) : viewKind === 'week' ? (
        /* 周视图：内容区横滑=选中日 ±1（整周态=整周 ±1）；列表按日程排版（阶段 5d） */
        <View style={styles.listWrapper} {...contentPanResponder.panHandlers}>
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
              // 官方建议的「先跳近似位置」在这里有害：highestMeasuredFrameIndex 为 0
              // 时等于滚回顶部，抹掉 initialScrollIndex 的定位（5e 实锤）。改为等行
              // 测量完成后一次性 scrollToIndex。
              setTimeout(() => {
                listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0, animated: false });
              }, 400);
            }}
          />
        </View>
      ) : viewKind === 'agenda' ? (
        /* 日程视图（阶段 5e 月窗口）：3 月窗口无边界滚动，标签随视口联动。
           外层 View 供 measureInWindow 取列表窗口坐标（今日组精修定位用） */
        <View ref={agendaListWrapRef} style={styles.listWrapper}>
          <FlatList<AgendaRow>
            key={`agenda-${agendaJumpKey}`}
            ref={listRef}
            style={styles.list}
            data={agendaRows}
            renderItem={renderRow}
            keyExtractor={rowKeyExtractor}
            onEndReached={appendAgendaPage}
            onEndReachedThreshold={0.5}
            onScroll={(event) => {
              lastAgendaOffsetRef.current = event.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            onScrollEndDrag={handleAgendaScroll}
            onMomentumScrollEnd={handleAgendaScroll}
          ListEmptyComponent={<EmptyState message={emptyMessage} />}
          contentContainerStyle={
            agendaRows.length === 0
              ? styles.listEmpty
              : { paddingBottom: Math.round(windowHeight * AGENDA_TAIL_PAD_RATIO) }
          }
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onScrollToIndexFailed={(info) => {
            // 两段精修兜底：估算 offset 偏差大时目标行可能仍未测量——再推一次窗口
            // 后重试精修（onScrollToIndexFailed 在两段式首跳后才会触发）。
            listRef.current?.scrollToOffset({
              offset: Math.max(0, info.index * AGENDA_MONTH_HEADER_BLOCK),
              animated: false,
            });
            setTimeout(() => {
              listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0, animated: false });
            }, 400);
          }}
          />
        </View>
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
    // 阶段 5e：定高——「今天」黑点改绝对定位后不再参与布局，行高不随选中/黑点增减变化
    height: 62,
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
    // 阶段 5e：绝对定位不占布局（chip 已定高），避免今天黑点撑高整行
    position: 'absolute',
    bottom: 5,
    alignSelf: 'center',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#111111',
  },
  // 阶段 5e：agenda 月窗口的月名标题行（每页首行）
  monthHeaderRow: {
    marginTop: 28,
    marginBottom: 4,
    // 定高：定位 offset=index×块高(85) 的前提（见 agenda 定位 effect）
    height: 53,
  },
  monthHeaderText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  // 链接行（阶段 5c 删除：已归档入口移入筛选面板）
  // Agenda 列表
  list: {
    flex: 1,
  },
  // 阶段 5d：周视图内容区手势容器（横滑切选中日；FlatList 纵向滚动在内层不受影响）
  listWrapper: {
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
