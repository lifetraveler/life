/**
 * 认真模式确认卡片（tasks/slice-25.md 阶段 2；AGENTS.md §7.37）。
 *
 * 拦截轮的 assistant 消息呈现（kind:'confirm'，载荷 FlashConfirmPayload）：
 * 「修改需要确认」标题 + 拟改字段摘要行（标题/内容 旧→新）+ 「应用修改/
 * 放弃修改」chips。选项点击本地处理（useFlashChat.applyConfirm /
 * dismissConfirm），不发起 AI 轮次；title 与 content 同轮双改由载荷携带两行
 * 摘要合并为同一条确认消息。
 *
 * 纪律：
 * - 纯展示组件：载荷结构与回调全部由 flash.tsx 屏幕层接线（§7.23 同
 *   FlashResultCard 先例，导航/数据不入组件）；
 * - busy（AI 轮次进行中）时 chips 禁用，防与新轮次交错；resolved（已应用/
 *   已放弃/已被新输入取消）后 chips 隐藏，消息保留摘要供回看；
 * - 样式复用 FlashResultCard 设计语言（白卡 hairline 描边 colors.border、
 *   chip flexWrap 自适应宽 §7.32），颜色全部走 Token（§7.36，禁硬编码色）。
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { FlashConfirmPayload } from './useFlashChat';
import { useTheme } from './theme';
import type { ThemeColors } from './theme';

interface FlashConfirmCardProps {
  payload: FlashConfirmPayload;
  /** AI 轮次进行中（busy）时 chips 禁用。 */
  disabled?: boolean;
  /** 应用修改：提交拦截轮缓冲的草稿与 history（本地处理，不发起 AI 轮次）。 */
  onApply: () => void;
  /** 放弃修改：草稿与 history 均不动。 */
  onDismiss: () => void;
}

/** 摘要行的空值显示（旧/新值可为空串，直接显示会只剩箭头）。 */
function describeConfirmValue(value: string): string {
  return value.trim().length > 0 ? value : '（空）';
}

export default function FlashConfirmCard({
  payload,
  disabled = false,
  onApply,
  onDismiss,
}: FlashConfirmCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // 载荷先捕获局部 const 再进闭包（FlashResultCard 先例：属性窄化不入闭包）。
  const confirmId = payload.confirmId;
  const changes = payload.changes;
  const resolved = payload.resolved === true;
  const apply = onApply;
  const dismiss = onDismiss;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>修改需要确认</Text>
      {changes.map((change) => (
        <View key={`${confirmId}-${change.field}`} style={styles.changeRow}>
          <Text style={styles.changeLabel}>{change.label}</Text>
          <Text style={styles.changeText}>
            {describeConfirmValue(change.from)} → {describeConfirmValue(change.to)}
          </Text>
        </View>
      ))}
      {!resolved ? (
        <View style={styles.chipRow}>
          <Pressable
            style={[styles.chip, disabled ? styles.chipDisabled : null]}
            onPress={apply}
            disabled={disabled}
          >
            <Text style={[styles.chipText, disabled ? styles.chipTextDisabled : null]}>
              应用修改
            </Text>
          </Pressable>
          <Pressable
            style={[styles.chip, disabled ? styles.chipDisabled : null]}
            onPress={dismiss}
            disabled={disabled}
          >
            <Text style={[styles.chipText, disabled ? styles.chipTextDisabled : null]}>
              放弃修改
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
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
      padding: 12,
      gap: 6,
    },
    title: {
      fontSize: 15,
      fontWeight: '700',
      color: c.text,
    },
    changeRow: {
      gap: 2,
    },
    changeLabel: {
      fontSize: 12,
      color: c.textMuted,
    },
    changeText: {
      fontSize: 13,
      color: c.text,
      lineHeight: 18,
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
  });
}
