import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SystemImportResult } from '../data/ItemRepository';

/**
 * 切片 9：系统日历导入结果展示组件（tasks/slice-09.md 实现要求 4）。
 * 展示：读取总数 / 导入 / 跳过重复 / 跳过本地可编辑冲突 / 失败（可展开）/ 范围外；
 * sourceUid 策略条数分布；content-hash > 0 时按 AGENTS.md §7.15 标注
 * 「基于内容去重，系统事件修改后可能产生重复」。
 * 数字自洽：导入 + 跳过重复 + 冲突 + 失败 + 范围外 = 读取总数。
 */

export default function SystemImportResultView({ result }: { result: SystemImportResult }) {
  const [showFailures, setShowFailures] = useState(false);
  const contentHashBased = result.sourceUidStrategies['content-hash'] > 0;

  return (
    <View style={styles.box}>
      <Text style={styles.title}>导入结果</Text>

      <View style={styles.numberRow}>
        <Text style={styles.numberItem}>读取总数 {result.totalRead}</Text>
        <Text style={styles.numberItem}>范围外 {result.outOfRangeCount}</Text>
      </View>
      <View style={styles.numberRow}>
        <Text style={styles.numberItem}>导入 {result.imported}</Text>
        <Text style={styles.numberItem}>跳过重复 {result.skippedDuplicate}</Text>
      </View>
      <View style={styles.numberRow}>
        <Text style={styles.numberItem}>跳过本地可编辑冲突 {result.skippedReadOnlyConflict}</Text>
        <Text style={styles.numberItem}>失败 {result.failed.length}</Text>
      </View>

      <Text style={styles.strategy}>
        sourceUid 策略：event-id {result.sourceUidStrategies['event-id']} 条 · content-hash{' '}
        {result.sourceUidStrategies['content-hash']} 条
      </Text>
      {contentHashBased ? (
        <Text style={styles.warn}>
          部分事件基于内容去重，系统事件修改后可能产生重复
        </Text>
      ) : null}

      {result.failed.length > 0 ? (
        <View style={styles.failuresBox}>
          <Pressable
            onPress={() => {
              setShowFailures(!showFailures);
            }}
          >
            <Text style={styles.failuresToggle}>
              {showFailures ? '收起失败清单 ▲' : `展开失败清单（${result.failed.length}）▼`}
            </Text>
          </Pressable>
          {showFailures
            ? result.failed.map((failure, index) => (
                <Text key={`${failure.externalId ?? 'null'}-${index}`} style={styles.failureLine}>
                  · {failure.title}
                  {failure.externalId === null ? '' : `（id ${failure.externalId}）`}：{failure.reason}
                </Text>
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    gap: 6,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
  },
  numberRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  numberItem: {
    fontSize: 14,
    color: '#333',
  },
  strategy: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
  },
  warn: {
    fontSize: 12,
    color: '#b26a00',
  },
  failuresBox: {
    marginTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
    paddingTop: 6,
  },
  failuresToggle: {
    fontSize: 13,
    color: '#c62828',
  },
  failureLine: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    lineHeight: 18,
  },
});
