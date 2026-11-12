import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { Reminder, ReminderFrequency } from '../domain/reminder';
import DateTimeField from './DateTimeField';
import OnceAtField from './OnceAtField';
import ReminderChannelFields from './ReminderChannelFields';
import {
  parseAppriseFormFields,
  validateReminderForm,
  WEEKDAY_OPTIONS,
} from './reminderForm';
import type { ReminderFormValues } from './reminderForm';
import TzPicker from './TzPicker';

/**
 * Reminder 表单（切片 6）：创建与编辑共用（AGENTS.md §4.27）。
 * - 编辑模式传 initial（Reminder），提交回传完整表单值，由父级决定 create/update；
 * - 校验为纯函数 validateReminderForm（与 Repository 归一化规则一致）；
 * - tz 选择器只含白名单两项（§4.25）；
 * - 切片 16 阶段 3：新增 once 频率与渠道选择（ReminderChannelFields 子组件）；
 * - 切片 17 阶段 2（§7.28）：once 触发时刻废弃手输，改 OnceAtField（Picker + 快捷
 *   Chips，civil 值直出按 reminder.tzid 解释）；渠道新增预设下拉（ReminderChannelFields）。
 */
interface ReminderFormProps {
  initial?: Reminder;
  submitLabel: string;
  onSubmit: (values: ReminderFormValues) => void | Promise<void>;
  onCancel: () => void;
}

const FREQUENCY_OPTIONS: ReadonlyArray<{ value: ReminderFrequency; label: string }> = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'once', label: '单次' },
];

