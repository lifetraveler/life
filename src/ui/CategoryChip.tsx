import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { Category } from '../domain/category';
import { contrastTextColor } from './color';

interface CategoryChipProps {
  /** 分类视觉来源（Category 结构子集；本切片分类固定预置 5 条） */
  category: Pick<Category, 'name' | 'color' | 'emoji'>;
  /** 传入则整个 chip 可点击（筛选面板复用） */
  onPress?: () => void;
  /**
   * 多选选中态（阶段 4 筛选面板）：true=黑描边；false=弱化（透明同宽描边+降低不透明度，
   * 保证选中/未选中切换时尺寸不跳）；不传 = 既有展示视觉（无描边、不弱化）。
   */
  selected?: boolean;
}

/** 分类颜色为 null 或非法时的回退配色（repository.md v0.14 数据异常回退约定） */
const FALLBACK_BG = '#EEEEEE';
const FALLBACK_TEXT = '#212121';

/**
 * 分类 chip（tasks/slice-14.md 阶段 2）：背景取 category.color，
 * 文字颜色按对比度自动取黑/白（src/ui/color.ts），内容为 Emoji + 名称。
 * 纯展示组件，不接触 Repository / 数据库。
 */
export default function CategoryChip({ category, onPress, selected }: CategoryChipProps) {
  let backgroundColor = FALLBACK_BG;
  let textColor = FALLBACK_TEXT;
  if (category.color) {
    const onColor = contrastTextColor(category.color);
    if (onColor !== null) {
      backgroundColor = category.color;
      textColor = onColor;
    }
  }
  const label = category.emoji ? `${category.emoji} ${category.name}` : category.name;

  const chipStyles: ViewStyle[] = [styles.chip, { backgroundColor }];
  if (selected === true) {
    chipStyles.push(styles.chipSelected);
  } else if (selected === false) {
    chipStyles.push(styles.chipUnselected);
  }

  const body = (
    <View style={chipStyles}>
      <Text style={[styles.label, { color: textColor }]}>{label}</Text>
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
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipSelected: {
    borderWidth: 2,
    borderColor: '#111111',
  },
  chipUnselected: {
    borderWidth: 2,
    borderColor: 'transparent',
    opacity: 0.45,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
  },
});
