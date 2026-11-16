import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from './theme';
import type { ThemeColors } from './theme';

interface EmptyStateProps {
  message: string;
}

/**
 * 空状态提示：纯展示组件（列表无数据、搜索无匹配时使用）。
 */
export default function EmptyState({ message }: EmptyStateProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {
      paddingVertical: 24,
      alignItems: 'center',
    },
    message: {
      color: c.textMuted,
      fontSize: 13,
    },
  });
}
