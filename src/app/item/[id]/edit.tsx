import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { itemRepository } from '../../../data';
import { itemPriorityLabel } from '../../../domain/category';
import type { Category } from '../../../domain/category';
import type { ItemWithRelations } from '../../../domain/relations/itemWithRelations';
import type { Tag } from '../../../domain/tag';
import type { Item, UpdateItemInput } from '../../../domain/item';
import { reminderScheduler } from '../../../notifications';
import CategoryChip from '../../../ui/CategoryChip';
import TagChip from '../../../ui/TagChip';
import { useTagDisplayMode } from '../../../ui/useTagDisplayMode';
import DateTimeField from '../../../ui/DateTimeField';
import { getDeviceTzid } from '../../../ui/timeFormat';

/**
 * Item 编辑页（切片 6，AGENTS.md §4.27 / §4.30）：
 * - 可改：title、content、type、startAt/endAt/allDay、tags；
 * - time 字段只走 updateItemTime（§4.24），title/content/type 走 updateItem（§4.5）；
 * - Reminder 的创建/编辑/删除在详情页完成，本页不含；
 * - endAt < startAt 由 Repository 抛错，本页先行校验并提示。
 */

const TYPE_OPTIONS: Array<{ value: Item['type']; label: string }> = [
  { value: 'note', label: '灵感' },
  { value: 'task', label: '任务' },
  { value: 'event', label: '日程' },
];

/** 优先级选项（§7.22：0=无 1=低 2=中 3=高；选择器用 ★ 表示 1-3） */
const PRIORITY_OPTIONS: readonly number[] = [0, 1, 2, 3];

function priorityOptionLabel(priority: number): string {
  return priority <= 0 ? '无' : '★'.repeat(priority);
}

