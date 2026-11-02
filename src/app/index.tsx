import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';

import { itemRepository } from '../data';
import type { ItemType } from '../domain/item';
import type { ItemWithTags, Tag } from '../domain/tag';
import EmptyState from '../ui/EmptyState';
import SearchInput from '../ui/SearchInput';
import { TYPE_LABELS, formatTimestamp } from '../ui/display';
import TagChip from '../ui/TagChip';

const ITEM_TYPES: readonly ItemType[] = ['note', 'task', 'event'];

/** 搜索防抖间隔（任务卡：300ms） */
const SEARCH_DEBOUNCE_MS = 300;

/** 输入按中/英文逗号切分：返回应立即创建的标签名与剩余未完成文本 */
function splitTagInput(raw: string): { completed: string[]; rest: string } {
  const parts = raw.split(/[，,]/);
  const rest = parts.pop() ?? '';
  return { completed: parts, rest };
}

/** 标签名规范化 + 去重（trim、空串丢弃、大小写不敏感），返回去重后的新数组 */
function collectTagNames(rawNames: readonly string[], existing: readonly string[]): string[] {
  const dedupKeys = new Set(existing.map((name) => name.toLowerCase()));
  const result: string[] = [];
  for (const rawName of rawNames) {
    const name = rawName.trim();
    const dedupKey = name.toLowerCase();
    if (name.length === 0 || dedupKeys.has(dedupKey)) {
      continue;
    }
    dedupKeys.add(dedupKey);
    result.push(name);
  }
  return result;
}

