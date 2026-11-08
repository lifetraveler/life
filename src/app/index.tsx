/**
 * 主页（切片 14 阶段 4 重构：tasks/slice-14.md 阶段 4 / AGENTS.md §7.21）。
 *
 * - 顶栏：左=分段视图切换（日程/今日/本周/本月，选中黑底白字胶囊）；
 *   右=筛选图标（纯 View 手绘两行滑杆，存在激活筛选时右上角红点提示）；
 * - 数据链：observeItemsWithTags 单订阅（默认列表，§7.23 ItemWithRelations）→
 *   视图范围谓词（today/week/month 用 ranges 纯函数；startAt=null 恒通过进「待办」组）→
 *   filterItems（激活筛选，维度内 OR、维度间 AND）→ groupItemsForAgenda 按天分组 →
 *   FlatList 摊平渲染（header|item 两类行）；本月视图组序倒序（按日期从晚到早）；
 * - 卡片：左侧 4px 分类色条 + Emoji + 标题 + 时间段（formatAgendaTimeRange），
 *   点击进详情页 /item/<id>（task 卡 life://item/<id> 深链同一路由）；
 * - 保留切片 3 搜索（SearchInput，防抖 300ms + 竞态序号）、切片 12 quick-add
 *   聚焦契约与返回键草稿判定、创建表单（默认折叠为一行入口，深链命中自动展开）；
 * - 搜索模式：结果跨视图（不限当前视图范围）按日程视图全量分组，筛选持续生效；
 * - 行内「转为任务/添加标签」入口由编辑页承接（同等能力）；「归档」入口移至详情页
 *   （用户确认，2026-11-08）；旧 /today /week 页面原样保留不删。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link, useRouter, useFocusEffect } from 'expo-router';

import { itemRepository } from '../data';
import type { Category } from '../domain/category';
import type { ItemType } from '../domain/item';
import { formatLocalDate, getZonedParts } from '../domain/recurrence/civilTime';
import type { ItemWithRelations } from '../domain/relations/itemWithRelations';
import type { Tag } from '../domain/tag';
import { groupItemsForAgenda } from '../domain/views/agenda';
import type { AgendaViewKind } from '../domain/views/agenda';
import { EMPTY_ITEM_FILTERS, filterItems, hasActiveFilters } from '../domain/views/filters';
import type { ItemFilters } from '../domain/views/filters';
import { getMonthRange, getTodayRange, getWeekRange } from '../domain/views/ranges';
import EmptyState from '../ui/EmptyState';
import FilterSheet from '../ui/FilterSheet';
import SearchInput from '../ui/SearchInput';
import { TYPE_LABELS } from '../ui/display';
import TagChip from '../ui/TagChip';
import { consumeTitleFocusRequest } from '../ui/focusRequestStore';
import { isQuickAddDraftEmpty } from '../ui/quickAddDraft';
import { formatAgendaTimeRange, getDeviceTzid } from '../ui/timeFormat';

const ITEM_TYPES: readonly ItemType[] = ['note', 'task', 'event'];

/** 搜索防抖间隔（任务卡：300ms） */
const SEARCH_DEBOUNCE_MS = 300;

/** 视图切换选项（§7.21：日程 Agenda / 今日 / 本周 / 本月） */
const VIEW_OPTIONS: readonly { kind: AgendaViewKind; label: string }[] = [
  { kind: 'agenda', label: '日程' },
  { kind: 'today', label: '今日' },
  { kind: 'week', label: '本周' },
  { kind: 'month', label: '本月' },
];

/** 合法分类色（数据异常回退约定 repository.md v0.14） */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** 分类色缺失/非法时卡片色条回退灰 */
const CARD_STRIPE_FALLBACK = '#DDDDDD';

/** 输入按中/英文逗号切分：返回应立即创建的标签名与剩余未完成文本 */
function splitTagInput(raw: string): { completed: string[]; rest: string } {
  const parts = raw.split(/[，,]/);
  const rest = parts.pop() ?? '';
  return { completed: parts, rest };
}

/** 标签名规范化 + 去重（trim、空串丢弃、大小写不敏感），返回去重后的新数组 */
function collectTagNames(rawNames: readonly string[], existing: readonly string[]): string[] {
  const dedupKeys = new Set(existing.map((name) => name.toLowerCase()));
  const result: string[] = [];
  for (const rawName of rawNames) {
    const name = rawName.trim();
    const dedupKey = name.toLowerCase();
    if (name.length === 0 || dedupKeys.has(dedupKey)) {
      continue;
    }
    dedupKeys.add(dedupKey);
    result.push(name);
  }
  return result;
}

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

