import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

/**
 * categories 表的 WatermelonDB model（切片 14，AGENTS.md §7.22，schema v6）。
 * 字段与 src/domain/category.ts 的 Category 一一对应。
 * 预置 5 条（work/personal/study/health/other）：升级安装经 migration SQL 插入，
 * 全新安装经 src/db/seed.ts 幂等 seed；主键固定为契约 id。
 * 本切片不支持自定义新增/删除分类，仅允许改颜色/Emoji（经 Repository updateCategoryVisuals）。
 */
export default class CategoryModel extends Model {
  static table = 'categories';

  @text('name') name!: string;

  @field('color') color!: string | null;

  @field('emoji') emoji!: string | null;

  @field('priority') priority!: number;
}
