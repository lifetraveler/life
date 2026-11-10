/**
 * 领域类型定义：Category（纯 TypeScript，不依赖 React Native / WatermelonDB）。
 *
 * AGENTS.md §7.22（v0.14，schema v6）：Category 是独立表，Item 经 categoryId 关联；
 * Item 自身不再有 color 字段，卡片颜色统一由关联 Category 提供。
 */

/** 数据模型：Category（AGENTS.md §7.22） */
export interface Category {
  /** 预置分类为固定 id（'work' 等）；本切片不支持自定义新增/删除分类 */
  id: string;
  name: string;
  /** 分类颜色；null 时 UI 回退默认灰色（repository.md v0.14 数据异常回退约定） */
  color: string | null;
  /** 分类图标（emoji）；null 时 UI 不显示图标 */
  emoji: string | null;
  /** 展示排序权重（getCategories 按 priority 升序返回） */
  priority: number;
}

/**
 * 预置分类（data-model.md v0.14「Category 实体与 Item 关联」）：
 * 不可删除、不可新增（本切片不实现自定义分类），仅允许改颜色/Emoji（updateCategoryVisuals）。
 *
 * 本常量是预置数据的唯一数据源：migration v6 的 SQL 插入与全新安装的 seed 均由此生成，
 * 两处不得各写一份字面量（防漂移）。
 */
export const PRESET_CATEGORIES: readonly Category[] = [
  { id: 'work', name: '工作', color: '#E57373', emoji: '💼', priority: 1 },
  { id: 'personal', name: '个人', color: '#64B5F6', emoji: '🏠', priority: 2 },
  { id: 'study', name: '学习', color: '#FFB74D', emoji: '📚', priority: 3 },
  { id: 'health', name: '健康', color: '#81C784', emoji: '🏃', priority: 4 },
  { id: 'other', name: '其他', color: '#9E9E9E', emoji: '📌', priority: 5 },
];

/** Item 未显式指定分类时的默认分类 id（AGENTS.md §7.22：categoryId 默认 'other'） */
export const DEFAULT_CATEGORY_ID = 'other';

/** Item.priority 的合法取值（§7.22：0=无 1=低 2=中 3=高） */
export const ITEM_PRIORITY_MIN = 0;
export const ITEM_PRIORITY_MAX = 3;

/** 校验 Item.priority：必须是 [0, 3] 内的整数（§7.22） */
export function isValidItemPriority(value: number): boolean {
  return Number.isInteger(value) && value >= ITEM_PRIORITY_MIN && value <= ITEM_PRIORITY_MAX;
}

/** priority → 展示标签（§7.22：0=无 1=低 2=中 3=高）；详情页与编辑页共用（阶段 3）。 */
const ITEM_PRIORITY_LABELS: Record<number, string> = { 0: '无', 1: '低', 2: '中', 3: '高' };

/** 取优先级展示标签；越界值回退数字本身（防御库中脏数据）。 */
export function itemPriorityLabel(priority: number): string {
  return ITEM_PRIORITY_LABELS[priority] ?? String(priority);
}