export default function ItemEditPage() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();

  const deviceTzid = getDeviceTzid();
  const tagDisplayMode = useTagDisplayMode();
  const [loaded, setLoaded] = useState<ItemWithRelations | null | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<Item['type']>('note');
  const [startAt, setStartAt] = useState<number | null>(null);
  const [endAt, setEndAt] = useState<number | null>(null);
  const [allDay, setAllDay] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagInput, setTagInput] = useState('');
  // 切片 14 阶段 3：分类/优先级（保存时随 updateItem 提交；categoryId null=尚未加载）
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [priority, setPriority] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!id) {
      setLoaded(null);
      return;
    }
    try {
      const [itemLoaded, categoryList] = await Promise.all([
        itemRepository.getItemById(id),
        itemRepository.getCategories(),
      ]);
      setCategories(categoryList);
      if (itemLoaded) {
        setTitle(itemLoaded.title);
        setContent(itemLoaded.content);
        setType(itemLoaded.type);
        setStartAt(itemLoaded.startAt);
        setEndAt(itemLoaded.endAt);
        setAllDay(itemLoaded.allDay);
        setTags(itemLoaded.tags);
        setCategoryId(itemLoaded.categoryId);
        setPriority(itemLoaded.priority);
      }
      setLoaded(itemLoaded);
    } catch (error) {
      console.warn('[slice-06] 编辑页读取失败', error);
      setFormError(`读取失败：${String(error)}`);
      setLoaded(null);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleAddTag = async (): Promise<void> => {
    const name = tagInput.trim();
    if (name.length === 0 || !id) {
      return;
    }
    try {
      await itemRepository.addTagToItem(id, name);
      setTagInput('');
      const refreshed = await itemRepository.getItemById(id);
      if (refreshed) {
        setTags(refreshed.tags);
      }
    } catch (error) {
      console.warn('[slice-06] 添加标签失败', error);
      setFormError(`添加标签失败：${String(error)}`);
    }
  };

  const handleRemoveTag = async (tag: Tag): Promise<void> => {
    if (!id) {
      return;
    }
    try {
      await itemRepository.removeTagFromItem(id, tag.id);
      const refreshed = await itemRepository.getItemById(id);
      if (refreshed) {
        setTags(refreshed.tags);
      }
    } catch (error) {
      console.warn('[slice-06] 移除标签失败', error);
      setFormError(`移除标签失败：${String(error)}`);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!id || submitting) {
      return;
    }
    // 切片 8：URL 直达时也必须拦截只读项（tasks/slice-08.md 实现要求 6）。
    if (loaded?.sourceReadOnly ?? false) {
      setFormError('只读项：此条目来自 ICS 导入，时间/标题/内容不可编辑');
      return;
    }
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      setFormError('标题不能为空');
      return;
    }
    if (startAt !== null && endAt !== null && endAt < startAt) {
      setFormError('结束时间必须不早于开始时间');
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      // title/content/type 走 §4.5 updateItem；时间字段只走 §4.24 updateItemTime。
      // 切片 14 阶段 3：categoryId/priority 一并随 updateItem 提交（repository.md v0.14）。
      const patch: UpdateItemInput = { title: trimmedTitle, content, type };
      if (categoryId !== null) {
        patch.categoryId = categoryId;
      }
      patch.priority = priority;
      await itemRepository.updateItem(id, patch);
      await itemRepository.updateItemTime(id, { startAt, endAt, allDay });
      // §4.27：Item 时间变更后 reconcile；失败不阻断保存，错误写日志。
      try {
        await reminderScheduler.reconcile();
      } catch (error) {
        console.warn('[slice-06] 编辑保存后 reconcile 失败', error);
      }
      router.back();
    } catch (error) {
      console.warn('[slice-06] 保存失败', error);
      setFormError(`保存失败：${String(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmCancel = (): void => {
    Alert.alert('放弃修改', '未保存的修改将丢失。', [
      { text: '继续编辑', style: 'cancel' },
      { text: '放弃', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  if (loaded === undefined) {
    return (
      <View style={styles.container}>
        <Text style={styles.meta}>加载中…</Text>
      </View>
    );
  }

  if (loaded === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.meta}>条目已删除</Text>
        <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
          <Text style={styles.secondaryText}>返回</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
        {(loaded?.sourceReadOnly ?? false) ? (
          <View style={styles.readonlyBox}>
            <Text style={styles.readonlyTitle}>来源：ICS（只读）</Text>
            <Text style={styles.readonlyText}>
              此条目来自 ICS 导入，时间/标题/内容不可编辑；可完成、归档或在详情页删除本地副本。
            </Text>
          </View>
        ) : null}
        <Text style={styles.label}>标题</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="标题" />

        <Text style={styles.label}>内容</Text>
        <TextInput
          style={[styles.input, styles.contentInput]}
          value={content}
          onChangeText={setContent}
          placeholder="内容（可选）"
          multiline
        />

        <Text style={styles.label}>类型</Text>
        <View style={styles.row}>
          {TYPE_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              style={[styles.chip, type === option.value && styles.chipActive]}
              onPress={() => setType(option.value)}
            >
              <Text style={[styles.chipText, type === option.value && styles.chipTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {(loaded?.sourceReadOnly ?? false) ? null : (
          <>
            {/* 切片 14 阶段 3：分类选择器——横向滑动 Chip，选中高亮，保存时更新 categoryId。 */}
            <Text style={styles.label}>分类</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipScrollRow}
            >
              {categories.map((category) => (
                <Pressable
                  key={category.id}
                  style={[
                    styles.categoryOption,
                    categoryId === category.id && styles.categoryOptionActive,
                  ]}
                  onPress={() => setCategoryId(category.id)}
                >
                  <CategoryChip category={category} />
                </Pressable>
              ))}
            </ScrollView>

            {/* 切片 14 阶段 3：优先级选择器（0-3，保存时更新 priority）。 */}
            <Text style={styles.label}>优先级</Text>
            <View style={styles.row}>
              {PRIORITY_OPTIONS.map((value) => (
                <Pressable
                  key={value}
                  style={[styles.chip, priority === value && styles.chipActive]}
                  onPress={() => setPriority(value)}
                >
                  <Text style={[styles.chipText, priority === value && styles.chipTextActive]}>
                    {priorityOptionLabel(value)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={styles.label}>开始时间（按设备时区 {deviceTzid} 显示）</Text>
        <DateTimeField label="开始" value={startAt} mode="datetime" onChange={setStartAt} />

        <Text style={styles.label}>结束时间</Text>
        <DateTimeField label="结束" value={endAt} mode="datetime" onChange={setEndAt} />

        <View style={styles.switchRow}>
          <Text style={styles.label}>全天</Text>
          <Switch value={allDay} onValueChange={setAllDay} />
        </View>

        <Text style={styles.label}>标签</Text>
        <View style={styles.row}>
          {tags.length === 0 ? <Text style={styles.meta}>暂无标签</Text> : null}
          {tags.map((tag) => (
            <TagChip
              key={tag.id}
              tag={tag}
              mode={tagDisplayMode}
              onRemove={(loaded?.sourceReadOnly ?? false) ? undefined : () => handleRemoveTag(tag)}
            />
          ))}
        </View>
        {(loaded?.sourceReadOnly ?? false) ? null : (
          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.tagInput]}
              value={tagInput}
              onChangeText={setTagInput}
              placeholder="新标签名"
            />
            <Pressable style={styles.secondaryButton} onPress={handleAddTag}>
              <Text style={styles.secondaryText}>添加</Text>
            </Pressable>
          </View>
        )}

        {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

        <View style={styles.row}>
          <Pressable
            style={[styles.primaryButton, (submitting || (loaded?.sourceReadOnly ?? false)) && styles.disabled]}
            onPress={handleSave}
            disabled={submitting || (loaded?.sourceReadOnly ?? false)}
          >
            <Text style={styles.primaryText}>{submitting ? '保存中…' : '保存'}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={confirmCancel} disabled={submitting}>
            <Text style={styles.secondaryText}>取消</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scroll: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    padding: 16,
    paddingBottom: 32,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#fff',
    fontSize: 15,
    color: '#111',
  },
  contentInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  tagInput: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  chipScrollRow: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  categoryOption: {
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: 1,
  },
  categoryOptionActive: {
    borderColor: '#1e6f5c',
  },
  chip: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  chipActive: {
    borderColor: '#1e6f5c',
    backgroundColor: '#e6f4ef',
  },
  chipText: {
    fontSize: 13,
    color: '#555',
  },
  chipTextActive: {
    color: '#1e6f5c',
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: {
    fontSize: 12,
    color: '#c62828',
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: '#1e6f5c',
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 18,
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
    paddingVertical: 9,
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
  meta: {
    fontSize: 12,
    color: '#888',
  },
  readonlyBox: {
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#eef2ff',
    borderRadius: 6,
    padding: 10,
    marginTop: 8,
  },
  readonlyTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4f46e5',
  },
  readonlyText: {
    fontSize: 12,
    color: '#555',
    lineHeight: 18,
    marginTop: 4,
  },
});
