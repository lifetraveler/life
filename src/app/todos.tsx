import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { itemRepository } from '../data';
import type { ItemWithRelations } from '../domain/relations/itemWithRelations';
import EmptyState from '../ui/EmptyState';
import { TYPE_LABELS, formatTimestamp } from '../ui/display';
import TagChip from '../ui/TagChip';
import { useTagDisplayMode } from '../ui/useTagDisplayMode';

/**
 * 待办列表（切片 14 阶段 5i）：无时间（startAt === null）条目的独立展示入口，
 * 与「已归档」同模式——主列表不混排，工具栏「待」pill 进入本页。
 * 数据链 observeItemsWithTags 单订阅（默认列表 §7.23），编辑/归档后实时刷新；
 * 本页只读，操作（补时间/归档/删除）在详情页完成。
 */
export default function TodosScreen() {
  const router = useRouter();
  const [items, setItems] = useState<ItemWithRelations[]>([]);
  // 切片 14 阶段 3：标签展示样式（设置页全局切换）
  const tagDisplayMode = useTagDisplayMode();

  useEffect(() => itemRepository.observeItemsWithTags(setItems), []);

  // 无时间条目 = 待办；归档项已被 NOT_ARCHIVED 查询排除；createdAt 倒序（最新在前）。
  const todos = useMemo(
    () =>
      items
        .filter((item) => item.startAt === null)
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)),
    [items],
  );

  const renderItem = useCallback(
    ({ item }: { item: ItemWithRelations }) => (
      <Pressable
        style={styles.row}
        onPress={() => router.push(`/item/${item.id}`)}
        accessibilityLabel={`待办 ${item.title}`}
      >
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowMeta}>
          {TYPE_LABELS[item.type]} · 建于 {formatTimestamp(item.createdAt)}
        </Text>
        {item.tags.length > 0 ? (
          <View style={styles.tagRow}>
            {item.tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} mode={tagDisplayMode} />
            ))}
          </View>
        ) : null}
      </Pressable>
    ),
    [router, tagDisplayMode],
  );

  return (
    <View style={styles.container}>
      <FlatList<ItemWithRelations>
        data={todos}
        renderItem={renderItem}
        keyExtractor={(record) => record.id}
        ListEmptyComponent={<EmptyState message="暂无待办——新增条目不填时间即进入这里" />}
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
  },
});
