import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { itemRepository } from '../../data';
import type { ItemWithTags } from '../../domain/tag';
import type { Reminder, ReconcileResult, UpdateReminderInput } from '../../domain/reminder';
import {
  getLastAutoReconcileResult,
  reminderScheduler,
} from '../../notifications';
import { isWhitelistedReminderTz } from '../../data/reminderTzWhitelist';
import EmptyState from '../../ui/EmptyState';
import ReminderFormEditor from '../../ui/ReminderFormEditor';
import type { ReminderFormValues } from '../../ui/reminderForm';
import { buildCreateReminderInput } from '../../ui/reminderForm';
import TagChip from '../../ui/TagChip';
import {
  formatItemEnd,
  formatItemStart,
  formatItemTime,
  formatReminderRuleSummary,
  getDeviceTzid,
} from '../../ui/timeFormat';

/**
 * Item 详情页（切片 6，AGENTS.md §4.26 / §4.27）：
 * - 展示 title/type/content/tags/startAt/endAt/allDay/reminders/status；
 * - Reminder 的创建/编辑/删除在本页完成；删除先 cancelForReminder 成功才 deleteReminder；
 * - 保存涉及 reminder 或 Item 状态变更后调用 reconcile()，失败不阻断、写日志并在 dev 信息区可见；
 * - Item 不存在（被删除）渲染“条目已删除”占位，不崩溃；
 * - 白名单外 tzid 的 reminder 只读展示并标注，不自动改写、不提供编辑/删除（§4.25）。
 */

const TYPE_LABELS: Record<string, string> = {
  note: '灵感',
  task: '任务',
  event: '日程',
};

function reconcileBrief(result: ReconcileResult | null): string {
  if (!result) {
    return '无';
  }
  return `新调度 ${result.newlyScheduled.length} · 取消 ${result.cancelled.length} · missed ${result.missed.length}`;
}

type FormMode = { kind: 'create' } | { kind: 'edit'; reminder: Reminder } | null;

