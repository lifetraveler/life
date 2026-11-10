import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { itemRepository } from '../data';
import type { ItemWithTags } from '../domain/tag';
import EmptyState from '../ui/EmptyState';
import { TYPE_LABELS, formatTimestamp } from '../ui/display';
import TagChip from '../ui/TagChip';
import { useTagDisplayMode } from '../ui/useTagDisplayMode';
import { formatItemStart, getDeviceTzid } from '../ui/timeFormat';

/**
 * 已归档列表（ui.md v0.12）：展示 status = 'archived' 的 Item 及其标签，可取消归档。
 * 数据经 Repository 获取（listArchivedItemsWithTags，repository.md v0.12 归档视图
 * 查询入口；切片 12 决策 C 由 listArchivedItems 换调而来），不直接接触 WatermelonDB。
 * 加载与取消归档失败均用页面内提示，不静默（不再只 console.error）。
 */
export default function ArchivedScreen() {
  const router = useRouter();
  const [items, setItems] = useState<ItemWithTags[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 切片 14 阶段 3：标签展示样式（设置页全局切换）
  const tagDisplayMode = useTagDisplayMode();

  const refresh = useCallback((): void => {
    void itemRepository
      .listArchivedItemsWithTags()
      .then((loaded) => {
        setItems(loaded);
        setErrorMessage(null);
      })
      .catch((error: unknown) => {
        console.error('listArchivedItemsWithTags failed:', error);
        setErrorMessage('已归档列表加载失败，请重试');
      });
  }, []);

  // 每次聚焦页面时刷新：覆盖从默认列表归档后返回本页的场景。
  useFocusEffect(useCallback(() => {
    refresh();
  }, [refresh]));

  // 取消归档后本页不会重新聚焦，需在动作完成后主动刷新。
  const handleUnarchive = useCallback((itemId: string): void => {
    void itemRepository
      .unarchiveItem(itemId)
      .then(() => {
        setErrorMessage(null);
        refresh();
      })
      .catch((error: unknown) => {
        console.error('unarchiveItem failed:', error);
        setErrorMessage('取消归档失败，请重试');
      });
  }, [refresh]);

  const renderItem = useCallback(({ item }: { item: ItemWithTags }) => (
    <View style={styles.row}>
      <Pressable onPress={() => router.push(`/item/${item.id}`)}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowMeta}>
          {TYPE_LABELS[item.type]} · {formatTimestamp(item.updatedAt)}
        </Text>
        {item.startAt !== null && (
          <Text style={styles.rowMeta}>
            归档前：{formatItemStart(item.startAt, item.allDay, getDeviceTzid())}
          </Text>
        )}
      </Pressable>
      <View style={styles.tagRow}>
        {item.tags.map((tag) => (
          <TagChip key={tag.id} tag={tag} mode={tagDisplayMode} />
        ))}
      </View>
      <View style={styles.actionRow}>
        <Pressable
          style={styles.actionButton}
          onPress={() => handleUnarchive(item.id)}
        >
          <Text style={styles.actionText}>取消归档</Text>
        </Pressable>
      </View>
    </View>
  ), [handleUnarchive, router, tagDisplayMode]);

  return (
    <View style={styles.container}>
      {errorMessage !== null && (
        <Text style={styles.errorText}>{errorMessage}</Text>
      )}
      <FlatList<ItemWithTags>
        data={items}
        renderItem={renderItem}
        keyExtractor={(record) => record.id}
        ListEmptyComponent={<EmptyState message="没有已归档的条目" />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  row: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
  },
  rowTitle: {
    fontSize: 15,
    marginBottom: 2,
  },
  rowMeta: {
    fontSize: 12,
    color: '#888888',
    marginBottom: 6,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  actionText: {
    fontSize: 12,
    color: '#333333',
  },
  errorText: {
    color: '#b00020',
    fontSize: 13,
    marginBottom: 8,
  },
});
