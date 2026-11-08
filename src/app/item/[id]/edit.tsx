import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { itemRepository } from '../../../data';
import type { Category } from '../../../domain/category';
import type { ItemWithRelations } from '../../../domain/relations/itemWithRelations';
import type { Tag } from '../../../domain/tag';
import type { UpdateItemInput } from '../../../domain/item';
import { reminderScheduler } from '../../../notifications';
import ItemFormFields from '../../../ui/ItemFormFields';
import { useItemForm } from '../../../ui/useItemForm';
import { getDeviceTzid } from '../../../ui/timeFormat';

/**
 * Item 编辑页（切片 6，AGENTS.md §4.27 / §4.30；切片 14 阶段 5：字段状态与渲染
 * 抽到共享表单 ui/useItemForm + ui/ItemFormFields，供全屏新建页 item/new.tsx 复用）：
 * - 可改：title、content、type、startAt/endAt/allDay、tags、categoryId、priority；
 * - time 字段只走 updateItemTime（§4.24），title/content/type/categoryId/priority
 *   走 updateItem（§4.5，repository.md v0.14）；
 * - Reminder 的创建/编辑/删除在详情页完成，本页不含；
 * - endAt < startAt 由 Repository 抛错，本页先行校验并提示。
 */

export default function ItemEditPage() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();

  const deviceTzid = getDeviceTzid();
  const form = useItemForm();
  // reset 引用稳定（useCallback），load 依赖它不会随渲染变化（否则 useFocusEffect
  // 每次渲染都重跑、逐键重读库）。
  const resetForm = form.reset;
  const [loaded, setLoaded] = useState<ItemWithRelations | null | undefined>(undefined);
  const [categories, setCategories] = useState<Category[]>([]);
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
        resetForm({
          title: itemLoaded.title,
          content: itemLoaded.content,
          type: itemLoaded.type,
          categoryId: itemLoaded.categoryId,
          priority: itemLoaded.priority,
          startAt: itemLoaded.startAt,
          endAt: itemLoaded.endAt,
          allDay: itemLoaded.allDay,
          tags: itemLoaded.tags,
          tagInput: '',
        });
      }
      setLoaded(itemLoaded);
    } catch (error) {
      console.warn('[slice-06] 编辑页读取失败', error);
      setFormError(`读取失败：${String(error)}`);
      setLoaded(null);
    }
  }, [id, resetForm]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleAddTag = async (): Promise<void> => {
    const name = form.tagInput.trim();
    if (name.length === 0 || !id) {
      return;
    }
    try {
      await itemRepository.addTagToItem(id, name);
      form.setTagInput('');
      const refreshed = await itemRepository.getItemById(id);
      if (refreshed) {
        form.setTags(refreshed.tags);
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
        form.setTags(refreshed.tags);
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
    const sourceReadOnly = loaded?.sourceReadOnly ?? false;
    if (sourceReadOnly) {
      setFormError('只读项：此条目来自 ICS 导入，时间/标题/内容不可编辑');
      return;
    }
    const validationError = form.validate();
    if (validationError !== null) {
      setFormError(validationError);
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      // title/content/type 走 §4.5 updateItem；时间字段只走 §4.24 updateItemTime。
      // 切片 14 阶段 3：categoryId/priority 一并随 updateItem 提交（repository.md v0.14）。
      const patch: UpdateItemInput = { title: form.title.trim(), content: form.content, type: form.type };
      if (form.categoryId !== null) {
        patch.categoryId = form.categoryId;
      }
      patch.priority = form.priority;
      await itemRepository.updateItem(id, patch);
      await itemRepository.updateItemTime(id, { startAt: form.startAt, endAt: form.endAt, allDay: form.allDay });
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

  const sourceReadOnly = loaded?.sourceReadOnly ?? false;

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
        {sourceReadOnly ? (
          <View style={styles.readonlyBox}>
            <Text style={styles.readonlyTitle}>来源：ICS（只读）</Text>
            <Text style={styles.readonlyText}>
              此条目来自 ICS 导入，时间/标题/内容不可编辑；可完成、归档或在详情页删除本地副本。
            </Text>
          </View>
        ) : null}

        <ItemFormFields
          form={form}
          categories={categories}
          sourceReadOnly={sourceReadOnly}
          onAddTag={() => {
            void handleAddTag();
          }}
          onRemoveTag={(tag) => {
            void handleRemoveTag(tag);
          }}
          deviceTzid={deviceTzid}
        />

        {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

        <View style={styles.row}>
          <Pressable
            style={[styles.primaryButton, (submitting || sourceReadOnly) && styles.disabled]}
            onPress={() => {
              void handleSave();
            }}
            disabled={submitting || sourceReadOnly}
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
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
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
