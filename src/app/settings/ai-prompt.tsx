import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AI_SYSTEM_PROMPT } from '../../domain/ai/prompt';
import { useTheme } from '../../ui/theme';
import type { ThemeColors } from '../../ui/theme';

/**
 * AI 提示词只读查看页（切片 26 阶段 2，AGENTS.md §7.38）。
 *
 * 契约边界：
 * - 展示 `AI_SYSTEM_PROMPT` 静态规则串（src/domain/ai/prompt.ts）；
 * - 动态拼接部分（当前时间事实、多轮上下文摘要，buildSystemPrompt 运行时
 *   追加）不在此页展示，页面顶部以 hint 注明；
 * - 只读：不提供编辑/复制/导出（无 TextInput、无 Clipboard、无分享）。
 */

const INTRO_TEXT =
  '以下为闪电录入 AI 解析所使用的系统提示词（静态规则部分）。' +
  '解析时还会动态附加当前时间等运行时事实与多轮上下文，那部分不在此展示。';

export default function AiPromptPage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.page}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.hint}>{INTRO_TEXT}</Text>
        <View style={styles.promptBox}>
          <Text style={styles.promptText}>{AI_SYSTEM_PROMPT}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

// 切片 26 阶段 2：颜色全部走 theme token（§7.36 夜间模式规范），无硬编码色值。
const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scroll: {
      flex: 1,
    },
    content: {
      padding: 16,
      gap: 12,
    },
    hint: {
      fontSize: 12,
      lineHeight: 18,
      color: colors.textMuted,
    },
    promptBox: {
      backgroundColor: colors.card,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: 12,
    },
    promptText: {
      fontSize: 12,
      lineHeight: 18,
      color: colors.text,
    },
  });
