/**
 * 闪电录入结果卡片（tasks/slice-22.md 阶段 2；AGENTS.md §7.34）。
 *
 * 保存成功后的 assistant 消息呈现（kind:'card'，载荷 FlashCardPayload 结构化
 * 快照）：左侧分类色条（含 Emoji 分类行）+ 粗体标题 + 📅 日期行（含具体时间）
 * + 提醒行（describeCardReminderLine 现算文案，切片 23 起按渠道展示 ⏰ 闹钟 /
 * 🔔 通知标识；once 显示绝对触发时刻，阶段 3 推迟后可见联动变化）。
 *
 * 纪律：
 * - 纯展示组件：点击只发 onPress（导航到 /item/[id] 留在 flash.tsx 屏幕层，
 *   §7.23 UI 不自查数据、导航不入组件）；
 * - 无时间待办（startAt null）不渲染日期行，也不渲染快捷推迟 chips（§7.34
 *   chips 条件=有具体时间非 allDay）；
 * - 快捷推迟 chips（+15分钟/+1小时）本阶段仅禁用占位（onPostpone 未接线），
 *   阶段 3 接线并联动顺延 once 提醒 onceAt；
 * - 样式沿用闪电录入设计语言（白卡 hairline #DDDDDD、主色 #4A90D9），
 *   chip 容器 flexWrap 自适应宽（§7.32 高分屏响应）。
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import type {
  FlashCardPayload,
  FlashCardReminderSnapshot,
} from '../domain/ai/types';
import { getZonedParts } from '../domain/recurrence/civilTime';
import {
  formatAgendaTimeRange,
  formatReminderRuleSummary,
  WEEKDAY_LABELS,
} from './timeFormat';
import { REMINDER_CHANNEL_LABELS } from './reminderForm';

/** 分类色缺失时的回退灰（Category.color null 的 UI 回退语义，取预置 other 色值）。 */
const FALLBACK_CATEGORY_COLOR = '#9E9E9E';

/** 快捷推迟选项（§7.34：+15分钟 / +1小时）。 */
const POSTPONE_OPTIONS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 15, label: '+15分钟' },
  { minutes: 60, label: '+1小时' },
];

/** 日期行左侧文案：'11月7日周六'；startAt null（无时间待办）→ null（整行不渲染）。 */
export function describeCardDate(payload: FlashCardPayload, tzid: string): string | null {
  if (payload.startAt === null) return null;
  const parts = getZonedParts(payload.startAt, tzid);
  const weekday = WEEKDAY_LABELS[parts.weekday] ?? '';
  return `${parts.month}月${parts.day}日${weekday}`;
}

/**
 * 卡片日期行完整文案（参考样式 '11月7日周六 | 09:00 - 11:00'）：
 * allDay → '11月7日周六 | 全天'；跨日区间由 formatAgendaTimeRange 给出；
 * startAt null → null（无时间待办不渲染时间行）。
 */
export function describeCardTimeLine(payload: FlashCardPayload, tzid: string): string | null {
  const date = describeCardDate(payload, tzid);
  if (date === null) return null;
  const range = formatAgendaTimeRange(payload, tzid);
  return range === null ? date : `${date} | ${range}`;
}

/**
 * 提醒行渠道标识（切片 23 阶段 3 / §7.35，任务卡验收 2/4）：含 alarm →
 * '⏰' + '闹钟 · 规则摘要'；含 system-notification → '🔔' + '通知 · 规则摘要'；
 * 网络渠道 → '🔔' + 渠道标签。规则摘要（formatReminderRuleSummary）保留，
 * 渠道只是行首标识。reminder null → null（整行不渲染）。
 */
export function describeCardReminderLine(
  reminder: FlashCardReminderSnapshot | null,
): { icon: string; text: string } | null {
  if (reminder === null) return null;
  const summary = formatReminderRuleSummary(reminder);
  if (reminder.channels.includes('alarm')) {
    return { icon: '⏰', text: `闹钟 · ${summary}` };
  }
  if (reminder.channels.includes('system-notification')) {
    return { icon: '🔔', text: `通知 · ${summary}` };
  }
  const labels =
    reminder.channels.length > 0
      ? reminder.channels.map((channel) => REMINDER_CHANNEL_LABELS[channel]).join('、')
      : '通知';
  return { icon: '🔔', text: `${labels} · ${summary}` };
}

interface FlashResultCardProps {
  payload: FlashCardPayload;
  tzid: string;
  /** 卡片主体点击（flash.tsx 接线 router.push('/item/[id]')）。 */
  onPress: () => void;
  /**
   * 快捷推迟回调（阶段 3 接线：更新 startAt 并联动顺延 once 提醒 onceAt，§7.34）；
   * 未传时 chips 呈禁用占位态（阶段 2 不接线）。
   */
  onPostpone?: (minutes: number) => void;
}

export default function FlashResultCard({
  payload,
  tzid,
  onPress,
  onPostpone,
}: FlashResultCardProps) {
  const timeLine = describeCardTimeLine(payload, tzid);
  const reminderLine = describeCardReminderLine(payload.reminder);
  const categoryColor = payload.category?.color ?? FALLBACK_CATEGORY_COLOR;
  const showPostponeChips = payload.startAt !== null && !payload.allDay;
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={[styles.colorBar, { backgroundColor: categoryColor }]} />
      <View style={styles.body}>
        {payload.category !== null ? (
          <View style={styles.categoryRow}>
            {payload.category.emoji !== null ? (
              <Text style={styles.categoryEmoji}>{payload.category.emoji}</Text>
            ) : null}
            <Text style={styles.categoryName}>{payload.category.name}</Text>
          </View>
        ) : null}
        <Text style={styles.title} numberOfLines={2}>
          {payload.title}
        </Text>
        {timeLine !== null ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaIcon}>📅</Text>
            <Text style={styles.metaText} numberOfLines={1}>
              {timeLine}
            </Text>
          </View>
        ) : null}
        {reminderLine !== null ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaIcon}>{reminderLine.icon}</Text>
            <Text style={styles.metaText} numberOfLines={1}>
              {reminderLine.text}
            </Text>
          </View>
        ) : null}
        {showPostponeChips ? (
          <View style={styles.chipRow}>
            {POSTPONE_OPTIONS.map((option) => {
              if (onPostpone === undefined) {
                // 阶段 2 占位：回调未接线时 chips 禁用（样式可见、点击无效果）。
                return (
                  <Pressable
                    key={option.minutes}
                    style={[styles.chip, styles.chipDisabled]}
                    disabled
                  >
                    <Text style={[styles.chipText, styles.chipTextDisabled]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              }
              const postpone = onPostpone;
              return (
                <Pressable
                  key={option.minutes}
                  style={styles.chip}
                  onPress={() => postpone(option.minutes)}
                >
                  <Text style={styles.chipText}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#DDDDDD',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    maxWidth: 320,
  },
  colorBar: {
    width: 4,
  },
  body: {
    flex: 1,
    padding: 12,
    gap: 6,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  categoryEmoji: {
    fontSize: 12,
  },
  categoryName: {
    fontSize: 12,
    color: '#999999',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111111',
    lineHeight: 22,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaIcon: {
    fontSize: 12,
  },
  metaText: {
    fontSize: 13,
    color: '#444444',
    flexShrink: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#CCCCCC',
    borderRadius: 14,
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipText: {
    fontSize: 12,
    color: '#4A90D9',
    fontWeight: '600',
  },
  chipTextDisabled: {
    color: '#999999',
  },
});
