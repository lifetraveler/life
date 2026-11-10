/**
 * 水合领域类型：ItemWithRelations（AGENTS.md §7.23 / repository.md v0.14）。
 *
 * Repository 的查询必须水合（Hydrate）关联的 Category 与 Tags；
 * 视图与 UI 层只消费 ItemWithRelations，不得自行查询 Category / Tag 表（§7.23）。
 *
 * 结构上是 ItemWithTags 的超集：既有消费 ItemWithTags 的调用方编译兼容。
 */
import type { Category } from '../category';
import type { Item } from '../item';
import type { Tag } from '../tag';

export type ItemWithRelations = Item & { tags: Tag[]; category: Category | null };
