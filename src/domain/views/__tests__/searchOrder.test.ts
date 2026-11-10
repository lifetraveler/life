import { sortSearchResults } from '../searchOrder';
import type { ItemWithRelations } from '../../relations/itemWithRelations';

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

const NOV7_0900 = Date.UTC(2026, 10, 7, 1, 0);
const NOV7_1000 = Date.UTC(2026, 10, 7, 2, 0);
const NOV8_1200 = Date.UTC(2026, 10, 8, 4, 0);

describe('sortSearchResults', () => {
  it('有 startAt 的按开始时间倒序在前，无 startAt 按 createdAt 倒序在末尾', () => {
    const early = makeItem({ id: 'early', startAt: NOV7_0900, endAt: null });
    const late = makeItem({ id: 'late', startAt: NOV8_1200, endAt: null });
    const mid = makeItem({ id: 'mid', startAt: NOV7_1000, endAt: null });
    const u1 = makeItem({ id: 'u1', startAt: null, createdAt: 10 });
    const u2 = makeItem({ id: 'u2', startAt: null, createdAt: 20 });
    const result = sortSearchResults([u1, mid, u2, early, late]);
    expect(result.map((it) => it.id)).toEqual(['late', 'mid', 'early', 'u2', 'u1']);
  });

  it('并列 startAt 按 createdAt 倒序，并列 createdAt 按 id 确定化', () => {
    const a = makeItem({ id: 'a', startAt: NOV7_0900, endAt: null, createdAt: 5 });
    const b = makeItem({ id: 'b', startAt: NOV7_0900, endAt: null, createdAt: 9 });
    const c = makeItem({ id: 'c', startAt: NOV7_0900, endAt: null, createdAt: 9 });
    const result = sortSearchResults([a, b, c]);
    expect(result.map((it) => it.id)).toEqual(['b', 'c', 'a']);
  });

  it('空数组与单项透传', () => {
    expect(sortSearchResults([])).toEqual([]);
    const only = makeItem({ id: 'x', startAt: null, createdAt: 1 });
    expect(sortSearchResults([only])).toEqual([only]);
  });
});
