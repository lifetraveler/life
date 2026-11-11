import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { itemRepository } from '../data';
import type { Item } from '../domain/item';
import type { ReconcileResult, Reminder, ReminderFrequency } from '../domain/reminder';
import { expandOccurrences } from '../domain/recurrence';
import type { Occurrence } from '../domain/recurrence';
import { TZDate } from '@date-fns/tz';
import { toRecurrenceRule } from '../data/reminderRuleMapping';
import {
  ensureNotificationPermissions,
  getLastAutoReconcileResult,
  getNotificationPermissionState,
  reminderScheduler,
} from '../notifications';
import type { NotificationPermissionState } from '../notifications';

/**
 * 提醒调试页（AGENTS.md §4.22，仅 __DEV__ 可用）：
 * - 创建/删除 reminder（一律走 Repository，不直接写库）；
 * - 手动触发 reconcile() 并展示 ReconcileResult；
 * - 查看当前已调度通知 identifier；
 * - 触发一次聚合补提醒通知（仅真机验收用）。
 * 本页不是正式 UI：release 构建渲染 null，正式导航不引用本路由。
 */

const FREQUENCIES: readonly ReminderFrequency[] = ['daily', 'weekly', 'monthly'];

// 切片 16：frequency 扩展 'once' 后 Record 必须穷举；列表行可能展示存量 once 提醒，
// 但创建表单不提供 once（onceAt 民用时刻输入属阶段 3 UI，本调试页不提前实现）。
const FREQUENCY_LABELS: Record<ReminderFrequency, string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  once: '单次',
};

const WEEKDAY_LABELS: Record<number, string> = {
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
  7: '日',
};

