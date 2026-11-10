/**
 * Item 表单字段状态（切片 14 阶段 5）：
 * - 从 item/[id]/edit.tsx 抽出，供编辑页与全屏新建页（src/app/item/new.tsx）共用
 *   同一套字段与校验（任务卡阶段 5：新建页复用标准编辑页表单逻辑）；
 * - 纯 UI 层状态：不 import WatermelonDB（AGENTS.md §4），持久化由页面组装；
 * - tags 语义由页面决定：编辑页 = 已绑定标签（增删即时走 Repository），
 *   新建页 = 待绑定标签占位（createItem 后逐个 addTagToItem）。
 */

import { useCallback, useState } from 'react';

import type { Item } from '../domain/item';
import type { Tag } from '../domain/tag';

/** 表单字段全集（页面可见的受控状态；categoryId null=未选/未加载） */
export interface ItemFormValues {
  title: string;
  content: string;
  type: Item['type'];
  categoryId: string | null;
  priority: number;
  startAt: number | null;
  endAt: number | null;
  allDay: boolean;
  tags: Tag[];
  tagInput: string;
}

/** 新建页初始值（编辑页不使用初始值：加载后 reset 回填） */
export const EMPTY_ITEM_FORM_VALUES: ItemFormValues = {
  title: '',
  content: '',
  type: 'note',
  categoryId: null,
  priority: 0,
  startAt: null,
  endAt: null,
  allDay: false,
  tags: [],
  tagInput: '',
};

/** 共享表单句柄：字段值 + setter + 整体重置 + 共享校验 */
export interface ItemForm {
  title: string;
  content: string;
  type: Item['type'];
  categoryId: string | null;
  priority: number;
  startAt: number | null;
  endAt: number | null;
  allDay: boolean;
  tags: Tag[];
  tagInput: string;
  setTitle: (v: string) => void;
  setContent: (v: string) => void;
  setType: (v: Item['type']) => void;
  setCategoryId: (v: string | null) => void;
  setPriority: (v: number) => void;
  setStartAt: (v: number | null) => void;
  setEndAt: (v: number | null) => void;
  setAllDay: (v: boolean) => void;
  setTags: (v: Tag[]) => void;
  setTagInput: (v: string) => void;
  /** 整体重置为给定值（编辑页加载后回填；tagInput 传 ''） */
  reset: (values: ItemFormValues) => void;
  /** 共享校验：标题必填、endAt ≥ startAt。返回错误文案或 null */
  validate: () => string | null;
}

export function useItemForm(): ItemForm {
  const [values, setValues] = useState<ItemFormValues>(EMPTY_ITEM_FORM_VALUES);

  // patch/reset 引用稳定（setState 稳定），页面可在 useCallback 依赖中安全引用。
  const patch = useCallback((next: Partial<ItemFormValues>): void => {
    setValues((current) => ({ ...current, ...next }));
  }, []);

  const reset = useCallback((next: ItemFormValues): void => {
    setValues(next);
  }, []);

  const validate = useCallback((): string | null => {
    if (values.title.trim().length === 0) {
      return '标题不能为空';
    }
    if (values.startAt !== null && values.endAt !== null && values.endAt < values.startAt) {
      return '结束时间必须不早于开始时间';
    }
    return null;
  }, [values]);

  return {
    ...values,
    setTitle: (v) => patch({ title: v }),
    setContent: (v) => patch({ content: v }),
    setType: (v) => patch({ type: v }),
    setCategoryId: (v) => patch({ categoryId: v }),
    setPriority: (v) => patch({ priority: v }),
    setStartAt: (v) => patch({ startAt: v }),
    setEndAt: (v) => patch({ endAt: v }),
    setAllDay: (v) => patch({ allDay: v }),
    setTags: (v) => patch({ tags: v }),
    setTagInput: (v) => patch({ tagInput: v }),
    reset,
    validate,
  };
}
