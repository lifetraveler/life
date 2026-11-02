import { Pressable, StyleSheet, Text, View } from 'react-native';

interface TagChipProps {
  label: string;
  /** 传入则显示移除按钮（×） */
  onRemove?: () => void;
  /** 传入则整个 chip 可点击（用于点击复用已有标签） */
  onPress?: () => void;
}

/**
 * 标签 chip：纯展示组件。
 * 数据由调用方（页面）传入，不接触 Repository / 数据库 / WatermelonDB。
 */
export default function TagChip({ label, onRemove, onPress }: TagChipProps) {
  const body = (
    <View style={styles.chip}>
      <Text style={styles.label}>{label}</Text>
      {onRemove ? (
        <Pressable hitSlop={8} onPress={onRemove} style={styles.removeButton}>
          <Text style={styles.removeText}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress}>
        {body}
      </Pressable>
    );
  }
  return body;
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  label: {
    fontSize: 12,
    color: '#3730a3',
  },
  removeButton: {
    marginLeft: 4,
  },
  removeText: {
    fontSize: 14,
    lineHeight: 16,
    color: '#6366f1',
    fontWeight: '600',
  },
});
