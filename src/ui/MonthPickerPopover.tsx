/**
 * 年月选择浮层（切片 14 阶段 5c，tasks/slice-14.md 阶段 5c-0，参考 tasks/年月切换组件.jpg）：
 * - 顶栏年月标签点击后弹出：‹ 年份 › 步进行 + 12 个月宫格（4 列 × 3 行），
 *   当前选中月胶囊高亮（黑底白字，与应用主色一致，不采用参考图红色）；
 * - 浮层定位：锚定在顶栏标签下方（调用方置于容器 absolute 层），点遮罩关闭；
 * - 纯自绘（react-native-calendars 无「年+月宫格」形态，用户确认自绘，零新依赖）；
 * - 本组件不读设备时区、不触碰 Repository。
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const MONTH_LABELS = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
] as const;

interface MonthPickerPopoverProps {
  visible: boolean;
  /** 当前选中月（弹层打开时高亮它） */
  anchor: { year: number; month: number };
  /** 选中某年某月 */
  onSelect: (year: number, month: number) => void;
  onClose: () => void;
}

export function MonthPickerPopover({
  visible,
  anchor,
  onSelect,
  onClose,
}: MonthPickerPopoverProps) {
  // 展示年：弹层打开时与锚点年同步；‹ › 在弹层内自由步进
  const [displayYear, setDisplayYear] = useState(anchor.year);
  useEffect(() => {
    if (visible) {
      setDisplayYear(anchor.year);
    }
  }, [visible, anchor.year]);

  if (!visible) {
    return null;
  }

  const stepYear = (delta: number): void => {
    setDisplayYear((prev) => prev + delta);
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* 遮罩：点击空白处关闭（不挡浮层自身，box-none） */}
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="关闭年月选择" />
      <View style={styles.card}>
        <View style={styles.yearRow}>
          <Pressable
            hitSlop={8}
            style={({ pressed }) => [styles.yearArrow, pressed && styles.pressed]}
            onPress={() => stepYear(-1)}
            accessibilityLabel="上一年"
          >
            <Ionicons name="chevron-back" size={20} color="#111111" />
          </Pressable>
          <Text style={styles.yearText}>{displayYear}</Text>
          <Pressable
            hitSlop={8}
            style={({ pressed }) => [styles.yearArrow, pressed && styles.pressed]}
            onPress={() => stepYear(1)}
            accessibilityLabel="下一年"
          >
            <Ionicons name="chevron-forward" size={20} color="#111111" />
          </Pressable>
        </View>
        <View style={styles.grid}>
          {MONTH_LABELS.map((label, index) => {
            const month = index + 1;
            const selected = displayYear === anchor.year && month === anchor.month;
            return (
              <Pressable
                key={label}
                style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
                onPress={() => onSelect(displayYear, month)}
                accessibilityLabel={`${displayYear}年${label}`}
              >
                <Text style={[styles.cellText, selected && styles.cellTextSelected]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
  },
  card: {
    position: 'absolute',
    // 阶段 5d：从顶栏年月标签正下方弹出（topBar paddingTop48 + 标题行高 ≈ 96），
    // 左对齐页面 padding 16；不再顶到屏幕左上角
    top: 96,
    left: 16,
    width: 268,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    paddingHorizontal: 10,
    elevation: 8,
  },
  yearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  yearArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yearText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: '25%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  cellText: {
    fontSize: 15,
    color: '#333333',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
    overflow: 'hidden',
  },
  cellTextSelected: {
    backgroundColor: '#111111',
    color: '#FFFFFF',
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.6,
  },
});
