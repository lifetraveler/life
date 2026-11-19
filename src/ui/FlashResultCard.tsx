/**
 * 闪电录入结果卡片（tasks/slice-22.md 阶段 2；AGENTS.md §7.34）。
 *
 * 保存成功后的 assistant 消息呈现（kind:'card'，载荷 FlashCardPayload 结构化
 * 快照）：左侧分类色条（含 Emoji 分类行）+ 粗体标题 + 📅 日期行（含具体时间）
 * + 📝 内容行（content 非空才显示，v0.19 验收反馈修补：机构/医院等细节在卡片
 * 直接可见）+ 提醒行（describeCardReminderLine 现算文案，切片 23 起按渠道展示
 * ⏰ 闹钟 / 🔔 通知标识；once 显示绝对触发时刻，阶段 3 推迟后可见联动变化）。
 *
 * 纪律：
 * - 纯展示组件：点击只发 onPress（导航到 /item/[id] 留在 flash.tsx 屏幕层，
 *   §7.23 UI 不自查数据、导航不入组件）；
 * - 无时间待办（startAt null）不渲染日期行，也不渲染快捷推迟 chips（§7.34
 *   chips 条件=有具体时间非 allDay）；
 * - 快捷推迟 chips（+15分钟/+1小时）本阶段仅禁用占位（onPostpone 未接线），
 *   阶段 3 接线并联动顺延 once 提醒 onceAt；
 * - 样式沿用闪电录入设计语言（白卡 hairline 描边 colors.border、主色 colors.primary），
 *   chip 容器 flexWrap 自适应宽（§7.32 高分屏响应）；
 * - 历史卡样式（切片 29 / AGENTS.md §7.40）：historical=true（聊天列表非最后
 *   一条的 kind:'card' 消息）时整卡降透明度 + 右上角「历史」角标（Token 化），
 *   快捷推迟 chips 保留可用（已保存条目语义仍正确）。角标是 Pressable 的
 *   absolute 子元素（不出现在文本流内、不新增 FlatList 行包裹层——切片 22
 *   教训：行包裹会致 flex:1 body 塌缩 0 宽）。
 * - 已删除联动态（切片 30 / AGENTS.md §7.41 D2）：deleted=true（对应条目已在
 *   详情页删除）时整卡降透明 +「已删除」角标（deleted 优先于 historical）、
 *   点击禁用、chips 整行不渲染；mark/remove 分流由 useFlashChat 承担。
 */

import { useMemo } from 'react';
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
import { useTheme } from './theme';
import type { ThemeColors } from './theme';

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
 * 渠道只是行首标识。切片 32（§7.44）多计划：入参改快照数组，逐条产出一行、
 * 顺序保留；空数组 → []（整块不渲染）。
 */
export function describeCardReminderLines(
  reminders: ReadonlyArray<FlashCardReminderSnapshot>,
): Array<{ icon: string; text: string }> {
  return reminders.map((reminder) => {
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
  });
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
  /**
   * 历史卡样式（切片 29 / AGENTS.md §7.40）：flash.tsx 以「聊天列表最后一条
   * kind:'card' 消息＝当前卡」判定传入——非最后的 card 消息 true。默认 false
   * （当前卡），当前卡不渲染角标、不加额外标识。
   */
  historical?: boolean;
  /**
   * 已删除联动态（切片 30 / AGENTS.md §7.41 D2，默认 false）：对应条目已在
   * 详情页删除（useFocusEffect reconcile 判定）——整卡降透明 +「已删除」角标
   * （与「历史」同位，deleted 优先）、点击禁用、chips 整行不渲染。
   */
  deleted?: boolean;
}

export default function FlashResultCard({
  payload,
  tzid,
  onPress,
  onPostpone,
  historical = false,
  deleted = false,
}: FlashResultCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const timeLine = describeCardTimeLine(payload, tzid);
  // 切片 32（§7.44）多计划：逐条提醒一行，空数组不渲染块。
  const reminderLines = describeCardReminderLines(payload.reminders);
  const categoryColor = payload.category?.color ?? FALLBACK_CATEGORY_COLOR;
  // 切片 30（§7.41 D2）：已删除卡不渲染 chips（chips 语义已无操作对象）；
  // 历史判定保持不变（deleted 与 historical 可同时为 true，角标 deleted 优先）。
  const showPostponeChips = payload.startAt !== null && !payload.allDay && !deleted;
  return (
    <Pressable
      style={[
        styles.card,
        historical || deleted ? styles.cardHistorical : null,
      ]}
      onPress={onPress}
      disabled={deleted}
    >
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
        {/* v0.19 验收反馈修补（切片 23）：内容补充说明行（机构/医院等细节），非空才显示。 */}
        {payload.content.trim().length > 0 ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaIcon}>📝</Text>
            <Text style={styles.metaText} numberOfLines={2}>
              {payload.content}
            </Text>
          </View>
        ) : null}
        {reminderLines.length > 0
          ? reminderLines.map((line, index) => (
              <View key={`${index}-${line.text}`} style={styles.metaRow}>
                <Text style={styles.metaIcon}>{line.icon}</Text>
                <Text style={styles.metaText} numberOfLines={1}>
                  {line.text}
                </Text>
              </View>
            ))
          : null}
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
      {/* 切片 29：历史卡右上角「历史」角标——absolute 定位不占文本流，
          pointerEvents none 不拦截卡片本体点击（触点穿透回 Pressable）。
          切片 30：deleted 优先渲染「已删除」角标（互斥：一卡一右上角标）。 */}
      {deleted ? (
        <View style={styles.historicalBadge} pointerEvents="none">
          <Text style={styles.historicalBadgeText}>已删除</Text>
        </View>
      ) : historical ? (
        <View style={styles.historicalBadge} pointerEvents="none">
          <Text style={styles.historicalBadgeText}>历史</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      backgroundColor: c.card,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      overflow: 'hidden',
      shadowColor: c.border,
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
      color: c.textMuted,
    },
    title: {
      fontSize: 17,
      fontWeight: '700',
      color: c.text,
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
      color: c.text,
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
      borderColor: c.border,
      borderRadius: 14,
      paddingVertical: 4,
      paddingHorizontal: 12,
      backgroundColor: c.card,
    },
    chipDisabled: {
      opacity: 0.5,
    },
    chipText: {
      fontSize: 12,
      color: c.primary,
      fontWeight: '600',
    },
    chipTextDisabled: {
      color: c.textMuted,
    },
    // 切片 29（§7.40）：历史卡整体降透明度（dim 全卡含 chips，仍可点击）+
    // 右上角「历史」角标（Token 化，深浅色两态可读；styles.card 已有
    // overflow hidden，角标 top/right 6 在卡内边界不受裁切影响）。
    cardHistorical: {
      opacity: 0.55,
    },
    historicalBadge: {
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
    historicalBadgeText: {
      fontSize: 10,
      color: c.textMuted,
      fontWeight: '600',
    },
  });
}
