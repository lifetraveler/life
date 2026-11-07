/**
 * 领域类型定义：Tag / ItemTag（纯 TypeScript，不依赖 React Native / WatermelonDB）。
 *
 * Tag 与 ItemTag 的字段集合是 AGENTS.md §4.4 的受保护契约：
 * 不得增删字段、不得重命名；Item 与 Tag 为多对多，通过 ItemTag 关联。
 *
 * v0.14（AGENTS.md §7.22，schema v6）明确扩展 color / emoji 两个字段；
 * 列 isOptional，迁移对既有行回填 null，读取层（toDomainTag）保持 null。
 */

import type { Item } from './item';

/** 数据模型：Tag（AGENTS.md §4.4 + §7.22 扩展） */
export interface Tag {
  id: string;
  /** 全局唯一；唯一性（trim + 大小写不敏感）由 Repository 层保证 */
  name: string;
  /** 标签颜色；null 时 UI 回退默认样式（既有标签经迁移回填 null） */
  color: string | null;
  /** 标签图标（emoji）；null 时 UI 不显示图标 */
  emoji: string | null;
  /** 毫秒时间戳 */
  createdAt: number;
}

/** 数据模型：ItemTag 关联（AGENTS.md §4.4） */
export interface ItemTag {
  id: string;
  itemId: string;
  tagId: string;
  /** 毫秒时间戳 */
  createdAt: number;
}

/** Item 及其标签视图（AGENTS.md §4.5） */
export type ItemWithTags = Item & { tags: Tag[] };

/** 标签名规范化结果：name 用于展示与存储，dedupKey 用于大小写不敏感查重 */
export interface NormalizedTagName {
  name: string;
  dedupKey: string;
}

/**
 * 标签名规范化：trim；大小写不敏感查重键取 toLowerCase()。
 * 空串交由调用方（Repository）判定并报错。
 */
export function normalizeTagName(rawName: string): NormalizedTagName {
  const name = rawName.trim();
  return { name, dedupKey: name.toLowerCase() };
}
