/**
 * 切片 7：本周视图页（tasks/slice-07.md + ui.md「今日/本周视图（v0.7）」）。
 *
 * 与今日视图的差异：
 * - 范围=设备时区周一 00:00 至下周一 00:00（getWeekRange，周一起点）；
 * - 只有两组：过期 → 已安排（本周无“今日创建”分组，也不订阅该查询）；
 * - 全空显“本周没有安排”（无快速记录入口——契约只给今日空态配了入口）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';

import { itemRepository } from '../data';
import { groupItemsForView } from '../domain/views/grouping';
import { getWeekRange } from '../domain/views/ranges';
import type { ItemWithTags } from '../domain/tag';
import { reminderScheduler } from '../notifications';
import EmptyState from '../ui/EmptyState';
import { ViewGroupSection } from '../ui/ViewGroupSection';
import { getDeviceTzid } from '../ui/timeFormat';

/** 视图坐标：挂载时确定一次（now 与范围不随后续时间流逝漂移；刷新由响应式查询驱动） */
interface WeekViewState {
  tzid: string;
  nowMs: number;
  rangeStartMs: number;
  rangeEndMs: number;
}

export default function WeekScreen() {
  const [viewState] = useState<WeekViewState>(() => {
    const tzid = getDeviceTzid();
    const nowMs = Date.now();
    const range = getWeekRange(nowMs, tzid);
    return { tzid, nowMs, rangeStartMs: range.startMs, rangeEndMs: range.endMs };
  });

  const [overdue, setOverdue] = useState<ItemWithTags[]>([]);
  const [scheduled, setScheduled] = useState<ItemWithTags[]>([]);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribeOverdue = itemRepository.observeOverdueItems(viewState.nowMs, setOverdue);
    const unsubscribeScheduled = itemRepository.observeScheduledItemsInRange(
      viewState.rangeStartMs,
      viewState.rangeEndMs,
      setScheduled,
    );
    return () => {
      unsubscribeOverdue();
      unsubscribeScheduled();
    };
  }, [viewState]);

  const grouped = useMemo(
    () =>
      groupItemsForView({
        items: [...overdue, ...scheduled],
        viewKind: 'week',
        nowMs: viewState.nowMs,
        rangeStartMs: viewState.rangeStartMs,
        rangeEndMs: viewState.rangeEndMs,
        todayRange: null,
      }),
    [overdue, scheduled, viewState],
  );

  const handleToggleStatus = useCallback(
    (item: ItemWithTags) => {
      if (busyItemId !== null) {
        return;
      }
      const nextStatus = item.status === 'done' ? 'active' : 'done';
      setBusyItemId(item.id);
      void (async () => {
        await itemRepository.updateItem(item.id, { status: nextStatus });
        // 契约：完成/取消完成后触发一次 reconcile()；失败不阻断 UI，记录日志
        reminderScheduler.reconcile().catch((error: unknown) => {
          console.warn('[slice-07] 快速完成后 reconcile 失败', error);
        });
        setActionError(null);
      })()
        .catch((error: unknown) => {
          console.warn('[slice-07] 快速完成 updateItem 失败', error);
          // 失败提示：updateItem 未落库，响应式查询不会翻转 UI（结构性回滚），此处补充可见错误
          setActionError('更新状态失败，请重试');
        })
        .finally(() => {
          setBusyItemId(null);
        });
    },
    [busyItemId],
  );

  const isViewEmpty = overdue.length === 0 && scheduled.length === 0;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>本周</Text>
        <Link href="/today" asChild>
          <Pressable hitSlop={8}>
            <Text style={styles.headerLink}>今日视图</Text>
          </Pressable>
        </Link>
      </View>

      {actionError !== null ? <Text style={styles.errorText}>{actionError}</Text> : null}

      {isViewEmpty ? (
        <EmptyState message="本周没有安排" />
      ) : (
        <ScrollView>
          <ViewGroupSection
            title="过期"
            groupId="overdue"
            items={grouped.overdue}
            tzid={viewState.tzid}
            busyItemId={busyItemId}
            onToggleStatus={handleToggleStatus}
          />
          <ViewGroupSection
            title="已安排"
            groupId="scheduled"
            items={grouped.scheduled}
            tzid={viewState.tzid}
            busyItemId={busyItemId}
            onToggleStatus={handleToggleStatus}
          />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  headerLink: {
    fontSize: 13,
    color: '#2563eb',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 12,
    marginBottom: 8,
  },
});
