import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { itemRepository } from '../../data';
import type { VisualPatch } from '../../data/ItemRepository';
import type { Category } from '../../domain/category';
import CategoryChip from '../../ui/CategoryChip';
import VisualEditor from '../../ui/VisualEditor';

/**
 * 分类管理页（tasks/slice-14.md 阶段 3 / AGENTS.md §7.22）：
 * - 列出 5 个预置分类（getCategories，priority 升序），CategoryChip 展示当前视觉；
 * - 点击任一分类展开 VisualEditor（页内展开，不跳转子页），保存调
 *   updateCategoryVisuals，成功后刷新列表并收起；
 * - 不支持新增/删除分类（任务卡「禁止修改/实现」明确，repository.md v0.14）。
 */

export default function CategorySettingsPage() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const loaded = await itemRepository.getCategories();
      setCategories(loaded);
      setError(null);
    } catch (err) {
      console.warn('[slice-14] 分类列表读取失败', err);
      setError(`读取失败：${String(err)}`);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleSave = useCallback(
    async (category: Category, patch: VisualPatch): Promise<void> => {
      if (savingId !== null) {
        return;
      }
      setSavingId(category.id);
      try {
        await itemRepository.updateCategoryVisuals(category.id, patch);
        await load();
        setExpandedId(null);
      } catch (err) {
        console.warn('[slice-14] 分类视觉保存失败', err);
        setError(`保存失败：${String(err)}`);
      } finally {
        setSavingId(null);
      }
    },
    [savingId, load],
  );

  if (categories === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.hint}>
        预置分类不可新增或删除，只能调整颜色与图标。点击任一分类开始编辑。
      </Text>
      {categories.map((category) => {
        const expanded = expandedId === category.id;
        return (
          <View key={category.id} style={styles.card}>
            <Pressable
              style={styles.row}
              onPress={() => setExpandedId(expanded ? null : category.id)}
            >
              <CategoryChip category={category} />
              <Text style={styles.rowAction}>{expanded ? '收起' : '编辑'}</Text>
            </Pressable>
            {expanded ? (
              <VisualEditor
                kind="category"
                name={category.name}
                initialColor={category.color}
                initialEmoji={category.emoji}
                saving={savingId === category.id}
                onSave={(patch) => {
                  void handleSave(category, patch);
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

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    padding: 16,
    paddingBottom: 32,
  },
  hint: {
    fontSize: 12,
    color: '#888',
    lineHeight: 18,
    marginBottom: 10,
  },
  card: {
    backgroundColor: '#fff',
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
    color: '#1e6f5c',
  },
  errorText: {
    fontSize: 12,
    color: '#c62828',
    marginTop: 8,
  },
});
