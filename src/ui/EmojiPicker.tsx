import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EMOJI_CHOICES } from './visualOptions';

interface EmojiPickerProps {
  /** 当前选中 Emoji（null = 无图标） */
  selected: string | null;
  /** 选择回调；点「✕」格回调 null（= 清除图标） */
  onSelect: (emoji: string | null) => void;
  /** 保存中禁用 */
  disabled?: boolean;
}

/**
 * Emoji 选择器（tasks/slice-14.md 阶段 3）：28 个常用 Emoji 网格 + 末尾「✕」清除格。
 * 纯展示组件：不接触 Repository / 数据库。
 */
export default function EmojiPicker({ selected, onSelect, disabled = false }: EmojiPickerProps) {
  return (
    <View style={styles.grid}>
      {EMOJI_CHOICES.map((emoji) => {
        const isSelected = selected !== null && selected === emoji;
        return (
          <Pressable
            key={emoji}
            style={[styles.cell, isSelected && styles.cellSelected]}
            onPress={() => onSelect(emoji)}
            disabled={disabled}
            accessibilityLabel={`图标 ${emoji}`}
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </Pressable>
        );
      })}
      <Pressable
        style={[styles.cell, styles.clearCell, selected === null && styles.cellSelected]}
        onPress={() => onSelect(null)}
        disabled={disabled}
        accessibilityLabel="清除图标"
      >
        <Text style={styles.clearText}>✕</Text>
      </Pressable>
    </View>
  );
}

/** 主题绿（与项目既有 primaryButton #1e6f5c 一致），选中描边色 */
const SELECTED_RING = '#1e6f5c';

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  cell: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cellSelected: {
    borderColor: SELECTED_RING,
    backgroundColor: '#e6f4ef',
  },
  emoji: {
    fontSize: 22,
  },
  clearCell: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d0d0d0',
  },
  clearText: {
    fontSize: 16,
    color: '#999',
    fontWeight: '600',
  },
});
