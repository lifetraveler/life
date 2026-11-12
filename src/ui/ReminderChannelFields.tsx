import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import ChannelPresetPicker from './ChannelPresetPicker';
import {
  isNetworkReminderChannel,
  NETWORK_CHANNEL_BOUNDARY_NOTICE,
  REMINDER_CHANNEL_OPTIONS,
} from './reminderForm';
import type { ReminderFormErrors, ReminderFormValues } from './reminderForm';
import type { ChannelPreset } from '../domain/channelPreset';
import { parseAppriseFormFields } from './reminderForm';

/**
 * 提醒渠道选择与配置输入（切片 16 阶段 3；切片 17 阶段 2 增加预设选择，§7.27）：
 * - 4 个渠道 chip（system-notification / alarm / webhook / apprise）；
 * - webhook / apprise → ChannelPresetPicker 预设下拉 + 配置输入框；选中预设 =
 *   整串值复制（此后与预设无关联），手改配置文本即清空预设关联；
 * - 选中网络渠道时恒显灰色边界提示（§7.26 约束 2：UI 必须注明「仅 App 进程存活时保证发送」）；
 * - 校验错误经 errors.channelConfig 展示；切渠道不清空已输入的配置文本，但清空预设关联。
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
  const isNetwork = isNetworkReminderChannel(values.channel);

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

  return (
    <View>
      <View style={styles.fieldRow}>
        <Text style={styles.label}>渠道</Text>
        {REMINDER_CHANNEL_OPTIONS.map((option) => {
          const selected = values.channel === option.value;
          return (
            <Pressable
              key={option.value}
              style={[styles.segment, selected && styles.segmentSelected]}
              onPress={() => onPatch({ channel: option.value, channelPresetId: null })}
            >
              <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {isNetwork ? <Text style={styles.boundaryNotice}>{NETWORK_CHANNEL_BOUNDARY_NOTICE}</Text> : null}

      {values.channel === 'webhook' ? (
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
            placeholder="Webhook URL（http/https）"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      ) : null}

      {values.channel === 'apprise' ? (
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
