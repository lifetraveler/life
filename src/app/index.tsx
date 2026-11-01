import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { itemRepository } from '../data';
import type { CreateItemInput, Item, ItemType } from '../domain/item';

const ITEM_TYPES: readonly ItemType[] = ['note', 'task', 'event'];

const TYPE_LABELS: Record<ItemType, string> = {
  note: '笔记',
  task: '任务',
  event: '事件',
};

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19);
}

export default function IndexScreen() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selectedType, setSelectedType] = useState<ItemType>('note');
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => itemRepository.observeItems(setItems), []);

  const canSave = title.trim().length > 0;

  const handleSave = useCallback((): void => {
    if (!canSave) {
      return;
    }
    const input: CreateItemInput = {
      type: selectedType,
      title: title.trim(),
      content: content.trim(),
    };
    void itemRepository
      .createItem(input)
      .then(() => {
        setTitle('');
        setContent('');
      })
      .catch((error: unknown) => {
        console.error('createItem failed:', error);
      });
  }, [canSave, content, selectedType, title]);

  const renderItem = useCallback(({ item }: { item: Item }) => (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>{item.title}</Text>
      <Text style={styles.rowMeta}>
        {TYPE_LABELS[item.type]} · {formatTimestamp(item.createdAt)}
      </Text>
    </View>
  ), []);

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>新建记录</Text>
      <TextInput
        style={styles.titleInput}
        value={title}
        onChangeText={setTitle}
        placeholder="标题（必填）"
      />
      <TextInput
        style={styles.contentInput}
        value={content}
        onChangeText={setContent}
        placeholder="内容（可选）"
        multiline
      />
      <View style={styles.typeRow}>
        {ITEM_TYPES.map((itemType) => {
          const selected = itemType === selectedType;
          return (
            <Pressable
              key={itemType}
              style={[styles.typeButton, selected && styles.typeButtonSelected]}
              onPress={() => setSelectedType(itemType)}
            >
              <Text style={[styles.typeText, selected && styles.typeTextSelected]}>
                {TYPE_LABELS[itemType]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
        disabled={!canSave}
        onPress={handleSave}
      >
        <Text style={styles.saveButtonText}>保存</Text>
      </Pressable>
      <Text style={styles.sectionLabel}>已有记录</Text>
      <FlatList<Item>
        data={items}
        renderItem={renderItem}
        keyExtractor={(record) => record.id}
        ListEmptyComponent={<Text style={styles.emptyText}>暂无记录</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  titleInput: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  contentInput: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 60,
    marginBottom: 8,
    textAlignVertical: 'top',
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  typeButton: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  typeButtonSelected: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  typeText: {
    color: '#333333',
  },
  typeTextSelected: {
    color: '#ffffff',
  },
  saveButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    color: '#ffffff',
    fontWeight: '600',
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
  },
  emptyText: {
    color: '#999999',
    paddingVertical: 12,
  },
});
