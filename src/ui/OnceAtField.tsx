import { useState } from 'react';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getDeviceTzid } from './timeFormat';
import {
  onceAtPlusOneHour,
  onceAtPlusTenMinutes,
  onceAtTomorrowMorningNine,
} from './onceAtChips';

/**
 * once 触发时刻选择字段（切片 17 阶段 2，AGENTS.md §7.28：废弃手输、必须 Picker + 快捷 Chips）。
 *
 * 交互复刻 DateTimeField 的 Android 两步 step-machine（先日期后时间/单步），但值表示不同：
 * - 表单值为民用五元组的表单形态（date='YYYY-MM-DD' 文本 + hour/minute），
 *   按 reminder.tzid 解释（§4.25），不走设备时区的绝对时刻换算；
 * - 合法性由构造保证：取 picker Date 的本地 getFullYear/getMonth/getDate/getHours/
 *   getMinutes 直接作数值字段写入，不做任何时区换算或字符串解析，
 *   因此 02-30 这类非法民用值在构造上不可能产生；
 * - 编辑旧数据（切片 16 手输时代可能写入非法 civil 值）时原样展示、不转换；
 *   picker 初值仅作滚轮种子（非法日回退为合法日），一碰即被合法值替换。
 */
export interface OnceAtFormValue {
  /** 'YYYY-MM-DD' 文本；'' 表示未设置 */
  date: string;
  hour: number | null;
  minute: number | null;
}

interface OnceAtFieldProps {
  label: string;
  value: OnceAtFormValue;
  /** onceAt 的解释时区（reminder.tzid，非设备时区） */
  tzid: string;
  onChange: (next: OnceAtFormValue) => void;
  error?: string;
}

type PickerStep = 'idle' | 'date' | 'time';

const EMPTY_ONCE_AT: OnceAtFormValue = { date: '', hour: null, minute: null };

/** picker 返回的 Date → 'YYYY-MM-DD'（直接取本地数值字段，无时区换算） */
function formatDateParts(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 民用文本 → picker 滚轮种子 Date（仅本地数值回读；非法日由 Date rollover 兜底为合法日） */
function pickerDateSeed(value: OnceAtFormValue, fallback: Date): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.date.trim());
  if (match === null) {
    return fallback;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export default function OnceAtField({ label, value, tzid, onChange, error }: OnceAtFieldProps) {
  const [step, setStep] = useState<PickerStep>('idle');
  const deviceTzid = getDeviceTzid();
  const now = Date.now();

  const dateDisplay = value.date === '' ? '未设置' : value.date;
  const timeDisplay =
    value.hour === null || value.minute === null
      ? '未设置'
      : `${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`;

  const handleDate = (event: DateTimePickerEvent, date?: Date): void => {
    setStep('idle');
    if (event.type !== 'set' || !date) {
      return;
    }
    onChange({ ...value, date: formatDateParts(date) });
  };

  const handleTime = (event: DateTimePickerEvent, time?: Date): void => {
    setStep('idle');
    if (event.type !== 'set' || !time) {
      return;
    }
    // 直接取滚轮选中的时/分数值（无换算）——合法性由构造保证
    onChange({ ...value, hour: time.getHours(), minute: time.getMinutes() });
  };

  const applyChip = (next: { year: number; month: number; day: number; hour: number; minute: number }): void => {
    onChange({
      date: `${String(next.year).padStart(4, '0')}-${String(next.month).padStart(2, '0')}-${String(next.day).padStart(2, '0')}`,
      hour: next.hour,
      minute: next.minute,
    });
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueRow}>
        <Pressable style={styles.valueButton} onPress={() => setStep('date')}>
          <Text style={value.date === '' ? styles.valuePlaceholder : styles.valueText}>
            {`日期 ${dateDisplay}`}
          </Text>
        </Pressable>
        <Pressable style={styles.valueButton} onPress={() => setStep('time')}>
          <Text
            style={
              value.hour === null || value.minute === null
                ? styles.valuePlaceholder
                : styles.valueText
            }
          >
            {`时间 ${timeDisplay}`}
          </Text>
        </Pressable>
        {value.date !== '' || value.hour !== null || value.minute !== null ? (
          <Pressable hitSlop={8} onPress={() => onChange(EMPTY_ONCE_AT)}>
            <Text style={styles.clearText}>清除</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.chipRow}>
        <Pressable
          style={styles.chip}
          onPress={() => applyChip(onceAtPlusTenMinutes(now, tzid))}
        >
          <Text style={styles.chipText}>+10分钟</Text>
        </Pressable>
        <Pressable
          style={styles.chip}
          onPress={() => applyChip(onceAtPlusOneHour(now, tzid))}
        >
          <Text style={styles.chipText}>+1小时</Text>
        </Pressable>
        <Pressable
          style={styles.chip}
          onPress={() => applyChip(onceAtTomorrowMorningNine(now, tzid))}
        >
          <Text style={styles.chipText}>明早9点</Text>
        </Pressable>
      </View>

      {tzid !== deviceTzid ? (
        <Text style={styles.tzHint}>{`按提醒时区 ${tzid} 解释`}</Text>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {step === 'date' ? (
        <DateTimePicker
          value={pickerDateSeed(value, new Date(now))}
          mode="date"
          display="default"
          onChange={handleDate}
        />
      ) : null}
      {step === 'time' ? (
        <DateTimePicker
          value={
            value.hour !== null && value.minute !== null
              ? new Date(2000, 0, 1, value.hour, value.minute)
              : new Date(now)
          }
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
    gap: 8,
    marginBottom: 6,
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
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
    flexWrap: 'wrap',
  },
  chip: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
  },
  chipText: {
    fontSize: 13,
    color: '#555',
  },
  tzHint: {
    fontSize: 12,
    color: '#9e9e9e',
    marginBottom: 4,
  },
  errorText: {
    fontSize: 12,
    color: '#c62828',
    marginBottom: 8,
  },
});
