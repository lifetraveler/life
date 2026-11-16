import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../ui/theme';
import type { ThemeColors } from '../../ui/theme';

/**
 * 事项 Tab 占位页（切片 14 阶段 5，toki_1.webp 底部第 2 入口）：
 * 独立事项视图留给后续切片（AGENTS.md §7.2 一次只做一个切片），本切片仅占位。
 */
export default function ItemsPlaceholderScreen() {
  // 切片 24（§7.36）：颜色走全局 Token（夜间模式），深浅色跟随系统。
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <Ionicons name="checkbox-outline" size={48} color={colors.textMuted} />
      <Text style={styles.title}>事项</Text>
      <Text style={styles.hint}>即将上线</Text>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.background,
      gap: 8,
    },
    title: {
      fontSize: 18,
      fontWeight: '600',
      color: c.text,
    },
    hint: {
      fontSize: 13,
      color: c.textMuted,
    },
  });
}
