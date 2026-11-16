import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { itemRepository } from '../../data';
import type { VisualPatch } from '../../data/ItemRepository';
import type { Tag } from '../../domain/tag';
import TagChip from '../../ui/TagChip';
import VisualEditor from '../../ui/VisualEditor';
import { useTheme } from '../../ui/theme';
import type { ThemeColors } from '../../ui/theme';

/**
 * 标签管理页（tasks/slice-14.md 阶段 3 / AGENTS.md §7.22）：
 * - observeTags 响应式列出全部标签（TagChip 展示当前视觉，both 模式便于看到图标）；
 * - 点击任一标签展开 VisualEditor（页内展开），保存调 updateTagVisuals，
 *   成功后收起；列表随 WatermelonDB 响应式查询自动刷新；
 * - 无新增/删除标签入口（既有条目页负责建标签）。
 */

export default function TagSettingsPage() {
  // 切片 24（§7.36）：颜色走全局 Token（夜间模式），深浅色跟随系统。
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // undefined=首次加载中；[] 兜底为空态
  const [tags, setTags] = useState<Tag[] | null | undefined>(undefined);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const unsubscribe = itemRepository.observeTags((next) => {
        if (cancelled) {
          return;
        }
        setTags(next);
        setError(null);
      });
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }, []),
  );

  const handleSave = useCallback(
    async (tag: Tag, patch: VisualPatch): Promise<void> => {
      if (savingId !== null) {
        return;
      }
      setSavingId(tag.id);
      try {
        await itemRepository.updateTagVisuals(tag.id, patch);
        // 验收修复：updateTagVisuals 后 observeTags 的响应式发射在本机型上偶发不触发
        //（水合行的 color/emoji 变化未即时推送），保存后显式拉取一次，与分类管理页
        // 「保存后 await load()」同一模式，保证列表即时反映新视觉。
        const fresh = await itemRepository.listTags();
        setTags(fresh);
        setExpandedId(null);
      } catch (err) {
        console.warn('[slice-14] 标签视觉保存失败', err);
        setError(`保存失败：${String(err)}`);
      } finally {
        setSavingId(null);
      }
    },
    [savingId],
  );

  if (tags === undefined || tags === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.hint}>
        点击任一标签调整颜色与图标；「✕」清除图标、「无」清除颜色。标签的展示样式
        （文字/表情）在设置页切换。
      </Text>
      {tags.length === 0 ? <Text style={styles.emptyText}>暂无标签</Text> : null}
      {tags.map((tag) => {
        const expanded = expandedId === tag.id;
        return (
          <View key={tag.id} style={styles.card}>
            <Pressable
              style={styles.row}
              onPress={() => setExpandedId(expanded ? null : tag.id)}
            >
              <TagChip tag={tag} mode="both" />
              <Text style={styles.rowAction}>{expanded ? '收起' : '编辑'}</Text>
            </Pressable>
            {expanded ? (
              <VisualEditor
                kind="tag"
                name={tag.name}
                initialColor={tag.color}
                initialEmoji={tag.emoji}
                saving={savingId === tag.id}
                onSave={(patch) => {
                  void handleSave(tag, patch);
                }}
                onCancel={() => setExpandedId(null)}
              />
            ) : null}
          </View>
        );
      })}
      {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll: {
      flex: 1,
      backgroundColor: c.background,
    },
    container: {
      padding: 16,
      paddingBottom: 32,
    },
    hint: {
      fontSize: 12,
      color: c.textMuted,
      lineHeight: 18,
      marginBottom: 10,
    },
    emptyText: {
      fontSize: 13,
      color: c.textMuted,
      textAlign: 'center',
      marginTop: 24,
    },
    card: {
      backgroundColor: c.card,
      borderRadius: 8,
      padding: 12,
      marginBottom: 10,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    rowAction: {
      fontSize: 13,
      color: c.primary,
    },
    errorText: {
      fontSize: 12,
      color: c.danger,
      marginTop: 8,
    },
  });
}
