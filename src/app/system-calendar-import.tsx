import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { itemRepository } from '../data';
import type { SystemImportResult } from '../data/ItemRepository';
import { expoSystemCalendarReader } from '../data/systemCalendarAdapters';
import type { SystemCalendarInfo } from '../domain/systemCalendar/types';
import { reminderScheduler } from '../notifications';
import SystemImportResultView from '../ui/SystemImportResultView';

/**
 * 切片 9：系统日历导入页（tasks/slice-09.md 实现要求 1/4）：
 * - 进入页面经 requestCalendarPermissionsAsync 申请读取权限（拒绝不崩溃，可重试）；
 * - 展示 API 返回的日历列表（多选，默认全选）+ 未来时间范围（7/30/90/365 天，默认 90）；
 * - 导入 → 结果内联展示 → fire-and-forget reconcile() → 「查看今日视图」；
 * - 不提供任何写入系统日历的能力（无写回调用路径）。
 */

const RANGE_OPTIONS = [7, 30, 90, 365] as const;
type RangeDays = (typeof RANGE_OPTIONS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

type Phase = 'loading' | 'permission-denied' | 'select' | 'importing' | 'done';

export default function SystemCalendarImportPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [calendars, setCalendars] = useState<SystemCalendarInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rangeDays, setRangeDays] = useState<RangeDays>(90);
  const [result, setResult] = useState<SystemImportResult | null>(null);
  const [permissionHint, setPermissionHint] = useState<string | null>(null);

  const requestPermissionAndLoad = useCallback(async (): Promise<void> => {
    setPhase('loading');
    setPermissionHint(null);
    try {
      const { granted } = await expoSystemCalendarReader.requestPermissions();
      if (!granted) {
        setPhase('permission-denied');
        return;
      }
      const loaded = await expoSystemCalendarReader.getCalendars();
      setCalendars(loaded);
      setSelectedIds(loaded.map((cal) => cal.id));
      setPhase('select');
    } catch (error) {
      console.warn('[slice-09] 日历权限申请/读取失败', error);
      setPermissionHint(error instanceof Error ? error.message : String(error));
      setPhase('permission-denied');
    }
  }, []);

  useEffect(() => {
    void requestPermissionAndLoad();
  }, [requestPermissionAndLoad]);

  const toggleCalendar = useCallback((id: string): void => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id],
    );
  }, []);

  const handleImport = useCallback(async (): Promise<void> => {
    if (selectedIds.length === 0) {
      Alert.alert('请至少选择一个日历');
      return;
    }
    setPhase('importing');
    try {
      const rangeStartMs = Date.now();
      const rangeEndMs = rangeStartMs + rangeDays * DAY_MS;
      const imported = await itemRepository.importSystemCalendarEvents({
        calendarIds: selectedIds,
        rangeStartMs,
        rangeEndMs,
      });
      setResult(imported);
      setPhase('done');
      // 任务卡实现要求 4：导入完成后触发一次 reconcile()；fire-and-forget，失败不阻断结果展示。
      void reminderScheduler
        .reconcile()
        .catch((error: unknown) => {
          console.warn('[slice-09] 导入后 reconcile 失败', error);
        });
    } catch (error) {
      console.warn('[slice-09] 系统日历导入失败', error);
      Alert.alert('导入失败', error instanceof Error ? error.message : String(error));
      setPhase('select');
    }
  }, [rangeDays, selectedIds]);

  if (phase === 'loading') {
    return (
      <View style={styles.centerBox}>
        <ActivityIndicator />
        <Text style={styles.meta}>正在申请日历读取权限…</Text>
      </View>
    );
  }

  if (phase === 'permission-denied') {
    return (
      <View style={styles.centerBox}>
        <Text style={styles.deniedTitle}>未授予日历读取权限</Text>
        <Text style={styles.meta}>
          系统日历导入需要读取权限。拒绝后无法读取日历列表，可稍后在系统设置中开启，或在此重试。
        </Text>
        {permissionHint ? <Text style={styles.errorText}>{permissionHint}</Text> : null}
        <Pressable style={styles.secondaryButton} onPress={() => void requestPermissionAndLoad()}>
          <Text style={styles.secondaryText}>重试</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          选择日历（已选 {selectedIds.length}/{calendars.length}）
        </Text>
        <Text style={styles.hint}>
          以下为系统 API 返回的日历列表；系统可能仅暴露部分日历，未列出的无法读取。
        </Text>
        {calendars.length === 0 ? (
          <Text style={styles.meta}>系统未返回任何日历。</Text>
        ) : (
          calendars.map((cal) => {
            const checked = selectedIds.includes(cal.id);
            return (
              <Pressable
                key={cal.id}
                style={styles.calendarRow}
                onPress={() => toggleCalendar(cal.id)}
                disabled={phase === 'importing'}
              >
                <Text style={styles.checkbox}>{checked ? '☑' : '☐'}</Text>
                <View style={styles.calendarText}>
                  <Text style={styles.calendarTitle}>
                    {cal.title.length > 0 ? cal.title : '（未命名日历）'}
                  </Text>
                  <Text style={styles.meta}>id {cal.id}</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>导入未来</Text>
        <View style={styles.rangeRow}>
          {RANGE_OPTIONS.map((days) => (
            <Pressable
              key={days}
              style={[styles.rangeButton, rangeDays === days && styles.rangeButtonActive]}
              onPress={() => setRangeDays(days)}
              disabled={phase === 'importing'}
            >
              <Text style={[styles.rangeText, rangeDays === days && styles.rangeTextActive]}>
                {days} 天
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.meta}>范围为 [现在，现在 + 所选天数)。</Text>
      </View>

      <Pressable
        style={[styles.primaryButton, phase === 'importing' && styles.disabled]}
        onPress={() => {
          void handleImport();
        }}
        disabled={phase === 'importing'}
      >
        {phase === 'importing' ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryText}>开始导入</Text>
        )}
      </Pressable>

      {phase === 'done' && result ? (
        <View style={styles.resultArea}>
          <SystemImportResultView result={result} />
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/today')}>
            <Text style={styles.secondaryText}>查看今日视图</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    padding: 16,
    paddingBottom: 32,
    gap: 16,
  },
  centerBox: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
  },
  hint: {
    fontSize: 12,
    color: '#888',
    lineHeight: 18,
  },
  meta: {
    fontSize: 12,
    color: '#999',
  },
  calendarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  checkbox: {
    fontSize: 18,
    color: '#1e6f5c',
  },
  calendarText: {
    flex: 1,
  },
  calendarTitle: {
    fontSize: 14,
    color: '#333',
  },
  rangeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rangeButton: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  rangeButtonActive: {
    borderColor: '#1e6f5c',
    backgroundColor: '#e8f3ef',
  },
  rangeText: {
    fontSize: 13,
    color: '#555',
  },
  rangeTextActive: {
    color: '#1e6f5c',
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: '#1e6f5c',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
  resultArea: {
    gap: 12,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  secondaryText: {
    fontSize: 13,
    color: '#555',
  },
  deniedTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#b26a00',
  },
  errorText: {
    fontSize: 12,
    color: '#c62828',
  },
});
