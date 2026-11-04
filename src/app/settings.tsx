import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

import { itemRepository } from '../data';
import { buildIcs } from '../domain/ics/buildIcs';
import { parseIcs } from '../domain/ics/parseIcs';
import { reminderScheduler } from '../notifications';
import { getDeviceTzid } from '../ui/timeFormat';
import {
  setLastExportResult,
  setLastImportResult,
} from '../ui/transferResultStore';

/**
 * 设置页（切片 8/9，tasks/slice-08.md 实现要求 4/5、tasks/slice-09.md 实现要求 3）：
 * - 导入 ICS：DocumentPicker 选文件 → parseIcs → importItemsInBatches → 结果页；
 *   导入完成后 fire-and-forget 触发一次 reconcile()（失败不阻断结果页）；
 * - 导出 ICS：listItemsForExport → buildIcs → 写入 cache 目录 → Sharing 分享 → 成功页；
 * - 系统日历（切片 9）：纯导航入口 → /system-calendar-import（权限/选择/结果都在该页内）；
 * - 主页不放导入/导出入口（任务卡明确要求入口只在设置页）。
 */

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 导出文件名时间戳（设备本地时间）：YYYYMMDD-HHmmss */
function exportFileStamp(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(
    d.getHours(),
  )}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

export default function SettingsPage() {
  const router = useRouter();
  const [busy, setBusy] = useState<'import' | 'export' | null>(null);

  const handleImport = useCallback(async (): Promise<void> => {
    if (busy !== null) {
      return;
    }
    setBusy('import');
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        // .ics 在不同设备上可能映射为 text/calendar 或 application/octet-stream，放宽为任意类型
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (picked.canceled) {
        return;
      }
      const asset = picked.assets[0];
      if (!asset) {
        return;
      }
      const text = await FileSystem.readAsStringAsync(asset.uri);
      const parsed = parseIcs(text, getDeviceTzid());
      const batch = await itemRepository.importItemsInBatches(
        parsed.events.map((event) => event.input),
      );
      setLastImportResult({
        createdCount: batch.createdCount,
        skippedDuplicateCount: batch.skippedDuplicateCount,
        floatingCount: parsed.events.filter((event) => event.floating).length,
        failures: [
          ...parsed.failures,
          ...batch.failures.map((failure) => ({
            summary: failure.title,
            reason: failure.reason,
          })),
        ],
        fileName: asset.name ?? null,
      });
      // 任务卡实现要求 4：导入完成后触发一次 reconcile()；fire-and-forget，失败不阻断结果页。
      void reminderScheduler
        .reconcile()
        .catch((error: unknown) => {
          console.warn('[slice-08] 导入后 reconcile 失败', error);
        });
      router.push('/import-result');
    } catch (error) {
      console.warn('[slice-08] 导入失败', error);
      Alert.alert('导入失败', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [busy, router]);

  const handleExport = useCallback(async (): Promise<void> => {
    if (busy !== null) {
      return;
    }
    setBusy('export');
    try {
      const items = await itemRepository.listItemsForExport({
        includeArchived: false,
        includeDone: true,
      });
      const now = Date.now();
      const ics = buildIcs(items, { tzid: getDeviceTzid(), now });
      const fileName = `life-export-${exportFileStamp(now)}.ics`;
      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(fileUri, ics, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      let shared = false;
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/calendar',
          dialogTitle: '分享 ICS 导出文件',
        });
        shared = true;
      }
      setLastExportResult({ count: items.length, fileName, fileUri, shared });
      router.push('/export-success');
    } catch (error) {
      console.warn('[slice-08] 导出失败', error);
      Alert.alert('导出失败', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [busy, router]);

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>导入</Text>
        <Text style={styles.hint}>
          选择一个 .ics 文件（如 Google Calendar 导出）。重复 UID 自动去重；只读项可在详情页删除本地副本。
        </Text>
        <Pressable
          style={[styles.primaryButton, busy !== null && styles.disabled]}
          onPress={() => {
            void handleImport();
          }}
          disabled={busy !== null}
        >
          {busy === 'import' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>导入 ICS</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>系统日历</Text>
        <Text style={styles.hint}>
          单向导入 Android 系统日历事件到本地（只读来源，不写回系统日历）。
        </Text>
        <Pressable style={styles.primaryButton} onPress={() => router.push('/system-calendar-import')}>
          <Text style={styles.primaryText}>导入系统日历</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>导出</Text>
        <Text style={styles.hint}>
          导出当前全部未归档条目（含已完成）为 ICS 文件，可通过系统分享面板发送或保存。
        </Text>
        <Pressable
          style={[styles.primaryButton, busy !== null && styles.disabled]}
          onPress={() => {
            void handleExport();
          }}
          disabled={busy !== null}
        >
          {busy === 'export' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>导出 ICS</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
    gap: 20,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
  },
  hint: {
    fontSize: 12,
    color: '#888',
    lineHeight: 18,
  },
  primaryButton: {
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
  disabled: {
    opacity: 0.5,
  },
});
