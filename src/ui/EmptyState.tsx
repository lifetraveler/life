import { StyleSheet, Text, View } from 'react-native';

interface EmptyStateProps {
  message: string;
}

/**
 * 空状态提示：纯展示组件（列表无数据、搜索无匹配时使用）。
 */
export default function EmptyState({ message }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  message: {
    color: '#999999',
    fontSize: 13,
  },
});
