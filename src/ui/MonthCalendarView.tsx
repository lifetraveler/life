/**
 * 富月历视图（切片 14 阶段 5b，tasks/slice-14.md 阶段 5b-5）：
 * - 纵向 FlatList 无极双向滚动：每月一页（react-native-calendars 的 Calendar，
 *   周一开头 firstDay=1、隐藏自带箭头与英文星期表头，星期表头/月名自行渲染为中文；
 *   customHeader=null 压掉自带英文月头（October 2026，5d 真机发现）；
 *   向上 prepend 上一月经 maintainVisibleContentPosition 保持视口；
 * - 自定义格子（dayComponent）：日号 + 当日 chip（≤3，分类色条 + 标题一行截断）+
 *   「+N」；今天日号圈高亮；
 * - 点格子 → onSelectDay(civilKey)（civilKey='YYYY-MM-DD'，与 itemsByDay/todayKey 同键）；
 * - 数据由调用方传入 itemsByDay 的分桶结果（本组件不接触 Repository）；
 * - 阶段 5e：视口首可见页经 onVisibleMonthChange 回调计划页（左上标签随滚动联动）；
 *   jumpToMonth+jumpKey 变化时 scrollToIndex 定位到目标月页（今天回位/年月选择），
 *   失败（页未测量）走 onScrollToIndexFailed 等 400ms 行测量完成后重试；
 * - 周条/列表的「‹ ›步进、今天回位」仍由计划页顶栏承担，本组件不重复实现。
 */

import { useCallback, useEffect, useRef, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Calendar } from 'react-native-calendars';
import type { DateData } from 'react-native-calendars';
import type { DayProps } from 'react-native-calendars/src/calendar/day';
import type { CivilMonth } from '../domain/views/ranges';
import type { ItemWithRelations } from '../domain/relations/itemWithRelations';
import { stripeColorOf } from './stripeColor';

/** 每格最多展示的事件 chip 数（超出显示「+N」，用户拍板 ≤3） */
const MAX_CHIPS_PER_DAY = 3;

export const WEEK_HEADER_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;

interface MonthCalendarViewProps {
  /** 待渲染的月份页（按时间升序） */
  months: CivilMonth[];
  /** 按民用日分桶的水合条目（itemsByDay 的返回值，键='YYYY-MM-DD'） */
  dayItems: Map<string, ItemWithRelations[]>;
  /** 「今天」民用日期键（高亮圈判定，与计划页同源） */
  todayKey: string;
  /** 点格子回调（civilKey='YYYY-MM-DD'） */
  onSelectDay: (civilKey: string) => void;
  /** 向上补页（prepend 上一月） */
  onPrependMonth: () => void;
  /** 向下补页（append 下一月） */
  onAppendMonth: () => void;
  /** 视口首可见页变化（滚动联动，计划页用于更新左上标签） */
  onVisibleMonthChange?: (month: CivilMonth) => void;
  /** 定位目标月（配合 jumpKey；null=无定位） */
  jumpToMonth?: CivilMonth | null;
  /** 定位序号：变化时执行一次定位 */
  jumpKey?: number;
}

interface CalendarCellProps extends Omit<DayProps, 'date'> {
  /** 官方 dayComponent 交叉签名：date 为 DateData（覆盖 BasicDayProps 的 string 语义） */
  date?: DateData;
}

function monthKeyOf(month: CivilMonth): string {
  return `${month.year}-${month.month}`;
}

/** 月名标题：跨年显年（2027年1月），同年只显月（11月）。 */
function monthTitle(month: CivilMonth): string {
  return month.month === 1 ? `${month.year}年1月` : `${month.month}月`;
}

