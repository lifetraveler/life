import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import EmptyState from '../ui/EmptyState';
import { getLastExportResult } from '../ui/transferResultStore';

/**
 * 导出成功页（切片 8，tasks/slice-08.md 实现要求 5）：
 * 展示导出条数与文件保存位置；结果数据来自内存单例（settings 页设置），
 * 直接以 URL 打开本页时显示空态。
 */

export default function ExportSuccessPage() {
  const router = useRouter();
  const result = getLastExportResult();

  if (!result) {
    return (
      <View style={styles.emptyContainer}>
        <EmptyState message="没有可展示的导出结果" />
        <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
          <Text style={styles.secondaryText}>返回</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.title}>导出完成</Text>

      <View style={styles.statBox}>
        <Text style={styles.statLine}>成功导出：{result.count} 条</Text>
        <Text style={styles.statLine}>文件名：{result.fileName}</Text>
        <Text style={styles.fileUri} selectable>
          保存位置：{result.fileUri}
        </Text>
        <Text style={styles.meta}>
          {result.shared
            ? '已唤起系统分享面板，可选择发送或保存到其他应用。'
            : '文件已写入应用缓存目录（本机未提供分享面板）。'}
        </Text>
      </View>

      <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
        <Text style={styles.secondaryText}>返回设置</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    padding: 16,
    paddingBottom: 32,
  },
  emptyContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
  },
  statBox: {
    marginTop: 14,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    gap: 6,
  },
  statLine: {
    fontSize: 14,
    color: '#333',
  },
  fileUri: {
    fontSize: 12,
    color: '#555',
  },
  meta: {
    fontSize: 12,
    color: '#888',
    lineHeight: 18,
  },
  secondaryButton: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  secondaryText: {
    fontSize: 13,
    color: '#555',
  },
});
