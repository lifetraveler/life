/**
 * Item 表单字段（切片 14 阶段 5）：
 * - 编辑页（item/[id]/edit.tsx）与全屏新建页（item/new.tsx）共用的纯受控字段渲染：
 *   标题/内容/类型/分类/优先级/起止时间/全天/标签；不含持久化、路由与保存按钮；
 * - 只读来源（ICS 导入，sourceReadOnly）：隐藏分类/优先级选择与标签增删，
 *   与原编辑页行为一致（tasks/slice-08.md 实现要求 6）；
 * - 字段样式自原编辑页复制，视觉不变；autoFocusTitle 供 quick-add 落点
 *   （life://quick-add → item/new）聚焦标题输入（ui.md「快速记录落点 v0.14」）。
 */

import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { Category } from '../domain/category';
import type { Item } from '../domain/item';
import type { Tag } from '../domain/tag';
import CategoryChip from './CategoryChip';
import DateTimeField from './DateTimeField';
import TagChip from './TagChip';
import { useTagDisplayMode } from './useTagDisplayMode';
import type { ItemForm } from './useItemForm';

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

interface ItemFormFieldsProps {
  form: ItemForm;
  categories: Category[];
  /** 只读来源（ICS 导入）：隐藏分类/优先级选择与标签增删，与原编辑页一致 */
  sourceReadOnly: boolean;
  /** 「添加」标签按钮回调（编辑页走 Repository；新建页绑定待绑定标签占位） */
  onAddTag: () => void;
  onRemoveTag: (tag: Tag) => void;
  /** 设备时区（时间字段说明文案） */
  deviceTzid: string;
  /** 挂载时聚焦标题输入（仅全屏新建页使用） */
  autoFocusTitle?: boolean;
}

export default function ItemFormFields({
  form,
  categories,
  sourceReadOnly,
  onAddTag,
  onRemoveTag,
  deviceTzid,
  autoFocusTitle = false,
}: ItemFormFieldsProps) {
  const tagDisplayMode = useTagDisplayMode();
  return (
    <>
      <Text style={styles.label}>标题</Text>
      <TextInput
        style={styles.input}
        value={form.title}
        onChangeText={form.setTitle}
        placeholder="标题"
        autoFocus={autoFocusTitle}
      />

      <Text style={styles.label}>内容</Text>
      <TextInput
        style={[styles.input, styles.contentInput]}
        value={form.content}
        onChangeText={form.setContent}
        placeholder="内容（可选）"
        multiline
      />

      <Text style={styles.label}>类型</Text>
      <View style={styles.row}>
        {TYPE_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            style={[styles.chip, form.type === option.value && styles.chipActive]}
            onPress={() => form.setType(option.value)}
          >
            <Text style={[styles.chipText, form.type === option.value && styles.chipTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {sourceReadOnly ? null : (
        <>
          {/* 分类选择器——横向滑动 Chip，选中高亮，保存时随页面提交 categoryId。 */}
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
                  form.categoryId === category.id && styles.categoryOptionActive,
                ]}
                onPress={() => form.setCategoryId(category.id)}
              >
                <CategoryChip category={category} />
              </Pressable>
            ))}
          </ScrollView>

          {/* 优先级选择器（0-3，保存时随页面提交 priority）。 */}
          <Text style={styles.label}>优先级</Text>
          <View style={styles.row}>
            {PRIORITY_OPTIONS.map((value) => (
              <Pressable
                key={value}
                style={[styles.chip, form.priority === value && styles.chipActive]}
                onPress={() => form.setPriority(value)}
              >
                <Text style={[styles.chipText, form.priority === value && styles.chipTextActive]}>
                  {priorityOptionLabel(value)}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Text style={styles.label}>开始时间（按设备时区 {deviceTzid} 显示）</Text>
      <DateTimeField label="开始" value={form.startAt} mode="datetime" onChange={form.setStartAt} />

      <Text style={styles.label}>结束时间</Text>
      <DateTimeField label="结束" value={form.endAt} mode="datetime" onChange={form.setEndAt} />

      <View style={styles.switchRow}>
        <Text style={styles.label}>全天</Text>
        <Switch value={form.allDay} onValueChange={form.setAllDay} />
      </View>

      <Text style={styles.label}>标签</Text>
      <View style={styles.row}>
        {form.tags.length === 0 ? <Text style={styles.meta}>暂无标签</Text> : null}
        {form.tags.map((tag) => (
          <TagChip
            key={tag.id}
            tag={tag}
            mode={tagDisplayMode}
            onRemove={sourceReadOnly ? undefined : () => onRemoveTag(tag)}
          />
        ))}
      </View>
      {sourceReadOnly ? null : (
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.tagInput]}
            value={form.tagInput}
            onChangeText={form.setTagInput}
            placeholder="新标签名"
          />
          <Pressable style={styles.secondaryButton} onPress={onAddTag}>
            <Text style={styles.secondaryText}>添加</Text>
          </Pressable>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
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
  meta: {
    fontSize: 12,
    color: '#888',
  },
});
