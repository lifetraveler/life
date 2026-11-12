import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { itemRepository } from '../data';
import type { ChannelPreset } from '../domain/channelPreset';
import {
  channelPresetSummary,
  matchesChannelPreset,
} from './reminderForm';
import type { ReminderFormValues } from './reminderForm';

/**
 * 渠道预设选择器（切片 17 阶段 2，AGENTS.md §7.27）：
 * webhook / apprise 渠道时展示全局预设下拉，选中即整串复制进表单字段
 * （webhook → channelConfigText=preset.configJson；apprise → 回填 BaseURL/Key），
 * 此后与预设无关联（删除预设不影响已保存提醒）。选中状态为纯 UI 值
 * values.channelPresetId；用户手改配置文本时由外层将其清空（回到「自定义」）。
 *
 * 数据经 itemRepository.listChannelPresets()（Repository 契约内方法），mount 与
 * 重新聚焦（从设置页返回）时刷新；仅展示与当前渠道 type 同型的预设。
 */
interface ChannelPresetPickerProps {
  channel: 'webhook' | 'apprise';
  values: ReminderFormValues;
  onApplyPreset: (preset: ChannelPreset) => void;
  onUseCustom: () => void;
}

export default function ChannelPresetPicker({
  channel,
  values,
  onApplyPreset,
  onUseCustom,
}: ChannelPresetPickerProps) {
  const router = useRouter();
  const [presets, setPresets] = useState<ChannelPreset[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      itemRepository
        .listChannelPresets()
        .then((all) => {
          if (active) {
            setPresets(all.filter((preset) => preset.type === channel));
          }
        })
        .catch(() => {
          if (active) {
            setPresets([]);
          }
        });
      return () => {
        active = false;
      };
    }, [channel]),
  );

  if (presets === null) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" />
      </View>
    );
  }

  const selected = values.channelPresetId !== null
    ? presets.find((preset) => preset.id === values.channelPresetId) ?? null
    : null;
  const hasConfig = channel === 'webhook'
    ? values.channelConfigText.trim().length > 0
    : values.appriseBaseUrl.trim().length > 0;
  const matched = presets.find((preset) => matchesChannelPreset(channel, values, preset)) ?? null;

  // 展示逻辑优先级：显式选中 > 配置恰与某预设一致（视为已关联）> 自定义 > 未选择
  let selectionLabel: string;
  if (selected !== null) {
    selectionLabel = selected.name;
  } else if (matched !== null) {
    selectionLabel = matched.name;
  } else if (hasConfig) {
    selectionLabel = '自定义（未关联预设）';
  } else {
    selectionLabel = '未选择';
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>预设</Text>
      <Pressable style={styles.selector} onPress={() => setExpanded((current) => !current)}>
        <Text style={styles.selectorText} numberOfLines={1} ellipsizeMode="middle">
          {selectionLabel}
        </Text>
        <Text style={styles.chevron}>{expanded ? '▴' : '▾'}</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.optionList}>
          {presets.map((preset) => {
            const isSelected = (selected ?? matched)?.id === preset.id;
            return (
              <Pressable
                key={preset.id}
                style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                onPress={() => {
                  onApplyPreset(preset);
                  setExpanded(false);
                }}
              >
                <View style={styles.optionTextCol}>
                  <Text style={styles.optionName}>{isSelected ? '✓ ' : ''}{preset.name}</Text>
                  <Text style={styles.optionSummary} numberOfLines={1} ellipsizeMode="middle">
                    {channelPresetSummary(preset)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          {hasConfig || selected !== null ? (
            <Pressable
              style={styles.optionRow}
              onPress={() => {
                onUseCustom();
                setExpanded(false);
              }}
            >
              <Text style={styles.optionName}>自定义（不使用预设）</Text>
            </Pressable>
          ) : null}
          {presets.length === 0 ? (
            <Text style={styles.emptyText}>暂无此类预设，可到「我的 → 提醒渠道」创建</Text>
          ) : null}
          <Pressable style={styles.manageRow} onPress={() => router.push('/settings/channels')}>
            <Text style={styles.manageText}>管理预设（去设置页）</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 10,
  },
  label: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
  },
  selectorText: {
    fontSize: 15,
    color: '#111',
    flex: 1,
    marginRight: 8,
  },
  chevron: {
    fontSize: 13,
    color: '#888',
  },
  optionList: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    marginTop: 6,
    backgroundColor: '#fafafa',
  },
  optionRow: {
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  optionRowSelected: {
    backgroundColor: '#e3f2fd',
  },
  optionTextCol: {
    gap: 2,
  },
  optionName: {
    fontSize: 14,
    color: '#111',
  },
  optionSummary: {
    fontSize: 12,
    color: '#888',
  },
  emptyText: {
    fontSize: 12,
    color: '#9e9e9e',
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  manageRow: {
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  manageText: {
    fontSize: 13,
    color: '#1976d2',
  },
  loadingRow: {
    paddingVertical: 10,
    alignItems: 'flex-start',
  },
});
