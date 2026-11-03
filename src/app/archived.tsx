import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { itemRepository } from '../data';
import type { ItemWithTags } from '../domain/tag';
import EmptyState from '../ui/EmptyState';
import { TYPE_LABELS, formatTimestamp } from '../ui/display';
import TagChip from '../ui/TagChip';

/**
 * 已归档列表（切片 3）：展示 status = 'archived' 的 Item 及其标签，可取消归档。
 * 数据经 Repository 获取（listArchivedItems），不直接接触 WatermelonDB。
 */
export default function ArchivedScreen() {
  const router = useRouter();
  const [items, setItems] = useState<ItemWithTags[]>([]);

  const refresh = useCallback((): void => {
    void itemRepository
      .listArchivedItems()
      .then(setItems)
      .catch((error: unknown) => {
        console.error('listArchivedItems failed:', error);
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
      .then(refresh)
      .catch((error: unknown) => {
        console.error('unarchiveItem failed:', error);
      });
  }, [refresh]);

  const renderItem = useCallback(({ item }: { item: ItemWithTags }) => (
    <View style={styles.row}>
      <Pressable onPress={() => router.push(`/item/${item.id}`)}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowMeta}>
          {TYPE_LABELS[item.type]} · {formatTimestamp(item.updatedAt)}
        </Text>
      </Pressable>
      <View style={styles.tagRow}>
        {item.tags.map((tag) => (
          <TagChip key={tag.id} label={tag.name} />
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
  ), [handleUnarchive, router]);

  return (
    <View style={styles.container}>
      <FlatList<ItemWithTags>
        data={items}
        renderItem={renderItem}
        keyExtractor={(record) => record.id}
        ListEmptyComponent={<EmptyState message="暂无归档记录" />}
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
});
