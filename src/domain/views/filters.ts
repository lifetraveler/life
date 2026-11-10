/**
 * 视图筛选纯函数（tasks/slice-14.md 阶段 2 / AGENTS.md §7.21）。
 *
 * 语义：维度内多选 OR（命中任一即通过），维度间 AND（每个启用的维度都必须通过）；
 * 空数组 = 该维度未启用（全部通过）。消费 ItemWithRelations（§7.23），
 * 只读 item.categoryId / item.sourceType / item.tags / item.status，不查库。
 *
 * 阶段 4：新增「状态」维度（§7.21 明文要求；阶段 2 的 ItemFilters 注释约定
 * 「留待阶段 4 接面板时按需扩展」）。状态 chips 仅提供 未完成/已完成；
 * archived 项在查询层已排除（默认列表语义），面板不提供该选项。
 */

import type { ItemSourceType, ItemStatus } from '../item';
import type { ItemWithRelations } from '../relations/itemWithRelations';

/** 筛选状态（筛选面板 §7.21：分类 / 日历源 / 标签 / 状态 四维度多选） */
export interface ItemFilters {
  /** 命中任一分类；空数组 = 不过滤 */
  categoryIds: string[];
  /** 命中任一日历源；空数组 = 不过滤 */
  sourceTypes: ItemSourceType[];
  /** 命中任一标签；空数组 = 不过滤 */
  tagIds: string[];
  /** 命中任一状态（'active' | 'done'）；空数组 = 不过滤（阶段 4 新增） */
  statuses: ItemStatus[];
}

/** 全不过滤的空筛选（调用方初始值，避免散落字面量漂移） */
export const EMPTY_ITEM_FILTERS: ItemFilters = {
  categoryIds: [],
  sourceTypes: [],
  tagIds: [],
  statuses: [],
};

/** 是否存在任一启用维度（主页筛选图标小红点判定，§7.21） */
export function hasActiveFilters(filters: ItemFilters): boolean {
  return (
    filters.categoryIds.length > 0 ||
    filters.sourceTypes.length > 0 ||
    filters.tagIds.length > 0 ||
    filters.statuses.length > 0
  );
}

export function filterItems(items: ItemWithRelations[], filters: ItemFilters): ItemWithRelations[] {
  const categorySet = new Set(filters.categoryIds);
  const sourceSet = new Set(filters.sourceTypes);
  const tagSet = new Set(filters.tagIds);
  const statusSet = new Set(filters.statuses);

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
    if (statusSet.size > 0 && !statusSet.has(item.status)) {
      return false;
    }
    return true;
  });
}
