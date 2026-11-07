import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import CategoryChip from './CategoryChip';
import ColorPalette from './ColorPalette';
import EmojiPicker from './EmojiPicker';
import TagChip from './TagChip';

interface VisualEditorProps {
  /** 'category' 用 CategoryChip 预览；'tag' 用 TagChip（both 模式）预览 */
  kind: 'category' | 'tag';
  /** 名称（预览文案；分类/标签名本切片均不可改） */
  name: string;
  initialColor: string | null;
  initialEmoji: string | null;
  saving?: boolean;
  /**
   * 保存回调：patch 携带 color/emoji 的当前值（显式 null = 清除该字段），
   * 形状与 repository.md v0.14 VisualPatch 兼容，由页面层调 Repository。
   */
  onSave: (patch: { color: string | null; emoji: string | null }) => void;
  /** 传入则显示「取消」按钮（页面收起编辑器） */
  onCancel?: () => void;
}

/**
 * 分类/标签视觉编辑器主体（tasks/slice-14.md 阶段 3，两配置页共用）：
 * 预览 chip（实时反映未保存的选择）+ 调色盘 + Emoji 网格 + 保存/取消。
 * 本地 state 编辑，「有变更」才允许保存；不接触 Repository / 数据库。
 */
export default function VisualEditor({
  kind,
  name,
  initialColor,
  initialEmoji,
  saving = false,
  onSave,
  onCancel,
}: VisualEditorProps) {
  const [color, setColor] = useState<string | null>(initialColor);
  const [emoji, setEmoji] = useState<string | null>(initialEmoji);

  const changed = color !== initialColor || emoji !== initialEmoji;

  const preview =
    kind === 'tag' ? (
      <TagChip tag={{ name, color, emoji }} mode="both" />
    ) : (
      <CategoryChip category={{ name, color, emoji }} />
    );

  return (
    <View style={styles.box}>
      <Text style={styles.label}>预览</Text>
      <View style={styles.previewRow}>{preview}</View>

      <Text style={styles.label}>颜色</Text>
      <ColorPalette selected={color} onSelect={setColor} disabled={saving} />
      <Text style={styles.hint}>「无」= 使用默认灰色</Text>

      <Text style={styles.label}>图标</Text>
      <EmojiPicker selected={emoji} onSelect={setEmoji} disabled={saving} />
      <Text style={styles.hint}>末尾 ✕ = 清除图标</Text>

      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.primaryButton, (!changed || saving) && styles.disabled]}
          onPress={() => onSave({ color, emoji })}
          disabled={!changed || saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.primaryText}>保存</Text>
          )}
        </Pressable>
        {onCancel ? (
          <Pressable style={styles.secondaryButton} onPress={onCancel} disabled={saving}>
            <Text style={styles.secondaryText}>取消</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e0',
    gap: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
    marginTop: 6,
  },
  previewRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  hint: {
    fontSize: 11,
    color: '#aaa',
    marginTop: 2,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  primaryButton: {
    backgroundColor: '#1e6f5c',
    borderRadius: 6,
    paddingVertical: 9,
    paddingHorizontal: 22,
    alignItems: 'center',
  },
  primaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
  },
  secondaryText: {
    fontSize: 13,
    color: '#555',
  },
  disabled: {
    opacity: 0.5,
  },
});
