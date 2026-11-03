import { Pressable, StyleSheet, Text, View } from 'react-native';

import { REMINDER_TZ_OPTIONS } from './reminderForm';

/**
 * Reminder 时区选择器（切片 6，AGENTS.md §4.25）：
 * 只展示白名单两项（Asia/Shanghai / America/New_York），单选。
 * UI 侧同样不允许出现白名单外选项；Repository 仍有最终校验。
 */
interface TzPickerProps {
  value: string;
  onChange: (tzid: string) => void;
}

export default function TzPicker({ value, onChange }: TzPickerProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>时区</Text>
      <View style={styles.row}>
        {REMINDER_TZ_OPTIONS.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              style={[styles.option, selected && styles.optionSelected]}
              onPress={() => onChange(option.value)}
            >
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    marginBottom: 10,
  },
  label: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  option: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  optionSelected: {
    borderColor: '#1976d2',
    backgroundColor: '#e3f2fd',
  },
  optionText: {
    fontSize: 13,
    color: '#555',
  },
  optionTextSelected: {
    color: '#1976d2',
    fontWeight: '600',
  },
});
