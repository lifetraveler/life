import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { ParsedItemDraft, ParsedItemType } from '../domain/ai/types';
import type { Category } from '../domain/category';
import CategoryChip from './CategoryChip';
import DateTimeField from './DateTimeField';

/**
 * 预览卡片编辑弹窗（tasks/slice-15.md 阶段 3，验收 8：点击卡片可手动调整
 * 分类、时间）。可编辑：标题/类型/分类/优先级/全天/起止时间/标签（仅移除，
 * 新增走输入框 #标签）。纯本地编辑，确认后才回写卡片草稿。
 */

const TYPE_OPTIONS: ReadonlyArray<{ value: ParsedItemType; label: string }> = [
  { value: 'note', label: '记事' },
  { value: 'task', label: '任务' },
  { value: 'event', label: '日程' },
];

const PRIORITY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: '无' },
  { value: 1, label: '低' },
  { value: 2, label: '中' },
  { value: 3, label: '高' },
];

interface FlashEditModalProps {
  visible: boolean;
  draft: ParsedItemDraft | null;
  categories: ReadonlyArray<Category>;
  onCancel: () => void;
  onConfirm: (next: ParsedItemDraft) => void;
}

export default function FlashEditModal({
  visible,
  draft,
  categories,
  onCancel,
  onConfirm,
}: FlashEditModalProps) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ParsedItemType>('note');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [priority, setPriority] = useState(0);
  const [allDay, setAllDay] = useState(false);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [endAt, setEndAt] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);

  // 每次打开时从当前草稿同步本地编辑态。
  useEffect(() => {
    if (visible && draft !== null) {
      setTitle(draft.title);
      setType(draft.type);
      setCategoryId(draft.categoryId);
      setPriority(draft.priority ?? 0);
      setAllDay(draft.allDay);
      setStartAt(draft.startAt);
      setEndAt(draft.endAt);
      setTags([...draft.tags]);
    }
  }, [visible, draft]);

  if (draft === null) {
    return null;
  }

  const confirm = (): void => {
    const trimmedTitle = title.trim();
    onConfirm({
      ...draft,
      title: trimmedTitle.length > 0 ? trimmedTitle : draft.title,
      type,
      categoryId,
      priority: priority >= 1 && priority <= 3 ? priority : null,
      allDay,
      startAt,
      endAt,
      tags,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onCancel}>
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
          <Text style={styles.headerTitle}>修改卡片</Text>
          <Pressable onPress={confirm}>
            <Text style={styles.confirmText}>完成</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.label}>标题</Text>
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            multiline
          />

          <Text style={styles.label}>类型</Text>
          <View style={styles.chipRow}>
            {TYPE_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                style={[styles.chip, type === opt.value && styles.chipSelected]}
                onPress={() => setType(opt.value)}
              >
                <Text
                  style={[
                    styles.chipText,
                    type === opt.value && styles.chipTextSelected,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>分类</Text>
          <View style={styles.chipRow}>
            {categories.map((category) => (
              <CategoryChip
                key={category.id}
                category={category}
                selected={categoryId === category.id}
                onPress={() =>
                  setCategoryId(categoryId === category.id ? null : category.id)
                }
              />
            ))}
          </View>

          <Text style={styles.label}>优先级</Text>
          <View style={styles.chipRow}>
            {PRIORITY_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                style={[
                  styles.chip,
                  priority === opt.value && styles.chipSelected,
                ]}
                onPress={() => setPriority(opt.value)}
              >
                <Text
                  style={[
                    styles.chipText,
                    priority === opt.value && styles.chipTextSelected,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.label}>全天</Text>
            <Switch value={allDay} onValueChange={setAllDay} />
          </View>

          <Text style={styles.label}>开始时间</Text>
          <DateTimeField
            label="开始时间"
            value={startAt}
            onChange={setStartAt}
            mode="datetime"
          />
          <Text style={styles.label}>结束时间</Text>
          <DateTimeField
            label="结束时间"
            value={endAt}
            onChange={setEndAt}
            mode="datetime"
          />

          {tags.length > 0 ? (
            <>
              <Text style={styles.label}>标签（点击移除；新增用 #标签）</Text>
              <View style={styles.chipRow}>
                {tags.map((tag) => (
                  <Pressable
                    key={tag}
                    style={styles.tagChip}
                    onPress={() => setTags(tags.filter((t) => t !== tag))}
                  >
                    <Text style={styles.tagText}>#{tag} ✕</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DDDDDD',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111111',
  },
  cancelText: {
    fontSize: 15,
    color: '#666666',
  },
  confirmText: {
    fontSize: 15,
    color: '#4A90D9',
    fontWeight: '600',
  },
  body: {
    padding: 16,
    paddingBottom: 40,
    gap: 8,
  },
  label: {
    fontSize: 13,
    color: '#666666',
    marginTop: 4,
  },
  titleInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#CCCCCC',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    color: '#111111',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#CCCCCC',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipSelected: {
    borderColor: '#111111',
    borderWidth: 1.5,
  },
  chipText: {
    fontSize: 13,
    color: '#444444',
  },
  chipTextSelected: {
    color: '#111111',
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  tagChip: {
    backgroundColor: '#EEEEEE',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: {
    fontSize: 12,
    color: '#444444',
  },
});
