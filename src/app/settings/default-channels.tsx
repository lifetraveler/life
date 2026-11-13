import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { itemRepository } from '../../data';
import type { ReminderChannel } from '../../domain/reminder';
import {
  isNetworkReminderChannel,
  NETWORK_CHANNEL_BOUNDARY_NOTICE,
  REMINDER_CHANNEL_OPTIONS,
  toggleReminderChannel,
} from '../../ui/reminderForm';

/**
 * 默认提醒方式设置页（切片 19 阶段 3，AGENTS.md §7.30 第二条）：
 * 新建提醒表单初始勾选的渠道集合（app_settings.defaultChannels，schema v11）。
 * 类似提醒表单的渠道多选，但只选类型、不填配置（任务卡阶段 3）：
 * - 切换复用 toggleReminderChannel（≥1 项 + expo 家族互斥，与表单同一交互纪律）；
 * - 保存走 updateSettings({ defaultChannels })，写路径 validateDefaultChannels
 *   抛错时展示具体文案、不落库（读宽松、写严格）。
 */
export default function DefaultChannelsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ReminderChannel[]>(['system-notification']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      itemRepository
        .getSettings()
        .then((settings) => {
          if (!active) {
            return;
          }
          setSelected([...settings.defaultChannels]);
          setError(null);
        })
        .catch((err) => {
          console.warn('[slice-19] 默认渠道读取失败', err);
          if (active) {
            setError(`读取失败：${String(err)}`);
          }
        })
        .finally(() => {
          if (active) {
            setLoading(false);
          }
        });
      return () => {
        active = false;
      };
    }, []),
  );

  const toggle = (channel: ReminderChannel): void => {
    setSelected((current) => toggleReminderChannel(current, channel));
    setSaved(false);
  };

  const handleSave = async (): Promise<void> => {
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      await itemRepository.updateSettings({ defaultChannels: selected });
      setError(null);
      setSaved(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[slice-19] 默认渠道保存失败', err);
      setError(`保存失败：${message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.hint}>
        新建提醒时表单默认勾选的渠道。系统通知与闹钟二选一（同属本地通知通道）；
        {NETWORK_CHANNEL_BOUNDARY_NOTICE}。
      </Text>

      <View style={styles.chipRow}>
        {REMINDER_CHANNEL_OPTIONS.map((option) => {
          const isSelected = selected.includes(option.value);
          return (
            <Pressable
              key={option.value}
              style={[styles.chip, isSelected && styles.chipSelected]}
              onPress={() => toggle(option.value)}
            >
              <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.meta}>
        当前：{selected.map((channel) => REMINDER_CHANNEL_OPTIONS.find((option) => option.value === channel)?.label ?? channel).join('、')}
      </Text>

      <Pressable style={styles.saveButton} disabled={saving} onPress={() => void handleSave()}>
        <Text style={styles.saveText}>{saving ? '保存中…' : '保存'}</Text>
      </Pressable>
      {saved ? <Text style={styles.savedText}>已保存</Text> : null}
      {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    fontSize: 12,
    color: '#888',
    lineHeight: 18,
    marginBottom: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  chipSelected: {
    borderColor: '#1976d2',
    backgroundColor: '#e3f2fd',
  },
  chipText: {
    fontSize: 13,
    color: '#555',
  },
  chipTextSelected: {
    color: '#1976d2',
    fontWeight: '600',
  },
  meta: {
    fontSize: 12,
    color: '#888',
    marginBottom: 12,
  },
  saveButton: {
    backgroundColor: '#1e6f5c',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  savedText: {
    fontSize: 12,
    color: '#1e6f5c',
    marginTop: 8,
  },
  errorText: {
    fontSize: 12,
    color: '#c62828',
    marginTop: 8,
  },
});
