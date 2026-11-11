import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { RecurrenceRule } from '../domain/recurrence/types';
import type { ParsedItemDraft } from '../domain/ai/types';
import type { Category } from '../domain/category';
import { formatItemDate, formatItemTime } from './timeFormat';

/**
 * 闪电添加预览卡片（tasks/slice-15.md 阶段 3，验收 6/8；AGENTS.md §7.25）。
 * 展示解析出的全部字段；点击整卡进入编辑弹窗。纯展示组件，不触 Repository。
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
}

export function describeRecurrenceRule(rule: RecurrenceRule): string {
  if (rule.frequency === 'daily') return '每天';
  if (rule.frequency === 'weekly') {
    return `每周${rule.weekdays.map((w) => WEEKDAY_LABELS[w - 1] ?? w).join('、')}`;
  }
  return `每月${rule.dayOfMonth}号`;
}

export function describeDraftTime(draft: ParsedItemDraft, tzid: string): string {
  if (draft.startAt === null) return '未设时间';
  if (draft.allDay) return `${formatItemDate(draft.startAt, tzid)} 全天`;
  const start = `${formatItemDate(draft.startAt, tzid)} ${formatItemTime(draft.startAt, tzid)}`;
  if (draft.endAt === null) return start;
  return `${start} ~ ${formatItemTime(draft.endAt, tzid)}`;
}

export default function FlashPreviewCard({
  draft,
  categories,
  tzid,
  onPress,
}: FlashPreviewCardProps) {
  const category = categories.find((c) => c.id === draft.categoryId) ?? null;
  const timeText =
    draft.recurrence !== null
      ? `${describeRecurrenceRule(draft.recurrence)} ${String(
          draft.recurrence.localTime.hour,
        ).padStart(2, '0')}:${String(draft.recurrence.localTime.minute).padStart(2, '0')}`
      : describeDraftTime(draft, tzid);

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.headerRow}>
        <Text style={styles.typeBadge}>{TYPE_LABELS[draft.type]}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {draft.title}
        </Text>
      </View>
      <Text style={styles.rowText}>时间：{timeText}</Text>
      {category !== null ? <Text style={styles.rowText}>分类：{category.name}</Text> : null}
      {draft.priority !== null && draft.priority >= 1 ? (
        <Text style={styles.rowText}>优先级：{PRIORITY_LABELS[draft.priority]}</Text>
      ) : null}
      {draft.tags.length > 0 ? (
        <Text style={styles.rowText}>标签：{draft.tags.join('、')}</Text>
      ) : null}
      {draft.reminderOffsetMinutes !== null ? (
        <Text style={styles.rowText}>
          提醒：提前{draft.reminderOffsetMinutes}分钟
        </Text>
      ) : null}
      <Text style={styles.editHint}>点击卡片可修改字段</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#DDDDDD',
    padding: 12,
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeBadge: {
    fontSize: 11,
    color: '#FFFFFF',
    backgroundColor: '#4A90D9',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#111111',
  },
  rowText: {
    fontSize: 13,
    color: '#444444',
  },
  editHint: {
    fontSize: 11,
    color: '#999999',
    marginTop: 2,
  },
});