export default function ItemDetailPage() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();

  // undefined=加载中；null=条目不存在（占位态）
  const [item, setItem] = useState<ItemWithTags | null | undefined>(undefined);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [saveReconcile, setSaveReconcile] = useState<ReconcileResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const deviceTzid = getDeviceTzid();

  const load = useCallback(async (): Promise<void> => {
    if (!id) {
      setItem(null);
      return;
    }
    try {
      const [itemLoaded, remindersLoaded] = await Promise.all([
        itemRepository.getItemById(id),
        itemRepository.listRemindersByItem(id),
      ]);
      setItem(itemLoaded);
      setReminders(remindersLoaded);
    } catch (error) {
      console.warn('[slice-06] 详情页读取失败', error);
      setActionError(`读取失败：${String(error)}`);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** §4.27：保存后对账；失败不阻断，错误写日志并进入 actionError（dev 信息区下方可见）。 */
  const reconcileAfterSave = useCallback(async (source: string): Promise<void> => {
    try {
      const result = await reminderScheduler.reconcile();
      setSaveReconcile(result);
    } catch (error) {
      console.warn(`[slice-06] ${source}后 reconcile 失败`, error);
      setActionError(`对账失败：${String(error)}`);
    }
  }, []);

  const handleCreateReminder = async (values: ReminderFormValues): Promise<void> => {
    if (!id) {
      return;
    }
    try {
      const created = await itemRepository.createReminder(buildCreateReminderInput(values, id));
      await reminderScheduler.scheduleForReminder(created.id);
      setFormMode(null);
      await reconcileAfterSave('新建提醒');
      await load();
    } catch (error) {
      console.warn('[slice-06] 创建提醒失败', error);
      setActionError(`创建提醒失败：${String(error)}`);
    }
  };

  const handleUpdateReminder = async (target: Reminder, values: ReminderFormValues): Promise<void> => {
    try {
      const patch: UpdateReminderInput = {
        frequency: values.frequency,
        localTimeHour: values.localTimeHour ?? target.localTimeHour,
        localTimeMinute: values.localTimeMinute ?? target.localTimeMinute,
        weekdays: values.weekdays,
        dayOfMonth: values.dayOfMonth ?? target.dayOfMonth,
        startAt: values.startAt ?? target.startAt,
        enabled: values.enabled,
        tzid: values.tzid,
      };
      await itemRepository.updateReminder(target.id, patch);
      // 任务卡实现要求 5：tzid 切换（或任意编辑）后，旧 tzid/旧规则的通知必须被
      // cancelForReminder 清理再重排；cancelForReminder 幂等，先 update 成功再清理最安全。
      await reminderScheduler.cancelForReminder(target.id);
      await reminderScheduler.scheduleForReminder(target.id);
      setFormMode(null);
      await reconcileAfterSave('编辑提醒');
      await load();
    } catch (error) {
      console.warn('[slice-06] 编辑提醒失败', error);
      setActionError(`编辑提醒失败：${String(error)}`);
    }
  };

  const handleDeleteReminder = async (target: Reminder): Promise<void> => {
    try {
      // 契约顺序（§4.27）：先 cancelForReminder 成功，才 deleteReminder；cancel 失败则不删。
      await reminderScheduler.cancelForReminder(target.id);
      await itemRepository.deleteReminder(target.id);
      await reconcileAfterSave('删除提醒');
      await load();
    } catch (error) {
      console.warn('[slice-06] 删除提醒失败（cancel 或 delete 阶段）', error);
      setActionError(`删除提醒失败：${String(error)}`);
    }
  };

  const confirmDeleteReminder = (target: Reminder): void => {
    Alert.alert('删除提醒', '将同时取消该提醒已调度的系统通知。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void handleDeleteReminder(target);
        },
      },
    ]);
  };

  /** 切片 8：删除本地副本（data-model.md v0.8：删除即从本地库移除，不影响外部来源）。 */
  const handleDeleteLocalCopy = async (): Promise<void> => {
    if (!id) {
      return;
    }
    try {
      // 先取消该条目全部提醒的系统通知（契约顺序：cancel 成功才动存储），再删行。
      for (const reminder of reminders) {
        await reminderScheduler.cancelForReminder(reminder.id);
      }
      await itemRepository.deleteItem(id);
      await reconcileAfterSave('删除本地副本');
      router.back();
    } catch (error) {
      console.warn('[slice-08] 删除本地副本失败', error);
      setActionError(`删除本地副本失败：${String(error)}`);
    }
  };

  const confirmDeleteLocalCopy = (): void => {
    Alert.alert(
      '删除本地副本',
      item?.sourceType === 'system-calendar'
        ? '将从本地库删除该条目及其提醒，不影响系统日历中的原事件。'
        : '将从本地库删除该条目及其提醒，不影响外部来源的 ICS 文件。',
      [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void handleDeleteLocalCopy();
        },
      },
    ]);
  };

  if (item === undefined) {
    return (
      <View style={styles.container}>
        <EmptyState message="加载中…" />
      </View>
    );
  }

  if (item === null) {
    // §4.26：Item 不存在时显示“条目已删除”占位页，不崩溃。
    return (
      <View style={styles.container}>
        <EmptyState message="条目已删除" />
        <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
          <Text style={styles.secondaryText}>返回</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{item.title}</Text>
        {item.sourceReadOnly ? (
          // 切片 8/9：只读项隐藏「编辑」入口，按来源展示徽标（tasks/slice-08.md 实现 6、slice-09 隐含要求）。
          <View style={styles.sourceBadge}>
            <Text style={styles.sourceBadgeText}>
              {item.sourceType === 'system-calendar' ? '来源：系统日历（只读）' : '来源：ICS（只读）'}
            </Text>
          </View>
        ) : (
          <Pressable
            style={styles.secondaryButton}
            onPress={() => router.push(`/item/${item.id}/edit`)}
          >
            <Text style={styles.secondaryText}>编辑</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.meta}>
        {TYPE_LABELS[item.type] ?? item.type} · 状态 {item.status}
      </Text>

      {item.content.length > 0 ? <Text style={styles.content}>{item.content}</Text> : null}

      {item.tags.length > 0 ? (
        <View style={styles.tagRow}>
          {item.tags.map((tag) => (
            <TagChip key={tag.id} tag={tag} />
          ))}
        </View>
      ) : null}

      {item.sourceReadOnly ? (
        <View style={styles.sectionBox}>
          <Text style={styles.sectionTitle}>外部来源</Text>
          <Text style={styles.meta}>
            {item.sourceType === 'system-calendar'
              ? '此条目来自系统日历导入：时间/标题/内容只读，可完成、可归档、可删除本地副本。'
              : '此条目来自 ICS 导入：时间/标题/内容只读，可完成、可归档、可删除本地副本。'}
          </Text>
          <Pressable
            style={[styles.secondaryButton, styles.dangerButton, styles.sourceDeleteButton]}
            onPress={confirmDeleteLocalCopy}
          >
            <Text style={[styles.secondaryText, styles.dangerText]}>删除本地副本</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.sectionBox}>
        <Text style={styles.sectionTitle}>时间</Text>
        <Text style={styles.line}>
          开始：{formatItemStart(item.startAt, item.allDay, deviceTzid)}
        </Text>
        <Text style={styles.line}>
          结束：{formatItemEnd(item.endAt, item.allDay, deviceTzid)}
        </Text>
        <Text style={styles.line}>全天：{item.allDay ? '是' : '否'}</Text>
        <Text style={styles.meta}>按设备时区 {deviceTzid} 显示</Text>
      </View>

      <View style={styles.sectionBox}>
        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>提醒（{reminders.length}）</Text>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => setFormMode(formMode?.kind === 'create' ? null : { kind: 'create' })}
          >
            <Text style={styles.secondaryText}>{formMode?.kind === 'create' ? '收起' : '新建提醒'}</Text>
          </Pressable>
        </View>

        {formMode?.kind === 'create' ? (
          <ReminderFormEditor
            submitLabel="创建"
            onSubmit={handleCreateReminder}
            onCancel={() => setFormMode(null)}
          />
        ) : null}

        {reminders.length === 0 ? (
          <Text style={styles.meta}>暂无提醒</Text>
        ) : (
          reminders.map((reminder) => {
            const editable = isWhitelistedReminderTz(reminder.tzid);
            const editingThis =
              formMode?.kind === 'edit' && formMode.reminder.id === reminder.id;
            return (
              <View key={reminder.id} style={styles.reminderRow}>
                <Text style={styles.line}>{formatReminderRuleSummary(reminder)}</Text>
                <Text style={styles.meta}>
                  {reminder.enabled ? '已启用' : '已停用'} · 生效起点{' '}
                  {formatItemTime(reminder.startAt, reminder.tzid)} · 上次对账{' '}
                  {reminder.lastReconciledAt === null
                    ? '从未'
                    : formatItemTime(reminder.lastReconciledAt, deviceTzid)}
                </Text>
                {!editable ? (
                  <Text style={styles.readonlyNote}>该时区暂不支持编辑（只读）</Text>
                ) : null}
                {reminder.tzid === 'UTC' ? (
                  // 切片 11 变更 A：时区来源修正前的历史 reminder 不迁移（occurrence 仍按 UTC 展开），
                  // 详情页如实标注（docs/contracts/ui.md v0.11）。
                  <Text style={styles.readonlyNote}>创建于时区修正前（UTC）</Text>
                ) : null}
                {editable && editingThis ? (
                  <ReminderFormEditor
                    initial={reminder}
                    submitLabel="保存"
                    onSubmit={(values) => handleUpdateReminder(reminder, values)}
                    onCancel={() => setFormMode(null)}
                  />
                ) : null}
                {editable && !editingThis ? (
                  <View style={styles.reminderActions}>
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => setFormMode({ kind: 'edit', reminder })}
                    >
                      <Text style={styles.secondaryText}>编辑</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.secondaryButton, styles.dangerButton]}
                      onPress={() => confirmDeleteReminder(reminder)}
                    >
                      <Text style={[styles.secondaryText, styles.dangerText]}>删除</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>

      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

      {__DEV__ ? (
        <View style={styles.devBox}>
          <Text style={styles.devTitle}>Dev 信息（仅 __DEV__）</Text>
          <Text style={styles.devText}>
            启动/前台对账：{reconcileBrief(getLastAutoReconcileResult())}
          </Text>
          <Text style={styles.devText}>本页保存对账：{reconcileBrief(saveReconcile)}</Text>
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
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
  },
  meta: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
  },
  content: {
    fontSize: 15,
    color: '#333',
    marginTop: 10,
    lineHeight: 22,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  sectionBox: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
  },
  line: {
    fontSize: 14,
    color: '#333',
    marginTop: 2,
  },
  reminderRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
    paddingTop: 8,
    marginTop: 8,
  },
  reminderActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  readonlyNote: {
    fontSize: 12,
    color: '#b26a00',
    marginTop: 4,
  },
  errorText: {
    fontSize: 12,
    color: '#c62828',
    marginTop: 8,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  secondaryText: {
    fontSize: 13,
    color: '#555',
  },
  dangerButton: {
    borderColor: '#c62828',
  },
  dangerText: {
    color: '#c62828',
  },
  devBox: {
    marginTop: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#bbb',
    borderRadius: 8,
    padding: 10,
  },
  devTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  devText: {
    fontSize: 12,
    color: '#666',
  },
  sourceBadge: {
    backgroundColor: '#eef2ff',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  sourceBadgeText: {
    fontSize: 12,
    color: '#4f46e5',
  },
  sourceDeleteButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
});
