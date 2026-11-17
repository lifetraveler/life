import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { RecurrenceRule } from '../domain/recurrence/types';
import type { ParsedItemDraft } from '../domain/ai/types';
import type { Category } from '../domain/category';
import type { ReminderChannel } from '../domain/reminder';
import { formatItemClock, formatItemDate, formatItemTime, isSameCivilDay } from './timeFormat';
import { REMINDER_CHANNEL_LABELS } from './reminderForm';
import { useTheme } from './theme';
import type { ThemeColors } from './theme';

/**
 * 闪电添加预览卡片（tasks/slice-15.md 阶段 3，验收 6/8；AGENTS.md §7.25）。
 * 展示解析出的全部字段；点击整卡进入编辑弹窗。纯展示组件，不触 Repository。
 * 切片 23 阶段 3（§7.35）：reminderChannels 含 alarm/system-notification 时
 * 渲染渠道标识行（⏰ 闹钟 / 🔔 通知）。
 */

const TYPE_LABELS: Record<ParsedItemDraft['type'], string> = {
  note: '记事',
  task: '任务',
  event: '日程',
};

const PRIORITY_LABELS: Record<number, string> = {
  1: '低优先级',
  2: '中优先级',
  3: '高优先级',
};

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

interface FlashPreviewCardProps {
  draft: ParsedItemDraft;
  categories: ReadonlyArray<Category>;
  tzid: string;
  onPress: () => void;
  /**
   * 切片 30（§7.41）阶段 3：草稿放弃态——整体降透明 +「已放弃」角标
   * （复用切片 29 历史卡视觉语言），点击禁用。默认 false。
   */
  dismissed?: boolean;
}

export function describeRecurrenceRule(rule: RecurrenceRule): string {
  if (rule.frequency === 'daily') return '每天';
  if (rule.frequency === 'weekly') {
    return `每周${rule.weekdays.map((w) => WEEKDAY_LABELS[w - 1] ?? w).join('、')}`;
  }
  return `每月${rule.dayOfMonth}号`;
}

/**
 * 切片 24 修复（slice-23 遗留 5）：start 行此前为 formatItemDate + formatItemTime
 * 相拼，而 formatItemTime 本身已含日期 → 「2026-11-16 2026-11-16 07:30」日期重复。
 * 现在 start 行单用 formatItemTime；endAt 与 startAt 同一民用日只补 'HH:mm'，
 * 跨民用日才带完整日期（与 formatAgendaTimeRange 的范围语义一致）。
 */
export function describeDraftTime(draft: ParsedItemDraft, tzid: string): string {
  if (draft.startAt === null) return '未设时间';
  if (draft.allDay) return `${formatItemDate(draft.startAt, tzid)} 全天`;
  const start = formatItemTime(draft.startAt, tzid);
  if (draft.endAt === null) return start;
  const end = isSameCivilDay(draft.startAt, draft.endAt, tzid)
    ? formatItemClock(draft.endAt, tzid)
    : formatItemTime(draft.endAt, tzid);
  return `${start} ~ ${end}`;
}

/**
 * 渠道标识文案（切片 23 阶段 3 / §7.35，任务卡验收 2）：含 alarm → '⏰ 闹钟'；
 * 含 system-notification → '🔔 通知'；网络渠道按 REMINDER_CHANNEL_LABELS 列出。
 * reminderChannels 未表达（undefined/空数组）→ null（不渲染渠道行）。
 */
export function describeDraftChannelLine(
  channels?: ReminderChannel[],
): string | null {
  if (channels === undefined || channels.length === 0) return null;
  if (channels.includes('alarm')) return '⏰ 闹钟';
  if (channels.includes('system-notification')) return '🔔 通知';
  return channels.map((channel) => REMINDER_CHANNEL_LABELS[channel]).join('、');
}

export default function FlashPreviewCard({
  draft,
  categories,
  tzid,
  onPress,
  dismissed = false,
}: FlashPreviewCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const category = categories.find((c) => c.id === draft.categoryId) ?? null;
  const channelLine = describeDraftChannelLine(draft.reminderChannels);
  const timeText =
    draft.recurrence !== null
      ? `${describeRecurrenceRule(draft.recurrence)} ${String(
          draft.recurrence.localTime.hour,
        ).padStart(2, '0')}:${String(draft.recurrence.localTime.minute).padStart(2, '0')}`
      : describeDraftTime(draft, tzid);

  return (
    <Pressable
      style={[styles.card, dismissed ? styles.cardDismissed : null]}
      onPress={onPress}
      disabled={dismissed}
    >
      {/* 切片 30（§7.41）：「已放弃」角标（切片 29 历史卡同款 pill）。 */}
      {dismissed ? (
        <View style={styles.dismissedBadge} pointerEvents="none">
          <Text style={styles.dismissedBadgeText}>已放弃</Text>
        </View>
      ) : null}
      <View style={styles.headerRow}>
        <Text style={styles.typeBadge}>{TYPE_LABELS[draft.type]}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {draft.title}
        </Text>
      </View>
      <Text style={styles.rowText}>时间：{timeText}</Text>
      {draft.content.trim().length > 0 ? (
        <Text style={styles.rowText} numberOfLines={2}>
          内容：{draft.content}
        </Text>
      ) : null}
      {category !== null ? <Text style={styles.rowText}>分类：{category.name}</Text> : null}
      {draft.priority !== null && draft.priority >= 1 ? (
        <Text style={styles.rowText}>优先级：{PRIORITY_LABELS[draft.priority]}</Text>
      ) : null}
      {draft.tags.length > 0 ? (
        <Text style={styles.rowText}>标签：{draft.tags.join('、')}</Text>
      ) : null}
      {channelLine !== null ? (
        <Text style={styles.rowText}>提醒：{channelLine}</Text>
      ) : null}
      {draft.reminderOffsetMinutes !== null ? (
        <Text style={styles.rowText}>
          提醒：提前{draft.reminderOffsetMinutes}分钟
        </Text>
      ) : null}
      {draft.reminderDelayMinutes !== null ? (
        <Text style={styles.rowText}>
          提醒：{draft.reminderDelayMinutes}分钟后
        </Text>
      ) : null}
      <Text style={styles.editHint}>
        {dismissed ? '草稿已放弃，重新输入可新建条目' : '点击卡片可修改字段'}
      </Text>
    </Pressable>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.card,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: 12,
      gap: 6,
    },
    // 切片 30（§7.41）阶段 3：弃置态仅降透明（切片 29 历史卡同款 0.55），
    // 不包外层 wrapper（切片 22 教训：FlatList/行容器测宽塌缩）。
    cardDismissed: {
      opacity: 0.55,
    },
    dismissedBadge: {
      position: 'absolute',
      top: 6,
      right: 6,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: 8,
      paddingVertical: 1,
      paddingHorizontal: 6,
    },
    dismissedBadgeText: {
      fontSize: 10,
      color: c.textMuted,
      fontWeight: '600',
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    typeBadge: {
      fontSize: 11,
      color: c.textOnPrimary,
      backgroundColor: c.primary,
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
      overflow: 'hidden',
    },
    cardTitle: {
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
    },
    rowText: {
      fontSize: 13,
      color: c.text,
    },
    editHint: {
      fontSize: 11,
      color: c.textMuted,
      marginTop: 2,
    },
  });
}