/** OnceCivilTime → 'YYYY-MM-DD' 文本（编辑回填用） */
function formatOnceDateParts(year: number, month: number, day: number): string {
  const monthText = String(month).padStart(2, '0');
  const dayText = String(day).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${monthText}-${dayText}`;
}

function initialValues(initial?: Reminder): ReminderFormValues {
  if (initial) {
    const onceAt =
      initial.frequency === 'once' && initial.onceAt !== null
        ? {
            date: formatOnceDateParts(initial.onceAt.year, initial.onceAt.month, initial.onceAt.day),
            hour: initial.onceAt.hour,
            minute: initial.onceAt.minute,
          }
        : { date: '', hour: null, minute: null };
    // 切片 18（提案 §8 阶段 1 机械适配）：表单仍单选，取首个渠道回填；
    // 阶段 3 多选 UI 落地时改为全量 channels 编辑。
    const primaryChannel = initial.channels[0] ?? 'system-notification';
    const appriseFields = initial.channels.includes('apprise')
      ? parseAppriseFormFields(initial.channelConfigs['apprise'] ?? null)
      : { baseUrl: '', key: '' };
    return {
      frequency: initial.frequency,
      localTimeHour: initial.localTimeHour,
      localTimeMinute: initial.localTimeMinute,
      weekdays: [...initial.weekdays],
      dayOfMonth: initial.dayOfMonth > 0 ? initial.dayOfMonth : null,
      onceAt,
      tzid: initial.tzid,
      startAt: initial.startAt,
      enabled: initial.enabled,
      channel: primaryChannel,
      channelConfigText: initial.channels.includes('webhook')
        ? (initial.channelConfigs['webhook'] ?? '')
        : '',
      appriseBaseUrl: appriseFields.baseUrl,
      appriseKey: appriseFields.key,
      channelPresetId: null,
    };
  }
  return {
    frequency: 'daily',
    localTimeHour: 9,
    localTimeMinute: 0,
    weekdays: [],
    dayOfMonth: null,
    onceAt: { date: '', hour: null, minute: null },
    tzid: 'Asia/Shanghai',
    startAt: Date.now(),
    enabled: true,
    channel: 'system-notification',
    channelConfigText: '',
    appriseBaseUrl: '',
    appriseKey: '',
    channelPresetId: null,
  };
}

export default function ReminderForm({ initial, submitLabel, onSubmit, onCancel }: ReminderFormProps) {
  const [values, setValues] = useState<ReminderFormValues>(() => initialValues(initial));
  const [submitting, setSubmitting] = useState(false);

  const errors = useMemo(() => validateReminderForm(values), [values]);
  const hasErrors = Object.keys(errors).length > 0;

  const patch = (next: Partial<ReminderFormValues>): void => {
    setValues((current) => ({ ...current, ...next }));
  };

  const toggleWeekday = (day: number): void => {
    setValues((current) => {
      const selected = current.weekdays.includes(day)
        ? current.weekdays.filter((existing) => existing !== day)
        : [...current.weekdays, day];
      return { ...current, weekdays: selected };
    });
  };

  const handleSubmit = async (): Promise<void> => {
    if (hasErrors || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.form}>
      <View style={styles.fieldRow}>
        {FREQUENCY_OPTIONS.map((option) => {
          const selected = values.frequency === option.value;
          return (
            <Pressable
              key={option.value}
              style={[styles.segment, selected && styles.segmentSelected]}
              onPress={() => patch({ frequency: option.value })}
            >
              <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {values.frequency !== 'once' ? (
        <>
          <View style={styles.fieldRow}>
            <Text style={styles.label}>时间</Text>
            <TextInput
              style={[styles.timeInput, errors.localTime && styles.inputError]}
              value={values.localTimeHour === null ? '' : String(values.localTimeHour)}
              onChangeText={(text) => {
                const hour = Number.parseInt(text, 10);
                patch({ localTimeHour: Number.isNaN(hour) ? null : hour });
              }}
              placeholder="时(0-23)"
              keyboardType="number-pad"
              maxLength={2}
            />
            <Text style={styles.colon}>:</Text>
            <TextInput
              style={[styles.timeInput, errors.localTime && styles.inputError]}
              value={values.localTimeMinute === null ? '' : String(values.localTimeMinute)}
              onChangeText={(text) => {
                const minute = Number.parseInt(text, 10);
                patch({ localTimeMinute: Number.isNaN(minute) ? null : minute });
              }}
              placeholder="分(0-59)"
              keyboardType="number-pad"
              maxLength={2}
            />
          </View>
          {errors.localTime ? <Text style={styles.errorText}>{errors.localTime}</Text> : null}
        </>
      ) : null}

      {values.frequency === 'weekly' ? (
        <>
          <View style={styles.fieldRow}>
            {WEEKDAY_OPTIONS.map((option) => {
              const selected = values.weekdays.includes(option.value);
              return (
                <Pressable
                  key={option.value}
                  style={[styles.weekdayChip, selected && styles.weekdayChipSelected]}
                  onPress={() => toggleWeekday(option.value)}
                >
                  <Text style={[styles.weekdayText, selected && styles.weekdayTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {errors.weekdays ? <Text style={styles.errorText}>{errors.weekdays}</Text> : null}
        </>
      ) : null}

      {values.frequency === 'monthly' ? (
        <>
          <View style={styles.fieldRow}>
            <Text style={styles.label}>每月</Text>
            <TextInput
              style={[styles.timeInput, errors.dayOfMonth && styles.inputError]}
              value={values.dayOfMonth === null ? '' : String(values.dayOfMonth)}
              onChangeText={(text) => {
                const day = Number.parseInt(text, 10);
                patch({ dayOfMonth: Number.isNaN(day) ? null : day });
              }}
              placeholder="1-31"
              keyboardType="number-pad"
              maxLength={2}
            />
            <Text style={styles.label}>日</Text>
          </View>
          {errors.dayOfMonth ? <Text style={styles.errorText}>{errors.dayOfMonth}</Text> : null}
        </>
      ) : null}

      {values.frequency === 'once' ? (
        <OnceAtField
          label="触发时刻"
          value={values.onceAt}
          tzid={values.tzid}
          onChange={(onceAt) => patch({ onceAt })}
          error={errors.onceAt}
        />
      ) : null}

      <ReminderChannelFields values={values} errors={errors} onPatch={patch} />

      <TzPicker value={values.tzid} onChange={(tzid) => patch({ tzid })} />
      {errors.tzid ? <Text style={styles.errorText}>{errors.tzid}</Text> : null}

      <DateTimeField
        label="生效起点"
        value={values.startAt}
        onChange={(startAt) => patch({ startAt })}
        mode="datetime"
      />
      {errors.startAt ? <Text style={styles.errorText}>{errors.startAt}</Text> : null}

      <View style={styles.switchRow}>
        <Text style={styles.label}>启用</Text>
        <Switch value={values.enabled} onValueChange={(enabled) => patch({ enabled })} />
      </View>

      <View style={styles.buttonRow}>
        <Pressable style={[styles.button, styles.secondaryButton]} onPress={onCancel}>
          <Text style={styles.secondaryText}>取消</Text>
        </Pressable>
        <Pressable
          style={[styles.button, (hasErrors || submitting) && styles.buttonDisabled]}
          onPress={() => void handleSubmit()}
        >
          <Text style={styles.primaryText}>{submitting ? '保存中…' : submitLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
  },
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
    fontSize: 14,
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
  colon: {
    fontSize: 15,
    color: '#111',
  },
  timeInput: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    width: 64,
    fontSize: 15,
    backgroundColor: '#fff',
  },
  inputError: {
    borderColor: '#c62828',
  },
  weekdayChip: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
  },
  weekdayChipSelected: {
    borderColor: '#1976d2',
    backgroundColor: '#e3f2fd',
  },
  weekdayText: {
    fontSize: 13,
    color: '#555',
  },
  weekdayTextSelected: {
    color: '#1976d2',
    fontWeight: '600',
  },
  errorText: {
    fontSize: 12,
    color: '#c62828',
    marginBottom: 8,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  button: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 9,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  secondaryButton: {
    borderColor: '#d0d0d0',
    backgroundColor: '#fff',
  },
  secondaryText: {
    fontSize: 14,
    color: '#555',
  },
  primaryText: {
    fontSize: 14,
    color: '#1976d2',
    fontWeight: '600',
  },
});
