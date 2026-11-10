/**
 * 切片 7：今日视图页（tasks/slice-07.md + ui.md「今日/本周视图（v0.7）」）。
 *
 * 契约要点：
 * - 范围=设备时区当天 00:00–24:00，边界由 getTodayRange 纯函数计算，本页不用 new Date(y,m,d) 构造；
 * - 三组固定顺序：过期 → 已安排 → 今日创建；空组隐藏标题；
 * - 全空显“今天没有安排”+ 快速记录入口；响应式查询自动刷新，不轮询、不下拉刷新；
 * - 快速完成/取消完成：updateItem 成功后触发一次 reconcile()（失败不阻断 UI、记录日志）；
 *   updateItem 失败时 DB 未变，响应式投影天然保持原状（结构性回滚），页面补充可见错误提示。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, useRouter } from 'expo-router';

import { itemRepository } from '../data';
import { groupItemsForView } from '../domain/views/grouping';
import { getTodayRange } from '../domain/views/ranges';
import type { ItemWithTags } from '../domain/tag';
import { reminderScheduler } from '../notifications';
import EmptyState from '../ui/EmptyState';
import { ViewGroupSection } from '../ui/ViewGroupSection';
import { getDeviceTzid } from '../ui/timeFormat';

/** 视图坐标：挂载时确定一次（now 与范围不随后续时间流逝漂移；刷新由响应式查询驱动） */
interface TodayViewState {
  tzid: string;
  nowMs: number;
  rangeStartMs: number;
  rangeEndMs: number;
}

export default function TodayScreen() {
  const [viewState] = useState<TodayViewState>(() => {
    const tzid = getDeviceTzid();
    const nowMs = Date.now();
    const range = getTodayRange(nowMs, tzid);
    return { tzid, nowMs, rangeStartMs: range.startMs, rangeEndMs: range.endMs };
  });

  const [overdue, setOverdue] = useState<ItemWithTags[]>([]);
  const [scheduled, setScheduled] = useState<ItemWithTags[]>([]);
  const [createdToday, setCreatedToday] = useState<ItemWithTags[]>([]);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const unsubscribeOverdue = itemRepository.observeOverdueItems(viewState.nowMs, setOverdue);
    const unsubscribeScheduled = itemRepository.observeScheduledItemsInRange(
      viewState.rangeStartMs,
      viewState.rangeEndMs,
      setScheduled,
    );
    const unsubscribeCreated = itemRepository.observeUnscheduledItemsCreatedInRange(
      viewState.rangeStartMs,
      viewState.rangeEndMs,
      setCreatedToday,
    );
    return () => {
      unsubscribeOverdue();
      unsubscribeScheduled();
      unsubscribeCreated();
    };
  }, [viewState]);

  const grouped = useMemo(
    () =>
      groupItemsForView({
        items: [...overdue, ...scheduled, ...createdToday],
        viewKind: 'today',
        nowMs: viewState.nowMs,
        rangeStartMs: viewState.rangeStartMs,
        rangeEndMs: viewState.rangeEndMs,
        todayRange: { startMs: viewState.rangeStartMs, endMs: viewState.rangeEndMs },
      }),
    [overdue, scheduled, createdToday, viewState],
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

  const isViewEmpty =
    overdue.length === 0 && scheduled.length === 0 && createdToday.length === 0;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>今日</Text>
        <Link href="/week" asChild>
          <Pressable hitSlop={8}>
            <Text style={styles.headerLink}>本周视图</Text>
          </Pressable>
        </Link>
      </View>

      {actionError !== null ? <Text style={styles.errorText}>{actionError}</Text> : null}

      {isViewEmpty ? (
        <View style={styles.emptyWrap}>
          <EmptyState message="今天没有安排" />
          <Pressable style={styles.recordButton} onPress={() => router.push('/item/new')}>
            <Text style={styles.recordButtonText}>去记录</Text>
          </Pressable>
        </View>
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
          <ViewGroupSection
            title="今日创建"
            groupId="createdToday"
            items={grouped.createdToday}
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
  emptyWrap: {
    alignItems: 'center',
  },
  recordButton: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  recordButtonText: {
    fontSize: 13,
    color: '#2563eb',
  },
});
