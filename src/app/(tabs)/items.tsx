import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * 事项 Tab 占位页（切片 14 阶段 5，toki_1.webp 底部第 2 入口）：
 * 独立事项视图留给后续切片（AGENTS.md §7.2 一次只做一个切片），本切片仅占位。
 */
export default function ItemsPlaceholderScreen() {
  return (
    <View style={styles.container}>
      <Ionicons name="checkbox-outline" size={48} color="#CCCCCC" />
      <Text style={styles.title}>事项</Text>
      <Text style={styles.hint}>即将上线</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111111',
  },
  hint: {
    fontSize: 13,
    color: '#999999',
  },
});