export default function IndexScreen() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selectedType, setSelectedType] = useState<ItemType>('note');
  const [items, setItems] = useState<ItemWithRelations[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  // 创建表单的标签输入：未提交的待绑定标签
  const [pendingTags, setPendingTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // 阶段 4：创建表单默认折叠为一行入口（quick-add 深链命中时展开）
  const [formExpanded, setFormExpanded] = useState(false);

  // 切片 12（ui.md v0.12 快速记录增强）：标题输入聚焦（quick-add 落地）与
  // 返回键收键盘判定所需。
  const titleInputRef = useRef<TextInput | null>(null);
  const keyboardVisibleRef = useRef(false);

  // 搜索状态：输入原文 + 最近一次完成搜索的结果。
  // 约定：searchInput 为空串 = 默认列表模式；非空（含纯空白）= 搜索模式。
  // 纯空白输入必须显示空结果而非回落默认列表（任务卡 5d）。
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<ItemWithRelations[]>([]);

  // 竞态保护：每次新的搜索输入/重放递增序号，过期响应一律丢弃（任务卡 4）。
  const searchSeqRef = useRef(0);

  // 阶段 4：视图切换 + 筛选
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

  const canSave = title.trim().length > 0;

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

  const addPendingTags = useCallback((rawNames: readonly string[]): void => {
    setPendingTags((current) => collectTagNames(rawNames, current));
  }, []);

  // 创建表单：输入中出现逗号时立即提交前面的标签，保留未完成文本
  const handleTagInputChange = useCallback((raw: string): void => {
    const { completed, rest } = splitTagInput(raw);
    if (completed.length > 0) {
      addPendingTags(completed);
    }
    setTagInput(rest);
  }, [addPendingTags]);

  // 创建表单：回车提交当前输入
  const handleTagInputSubmit = useCallback((): void => {
    if (tagInput.trim().length > 0) {
      addPendingTags([tagInput]);
    }
    setTagInput('');
  }, [addPendingTags, tagInput]);

  const removePendingTag = useCallback((tagName: string): void => {
    setPendingTags((current) => current.filter((name) => name !== tagName));
  }, []);

  const handleSave = useCallback((): void => {
    if (!canSave) {
      return;
    }
    const tagsToBind = [...pendingTags];
    void (async () => {
      try {
        const created = await itemRepository.createItem({
          type: selectedType,
          title: title.trim(),
          content: content.trim(),
        });
        for (const tagName of tagsToBind) {
          await itemRepository.addTagToItem(created.id, tagName);
        }
        setTitle('');
        setContent('');
        setPendingTags([]);
        setTagInput('');
      } catch (error) {
        console.error('createItem with tags failed:', error);
      }
    })();
  }, [canSave, content, pendingTags, selectedType, title]);

  // 切片 12（ui.md v0.12 快速记录增强）：quick-add 深链 replace('/') 落地后
  // 展开创建表单并聚焦标题输入。聚焦请求是模块级一次性信号（quick-add.tsx 置位，
  // 此处消费复位）；useFocusEffect 每次回到主页都触发，100ms 延迟避开路由切换
  // 动画期 TextInput 尚未挂稳的问题（冷启动深链尤甚）。
  useFocusEffect(
    useCallback(() => {
      if (!consumeTitleFocusRequest()) {
        return;
      }
      setFormExpanded(true);
      const timer = setTimeout(() => {
        titleInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }, []),
  );

  // 切片 12（ui.md v0.12 快速记录增强）：返回键按草稿空/非空区分——
  // 键盘未弹起时不拦截（返回 false 走默认行为：根页退出/系统返回）；
  // 键盘弹起时：草稿为空 = 关闭键盘并退出聚焦；草稿非空 = 仅关闭键盘、不丢草稿。
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      keyboardVisibleRef.current = true;
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      keyboardVisibleRef.current = false;
    });
    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!keyboardVisibleRef.current) {
        return false;
      }
      Keyboard.dismiss();
      if (isQuickAddDraftEmpty(title, content, tagInput, pendingTags.length)) {
        titleInputRef.current?.blur();
        return true;
      }
      return true;
    });
    return () => {
      showSub.remove();
      hideSub.remove();
      backSub.remove();
    };
  }, [content, pendingTags, tagInput, title]);

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
      {/* 顶栏：左视图切换 + 右筛选图标（激活筛选时红点） */}
      <View style={styles.topBar}>
        <View style={styles.viewSwitcher}>
          {VIEW_OPTIONS.map((option) => {
            const selected = option.kind === viewKind;
            return (
              <Pressable
                key={option.kind}
                style={[styles.viewTab, selected && styles.viewTabSelected]}
                onPress={() => setViewKind(option.kind)}
              >
                <Text style={[styles.viewTabText, selected && styles.viewTabTextSelected]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
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

      {/* 链接行：原「今日」链接由顶栏「今日」视图取代；已归档/设置保留 */}
      <View style={styles.linksRow}>
        <Link href="/archived" asChild>
          <Pressable hitSlop={8}>
            <Text style={styles.linkText}>已归档</Text>
          </Pressable>
        </Link>
        <Link href="/settings" asChild>
          <Pressable hitSlop={8}>
            <Text style={styles.linkText}>设置</Text>
          </Pressable>
        </Link>
      </View>

      {/* 创建表单：默认折叠为一行入口 */}
      {formExpanded ? (
        <View style={styles.formBlock}>
          <TextInput
            style={styles.titleInput}
            ref={titleInputRef}
            value={title}
            onChangeText={setTitle}
            placeholder="标题（必填）"
          />
          <TextInput
            style={styles.contentInput}
            value={content}
            onChangeText={setContent}
            placeholder="内容（可选）"
            multiline
          />
          <View style={styles.typeRow}>
            {ITEM_TYPES.map((itemType) => {
              const selected = itemType === selectedType;
              return (
                <Pressable
                  key={itemType}
                  style={[styles.typeButton, selected && styles.typeButtonSelected]}
                  onPress={() => setSelectedType(itemType)}
                >
                  <Text style={[styles.typeText, selected && styles.typeTextSelected]}>
                    {TYPE_LABELS[itemType]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            style={styles.titleInput}
            value={tagInput}
            onChangeText={handleTagInputChange}
            onSubmitEditing={handleTagInputSubmit}
            placeholder="标签（回车或逗号确认，可多个）"
            returnKeyType="done"
          />
          {pendingTags.length > 0 ? (
            <View style={styles.tagRow}>
              {pendingTags.map((tagName) => (
                <TagChip key={tagName} label={tagName} onRemove={() => removePendingTag(tagName)} />
              ))}
            </View>
          ) : null}
          <Pressable
            style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
            disabled={!canSave}
            onPress={handleSave}
          >
            <Text style={styles.saveButtonText}>保存</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.formEntry} onPress={() => setFormExpanded(true)}>
          <Text style={styles.formEntryText}>＋ 新建记录</Text>
        </Pressable>
      )}

      <FlatList<AgendaRow>
        style={styles.list}
        data={rows}
        renderItem={renderRow}
        keyExtractor={rowKeyExtractor}
        ListEmptyComponent={<EmptyState message={emptyMessage} />}
        contentContainerStyle={rows.length === 0 ? styles.listEmpty : undefined}
      />

      {/* 筛选面板：应用=父级只提交筛选（实时过滤），关闭动画由面板自管 */}
      <FilterSheet
        visible={filterSheetVisible}
        categories={categories}
        tags={allTags}
        initialFilters={activeFilters}
        onApply={(draft) => {
          setActiveFilters(draft);
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
  // 顶栏
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  viewSwitcher: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    flexShrink: 1,
    gap: 6,
  },
  viewTab: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  viewTabSelected: {
    backgroundColor: '#111111',
  },
  viewTabText: {
    fontSize: 13,
    color: '#333333',
  },
  viewTabTextSelected: {
    color: '#ffffff',
    fontWeight: '600',
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
  // 创建表单（折叠入口 + 展开块）
  formEntry: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cccccc',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 14,
  },
  formEntryText: {
    fontSize: 14,
    color: '#666666',
  },
  formBlock: {
    marginBottom: 14,
  },
  titleInput: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  contentInput: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 60,
    marginBottom: 8,
    textAlignVertical: 'top',
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  typeButton: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  typeButtonSelected: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  typeText: {
    color: '#333333',
  },
  typeTextSelected: {
    color: '#ffffff',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  saveButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 4,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    color: '#ffffff',
    fontWeight: '600',
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
});
