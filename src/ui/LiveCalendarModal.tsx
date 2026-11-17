/**
 * live 日历条目只读弹层（切片 27，AGENTS.md §7.39 / ui.md v0.31）。
 *
 * 点击四视图中的 live 合成条目时弹出：标题 + 时间 + 来源日历 + 备注全文，
 * 底部固定「只读」说明。不提供编辑入口，不跳转 item 详情页（契约措辞）。
 * 纯展示组件：数据经 props 传入（LiveCalendarEntry），关闭由父级置空。
 */

import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Ionicons } from '@expo/vector-icons';

import { contrastTextColor } from './color';
import { formatAgendaTimeRange } from './timeFormat';
import { useTheme } from './theme';
import type { ThemeColors } from './theme';
import type { LiveCalendarEntry } from '../domain/views/liveCalendar';

/** 合法日历色（色条回退约定与 plan.tsx AgendaItemCard 同款校验）。 */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

interface LiveCalendarModalProps {
  /** 当前展示的 live 条目（null = 关闭卸载）。 */
  entry: LiveCalendarEntry | null;
  /** 时间行渲染时区（plan 页 tzid 直传）。 */
  tzid: string;
  onClose: () => void;
}

export default function LiveCalendarModal({ entry, tzid, onClose }: LiveCalendarModalProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (entry === null) {
    return null;
  }

  const stripeColor =
    entry.liveColor !== null && HEX_COLOR_PATTERN.test(entry.liveColor)
      ? entry.liveColor
      : colors.border;
  const onStripe = contrastTextColor(stripeColor) ?? colors.text;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* 全屏遮罩：点击空白处关闭 */}
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* 卡片（阻止点击穿透到遮罩） */}
        <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
          <View style={[styles.header, { backgroundColor: stripeColor }]}>
            <Ionicons name="lock-closed" size={14} color={onStripe} />
            <Text style={[styles.headerTitle, { color: onStripe }]} numberOfLines={2}>
              {entry.title}
            </Text>
          </View>
          <View style={styles.body}>
            {entry.startAt !== null ? (
              <Text style={styles.timeLine}>{formatAgendaTimeRange(entry, tzid)}</Text>
            ) : null}
            {entry.liveSourceName !== null ? (
              <Text style={styles.sourceLine}>来源：{entry.liveSourceName}</Text>
            ) : null}
            {entry.content !== '' ? (
              <Text style={styles.contentText}>{entry.content}</Text>
            ) : null}
            <Text style={styles.readOnlyNotice}>
              只读条目：来自系统日历的实时显示，不提供编辑。
            </Text>
            <Pressable
              style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
              onPress={onClose}
              accessibilityLabel="关闭只读详情"
            >
              <Text style={styles.closeButtonText}>关闭</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      width: '100%',
      borderRadius: 14,
      backgroundColor: c.card,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    headerTitle: {
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
    },
    body: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 8,
    },
    timeLine: {
      fontSize: 13,
      color: c.text,
    },
    sourceLine: {
      fontSize: 12,
      color: c.textMuted,
    },
    contentText: {
      fontSize: 14,
      color: c.text,
      lineHeight: 20,
    },
    readOnlyNotice: {
      fontSize: 12,
      color: c.textMuted,
      marginTop: 4,
    },
    closeButton: {
      alignSelf: 'flex-end',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.background,
    },
    closeButtonPressed: {
      opacity: 0.6,
    },
    closeButtonText: {
      fontSize: 13,
      color: c.text,
    },
  });
}
