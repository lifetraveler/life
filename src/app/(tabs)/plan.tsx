/**
 * 计划 Tab 主视图（切片 14 阶段 5 重构：tasks/slice-14.md 阶段 5 / AGENTS.md §7.21；
 * 原 src/app/index.tsx 移入 (tabs)/plan.tsx）。
 *
 * - 阶段 5：视图切换器移入筛选面板顶部（日程/今天/周/月，FilterSheet initialViewKind
 *   + onApply 双参）；移除内嵌快速录入框（创建落点改为全屏新建页 /item/new，
 *   ui.md「快速记录落点 v0.14」）；右下 FAB 新建入口 → router.push('/item/new')；
 *   无导航头标题（(tabs) 布局 headerShown:false，验收 16）；
 * - 顶栏：右=筛选图标（纯 View 手绘两行滑杆，存在激活筛选时右上角红点提示）；
 * - 数据链：observeItemsWithTags 单订阅（默认列表，§7.23 ItemWithRelations）→
 *   视图范围谓词（today/week/month 用 ranges 纯函数；startAt=null 恒通过进「待办」组）→
 *   filterItems（激活筛选，维度内 OR、维度间 AND）→ groupItemsForAgenda 按天分组 →
 *   FlatList 摊平渲染（header|item 两类行）；本月视图组序倒序（按日期从晚到早）；
 * - 卡片：左侧 4px 分类色条 + Emoji + 标题 + 时间段（formatAgendaTimeRange），
 *   点击进详情页 /item/<id>（task 卡 life://item/<id> 深链同一路由）；
 * - 保留切片 3 搜索（SearchInput，防抖 300ms + 竞态序号）；搜索模式：结果跨视图
 *   （不限当前视图范围）按日程视图全量分组，筛选持续生效；
 * - 链接行：仅「已归档」（设置入口移入「我的」Tab）；行内「转为任务/添加标签」入口
 *   由编辑页承接（同等能力）；「归档」入口移至详情页（用户确认，2026-11-08）；
 *   旧 /today /week 页面原样保留不删。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { getMonthRange, getTodayRange, getWeekRange } from '../../domain/views/ranges';
import EmptyState from '../../ui/EmptyState';
import FilterSheet from '../../ui/FilterSheet';
import SearchInput from '../../ui/SearchInput';
import { formatAgendaTimeRange, getDeviceTzid } from '../../ui/timeFormat';

/** 搜索防抖间隔（任务卡：300ms） */
const SEARCH_DEBOUNCE_MS = 300;

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

  // 搜索状态：输入原文 + 最近一次完成搜索的结果。
  // 约定：searchInput 为空串 = 默认列表模式；非空（含纯空白）= 搜索模式。
  // 纯空白输入必须显示空结果而非回落默认列表（任务卡 5d）。
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<ItemWithRelations[]>([]);

  // 竞态保护：每次新的搜索输入/重放递增序号，过期响应一律丢弃（任务卡 4）。
  const searchSeqRef = useRef(0);

  // 阶段 5：视图模式 + 筛选（视图切换 UI 在筛选面板顶部）
  const [viewKind, setViewKind] = useState<AgendaViewKind>('agenda');
  const [activeFilters, setActiveFilters] = useState<ItemFilters>(EMPTY_ITEM_FILTERS);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  // 视图时间坐标：挂载时固化（today.tsx 同款模式）——页面存续期间「今天」不漂移。
  const [viewTime] = useState(() => {
    const tzid = getDeviceTzid();
    return { tzid, nowMs: Date.now() };
  });

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

  /** FAB → 全屏新建页（验收 17：保存后 router.back() 返回，列表由响应式订阅自动刷新） */
  const openNewItem = useCallback((): void => {
    router.push('/item/new');
  }, [router]);

  /** 立即执行一次搜索并应用结果（序号递增，使之前在途响应全部失效） */
  const runSearch = useCallback((raw: string): void => {
    const seq = ++searchSeqRef.current;
    void itemRepository
      .searchItems(raw)
      .then((results) => {
        if (searchSeqRef.current === seq) {
          setSearchResults(results);
        }
      })
      .catch((error: unknown) => {
        console.error('searchItems failed:', error);
      });
  }, []);

  // 搜索防抖：输入停顿 300ms 后才真正查库；清空输入立即作废在途请求。
  useEffect(() => {
    if (searchInput.length === 0) {
      searchSeqRef.current += 1;
      return undefined;
    }
    const timer = setTimeout(() => {
      runSearch(searchInput);
    }, SEARCH_DEBOUNCE_MS);
    return (): void => {
      clearTimeout(timer);
    };
  }, [runSearch, searchInput]);

  const openItemDetail = useCallback(
    (itemId: string): void => {
      router.push(`/item/${itemId}`);
    },
    [router],
  );

  const searching = searchInput.length > 0;
  const filtersActive = hasActiveFilters(activeFilters);

  // 视图时间范围：agenda=全量；today/week/month 用纯函数（[start, end) 左闭右开）
  const viewRange = useMemo(() => {
    if (viewKind === 'agenda') {
      return null;
    }
    if (viewKind === 'today') {
      return getTodayRange(viewTime.nowMs, viewTime.tzid);
    }
    if (viewKind === 'week') {
      return getWeekRange(viewTime.nowMs, viewTime.tzid);
    }
    return getMonthRange(viewTime.nowMs, viewTime.tzid);
  }, [viewKind, viewTime]);

  // 「今天」民用日期键（组头高亮判定，与 agenda 分组键同源：civilTime）
  const todayKey = useMemo(
    () => formatLocalDate(getZonedParts(viewTime.nowMs, viewTime.tzid)),
    [viewTime],
  );

  // 数据链：范围谓词（agenda/搜索不限范围；startAt=null 恒通过）→ 筛选 → 分组
  const agendaGroups = useMemo(() => {
    const baseItems = searching ? searchResults : items;
    const ranged =
      !searching && viewRange !== null
        ? baseItems.filter(
            (item) =>
              item.startAt === null ||
              (item.startAt >= viewRange.startMs && item.startAt < viewRange.endMs),
          )
        : baseItems;
    const filtered = filterItems(ranged, activeFilters);
    return groupItemsForAgenda(filtered, {
      // 搜索结果跨视图呈现（不限当前视图范围），固定按日程视图全量分组
      viewKind: searching ? 'agenda' : viewKind,
      nowMs: viewTime.nowMs,
      tzid: viewTime.tzid,
    });
  }, [activeFilters, items, searchResults, searching, viewKind, viewRange, viewTime]);

  // 本月视图组序倒序（按日期从晚到早承载「本月」范围；搜索模式除外）
  const displayedGroups = useMemo(() => {
    if (viewKind === 'month' && !searching) {
      return [...agendaGroups].reverse();
    }
    return agendaGroups;
  }, [agendaGroups, searching, viewKind]);

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
    if (searching) {
      return '无匹配结果';
    }
    if (viewKind === 'today') {
      return '今天没有安排';
    }
    if (viewKind === 'week') {
      return '本周没有安排';
    }
    if (viewKind === 'month') {
      return '本月没有安排';
    }
    return '暂无日程';
  }, [searching, viewKind]);

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
      {/* 顶栏：筛选图标右对齐（视图切换已移入筛选面板；激活筛选时红点提示） */}
      <View style={styles.topBar}>
        <Pressable hitSlop={8} style={styles.filterButton} onPress={openFilterSheet}>
          <View style={styles.filterIcon}>
            <View style={styles.filterIconLine}>
              <View style={styles.filterIconKnob} />
            </View>
            <View style={styles.filterIconLine}>
              <View style={[styles.filterIconKnob, styles.filterIconKnobEnd]} />
            </View>
          </View>
          {filtersActive ? <View style={styles.filterDot} /> : null}
        </Pressable>
      </View>

      <SearchInput value={searchInput} onChangeText={setSearchInput} />

      {/* 链接行：设置入口移入「我的」Tab；已归档保留 */}
      <View style={styles.linksRow}>
        <Link href="/archived" asChild>
          <Pressable hitSlop={8}>
            <Text style={styles.linkText}>已归档</Text>
          </Pressable>
        </Link>
      </View>

      <FlatList<AgendaRow>
        style={styles.list}
        data={rows}
        renderItem={renderRow}
        keyExtractor={rowKeyExtractor}
        ListEmptyComponent={<EmptyState message={emptyMessage} />}
        contentContainerStyle={rows.length === 0 ? styles.listEmpty : undefined}
      />

      {/* FAB：新建条目 → 全屏新建页（阶段 5，toki_1.webp 右下角） */}
      <Pressable style={styles.fab} onPress={openNewItem} hitSlop={4}>
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </Pressable>

      {/* 筛选面板：应用=提交筛选+视图模式（实时生效），关闭动画由面板自管 */}
      <FilterSheet
        visible={filterSheetVisible}
        categories={categories}
        tags={allTags}
        initialFilters={activeFilters}
        initialViewKind={viewKind}
        onApply={(draft, nextViewKind) => {
          setActiveFilters(draft);
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
  // 顶栏：仅筛选图标，右对齐（视图切换器已移入筛选面板）
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: 10,
  },
  filterButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterIcon: {
    gap: 3,
  },
  filterIconLine: {
    width: 16,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#CCCCCC',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  filterIconKnob: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#111111',
    marginLeft: 2,
  },
  filterIconKnobEnd: {
    marginLeft: 8,
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
