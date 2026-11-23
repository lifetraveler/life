import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';

import { itemRepository, sparkRepository } from '../../data';
import type { Category } from '../../domain/category';
import type { Tag } from '../../domain/tag';
import { reminderScheduler } from '../../notifications';
import ItemFormFields from '../../ui/ItemFormFields';
import { useItemForm } from '../../ui/useItemForm';
import { getDeviceTzid } from '../../ui/timeFormat';
import { useTheme } from '../../ui/theme';
import type { ThemeColors } from '../../ui/theme';

/**
 * 全屏新建页（切片 14 阶段 5，tasks/slice-14.md 阶段 5 FAB 落点 life://item/new）：
 * - 复用标准编辑页表单（ui/ItemFormFields + ui/useItemForm，标题自动聚焦）；
 * - 保存链：createItem（§4.7；categoryId null 不传 → 落 'other'；priority 默认 0）→
 *   updateItemTime（时间字段只走 §4.24）→ 逐个 addTagToItem（待绑定标签名）→
 *   reconcile()（§4.27，失败不阻断）→ router.back() 返回计划页；
 *   列表由计划页响应式订阅自动刷新（验收 17）；
 * - life://item/new 深链与计划页 FAB push 同一路由；quick-add（life://quick-add）
 *   也落在本页（ui.md「快速记录落点 v0.14」）；
 * - 未保存草稿由「放弃新建」确认弹窗保护（替代原主页返回键草稿判定）；
 * - 切片 37（§7.49 D7）灵感转计划：params.fromSpark 存在时按 title/content 预填
 *   表单，保存成功后 linkSparkToItem 建立关联（失败仅披露，不回滚条目），
 *   成功返回灵感详情页。
 */

/** 新建页待绑定标签：尚无 Tag 记录，以占位 id 构造 Chip 渲染用对象，保存时取 name 落库 */
function fabricatedTag(name: string): Tag {
  return { id: `pending:${name}`, name, color: null, emoji: null, createdAt: 0 };
}

export default function ItemNewPage() {
  // 切片 24（§7.36）：颜色走全局 Token（夜间模式），深浅色跟随系统。
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const router = useRouter();
  const params = useLocalSearchParams<{ fromSpark?: string; title?: string; content?: string }>();
  // 切片 37：仅 fromSpark 存在时进入转计划预填模式（无该参数的入口零改动）。
  const fromSparkId = typeof params.fromSpark === 'string' && params.fromSpark.length > 0 ? params.fromSpark : null;
  const form = useItemForm();
  const [prefilled, setPrefilled] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const deviceTzid = getDeviceTzid();

  // 灵感转计划预填（一次性；useItemForm 无初始值入口，挂载后 set 一次）。
  useEffect(() => {
    if (prefilled || fromSparkId === null) return;
    if (typeof params.title === 'string' && params.title.length > 0) {
      form.setTitle(params.title);
    }
    if (typeof params.content === 'string' && params.content.length > 0) {
      form.setContent(params.content);
    }
    setPrefilled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromSparkId, params.title, params.content, prefilled]);

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
      // 切片 37：灵感转计划——保存成功后建立关联（失败仅披露，不回滚条目）。
      if (fromSparkId !== null) {
        try {
          await sparkRepository.linkSparkToItem(fromSparkId, created.id);
        } catch (error) {
          console.warn('[slice-37] 灵感关联计划失败（条目已保存）', error);
          Alert.alert('已保存', '灵感关联失败，可在灵感详情页手动关联。');
        }
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

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    scroll: {
      flex: 1,
      backgroundColor: c.background,
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
      color: c.danger,
      marginTop: 8,
    },
    primaryButton: {
      backgroundColor: c.primary,
      borderRadius: 6,
      paddingVertical: 10,
      paddingHorizontal: 18,
    },
    primaryText: {
      color: c.textOnPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    secondaryButton: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 6,
      paddingVertical: 9,
      paddingHorizontal: 14,
      backgroundColor: c.card,
    },
    secondaryText: {
      fontSize: 13,
      color: c.textMuted,
    },
    disabled: {
      opacity: 0.5,
    },
  });
}
