import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { itemRepository } from '../data';
import { reminderScheduler } from '../notifications';
import {
  getLastImportPreview,
  type ImportPreviewData,
} from '../ui/importPreviewStore';
import {
  setLastImportResult,
} from '../ui/transferResultStore';
import { formatItemStart, getDeviceTzid } from '../ui/timeFormat';

/**
 * 导入预览页（切片 17 阶段 2；AGENTS.md §7.28：ICS 与系统日历导入必须先进入
 * 预览页展示解析结果，默认勾选新增项，确认后才落库）。
 *
 * 数据流：选择页（profile.handleImport / system-calendar-import）先调用
 * generateIcsPreview / generateSystemCalendarPreview，把结果写入
 * importPreviewStore 模块单例后 push 本页；本页渲染并让用户勾选，确认时按
 * source 分派批量导入（ics → importItemsInBatches；system-calendar →
 * importSystemCalendarEntries），结果统一写入 transferResultStore 后
 * replace 到既有 /import-result 结果页（reconcile 语义与两条旧导入路径一致：
 * fire-and-forget，失败不阻断结果页）。
 *
 * 勾选规则（§7.28 + repository.md v0.17「预览标记 = 实际落库行为」）：
 * - isDuplicate=true 的条目置灰、不可勾选、默认不选（本地库已存在同 UID）；
 * - 其余条目默认全选，用户可逐条取消。
 */

