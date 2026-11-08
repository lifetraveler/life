import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { itemRepository } from '../../data';
import type { Category } from '../../domain/category';
import type { Tag } from '../../domain/tag';
import { reminderScheduler } from '../../notifications';
import ItemFormFields from '../../ui/ItemFormFields';
import { useItemForm } from '../../ui/useItemForm';
import { getDeviceTzid } from '../../ui/timeFormat';

/**
 * 全屏新建页（切片 14 阶段 5，tasks/slice-14.md 阶段 5 FAB 落点 life://item/new）：
 * - 复用标准编辑页表单（ui/ItemFormFields + ui/useItemForm，标题自动聚焦）；
 * - 保存链：createItem（§4.7；categoryId null 不传 → 落 'other'；priority 默认 0）→
 *   updateItemTime（时间字段只走 §4.24）→ 逐个 addTagToItem（待绑定标签名）→
 *   reconcile()（§4.27，失败不阻断）→ router.back() 返回计划页；
 *   列表由计划页响应式订阅自动刷新（验收 17）；
 * - life://item/new 深链与计划页 FAB push 同一路由；quick-add（life://quick-add）
 *   也落在本页（ui.md「快速记录落点 v0.14」）；
 * - 未保存草稿由「放弃新建」确认弹窗保护（替代原主页返回键草稿判定）。
 */

/** 新建页待绑定标签：尚无 Tag 记录，以占位 id 构造 Chip 渲染用对象，保存时取 name 落库 */
function fabricatedTag(name: string): Tag {
  return { id: `pending:${name}`, name, color: null, emoji: null, createdAt: 0 };
}

export default function ItemNewPage() {
  const router = useRouter();
  const form = useItemForm();
  const [categories, setCategories] = useState<Category[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const deviceTzid = getDeviceTzid();

  useEffect(() => {
    itemRepository
      .getCategories()
      .then((loaded) => {
        setCategories(loaded);
      })
      .catch((error: unknown) => {
        console.warn('[slice-14] 新建页读取分类失败', error);
      });
  }, []);

  const handleAddTag = (): void => {
    const name = form.tagInput.trim();
    if (name.length === 0) {
      return;
    }
    // 去重（大小写不敏感，与 collectTagNames 语义一致）
    if (form.tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) {
      form.setTagInput('');
      return;
    }
    form.setTags([...form.tags, fabricatedTag(name)]);
    form.setTagInput('');
  };

  const handleRemoveTag = (tag: Tag): void => {
    form.setTags(form.tags.filter((candidate) => candidate.id !== tag.id));
  };

  /** 草稿非空判定：任一字段偏离初始值即视为有未保存内容 */
  const isDirty = (): boolean =>
    form.title.trim().length > 0 ||
    form.content.trim().length > 0 ||
    form.tagInput.trim().length > 0 ||
    form.tags.length > 0 ||
    form.type !== 'note' ||
    form.categoryId !== null ||
    form.priority !== 0 ||
    form.startAt !== null ||
    form.endAt !== null ||
    form.allDay;

  const confirmCancel = (): void => {
    if (!isDirty()) {
      router.back();
      return;
    }
    Alert.alert('放弃新建', '未保存的内容将丢失。', [
      { text: '继续编辑', style: 'cancel' },
      { text: '放弃', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  const handleSave = async (): Promise<void> => {
    if (submitting) {
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
      const created = await itemRepository.createItem({
        type: form.type,
        title: form.title.trim(),
        content: form.content.trim(),
        ...(form.categoryId !== null ? { categoryId: form.categoryId } : {}),
        priority: form.priority,
      });
      // 时间字段只走 §4.24 updateItemTime（与编辑页同一路径）
      await itemRepository.updateItemTime(created.id, {
        startAt: form.startAt,
        endAt: form.endAt,
        allDay: form.allDay,
      });
      for (const tag of form.tags) {
        await itemRepository.addTagToItem(created.id, tag.name);
      }
      // §4.27：Item 时间变更后 reconcile；失败不阻断保存，错误写日志。
      try {
        await reminderScheduler.reconcile();
      } catch (error) {
        console.warn('[slice-14] 新建保存后 reconcile 失败', error);
      }
      router.back();
    } catch (error) {
      console.warn('[slice-14] 新建保存失败', error);
      setFormError(`保存失败：${String(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
        <ItemFormFields
          form={form}
          categories={categories}
          sourceReadOnly={false}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          deviceTzid={deviceTzid}
          autoFocusTitle
        />

        {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

        <View style={styles.row}>
          <Pressable
            style={[styles.primaryButton, submitting && styles.disabled]}
            onPress={() => {
              void handleSave();
            }}
            disabled={submitting}
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
});