/** 该月 1 日的 dateString（Calendar current 参数）。 */
function monthCurrent(month: CivilMonth): string {
  return `${month.year}-${pad2(month.month)}-01`;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

export function MonthCalendarView({
  months,
  dayItems,
  todayKey,
  onSelectDay,
  onPrependMonth,
  onAppendMonth,
  onVisibleMonthChange,
  jumpToMonth = null,
  jumpKey = 0,
}: MonthCalendarViewProps) {
  const listRef = useRef<FlatList<CivilMonth> | null>(null);
  // onVisibleMonthChange 用 ref 中转：回调每次渲染都是新函数时 FlatList prop 不抖动
  const visibleChangeRef = useRef(onVisibleMonthChange);
  visibleChangeRef.current = onVisibleMonthChange;
  const handleViewableItemsChanged = useRef(
    (info: { viewableItems: Array<{ item: CivilMonth; isViewable: boolean }> }) => {
      const first = info.viewableItems.find((entry) => entry.isViewable)?.item;
      if (first) {
        visibleChangeRef.current?.(first);
      }
    },
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;
  // 定位（今天回位/年月选择）：jumpKey 变化 → scrollToIndex 到目标月页；页未测量时
  // onScrollToIndexFailed 等 400ms（月历页高约 400px，重挂一帧后测量完成）重试。
  useEffect(() => {
    if (jumpToMonth === null || jumpKey === 0) {
      return;
    }
    const index = months.findIndex(
      (month) => month.year === jumpToMonth.year && month.month === jumpToMonth.month,
    );
    if (index < 0) {
      return;
    }
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: false });
    }, 80);
    return () => clearTimeout(timer);
    // jumpToMonth 经 ref 语义随 jumpKey 一起变化，此处只依赖 jumpKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpKey, months]);
  const renderCell = useCallback(
    (cellProps: CalendarCellProps) => {
      const { date, state } = cellProps;
      if (!date || state === 'disabled') {
        // hideExtraDays=true 时不渲染其它月的占位格
        return <View style={styles.cellEmpty} />;
      }
      const civilKey = date.dateString;
      const isToday = civilKey === todayKey;
      const chips = dayItems.get(civilKey) ?? [];
      const overflow = chips.length > MAX_CHIPS_PER_DAY ? chips.length - MAX_CHIPS_PER_DAY : 0;
      const visible = chips.slice(0, MAX_CHIPS_PER_DAY);
      return (
        <Pressable style={styles.cell} onPress={() => onSelectDay(civilKey)}>
          <View style={isToday ? styles.cellDayTodayWrap : undefined}>
            <Text style={[styles.cellDay, isToday ? styles.cellDayToday : undefined]}>{date.day}</Text>
          </View>
          {visible.map((chip) => (
            <View key={chip.id} style={styles.chip}>
              <View style={[styles.chipStripe, { backgroundColor: stripeColorOf(chip.category?.color) }]} />
              <Text style={styles.chipText} numberOfLines={1}>
                {chip.title}
              </Text>
            </View>
          ))}
          {overflow > 0 ? <Text style={styles.chipOverflow}>+{overflow}</Text> : null}
        </Pressable>
      );
    },
    [dayItems, onSelectDay, todayKey],
  );

  const renderMonth = useCallback(
    ({ item }: { item: CivilMonth }) => (
      <View style={styles.monthPage}>
        <Text style={styles.monthTitle}>{monthTitle(item)}</Text>
        <View style={styles.weekHeader}>
          {WEEK_HEADER_LABELS.map((label) => (
            <Text key={label} style={styles.weekHeaderText}>
              {label}
            </Text>
          ))}
        </View>
        <Calendar
          current={monthCurrent(item)}
          firstDay={1}
          hideArrows={true}
          hideDayNames={true}
          hideExtraDays={true}
          customHeader={() => null}
          dayComponent={renderCell}
          style={styles.calendar}
        />
      </View>
    ),
    [renderCell],
  );

  const pageKeyExtractor = useCallback((month: CivilMonth): string => monthKeyOf(month), []);

  const flatListData = useMemo(() => months, [months]);

  return (
    <FlatList<CivilMonth>
      ref={listRef}
      style={styles.list}
      data={flatListData}
      keyExtractor={pageKeyExtractor}
      renderItem={renderMonth}
      maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
      onViewableItemsChanged={handleViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      onScrollToIndexFailed={(info) => {
        // 目标页未测量时不做「跳近似位置」（highestMeasuredFrameIndex=0 会滚回顶部），
        // 等测量完成后一次性定位
        setTimeout(() => {
          listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0, animated: false });
        }, 400);
      }}
      onStartReached={onPrependMonth}
      // 阈值收紧到 0.5（阶段 5c 修复「月视图空白格子」）：1.5 时初始单页挂载会连发
      // prepend（offset 0 触发一次，prepend 后视口距顶仍 <1.5 屏再触发一次），视口被
      // 顶飞到无记录的空月页；0.5 只在真正接近列表边缘时补页。
      onStartReachedThreshold={0.5}
      onEndReached={onAppendMonth}
      onEndReachedThreshold={0.5}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  monthPage: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  monthTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
    paddingTop: 6,
    paddingBottom: 4,
  },
  weekHeader: {
    flexDirection: 'row',
    paddingBottom: 4,
  },
  weekHeaderText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    color: '#999999',
  },
  calendar: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  cellEmpty: {
    flex: 1,
    minHeight: 72,
  },
  // 阶段 5d：空格子保持空白不画框——去掉格子边框/圆角/底色，
  // 有项目的日子由 chip 自身的 #F5F5F5 背景承载视觉
  cell: {
    flex: 1,
    minHeight: 72,
    paddingVertical: 3,
    paddingHorizontal: 3,
    marginHorizontal: 1,
    overflow: 'hidden',
  },
  cellDayTodayWrap: {
    alignSelf: 'center',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellDay: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333333',
    textAlign: 'center',
  },
  cellDayToday: {
    color: '#FFFFFF',
    fontSize: 12,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 4,
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 3,
    paddingVertical: 1,
    marginTop: 2,
    gap: 3,
  },
  chipStripe: {
    width: 3,
    height: 10,
    borderRadius: 1.5,
  },
  chipText: {
    flexShrink: 1,
    fontSize: 10,
    color: '#333333',
  },
  chipOverflow: {
    fontSize: 10,
    color: '#888888',
    marginTop: 2,
  },
});
