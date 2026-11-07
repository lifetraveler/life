import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PALETTE_COLORS } from './visualOptions';

interface ColorPaletteProps {
  /** 当前选中色（null = 未自定义） */
  selected: string | null;
  /** 选择回调；点「无」格回调 null（= 清除自定义色，展示组件回退默认灰） */
  onSelect: (color: string | null) => void;
  /** 保存中禁用 */
  disabled?: boolean;
}

/**
 * 调色盘（tasks/slice-14.md 阶段 3）：10 个预设色圆块 + 末尾「无」格。
 * 「无」格语义 = 清空自定义颜色（落 null），由 TagChip / CategoryChip /
 * AgendaItemCard 走既有回退灰渲染，不在数据层写死灰色 hex。
 * 纯展示组件：不接触 Repository / 数据库。
 */
export default function ColorPalette({ selected, onSelect, disabled = false }: ColorPaletteProps) {
  return (
    <View style={styles.row}>
      {PALETTE_COLORS.map((color) => {
        const isSelected = selected !== null && selected === color;
        return (
          <Pressable
            key={color}
            style={[styles.swatch, isSelected && styles.swatchSelected]}
            onPress={() => onSelect(color)}
            disabled={disabled}
            accessibilityLabel={`颜色 ${color}`}
          />
        );
      })}
      <Pressable
        style={[styles.swatch, styles.defaultSwatch, selected === null && styles.swatchSelected]}
        onPress={() => onSelect(null)}
        disabled={disabled}
        accessibilityLabel="默认灰（清除自定义颜色）"
      >
        <Text style={styles.defaultText}>无</Text>
      </Pressable>
    </View>
  );
}

/** 主题绿（与项目既有 primaryButton #1e6f5c 一致），选中描边色 */
const SELECTED_RING = '#1e6f5c';

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  swatchSelected: {
    borderColor: SELECTED_RING,
  },
  defaultSwatch: {
    backgroundColor: '#fff',
    borderColor: '#d0d0d0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  defaultText: {
    fontSize: 11,
    color: '#888',
  },
});