export default function IndexScreen() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selectedType, setSelectedType] = useState<ItemType>('note');
  const [items, setItems] = useState<ItemWithTags[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);

  // 创建表单的标签输入：未提交的待绑定标签
  const [pendingTags, setPendingTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // 行内「添加标签」编辑器状态：当前展开的 Item id + 输入框文本
  const [editingTagsForId, setEditingTagsForId] = useState<string | null>(null);
  const [rowTagInput, setRowTagInput] = useState('');

  // 搜索状态：输入原文 + 最近一次完成搜索的结果。
  // 约定：searchInput 为空串 = 默认列表模式；非空（含纯空白）= 搜索模式。
  // 纯空白输入必须显示空结果而非回落默认列表（任务卡 5d）。
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<ItemWithTags[]>([]);

  // 竞态保护：每次新的搜索输入/重放递增序号，过期响应一律丢弃（任务卡 4）。
  const searchSeqRef = useRef(0);

  useEffect(() => itemRepository.observeItemsWithTags(setItems), []);
  useEffect(() => itemRepository.observeTags(setAllTags), []);

  const canSave = title.trim().length > 0;

  /** 立即执行一次搜索并应用结果（序号递增，使之前在途响应全部失效） */
  const runSearch = useCallback((raw: string): void => {
    const seq = ++searchSeqRef.current;
    void itemRepository
      .searchItems(raw)
      .then((results) => {
        if (searchSeqRef.current === seq) {
          setSearchResults(results);
        }
      })
      .catch((error: unknown) => {
        console.error('searchItems failed:', error);
      });
  }, []);

  // 搜索防抖：输入停顿 300ms 后才真正查库；清空输入立即作废在途请求。
  useEffect(() => {
    if (searchInput.length === 0) {
      searchSeqRef.current += 1;
      return undefined;
    }
    const timer = setTimeout(() => {
      runSearch(searchInput);
    }, SEARCH_DEBOUNCE_MS);
    return (): void => {
      clearTimeout(timer);
    };
  }, [runSearch, searchInput]);

  const addPendingTags = useCallback((rawNames: readonly string[]): void => {
    setPendingTags((current) => collectTagNames(rawNames, current));
  }, []);

  // 创建表单：输入中出现逗号时立即提交前面的标签，保留未完成文本
  const handleTagInputChange = useCallback((raw: string): void => {
    const { completed, rest } = splitTagInput(raw);
    if (completed.length > 0) {
      addPendingTags(completed);
    }
    setTagInput(rest);
  }, [addPendingTags]);

  // 创建表单：回车提交当前输入
  const handleTagInputSubmit = useCallback((): void => {
    if (tagInput.trim().length > 0) {
      addPendingTags([tagInput]);
    }
    setTagInput('');
  }, [addPendingTags, tagInput]);

  const removePendingTag = useCallback((tagName: string): void => {
    setPendingTags((current) => current.filter((name) => name !== tagName));
  }, []);

  const handleSave = useCallback((): void => {
    if (!canSave) {
      return;
    }
    const tagsToBind = [...pendingTags];
    void (async () => {
      try {
        const created = await itemRepository.createItem({
          type: selectedType,
          title: title.trim(),
          content: content.trim(),
        });
        for (const tagName of tagsToBind) {
          await itemRepository.addTagToItem(created.id, tagName);
        }
        setTitle('');
        setContent('');
        setPendingTags([]);
        setTagInput('');
      } catch (error) {
        console.error('createItem with tags failed:', error);
      }
    })();
  }, [canSave, content, pendingTags, selectedType, title]);

  const handleConvertToTask = useCallback((itemId: string): void => {
    void itemRepository
      .updateItem(itemId, { type: 'task' })
      .catch((error: unknown) => {
        console.error('updateItem failed:', error);
      });
  }, []);

  // 归档：默认列表由 observeItemsWithTags 自动移除；搜索模式下立即重放当前关键词。
  const handleArchive = useCallback((itemId: string): void => {
    void itemRepository
      .archiveItem(itemId)
      .then(() => {
        if (searchInput.length > 0) {
          runSearch(searchInput);
        }
      })
      .catch((error: unknown) => {
        console.error('archiveItem failed:', error);
      });
  }, [runSearch, searchInput]);

  const handleRemoveTag = useCallback((itemId: string, tagId: string): void => {
    void itemRepository
      .removeTagFromItem(itemId, tagId)
      .catch((error: unknown) => {
        console.error('removeTagFromItem failed:', error);
      });
  }, []);

  const handleAddTagToItem = useCallback((itemId: string, tagName: string): void => {
    void itemRepository
      .addTagToItem(itemId, tagName)
      .then(() => {
        setRowTagInput('');
      })
      .catch((error: unknown) => {
        console.error('addTagToItem failed:', error);
      });
  }, []);

  const toggleTagEditor = useCallback((itemId: string): void => {
    setEditingTagsForId((current) => {
      if (current === itemId) {
        setRowTagInput('');
        return null;
      }
      return itemId;
    });
  }, []);

  // 行内编辑器：输入中出现逗号时立即提交前面的标签
  const handleRowTagInputChange = useCallback((raw: string): void => {
    const { completed, rest } = splitTagInput(raw);
    if (editingTagsForId !== null && completed.length > 0) {
      const itemId = editingTagsForId;
      void (async () => {
        for (const tagName of collectTagNames(completed, [])) {
          await itemRepository.addTagToItem(itemId, tagName);
        }
      })().catch((error: unknown) => {
        console.error('addTagToItem failed:', error);
      });
    }
    setRowTagInput(rest);
  }, [editingTagsForId]);

  // 行内编辑器：回车提交当前输入
  const submitRowTag = useCallback((itemId: string): void => {
    if (rowTagInput.trim().length > 0) {
      handleAddTagToItem(itemId, rowTagInput);
      return;
    }
    setRowTagInput('');
  }, [handleAddTagToItem, rowTagInput]);

  /** 「已有标签」复用建议：所有标签减去本项已绑定的 */
  const suggestTagsFor = useCallback((record: ItemWithTags): Tag[] => {
    const boundIds = new Set(record.tags.map((tag) => tag.id));
    return allTags.filter((tag) => !boundIds.has(tag.id));
  }, [allTags]);

  const renderItem = useCallback(({ item }: { item: ItemWithTags }) => {
    const suggestions = suggestTagsFor(item);
    const editing = editingTagsForId === item.id;
    return (
      <View style={styles.row}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowMeta}>
          {TYPE_LABELS[item.type]} · {formatTimestamp(item.createdAt)}
        </Text>
        <View style={styles.tagRow}>
          {item.tags.map((tag) => (
            <TagChip
              key={tag.id}
              label={tag.name}
              onRemove={() => handleRemoveTag(item.id, tag.id)}
            />
          ))}
        </View>
        <View style={styles.actionRow}>
          {item.type === 'note' ? (
            <Pressable
              style={styles.actionButton}
              onPress={() => handleConvertToTask(item.id)}
            >
              <Text style={styles.actionText}>转为任务</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={styles.actionButton}
            onPress={() => handleArchive(item.id)}
          >
            <Text style={styles.actionText}>归档</Text>
          </Pressable>
          <Pressable
            style={[styles.actionButton, editing && styles.actionButtonActive]}
            onPress={() => toggleTagEditor(item.id)}
          >
            <Text style={styles.actionText}>{editing ? '收起标签' : '添加标签'}</Text>
          </Pressable>
        </View>
        {editing ? (
          <View style={styles.tagEditor}>
            <TextInput
              style={styles.tagInput}
              value={rowTagInput}
              onChangeText={handleRowTagInputChange}
              onSubmitEditing={() => submitRowTag(item.id)}
              placeholder="标签名（回车或逗号确认）"
              returnKeyType="done"
            />
            {suggestions.length > 0 ? (
              <>
                <Text style={styles.suggestLabel}>已有标签（点击复用）：</Text>
                <View style={styles.tagRow}>
                  {suggestions.map((tag) => (
                    <TagChip
                      key={tag.id}
                      label={tag.name}
                      onPress={() => handleAddTagToItem(item.id, tag.name)}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }, [editingTagsForId, handleAddTagToItem, handleArchive, handleConvertToTask, handleRemoveTag,
    handleRowTagInputChange, rowTagInput, submitRowTag, suggestTagsFor, toggleTagEditor]);

  const searching = searchInput.length > 0;
  const displayedItems = searching ? searchResults : items;

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
      <TextInput
        style={styles.titleInput}
        value={tagInput}
        onChangeText={handleTagInputChange}
        onSubmitEditing={handleTagInputSubmit}
        placeholder="标签（回车或逗号确认，可多个）"
        returnKeyType="done"
      />
      {pendingTags.length > 0 ? (
        <View style={styles.tagRow}>
          {pendingTags.map((tagName) => (
            <TagChip
              key={tagName}
              label={tagName}
              onRemove={() => removePendingTag(tagName)}
            />
          ))}
        </View>
      ) : null}
      <Pressable
        style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
        disabled={!canSave}
        onPress={handleSave}
      >
        <Text style={styles.saveButtonText}>保存</Text>
      </Pressable>
      <View style={styles.listHeaderRow}>
        <Text style={styles.sectionLabel}>已有记录</Text>
        <Link href="/archived" asChild>
          <Pressable hitSlop={8}>
            <Text style={styles.archivedLink}>已归档</Text>
          </Pressable>
        </Link>
      </View>
      <SearchInput
        value={searchInput}
        onChangeText={setSearchInput}
      />
      <FlatList<ItemWithTags>
        data={displayedItems}
        renderItem={renderItem}
        keyExtractor={(record) => record.id}
        ListEmptyComponent={
          searching
            ? <EmptyState message="无匹配结果" />
            : <EmptyState message="暂无记录" />
        }
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
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
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
    marginBottom: 6,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  actionButton: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  actionButtonActive: {
    borderColor: '#2563eb',
  },
  actionText: {
    fontSize: 12,
    color: '#333333',
  },
  tagEditor: {
    marginTop: 6,
    marginBottom: 4,
  },
  tagInput: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 6,
  },
  suggestLabel: {
    fontSize: 11,
    color: '#888888',
    marginBottom: 4,
  },
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  archivedLink: {
    fontSize: 13,
    color: '#2563eb',
  },
});
