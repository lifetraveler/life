import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import EmptyState from '../ui/EmptyState';
import { getLastImportResult } from '../ui/transferResultStore';

/**
 * 导入结果页（切片 8，tasks/slice-08.md 实现要求 4）：
 * - 展示新增 N / 跳过（重复）M / 浮动时间已按设备时区解释 F / 失败 K；
 * - 失败清单可展开，附 VEVENT SUMMARY 与原因（解析失败 + 批量写入失败合并）；
 * - 「查看今日视图」按钮跳 today.tsx。
 * 结果数据来自内存单例（settings 页设置）；直接以 URL 打开本页时显示空态。
 */

export default function ImportResultPage() {
  const router = useRouter();
  const result = getLastImportResult();
  const [failuresExpanded, setFailuresExpanded] = useState(false);

  if (!result) {
    return (
      <View style={styles.emptyContainer}>
        <EmptyState message="没有可展示的导入结果" />
        <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
          <Text style={styles.secondaryText}>返回</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.title}>导入完成</Text>
      {result.fileName ? <Text style={styles.meta}>来源文件：{result.fileName}</Text> : null}

      <View style={styles.statBox}>
        <Text style={styles.statLine}>新增：{result.createdCount} 条</Text>
        <Text style={styles.statLine}>跳过（重复）：{result.skippedDuplicateCount} 条</Text>
        <Text style={styles.statLine}>
          浮动时间已按设备时区解释：{result.floatingCount} 条
        </Text>
        <Text style={[styles.statLine, result.failures.length > 0 && styles.statFailure]}>
          失败：{result.failures.length} 条
        </Text>
      </View>

      {result.failures.length > 0 ? (
        <View style={styles.sectionBox}>
          <Pressable
            hitSlop={8}
            onPress={() => {
              setFailuresExpanded((current) => !current);
            }}
          >
            <Text style={styles.expandToggle}>
              {failuresExpanded ? '收起失败清单 ▲' : '展开失败清单 ▼'}
            </Text>
          </Pressable>
          {failuresExpanded
            ? result.failures.map((failure, index) => (
                <View key={`${failure.summary}-${index}`} style={styles.failureRow}>
                  <Text style={styles.failureSummary}>{failure.summary}</Text>
                  <Text style={styles.failureReason}>{failure.reason}</Text>
                </View>
              ))
            : null}
        </View>
      ) : null}

      <Pressable style={styles.primaryButton} onPress={() => router.replace('/today')}>
        <Text style={styles.primaryText}>查看今日视图</Text>
      </Pressable>
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
  meta: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
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
  statFailure: {
    color: '#c62828',
  },
  sectionBox: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
  },
  expandToggle: {
    fontSize: 13,
    color: '#2563eb',
  },
  failureRow: {
    marginTop: 10,
  },
  failureSummary: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  failureReason: {
    fontSize: 12,
    color: '#c62828',
    marginTop: 2,
  },
  primaryButton: {
    marginTop: 18,
    backgroundColor: '#1e6f5c',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 22,
  },
  primaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryButton: {
    marginTop: 10,
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
