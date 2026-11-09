/**
 * 日视图纵向时间轴（切片 14 阶段 5b；阶段 5c 重构列结构 + 横滑切日）：
 * - 顶部：全天/无时间区（allDay 项 + startAt=null 的待办 chip）；
 * - 主体：ScrollView 纵向时间轴，每小时 64px（HOUR_PX）；阶段 5c 起为两列结构——
 *   左侧固定宽时间标签列 + 右侧 flex:1 事件画布，事件块/小时线/红线的百分比与
 *   absolute 坐标全部相对右侧画布（修复 5b 版块盖住时间列的偏移）；
 * - 事件块由 layoutDayEvents 预布局（分钟/比例坐标，本组件乘 px 换算），重叠自动横向平分；
 * - 横滑（PanResponder，|dx|>24 且横向意图明确）→ onShiftDay(±1) 切前后日（阶段 5c，
 *   与周条同一手势阈值；纵向滚动仍归 ScrollView）；
 * - 当前时刻红线（nowMs 在当日范围内才渲染）；挂载/切日时滚动到当前时刻附近（上移 2 小时）；
 * - 点事件块 → onSelectItem(id)（计划页跳详情）；
 * - 本组件不接触 Repository，全部数据经 props 传入。
 */

import { useEffect, useMemo, useRef } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { DayTimelineLayout } from '../domain/views/dayTimeline';
import type { ItemWithRelations } from '../domain/relations/itemWithRelations';
import { formatAgendaTimeRange } from './timeFormat';
import { stripeColorOf } from './stripeColor';

/** 每小时像素高度（任务卡阶段 5b-4：64px/小时） */
const HOUR_PX = 64;
const PX_PER_MIN = HOUR_PX / 60;
/** 一天总高（1440 分钟） */
const DAY_PX = 24 * HOUR_PX;
/** 左侧时间标签列宽 */
const TIME_COLUMN_WIDTH = 44;
/** 挂载时滚动定位：当前时刻上移 2 小时 */
const SCROLL_BACK_MIN = 120;

