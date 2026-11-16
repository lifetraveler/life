import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { REMINDER_TZ_OPTIONS } from './reminderForm';
import { useTheme } from './theme';
import type { ThemeColors } from './theme';

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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
              <Text
                style={[styles.optionText, selected && styles.optionTextSelected]}
                numberOfLines={1}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    field: {
      marginBottom: 10,
    },
    label: {
      fontSize: 13,
      color: c.textMuted,
      marginBottom: 4,
    },
    row: {
      flexDirection: 'row',
      gap: 8,
      flexWrap: 'wrap',
    },
    option: {
      // 切片 21（AGENTS.md §7.32）：自适应宽度，大字体下不折行（行容器补 flexWrap 兜底）。
      flexGrow: 0,
      flexShrink: 1,
      minWidth: 88,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 6,
      paddingVertical: 8,
      paddingHorizontal: 10,
      backgroundColor: c.card,
      alignItems: 'center',
    },
    optionSelected: {
      borderColor: c.primary,
      backgroundColor: c.card,
    },
    optionText: {
      fontSize: 13,
      color: c.textMuted,
    },
    optionTextSelected: {
      color: c.primary,
      fontWeight: '600',
    },
  });
}
