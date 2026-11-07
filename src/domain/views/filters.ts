/**
 * 视图筛选纯函数（tasks/slice-14.md 阶段 2 / AGENTS.md §7.21）。
 *
 * 语义：维度内多选 OR（命中任一即通过），维度间 AND（每个启用的维度都必须通过）；
 * 空数组 = 该维度未启用（全部通过）。消费 ItemWithRelations（§7.23），
 * 只读 item.categoryId / item.sourceType / item.tags，不查库。
 */

import type { ItemSourceType } from '../item';
import type { ItemWithRelations } from '../relations/itemWithRelations';

/** 筛选状态（筛选面板 §7.21；「状态」维度留待阶段 4 接面板时按需扩展） */
export interface ItemFilters {
  /** 命中任一分类；空数组 = 不过滤 */
  categoryIds: string[];
  /** 命中任一日历源；空数组 = 不过滤 */
  sourceTypes: ItemSourceType[];
  /** 命中任一标签；空数组 = 不过滤 */
  tagIds: string[];
}

/** 全不过滤的空筛选（调用方初始值，避免散落字面量漂移） */
export const EMPTY_ITEM_FILTERS: ItemFilters = { categoryIds: [], sourceTypes: [], tagIds: [] };

export function filterItems(items: ItemWithRelations[], filters: ItemFilters): ItemWithRelations[] {
  const categorySet = new Set(filters.categoryIds);
  const sourceSet = new Set(filters.sourceTypes);
  const tagSet = new Set(filters.tagIds);

  return items.filter((item) => {
    if (categorySet.size > 0 && !categorySet.has(item.categoryId)) {
      return false;
    }
    if (sourceSet.size > 0 && !sourceSet.has(item.sourceType)) {
      return false;
    }
    if (tagSet.size > 0 && !item.tags.some((tag) => tagSet.has(tag.id))) {
      return false;
    }
    return true;
  });
}
