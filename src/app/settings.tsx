import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

import { itemRepository } from '../data';
import { serializeExportData } from '../domain/export';
import { buildIcs } from '../domain/ics/buildIcs';
import { parseIcs } from '../domain/ics/parseIcs';
import type { TagDisplayMode } from '../domain/settings';
import { reminderScheduler } from '../notifications';
import TagChip from '../ui/TagChip';
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
 * - 导出 JSON（切片 12，tasks/slice-12.md 实现要求 3）：默认列表 ∪ 归档列表 + 全库
 *   Reminder → serializeExportData → 写入 cache 目录 → Sharing 分享；成功/失败
 *   页内提示（不用 Alert），导出路径纯只读、不触发 reconcile；
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

/** 标签展示样式选项（§7.22 tagDisplayMode；切片 14 阶段 3 验收 7） */
const TAG_DISPLAY_OPTIONS: ReadonlyArray<{ value: TagDisplayMode; label: string }> = [
  { value: 'text', label: '纯文字' },
  { value: 'emoji', label: '仅表情' },
  { value: 'both', label: '表情 + 文字' },
];

/** 单选行的效果示例标签（固定样例数据，非数据库记录） */
const SAMPLE_TAG = { name: '示例', color: '#64B5F6', emoji: '💼' };

export default function SettingsPage() {
  const router = useRouter();
  const [busy, setBusy] = useState<'import' | 'export' | null>(null);
  // 切片 12：JSON 导出的页内结果提示（成功/失败都不用 Alert，任务卡实现要求 3）。
  const [exportJsonResult, setExportJsonResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // 切片 14 阶段 3：全局标签展示样式（app_settings.tagDisplayMode）。
  // null = 尚未加载完成；切换为乐观更新，失败回滚并页内提示（不用 Alert）。
  const [displayMode, setDisplayMode] = useState<TagDisplayMode | null>(null);
  const [modeSaving, setModeSaving] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      itemRepository
        .getSettings()
        .then((settings) => {
          if (!cancelled) {
            setDisplayMode(settings.tagDisplayMode);
          }
        })
        .catch((error: unknown) => {
          console.warn('[slice-14] 读取标签展示样式失败', error);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const handleModeChange = useCallback(
    async (mode: TagDisplayMode): Promise<void> => {
      if (modeSaving || displayMode === null || mode === displayMode) {
        return;
      }
      const previous = displayMode;
      setDisplayMode(mode);
      setModeSaving(true);
      try {
        await itemRepository.updateSettings({ tagDisplayMode: mode });
        setModeError(null);
      } catch (error) {
        console.warn('[slice-14] 标签展示样式保存失败', error);
        setDisplayMode(previous);
        setModeError('保存失败，请重试');
      } finally {
        setModeSaving(false);
      }
    },
    [modeSaving, displayMode],
  );

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

  // 切片 12 JSON 导出（tasks/slice-12.md 实现要求 3）：范围=默认列表 ∪ 归档列表
  // （决策 B，含 archived/done），提醒=全库（决策 A-1）；序列化纯函数在
  // src/domain/export.ts。与 ICS 导出共用 busy='export'；不触发 reconcile。
  const handleExportJson = useCallback(async (): Promise<void> => {
    if (busy !== null) {
      return;
    }
    setBusy('export');
    setExportJsonResult(null);
    try {
      const [defaultItems, archivedItems, allReminders] = await Promise.all([
        itemRepository.listItemsWithTags(),
        itemRepository.listArchivedItemsWithTags(),
        itemRepository.listAllReminders(),
      ]);
      const json = serializeExportData(
        [...defaultItems, ...archivedItems],
        allReminders,
      );
      const now = Date.now();
      const fileName = `life-export-${exportFileStamp(now)}.json`;
      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(fileUri, json, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const count = defaultItems.length + archivedItems.length;
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/json',
          dialogTitle: '分享 JSON 导出文件',
        });
        setExportJsonResult({
          ok: true,
          text: `导出成功：${fileName}（${count} 条，已打开分享面板）`,
        });
      } else {
        setExportJsonResult({
          ok: true,
          text: `导出成功：${fileName}（${count} 条，文件位于 ${fileUri}）`,
        });
      }
    } catch (error) {
      console.warn('[slice-12] JSON 导出失败', error);
      setExportJsonResult({ ok: false, text: '导出失败，请重试' });
    } finally {
      setBusy(null);
    }
  }, [busy]);

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>分类与标签</Text>
        <Text style={styles.hint}>自定义预置分类与标签的颜色、图标。</Text>
        <Pressable style={styles.navRow} onPress={() => router.push('/settings/categories')}>
          <Text style={styles.navLabel}>分类管理</Text>
          <Text style={styles.navChevron}>›</Text>
        </Pressable>
        <Pressable style={styles.navRow} onPress={() => router.push('/settings/tags')}>
          <Text style={styles.navLabel}>标签管理</Text>
          <Text style={styles.navChevron}>›</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>标签展示样式</Text>
        <Text style={styles.hint}>影响列表、详情、编辑等页面的标签显示方式。</Text>
        {TAG_DISPLAY_OPTIONS.map((option) => {
          const selected = displayMode === option.value;
          return (
            <Pressable
              key={option.value}
              style={styles.radioRow}
              onPress={() => {
                void handleModeChange(option.value);
              }}
              disabled={displayMode === null || modeSaving}
            >
              <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
                {selected ? <View style={styles.radioInner} /> : null}
              </View>
              <Text style={styles.radioLabel}>{option.label}</Text>
              <TagChip tag={SAMPLE_TAG} mode={option.value} />
            </Pressable>
          );
        })}
        {modeError !== null ? <Text style={styles.errorHint}>{modeError}</Text> : null}
      </View>

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

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>导出 JSON</Text>
        <Text style={styles.hint}>
          导出全部条目（含已完成与已归档）及其标签、提醒规则为 JSON 文件，可通过系统分享面板发送或保存。
        </Text>
        <Pressable
          style={[styles.primaryButton, busy !== null && styles.disabled]}
          onPress={() => {
            void handleExportJson();
          }}
          disabled={busy !== null}
        >
          {busy === 'export' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>导出 JSON</Text>
          )}
        </Pressable>
        {exportJsonResult !== null && (
          <Text style={exportJsonResult.ok ? styles.hint : styles.errorHint}>
            {exportJsonResult.text}
          </Text>
        )}
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
  errorHint: {
    fontSize: 12,
    color: '#b00020',
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
  // —— 切片 14 阶段 3：分类/标签导航行与标签展示样式单选 ——
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#f0f0f0',
  },
  navLabel: {
    fontSize: 14,
    color: '#333',
  },
  navChevron: {
    fontSize: 16,
    color: '#bbb',
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#bbb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterActive: {
    borderColor: '#1e6f5c',
  },
  radioInner: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#1e6f5c',
  },
  radioLabel: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
});