export default function ImportPreviewPage() {
  const router = useRouter();
  // getLastImportPreview 只在进入本页那一刻读取一次：预览数据在导入过程中
  // 不应变化（store 仅由上一个页面在跳转前写入一次）。
  const [preview] = useState<ImportPreviewData | null>(() => getLastImportPreview());
  const [selected, setSelected] = useState<Set<number>>(() => {
    const data = getLastImportPreview();
    const initial = new Set<number>();
    if (data !== null) {
      data.entries.forEach((entry, index) => {
        if (!entry.isDuplicate) {
          initial.add(index);
        }
      });
    }
    return initial;
  });
  const [confirming, setConfirming] = useState(false);

  const toggleEntry = useCallback(
    (index: number): void => {
      if (preview === null) {
        return;
      }
      if (preview.entries[index]?.isDuplicate === true) {
        return;
      }
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        return next;
      });
    },
    [preview],
  );

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (preview === null || confirming) {
      return;
    }
    const selectedInputs = preview.entries
      .filter((_entry, index) => selected.has(index))
      .map((entry) => entry.input);
    if (selectedInputs.length === 0) {
      return;
    }
    setConfirming(true);
    try {
      const batch =
        preview.source === 'ics'
          ? await itemRepository.importItemsInBatches(selectedInputs)
          : await itemRepository.importSystemCalendarEntries(selectedInputs);
      setLastImportResult({
        createdCount: batch.createdCount,
        skippedDuplicateCount: batch.skippedDuplicateCount,
        floatingCount:
          preview.source === 'ics'
            ? preview.entries.filter((entry, index) => entry.floating && selected.has(index))
                .length
            : 0,
        failures: [
          ...preview.failures,
          ...batch.failures.map((failure) => ({
            summary: failure.title,
            reason: failure.reason,
          })),
        ],
        fileName: preview.fileName,
      });
      // 与两条旧导入路径一致：导入完成后触发一次 reconcile()（fire-and-forget）。
      void reminderScheduler
        .reconcile()
        .catch((error: unknown) => {
          console.warn('[slice-17] 预览确认导入后 reconcile 失败', error);
        });
      router.replace('/import-result');
    } catch (error) {
      console.warn('[slice-17] 预览确认导入失败', error);
      Alert.alert('导入失败', error instanceof Error ? error.message : String(error));
      setConfirming(false);
    }
  }, [preview, confirming, selected, router]);

  if (preview === null) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>没有待预览的导入内容</Text>
        <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
          <Text style={styles.secondaryText}>返回</Text>
        </Pressable>
      </View>
    );
  }

  const duplicateCount = preview.entries.filter((entry) => entry.isDuplicate).length;
  const selectedCount = selected.size;
  const deviceTzid = getDeviceTzid();

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.title}>导入预览</Text>
      <Text style={styles.meta}>
        {preview.source === 'ics'
          ? `来源文件：${preview.fileName ?? '未命名'}`
          : (preview.meta ?? '来源：系统日历')}
      </Text>
      <Text style={styles.hint}>
        {`共 ${preview.entries.length} 条 · 已选 ${selectedCount} 条 · 重复 ${duplicateCount} 条（置灰不可选）。取消勾选的条目不会写入本地库。`}
      </Text>

      {preview.meta !== null && preview.source === 'ics' ? (
        <Text style={styles.meta}>{preview.meta}</Text>
      ) : null}

      {preview.entries.map((entry, index) => {
        const checked = selected.has(index);
        const duplicate = entry.isDuplicate;
        return (
          <Pressable
            key={`${entry.input.sourceUid ?? 'no-uid'}-${index}`}
            style={[styles.entryCard, duplicate && styles.entryCardDuplicate]}
            onPress={() => toggleEntry(index)}
            disabled={duplicate}
          >
            <Text style={[styles.checkbox, duplicate && styles.checkboxDisabled]}>
              {duplicate ? '☐' : checked ? '☑' : '☐'}
            </Text>
            <View style={styles.entryBody}>
              <Text style={[styles.entryTitle, duplicate && styles.entryTitleDuplicate]} numberOfLines={2}>
                {entry.input.title}
              </Text>
              <Text style={styles.entryMeta}>
                {formatItemStart(entry.input.startAt, entry.input.allDay === true, deviceTzid)}
                {entry.floating ? ' · 浮动时间（按设备时区解释）' : ''}
              </Text>
              {duplicate ? (
                <Text style={styles.duplicateNote}>本地库已存在（同来源同 UID），将跳过</Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}

      {preview.sameFileDuplicates.length > 0 ? (
        <View style={styles.sectionBox}>
          <Text style={styles.sectionTitle}>
            {`同文件重复 UID（已排除，共 ${preview.sameFileDuplicates.length} 条）`}
          </Text>
          {preview.sameFileDuplicates.map((item, index) => (
            <Text key={`${item.uid}-${index}`} style={styles.failureReason} numberOfLines={1}>
              {item.summary}
            </Text>
          ))}
        </View>
      ) : null}

      {preview.failures.length > 0 ? (
        <View style={styles.sectionBox}>
          <Text style={styles.sectionTitle}>{`解析失败（${preview.failures.length} 条，不会导入）`}</Text>
          {preview.failures.map((failure, index) => (
            <View key={index} style={styles.failureRow}>
              <Text style={styles.failureSummary} numberOfLines={1}>
                {failure.summary}
              </Text>
              <Text style={styles.failureReason}>{failure.reason}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Pressable
        style={[styles.primaryButton, (selectedCount === 0 || confirming) && styles.disabled]}
        onPress={() => {
          void handleConfirm();
        }}
        disabled={selectedCount === 0 || confirming}
      >
        {confirming ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryText}>{`确认导入（${selectedCount} 条）`}</Text>
        )}
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={() => router.back()} disabled={confirming}>
        <Text style={styles.secondaryText}>返回</Text>
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
    gap: 10,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  emptyTitle: {
    fontSize: 14,
    color: '#888',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
  },
  meta: {
    fontSize: 12,
    color: '#999',
  },
  hint: {
    fontSize: 12,
    color: '#888',
    lineHeight: 18,
  },
  entryCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
  },
  entryCardDuplicate: {
    backgroundColor: '#fafafa',
  },
  checkbox: {
    fontSize: 18,
    color: '#1e6f5c',
    lineHeight: 22,
  },
  checkboxDisabled: {
    color: '#bdbdbd',
  },
  entryBody: {
    flex: 1,
    gap: 2,
  },
  entryTitle: {
    fontSize: 14,
    color: '#111',
  },
  entryTitleDuplicate: {
    color: '#9e9e9e',
  },
  entryMeta: {
    fontSize: 12,
    color: '#888',
  },
  duplicateNote: {
    fontSize: 11,
    color: '#b26a00',
  },
  sectionBox: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111',
  },
  failureRow: {
    gap: 2,
  },
  failureSummary: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  failureReason: {
    fontSize: 12,
    color: '#c62828',
  },
  primaryButton: {
    backgroundColor: '#1e6f5c',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  secondaryText: {
    fontSize: 13,
    color: '#555',
  },
});
