import { EMPTY_ITEM_FILTERS, filterItems } from '../filters';
import type { ItemFilters } from '../filters';
import type { ItemWithRelations } from '../../relations/itemWithRelations';
import type { Tag } from '../../tag';

function makeTag(id: string, overrides: Partial<Tag> = {}): Tag {
  return { id, name: `标签${id}`, color: null, emoji: null, createdAt: 0, ...overrides };
}

function makeItem(overrides: Partial<ItemWithRelations> & { id: string }): ItemWithRelations {
  const base: Omit<ItemWithRelations, 'id'> = {
    type: 'task',
    title: overrides.id,
    content: '',
    status: 'active',
    startAt: null,
    endAt: null,
    allDay: false,
    sourceType: 'local',
    sourceUid: null,
    sourceReadOnly: false,
    categoryId: 'other',
    priority: 0,
    createdAt: 0,
    updatedAt: 0,
    tags: [],
    category: null,
  };
  return { ...base, ...overrides };
}

/** 固定四条覆盖 分类×来源×标签 的组合矩阵 */
const T_WORK = makeTag('t-work');
const T_LIFE = makeTag('t-life');
const T_OTHER = makeTag('t-other');

const WORK_LOCAL = makeItem({ id: 'work-local', categoryId: 'work', sourceType: 'local', tags: [T_WORK] });
const WORK_ICS = makeItem({ id: 'work-ics', categoryId: 'work', sourceType: 'ics', tags: [T_LIFE, T_OTHER] });
const STUDY_SYSTEM = makeItem({ id: 'study-system', categoryId: 'study', sourceType: 'system-calendar', tags: [] });
const OTHER_LOCAL = makeItem({ id: 'other-local', categoryId: 'other', sourceType: 'local', tags: [T_OTHER] });

const ALL = [WORK_LOCAL, WORK_ICS, STUDY_SYSTEM, OTHER_LOCAL];

function ids(items: ItemWithRelations[]): string[] {
  return items.map((it) => it.id);
}

function withCategory(categoryIds: string[]): ItemFilters {
  return { ...EMPTY_ITEM_FILTERS, categoryIds };
}

function withSources(sourceTypes: ItemFilters['sourceTypes']): ItemFilters {
  return { ...EMPTY_ITEM_FILTERS, sourceTypes };
}

function withTags(tagIds: string[]): ItemFilters {
  return { ...EMPTY_ITEM_FILTERS, tagIds };
}

describe('filterItems：空 filters', () => {
  it('EMPTY_ITEM_FILTERS 全维度为空', () => {
    expect(EMPTY_ITEM_FILTERS).toEqual({ categoryIds: [], sourceTypes: [], tagIds: [] });
  });

  it('空 filters 全过：返回新数组、保持输入顺序与元素引用', () => {
    const result = filterItems(ALL, EMPTY_ITEM_FILTERS);
    expect(ids(result)).toEqual(['work-local', 'work-ics', 'study-system', 'other-local']);
    expect(result).not.toBe(ALL);
    expect(result[0]).toBe(ALL[0]);
    expect(result[3]).toBe(ALL[3]);
  });

  it('EMPTY_ITEM_FILTERS 与字面量全空 filters 等价', () => {
    const literal: ItemFilters = { categoryIds: [], sourceTypes: [], tagIds: [] };
    expect(filterItems(ALL, EMPTY_ITEM_FILTERS)).toEqual(filterItems(ALL, literal));
  });

  it('不修改（mutate）输入数组', () => {
    const items = [WORK_LOCAL, STUDY_SYSTEM];
    const snapshot = [...items];
    filterItems(items, withCategory(['study']));
    expect(items).toEqual(snapshot);
    expect(items).toHaveLength(2);
  });
});

describe('filterItems：单维度多值 OR', () => {
  it('categoryIds 命中任一即通过', () => {
    expect(ids(filterItems(ALL, withCategory(['work', 'study'])))).toEqual([
      'work-local',
      'work-ics',
      'study-system',
    ]);
  });

  it('sourceTypes 命中任一即通过', () => {
    expect(ids(filterItems(ALL, withSources(['ics', 'system-calendar'])))).toEqual([
      'work-ics',
      'study-system',
    ]);
  });

  it('tagIds 命中 item.tags 任一即通过', () => {
    expect(ids(filterItems(ALL, withTags(['t-life'])))).toEqual(['work-ics']);
  });

  it('tagIds 多值 OR：任一标签命中即通过', () => {
    expect(ids(filterItems(ALL, withTags(['t-work', 't-life'])))).toEqual(['work-local', 'work-ics']);
  });
});

describe('filterItems：跨维度 AND', () => {
  it('分类 AND 标签：只保留同时命中的项', () => {
    // work-ics 是 work 分类但没有 t-work 标签，被排除
    const filters: ItemFilters = { categoryIds: ['work'], sourceTypes: [], tagIds: ['t-work'] };
    expect(ids(filterItems(ALL, filters))).toEqual(['work-local']);
  });

  it('三维 AND：分类 + 来源 + 标签交集', () => {
    const filters: ItemFilters = { categoryIds: ['work'], sourceTypes: ['ics'], tagIds: ['t-life'] };
    expect(ids(filterItems(ALL, filters))).toEqual(['work-ics']);
  });

  it('维度命中但另一维度无命中 → 空数组', () => {
    expect(filterItems(ALL, withCategory(['health']))).toEqual([]);
    expect(filterItems([WORK_LOCAL], withTags(['t-other']))).toEqual([]);
  });
});
