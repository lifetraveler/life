import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { TagDisplayMode } from '../domain/settings';
import { formatTagDisplay } from '../domain/tags/tagDisplay';
import { contrastTextColor } from './color';

/** TagChip 需要的最小视觉来源（Tag 结构子集；便于测试与草稿场景复用） */
export interface TagChipVisualSource {
  name: string;
  color: string | null;
  emoji: string | null;
}

interface TagChipProps {
  /**
   * 传 Tag 时按 formatTagDisplay(tag, mode) 渲染文案，背景取 tag.color
   * （null/非法色回退默认中性样式）。
   */
  tag?: TagChipVisualSource;
  /**
   * 纯文字渲染（与 tag 同时传时以 tag 为准）：无颜色/emoji 的场景
   * （如快速添加页的未保存标签草稿）。
   */
  label?: string;
  /** 标签展示模式（app_settings.tagDisplayMode，§7.22）；默认 'text'，设置接线在阶段 3/4 */
  mode?: TagDisplayMode;
  /** 传入则显示移除按钮（×） */
  onRemove?: () => void;
  /** 传入则整个 chip 可点击（用于点击复用已有标签 / 筛选面板） */
  onPress?: () => void;
  /**
   * 多选选中态（阶段 4 筛选面板）：true=黑描边；false=弱化（透明同宽描边+降低不透明度，
   * 保证选中/未选中切换时尺寸不跳）；不传 = 既有展示视觉（无描边、不弱化）。
   */
  selected?: boolean;
}

/** 无自定义颜色时的默认中性配色（沿用切片 2 既有视觉，调用点零视觉漂移） */
const NEUTRAL_BG = '#eef2ff';
const NEUTRAL_TEXT = '#3730a3';

/**
 * 标签 chip：纯展示组件（tasks/slice-14.md 阶段 2 视觉增强）。
 * 数据由调用方传入，不接触 Repository / 数据库 / WatermelonDB。
 */
export default function TagChip({ tag, label, mode = 'text', onRemove, onPress, selected }: TagChipProps) {
  const text = tag ? formatTagDisplay(tag, mode) : (label ?? '');

  let backgroundColor = NEUTRAL_BG;
  let textColor = NEUTRAL_TEXT;
  if (tag?.color) {
    const onColor = contrastTextColor(tag.color);
    if (onColor !== null) {
      backgroundColor = tag.color;
      textColor = onColor;
    }
  }

  const chipStyles: ViewStyle[] = [styles.chip, { backgroundColor }];
  if (selected === true) {
    chipStyles.push(styles.chipSelected);
  } else if (selected === false) {
    chipStyles.push(styles.chipUnselected);
  }

  const body = (
    <View style={chipStyles}>
      <Text style={[styles.label, { color: textColor }]}>{text}</Text>
      {onRemove ? (
        <Pressable hitSlop={8} onPress={onRemove} style={styles.removeButton}>
          <Text style={[styles.removeText, { color: textColor }]}>×</Text>
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
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
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
  },
  removeButton: {
    marginLeft: 4,
  },
  removeText: {
    fontSize: 14,
    lineHeight: 16,
    fontWeight: '600',
  },
});