/** 调试页默认时区：当前设备时区（可在表单里覆盖，如真机 DST 验收输 America/New_York）。 */
function deviceTzid(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export default function DebugRemindersScreen() {
  const [items, setItems] = useState<Item[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [frequency, setFrequency] = useState<ReminderFrequency>('daily');
  const [hourText, setHourText] = useState('9');
  const [minuteText, setMinuteText] = useState('0');
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [dayOfMonthText, setDayOfMonthText] = useState('1');
  const [tzidText, setTzidText] = useState<string>(deviceTzid());
  const [startAtOffsetMinutesText, setStartAtOffsetMinutesText] = useState('0');
  const [startAtDateText, setStartAtDateText] = useState('');
  const [scheduledIds, setScheduledIds] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<ReconcileResult | null>(null);
  const [permissionState, setPermissionState] = useState<NotificationPermissionState | null>(null);
  const [status, setStatus] = useState<string>('');

  const refresh = useCallback(async (): Promise<void> => {
    const [nextItems, nextReminders] = await Promise.all([
      itemRepository.listItems(),
      itemRepository.listEnabledReminders(),
    ]);
    setItems(nextItems);
    setReminders(nextReminders);
    setScheduledIds(await reminderScheduler.getScheduledNotificationIdentifiers());
    setPermissionState(await getNotificationPermissionState());
    if (!nextItems.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(nextItems[0]?.id ?? null);
    }
  }, [selectedItemId]);

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setStatus(`刷新失败：${String(error)}`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!__DEV__) {
    return null;
  }

  const appendStatus = (message: string): void => {
    setStatus(message);
  };

  const createReminder = async (): Promise<void> => {
    if (!selectedItemId) {
      appendStatus('请先选择一条 Item（调试页不负责创建 Item，请回首页添加）');
      return;
    }
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      appendStatus('小时必须是 0–23 整数');
      return;
    }
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
      appendStatus('分钟必须是 0–59 整数');
      return;
    }
    const dayOfMonth = Number(dayOfMonthText);
    if (frequency === 'monthly' && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) {
      appendStatus('「几号」必须是 1–31 整数');
      return;
    }
    const startAtOffsetMinutes = Number(startAtOffsetMinutesText);
    if (!Number.isFinite(startAtOffsetMinutes)) {
      appendStatus('startAt 偏移必须是数字（分钟，可为负）');
      return;
    }
    // startAt：填了绝对日期（YYYY-MM-DD，按规则 tzid 的当天 00:00）优先；否则用偏移。
    let startAt = Date.now() + startAtOffsetMinutes * 60_000;
    const trimmedDate = startAtDateText.trim();
    if (trimmedDate.length > 0) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
        appendStatus('startAt 日期格式必须是 YYYY-MM-DD');
        return;
      }
      startAt = new TZDate(`${trimmedDate}T00:00:00`, tzidText.trim() || deviceTzid()).getTime();
    }
    try {
      const reminder = await itemRepository.createReminder({
        itemId: selectedItemId,
        frequency,
        localTimeHour: hour,
        localTimeMinute: minute,
        weekdays: frequency === 'weekly' ? [...weekdays] : [],
        dayOfMonth: frequency === 'monthly' ? dayOfMonth : 0,
        tzid: tzidText.trim() || deviceTzid(),
        startAt: Date.now() + startAtOffsetMinutes * 60_000,
        enabled: true,
      });
      await reminderScheduler.scheduleForReminder(reminder.id);
      appendStatus(
        `已创建 reminder ${reminder.id}（${FREQUENCY_LABELS[frequency]} ${hour}:${String(minute).padStart(2, '0')} ${reminder.tzid}，startAt 偏移 ${startAtOffsetMinutes}min）并调度`,
      );
      await refresh();
    } catch (error) {
      appendStatus(`创建失败：${String(error)}`);
    }
  };

  const toggleItemStatus = async (item: Item): Promise<void> => {
    try {
      const nextStatus = item.status === 'active' ? 'done' : 'active';
      await itemRepository.updateItem(item.id, { status: nextStatus });
      appendStatus(`Item ${item.id} 状态改为 ${nextStatus}`);
      await refresh();
    } catch (error) {
      appendStatus(`改状态失败：${String(error)}`);
    }
  };

  const deleteReminder = async (id: string): Promise<void> => {
    try {
      await itemRepository.deleteReminder(id);
      await reminderScheduler.cancelForReminder(id);
      appendStatus(`已删除 reminder ${id} 并取消其通知`);
      await refresh();
    } catch (error) {
      appendStatus(`删除失败：${String(error)}`);
    }
  };

  const reconcileNow = async (): Promise<void> => {
    try {
      const result = await reminderScheduler.reconcile();
      setLastResult(result);
      if (result.missed.length > 0) {
        await reminderScheduler.presentMissedSummary(result.missed);
      }
      appendStatus(
        `对账完成：新调度 ${result.newlyScheduled.length}，取消 ${result.cancelled.length}，错过 ${result.missed.length}（错过非空时已弹聚合提示）`,
      );
      await refresh();
    } catch (error) {
      appendStatus(`对账失败：${String(error)}`);
    }
  };

  const requestPermission = async (): Promise<void> => {
    const state = await ensureNotificationPermissions();
    setPermissionState(state);
    appendStatus(`权限状态：${state}`);
  };

  /** 展开 30 个 occurrence（不做 30 天窗口过滤），用于 DST gap 人工核对。 */
  const previewOccurrences = (reminder: Reminder): void => {
    try {
      const occurrences: Occurrence[] = expandOccurrences({
        scheduleId: reminder.id,
        rule: toRecurrenceRule(reminder),
        startAt: reminder.startAt,
        tzid: reminder.tzid,
        count: 30,
      });
      appendStatus(
        `展开预览（30 项，未过滤窗口）：\n${occurrences
          .map((o) => `${o.localDate} ${o.localTime} ${o.tzid}`)
          .join('\n')}`,
      );
    } catch (error) {
      appendStatus(`展开失败：${String(error)}`);
    }
  };

  const presentMissedAgain = async (): Promise<void> => {
    const missed: Occurrence[] = lastResult?.missed ?? [];
    if (missed.length === 0) {
      appendStatus('最近一次对账没有 missed 数据');
      return;
    }
    await reminderScheduler.presentMissedSummary(missed);
    appendStatus(`已再次弹出聚合提示（${missed.length} 条）`);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>提醒调试（仅 __DEV__）</Text>
      {status ? <Text style={styles.status}>{status}</Text> : null}

      <Text style={styles.section}>权限（Android 13+ POST_NOTIFICATIONS）</Text>
      <Text>当前状态：{permissionState ?? '未知'}</Text>
      <Pressable style={styles.button} onPress={() => void requestPermission()}>
        <Text style={styles.buttonText}>显式申请通知权限</Text>
      </Pressable>

      <Text style={styles.section}>Item（提醒的宿主）</Text>
      {items.length === 0 ? <Text>暂无 Item，请先回首页创建。</Text> : null}
      {items.map((item) => (
        <View key={item.id} style={[styles.row, selectedItemId === item.id && styles.rowSelected]}>
          <Pressable onPress={() => setSelectedItemId(item.id)}>
            <Text>
              {selectedItemId === item.id ? '✓ ' : ''}
              {item.title}（{item.type} / {item.status}）
            </Text>
          </Pressable>
          <Pressable style={[styles.button, styles.chip]} onPress={() => void toggleItemStatus(item)}>
            <Text>{item.status === 'active' ? '标记 done' : '恢复 active'}</Text>
          </Pressable>
        </View>
      ))}

      <Text style={styles.section}>创建 reminder</Text>
      <View style={styles.rowWrap}>
        {FREQUENCIES.map((value) => (
          <Pressable
            key={value}
            style={[styles.chip, frequency === value && styles.chipSelected]}
            onPress={() => setFrequency(value)}
          >
            <Text>{FREQUENCY_LABELS[value]}</Text>
          </Pressable>
        ))}
      </View>
      {frequency === 'weekly' ? (
        <View style={styles.rowWrap}>
          {[1, 2, 3, 4, 5, 6, 7].map((day) => (
            <Pressable
              key={day}
              style={[styles.chip, weekdays.includes(day) && styles.chipSelected]}
              onPress={() =>
                setWeekdays((current) =>
                  current.includes(day)
                    ? current.filter((value) => value !== day)
                    : [...current, day].sort((a, b) => a - b),
                )
              }
            >
              <Text>周{WEEKDAY_LABELS[day]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {frequency === 'monthly' ? (
        <View style={styles.fieldRow}>
          <Text>每月几号（1–31，超出当月回退到最后一天）：</Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={dayOfMonthText}
            onChangeText={setDayOfMonthText}
          />
        </View>
      ) : null}
      <View style={styles.fieldRow}>
        <Text>时间（24 小时制）：</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={hourText}
          onChangeText={setHourText}
        />
        <Text>:</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={minuteText}
          onChangeText={setMinuteText}
        />
      </View>
      <View style={styles.fieldRow}>
        <Text>tzid（留空=设备时区）：</Text>
        <TextInput
          style={[styles.input, styles.inputWide]}
          value={tzidText}
          onChangeText={setTzidText}
          autoCapitalize="none"
        />
      </View>
      <View style={styles.fieldRow}>
        <Text>startAt 偏移（分钟，负=过去）：</Text>
        <TextInput
          style={styles.input}
          keyboardType="numbers-and-punctuation"
          value={startAtOffsetMinutesText}
          onChangeText={setStartAtOffsetMinutesText}
        />
      </View>
      <View style={styles.fieldRow}>
        <Text>或 startAt 绝对日期（YYYY-MM-DD，按 tzid 当天 00:00）：</Text>
        <TextInput
          style={[styles.input, styles.inputWide]}
          value={startAtDateText}
          onChangeText={setStartAtDateText}
          autoCapitalize="none"
        />
      </View>
      <Text style={styles.hint}>填绝对日期时忽略偏移；DST 验收可输 America/New_York。</Text>
      <Pressable style={styles.button} onPress={() => void createReminder()}>
        <Text style={styles.buttonText}>创建 reminder 并调度</Text>
      </Pressable>

      <Text style={styles.section}>现有 reminder（listEnabledReminders）</Text>
      {reminders.length === 0 ? <Text>暂无启用的 reminder。</Text> : null}
      {reminders.map((reminder) => (
        <View key={reminder.id} style={styles.row}>
          <Text>
            {reminder.id} → item {reminder.itemId}（{FREQUENCY_LABELS[reminder.frequency]}{' '}
            {String(reminder.localTimeHour).padStart(2, '0')}:
            {String(reminder.localTimeMinute).padStart(2, '0')} / {reminder.tzid} / startAt=
            {new Date(reminder.startAt).toISOString()}）
          </Text>
          <View style={styles.rowWrap}>
            <Pressable style={styles.chip} onPress={() => previewOccurrences(reminder)}>
              <Text>展开预览 30 项</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.danger]}
              onPress={() => void deleteReminder(reminder.id)}
            >
              <Text style={styles.buttonText}>删除并取消通知</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <Text style={styles.section}>对账与观察</Text>
      <Pressable style={styles.button} onPress={() => void reconcileNow()}>
        <Text style={styles.buttonText}>手动 reconcile()</Text>
      </Pressable>
      {lastResult ? (
        <Text style={styles.hint}>
          最近一次：newlyScheduled={lastResult.newlyScheduled.length}，cancelled=
          {lastResult.cancelled.length}，missed={lastResult.missed.length}
          {lastResult.missed.length > 0 ? `\n${lastResult.missed.map((o) => o.occurrenceKey).join('\n')}` : ''}
        </Text>
      ) : null}
      {(() => {
        const auto = getLastAutoReconcileResult();
        if (!auto) return <Text style={styles.hint}>启动对账：尚无结果</Text>;
        return (
          <Text style={styles.hint}>
            启动对账：newlyScheduled={auto.newlyScheduled.length}，cancelled={auto.cancelled.length}，missed=
            {auto.missed.length}
            {auto.missed.length > 0
              ? `\n${auto.missed.map((o) => `${o.occurrenceKey} @ ${new Date(o.instant).toISOString()}`).join('\n')}`
              : ''}
          </Text>
        );
      })()}
      <Pressable style={styles.button} onPress={() => void presentMissedAgain()}>
        <Text style={styles.buttonText}>再次弹聚合补提醒通知</Text>
      </Pressable>

      <Text style={styles.section}>已调度通知（getAllScheduledNotificationsAsync）</Text>
      <Text>共 {scheduledIds.length} 条（仅统计本 App 前缀）</Text>
      {scheduledIds.map((identifier) => (
        <Text key={identifier} style={styles.mono}>
          {identifier}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 16,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  section: {
    marginTop: 12,
    fontSize: 15,
    fontWeight: '700',
  },
  status: {
    color: '#0a7',
  },
  row: {
    paddingVertical: 6,
    gap: 4,
  },
  rowSelected: {
    backgroundColor: '#eef',
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#eee',
  },
  chipSelected: {
    backgroundColor: '#cde',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 8,
    minWidth: 48,
  },
  inputWide: {
    flex: 1,
  },
  button: {
    backgroundColor: '#246',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  danger: {
    backgroundColor: '#a33',
  },
  buttonText: {
    color: '#fff',
  },
  hint: {
    color: '#666',
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 11,
  },
});
