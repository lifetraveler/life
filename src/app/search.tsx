/**
 * 搜索页（切片 14 阶段 5b，tasks/slice-14.md 阶段 5b-7）：
 * - 主页顶栏 🔍 进入；独立全屏页，自绘顶栏（返回 + 输入框自动聚焦）；
 * - 匹配语义不变：仍走 itemRepository.searchItems 的 LIKE 查询（§7.18，切片 3 契约），
 *   本页只做呈现层排序与分页；
 * - 排序：有 startAt 按开始时间倒序在前，无 startAt 按 createdAt 倒序在末尾
 *   （src/domain/views/searchOrder.ts，带单测）；
 * - 分页：50 条/批，滚动距底约 1200px（约第 30 条附近）预取下一批；
 *   onScroll 判定 + 防重入（loadingMore ref）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';

import { itemRepository } from '../data';
import { sortSearchResults } from '../domain/views/searchOrder';
import type { ItemWithRelations } from '../domain/relations/itemWithRelations';
import { formatAgendaTimeRange, getDeviceTzid } from '../ui/timeFormat';
import { useTheme } from '../ui/theme';
import type { ThemeColors } from '../ui/theme';

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 50;
const PREFETCH_DISTANCE_PX = 1200;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/** 搜索结果行：分类色条 + 标题 + 时间标签（无时间显示待办标记）。 */
function SearchItemCard({ item, deviceTzid }: { item: ItemWithRelations; deviceTzid: string }) {
  // 切片 24（§7.36）：颜色走全局 Token（夜间模式），深浅色跟随系统。
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const stripeColor =
    item.category?.color && HEX_COLOR_PATTERN.test(item.category.color)
      ? item.category.color
      : // 分类色缺失/非法时色条回退 colors.border（切片 24：与 plan.tsx 同口径，回退色随主题切换）
        colors.border;
  const timeLabel = formatAgendaTimeRange(
    { startAt: item.startAt, endAt: item.endAt, allDay: item.allDay },
    deviceTzid,
  );
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push(`/item/${item.id}`)}
    >
      <View style={[styles.cardStripe, { backgroundColor: stripeColor }]} />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.cardTime}>{timeLabel ?? '待办 · 无时间'}</Text>
      </View>
    </Pressable>
  );
}

export default function SearchPage() {
  // 切片 24（§7.36）：颜色走全局 Token（夜间模式），深浅色跟随系统。
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<ItemWithRelations[]>([]);
  const [deviceTzid, setDeviceTzid] = useState('Asia/Shanghai');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const searchSeqRef = useRef(0);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    setDeviceTzid(getDeviceTzid());
  }, []);

  /** 立即执行一次搜索并应用结果（序号递增，使之前在途响应全部失效）。 */
  const runSearch = useCallback((raw: string): void => {
    const seq = ++searchSeqRef.current;
    void itemRepository
      .searchItems(raw)
      .then((found) => {
        if (searchSeqRef.current === seq) {
          setResults(sortSearchResults(found));
          setVisibleCount(PAGE_SIZE);
        }
      })
      .catch((error: unknown) => {
        console.error('searchItems failed:', error);
      });
  }, []);

  // 搜索防抖：输入停顿 300ms 后才真正查库；清空输入立即作废在途请求。
  useEffect(() => {
    if (keyword.trim().length === 0) {
      searchSeqRef.current += 1;
      setResults([]);
      setVisibleCount(PAGE_SIZE);
      return undefined;
    }
    const timer = setTimeout(() => {
      runSearch(keyword);
    }, SEARCH_DEBOUNCE_MS);
    return (): void => {
      clearTimeout(timer);
    };
  }, [runSearch, keyword]);

  const searching = keyword.trim().length > 0;
  const visibleResults = useMemo(() => results.slice(0, visibleCount), [results, visibleCount]);
  const hasMore = visibleCount < results.length;

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!hasMore || loadingMoreRef.current) {
        return;
      }
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      if (contentOffset.y + layoutMeasurement.height > contentSize.height - PREFETCH_DISTANCE_PX) {
        loadingMoreRef.current = true;
        setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, results.length));
        // 下一帧解除防重入（纯本地切片，无异步等待）
        requestAnimationFrame(() => {
          loadingMoreRef.current = false;
        });
      }
    },
    [hasMore, results.length],
  );

  const renderItem = useCallback(
    ({ item }: { item: ItemWithRelations }) => <SearchItemCard item={item} deviceTzid={deviceTzid} />,
    [deviceTzid],
  );

  const keyExtractor = useCallback((item: ItemWithRelations): string => item.id, []);

  const emptyMessage = !searching ? '输入关键词搜索' : '无匹配结果';

  return (
    <View style={styles.page}>
      <View style={styles.topBar}>
        <Pressable
          style={({ pressed }) => [styles.backButton, pressed && styles.iconPressed]}
          onPress={() => router.back()}
          accessibilityLabel="返回"
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.inputWrap}>
          <Ionicons name="search-outline" size={16} color={colors.textMuted} />
          <TextInput
            style={styles.input}
            value={keyword}
            onChangeText={setKeyword}
            placeholder="搜索标题、内容、标签"
            placeholderTextColor={colors.textMuted}
            autoFocus
            returnKeyType="search"
            autoCorrect={false}
          />
          {searching ? (
            <Pressable onPress={() => setKeyword('')} accessibilityLabel="清空搜索">
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {searching ? (
        <Text style={styles.meta}>
          共 {results.length} 条{hasMore ? ` · 已显示 ${visibleResults.length} 条` : ''}
        </Text>
      ) : null}
      <FlatList
        style={styles.list}
        contentContainerStyle={searching && results.length === 0 ? styles.listEmpty : styles.listContent}
        data={visibleResults}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.empty}>{emptyMessage}</Text>}
      />
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: c.background,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
      backgroundColor: c.background,
    },
    backButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconPressed: {
      opacity: 0.6,
    },
    inputWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.card,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    input: {
      flex: 1,
      fontSize: 15,
      color: c.text,
      paddingVertical: 0,
    },
    meta: {
      fontSize: 12,
      color: c.textMuted,
      paddingHorizontal: 16,
      marginBottom: 4,
    },
    list: {
      flex: 1,
    },
    listContent: {
      paddingHorizontal: 16,
      paddingBottom: 32,
    },
    listEmpty: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    empty: {
      fontSize: 14,
      color: c.textMuted,
    },
    card: {
      flexDirection: 'row',
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      // 卡片描边/底为浅灰系但非页面根底 → 按语义归 border/card（阶段 2 规则 3）
      borderColor: c.border,
      backgroundColor: c.card,
      marginBottom: 8,
      overflow: 'hidden',
    },
    cardPressed: {
      opacity: 0.7,
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
      color: c.text,
      lineHeight: 20,
    },
    cardTime: {
      fontSize: 12,
      color: c.textMuted,
      marginTop: 3,
    },
  });
}