interface DayTimelineViewProps {
  /** 当天起点毫秒（resolveDayStart 结果，块坐标/红线判定基准） */
  dayStartMs: number;
  /** 时间轴布局（layoutDayEvents 输出：timedBlocks + allDayItems） */
  layout: DayTimelineLayout;
  /** 无 startAt 的待办（放顶部 chip 区，day 视图范围内经筛选） */
  unscheduled: ItemWithRelations[];
  /** 「现在」毫秒（红线；不在当天范围内则不画） */
  nowMs: number;
  tzid: string;
  onSelectItem: (itemId: string) => void;
  /** 横滑切日回调（±1；阶段 5c，左右滑切前后日） */
  onShiftDay: (deltaDays: number) => void;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/** 小时标签数组：'00:00'..'23:00' */
const HOUR_LABELS: string[] = Array.from({ length: 24 }, (_unused, hour) => `${pad2(hour)}:00`);

export function DayTimelineView({
  dayStartMs,
  layout,
  unscheduled,
  nowMs,
  tzid,
  onSelectItem,
  onShiftDay,
}: DayTimelineViewProps) {
  const scrollRef = useRef<ScrollView | null>(null);

  // 挂载时定位到当前时刻（上移 2 小时）；锚点变化（切天/今天回位）时跟随
  const nowOffsetMin = (nowMs - dayStartMs) / 60_000;
  useEffect(() => {
    if (nowOffsetMin >= 0 && nowOffsetMin <= 24 * 60) {
      scrollRef.current?.scrollTo({ y: Math.max(0, (nowOffsetMin - SCROLL_BACK_MIN) * PX_PER_MIN), animated: false });
    }
  }, [nowOffsetMin, dayStartMs]);

  const showNowLine = nowOffsetMin >= 0 && nowOffsetMin <= 24 * 60;

  const hasAllDayArea = layout.allDayItems.length > 0 || unscheduled.length > 0;

  // 横滑切日：水平拖过阈值 ±1 天（与周条同一阈值；纵向意图让给 ScrollView 滚动）
  const shiftPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx <= -40) {
            onShiftDay(1);
          } else if (gesture.dx >= 40) {
            onShiftDay(-1);
          }
        },
      }),
    [onShiftDay],
  );

  // 左列时间标签（absolute 挂在固定宽 gutter 上）
  const gutterLabels = useMemo(
    () =>
      HOUR_LABELS.map((label, hour) => (
        <Text key={label} style={[styles.hourLabel, { top: hour * HOUR_PX - 6 }]}>
          {label}
        </Text>
      )),
    [],
  );

  // 右侧画布小时线（absolute，相对画布全宽）
  const hourLines = useMemo(
    () =>
      HOUR_LABELS.map((label, hour) => (
        <View key={label} style={[styles.hourLine, { top: hour * HOUR_PX }]} />
      )),
    [],
  );

  return (
    <View style={styles.container} {...shiftPanResponder.panHandlers}>
      {hasAllDayArea ? (
        <View style={styles.allDayArea}>
          {layout.allDayItems.map((item) => (
            <Pressable
              key={item.id}
              style={({ pressed }) => [styles.allDayChip, pressed && styles.chipPressed]}
              onPress={() => onSelectItem(item.id)}
            >
              <View style={[styles.chipStripe, { backgroundColor: stripeColorOf(item.category?.color) }]} />
              <Text style={styles.allDayText} numberOfLines={1}>
                全天 · {item.title}
              </Text>
            </Pressable>
          ))}
          {unscheduled.map((item) => (
            <Pressable
              key={item.id}
              style={({ pressed }) => [styles.allDayChip, pressed && styles.chipPressed]}
              onPress={() => onSelectItem(item.id)}
            >
              <View style={[styles.chipStripe, { backgroundColor: stripeColorOf(item.category?.color) }]} />
              <Text style={styles.allDayText} numberOfLines={1}>
                待办 · {item.title}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.canvas} ref={scrollRef}>
        <View style={styles.canvasRow}>
          <View style={styles.gutter}>{gutterLabels}</View>
          <View style={styles.canvasInner}>
            {hourLines}
            {showNowLine ? (
              <View style={[styles.nowLine, { top: nowOffsetMin * PX_PER_MIN }]}>
                <View style={styles.nowDot} />
              </View>
            ) : null}
            {layout.timedBlocks.map((block) => {
              const rangeLabel = formatAgendaTimeRange(
                {
                  ...block.item,
                  // 时间轴块内时间标签按块裁剪后的起止呈现（跨午夜事件显示当日剩余段）
                  startAt: dayStartMs + block.topMin * 60_000,
                  endAt: dayStartMs + (block.topMin + block.heightMin) * 60_000,
                },
                tzid,
              );
              return (
                <Pressable
                  key={block.item.id}
                  style={[
                    styles.eventBlock,
                    {
                      top: block.topMin * PX_PER_MIN,
                      height: Math.max(30, block.heightMin * PX_PER_MIN - 2),
                      left: `${block.leftRatio * 100}%` as `${number}%`,
                      width: `${block.widthRatio * 100}%` as `${number}%`,
                    },
                  ]}
                  onPress={() => onSelectItem(block.item.id)}
                >
                  <View style={[styles.chipStripe, { backgroundColor: stripeColorOf(block.item.category?.color) }]} />
                  <View style={styles.eventTextWrap}>
                    <Text style={styles.eventTime}>{rangeLabel ?? '无时间'}</Text>
                    <Text style={styles.eventTitle} numberOfLines={2}>
                      {block.item.title}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  allDayArea: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ECECEC',
    gap: 4,
  },
  allDayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F7F7F7',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  chipPressed: {
    opacity: 0.6,
  },
  chipStripe: {
    width: 3,
    height: 14,
    borderRadius: 1.5,
  },
  allDayText: {
    flexShrink: 1,
    fontSize: 12,
    color: '#333333',
  },
  scroll: {
    flex: 1,
  },
  canvas: {
    height: DAY_PX,
  },
  // 阶段 5c 两列结构：左列固定宽标签，右侧 flex:1 画布（事件块百分比相对画布）
  canvasRow: {
    flex: 1,
    flexDirection: 'row',
  },
  gutter: {
    width: TIME_COLUMN_WIDTH,
    height: DAY_PX,
  },
  canvasInner: {
    flex: 1,
    height: DAY_PX,
    position: 'relative',
  },
  hourLabel: {
    position: 'absolute',
    left: 0,
    width: TIME_COLUMN_WIDTH - 6,
    textAlign: 'right',
    fontSize: 10,
    color: '#AAAAAA',
  },
  hourLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#EEEEEE',
  },
  nowLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#E53935',
  },
  nowDot: {
    position: 'absolute',
    left: -3,
    top: -2.5,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E53935',
  },
  eventBlock: {
    position: 'absolute',
    backgroundColor: '#F7F7F7',
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    padding: 4,
    flexDirection: 'row',
    gap: 4,
    overflow: 'hidden',
  },
  eventTextWrap: {
    flexShrink: 1,
  },
  eventTime: {
    fontSize: 9,
    color: '#888888',
  },
  eventTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#111111',
  },
});
