import { useState } from 'react';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatItemDate, formatItemTime, getDeviceTzid } from './timeFormat';

/**
 * 日期/时间选择字段（切片 6，AGENTS.md §4.30 允许的选择器依赖）。
 *
 * Android 上的交互为两步：先选日期（或直接选时间），完成后关闭。
 * - mode 'datetime'：先日期后时间；'date' / 'time'：单步。
 * - value 为 null 时显示占位文本；选择后回传绝对毫秒时间戳。
 * - 展示格式按设备当前 IANA 时区（§4.27 与详情页一致）。
 */
interface DateTimeFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  mode?: 'date' | 'time' | 'datetime';
  /** null 时点开的默认值 */
  fallback?: number;
}

type PickerStep = 'idle' | 'date' | 'time';

export default function DateTimeField({
  label,
  value,
  onChange,
  mode = 'datetime',
  fallback = Date.now(),
}: DateTimeFieldProps) {
  const [step, setStep] = useState<PickerStep>('idle');
  const [pickedDate, setPickedDate] = useState<Date | null>(null);
  const deviceTzid = getDeviceTzid();

  const display =
    value === null
      ? '未设置'
      : mode === 'date'
        ? formatItemDate(value, deviceTzid)
        : formatItemTime(value, deviceTzid);

  const startPicking = (): void => {
    setPickedDate(null);
    setStep(mode === 'time' ? 'time' : 'date');
  };

  const handleDate = (event: DateTimePickerEvent, date?: Date): void => {
    if (event.type !== 'set' || !date) {
      setStep('idle');
      return;
    }
    if (mode === 'date') {
      onChange(date.getTime());
      setStep('idle');
      return;
    }
    setPickedDate(date);
    setStep('time');
  };

  const handleTime = (event: DateTimePickerEvent, time?: Date): void => {
    setStep('idle');
    if (event.type !== 'set' || !time) {
      return;
    }
    const base = pickedDate ?? new Date(fallback);
    const combined = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate(),
      time.getHours(),
      time.getMinutes(),
      0,
      0,
    );
    onChange(combined.getTime());
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueRow}>
        <Pressable style={styles.valueButton} onPress={startPicking}>
          <Text style={value === null ? styles.valuePlaceholder : styles.valueText}>{display}</Text>
        </Pressable>
        {value !== null ? (
          <Pressable hitSlop={8} onPress={() => onChange(null)}>
            <Text style={styles.clearText}>清除</Text>
          </Pressable>
        ) : null}
      </View>
      {step === 'date' ? (
        <DateTimePicker
          value={value !== null ? new Date(value) : new Date(fallback)}
          mode="date"
          display="default"
          onChange={handleDate}
        />
      ) : null}
      {step === 'time' ? (
        <DateTimePicker
          value={pickedDate ?? new Date(fallback)}
          mode="time"
          is24Hour
          display="default"
          onChange={handleTime}
        />
      ) : null}
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
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  valueButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
  },
  valueText: {
    fontSize: 15,
    color: '#111',
  },
  valuePlaceholder: {
    fontSize: 15,
    color: '#999',
  },
  clearText: {
    fontSize: 13,
    color: '#c62828',
  },
});
