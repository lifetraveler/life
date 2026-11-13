import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import ChannelPresetPicker from './ChannelPresetPicker';
import { itemRepository } from '../data';
import {
  isNetworkReminderChannel,
  NETWORK_CHANNEL_BOUNDARY_NOTICE,
  REMINDER_CHANNEL_OPTIONS,
  toggleReminderChannel,
} from './reminderForm';
import type { ReminderFormErrors, ReminderFormValues } from './reminderForm';
import type { ChannelPreset } from '../domain/channelPreset';
import { parseAppriseFormFields } from './reminderForm';

/**
 * 提醒渠道选择与配置输入（切片 16 阶段 3；切片 17 阶段 2 增加预设选择，§7.27；
 * 切片 18 阶段 3 改多选，§7.29）：
 * - 4 个渠道 chip 多选（toggleReminderChannel 保证 ≥1 项 + expo 家族互斥）；
 * - 每个「选中」的网络渠道展开自己的预设下拉 + 配置输入框；选中预设 =
 *   整串值复制（此后与预设无关联），手改配置文本即清空预设关联；
 * - 渠道刚选中且配置为空时自动填充该渠道的默认预设（is_default，§7.29）；
 * - 任一网络渠道选中时恒显灰色边界提示（§7.26 约束 2：UI 必须注明「仅 App 进程存活时保证发送」）；
 * - 校验错误经 errors.channels / errors.channelConfig 展示；切渠道不清空已输入的配置文本。
 */
interface ReminderChannelFieldsProps {
  values: ReminderFormValues;
  errors: ReminderFormErrors;
  onPatch: (next: Partial<ReminderFormValues>) => void;
}

export default function ReminderChannelFields({
  values,
  errors,
  onPatch,
}: ReminderChannelFieldsProps) {
  const hasNetwork = values.channels.some(isNetworkReminderChannel);

  const applyPreset = (preset: ChannelPreset): void => {
    if (preset.type === 'webhook') {
      onPatch({ channelConfigText: preset.configJson, channelPresetId: preset.id });
      return;
    }
    const fields = parseAppriseFormFields(preset.configJson);
    onPatch({
      appriseBaseUrl: fields.baseUrl,
      appriseKey: fields.key,
      channelPresetId: preset.id,
    });
  };

  // 默认预设自动填充（§7.29）：网络渠道从「未选中」变为「选中」且对应配置输入为空时，
  // 拉取该渠道 type 的 is_default 预设应用一次。仅在选中跳变沿触发（ref 记录上一帧选中态），
  // 用户随后清空/手改配置不会被再次覆盖。
  const prevNetworkSelection = useRef<{ webhook: boolean; apprise: boolean }>({
    webhook: values.channels.includes('webhook'),
    apprise: values.channels.includes('apprise'),
  });

  useEffect(() => {
    const selected = {
      webhook: values.channels.includes('webhook'),
      apprise: values.channels.includes('apprise'),
    };
    const previous = prevNetworkSelection.current;
    prevNetworkSelection.current = selected;
    const justSelected = (channel: 'webhook' | 'apprise'): boolean =>
      selected[channel] && !previous[channel];
    const configEmpty = (channel: 'webhook' | 'apprise'): boolean =>
      channel === 'webhook'
        ? values.channelConfigText.trim().length === 0
        : values.appriseBaseUrl.trim().length === 0;
    const targets = (['webhook', 'apprise'] as const).filter(
      (channel) => justSelected(channel) && configEmpty(channel),
    );
    if (targets.length === 0) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const presets = await itemRepository.listChannelPresets();
        if (!active) {
          return;
        }
        for (const channel of targets) {
          const defaultPreset = presets.find(
            (preset) => preset.type === channel && preset.isDefault,
          );
          if (defaultPreset !== undefined) {
            applyPreset(defaultPreset);
          }
        }
      } catch {
        // 预设读取失败不阻断表单（保持空配置，由校验提示必填）
      }
    })();
    return () => {
      active = false;
    };
    // 仅在选中集合变化时评估跳变沿；applyPreset/configEmpty 为纯派生。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.channels]);

  return (
    <View>
      <View style={styles.fieldRow}>
        <Text style={styles.label}>渠道（可多选）</Text>
        {REMINDER_CHANNEL_OPTIONS.map((option) => {
          const selected = values.channels.includes(option.value);
          return (
            <Pressable
              key={option.value}
              style={[styles.segment, selected && styles.segmentSelected]}
              onPress={() =>
                onPatch({ channels: toggleReminderChannel(values.channels, option.value), channelPresetId: null })
              }
            >
              <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {hasNetwork ? <Text style={styles.boundaryNotice}>{NETWORK_CHANNEL_BOUNDARY_NOTICE}</Text> : null}

      {values.channels.includes('webhook') ? (
        <View>
          <ChannelPresetPicker
            channel="webhook"
            values={values}
            onApplyPreset={applyPreset}
            onUseCustom={() => onPatch({ channelPresetId: null })}
          />
          <TextInput
            style={[styles.urlInput, errors.channelConfig && styles.inputError]}
            value={values.channelConfigText}
            onChangeText={(text) => onPatch({ channelConfigText: text, channelPresetId: null })}
            placeholder="Webhook URL（http/https）或配置 JSON（选预设自动填入）"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      ) : null}

      {values.channels.includes('apprise') ? (
        <View>
          <ChannelPresetPicker
            channel="apprise"
            values={values}
            onApplyPreset={applyPreset}
            onUseCustom={() => onPatch({ channelPresetId: null })}
          />
          <TextInput
            style={[styles.urlInput, errors.channelConfig && styles.inputError]}
            value={values.appriseBaseUrl}
            onChangeText={(text) => onPatch({ appriseBaseUrl: text, channelPresetId: null })}
            placeholder="Apprise BaseURL（http/https）"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[styles.urlInput, errors.channelConfig && styles.inputError]}
            value={values.appriseKey}
            onChangeText={(text) => onPatch({ appriseKey: text, channelPresetId: null })}
            placeholder="Apprise Key"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      ) : null}

      {errors.channels ? <Text style={styles.errorText}>{errors.channels}</Text> : null}
      {errors.channelConfig ? <Text style={styles.errorText}>{errors.channelConfig}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  segment: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  segmentSelected: {
    borderColor: '#1976d2',
    backgroundColor: '#e3f2fd',
  },
  segmentText: {
    fontSize: 13,
    color: '#555',
  },
  segmentTextSelected: {
    color: '#1976d2',
    fontWeight: '600',
  },
  label: {
    fontSize: 13,
    color: '#666',
  },
  boundaryNotice: {
    fontSize: 12,
    color: '#9e9e9e',
    marginBottom: 8,
  },
  urlInput: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 15,
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  inputError: {
    borderColor: '#c62828',
  },
  errorText: {
    fontSize: 12,
    color: '#c62828',
    marginBottom: 8,
  },
});
