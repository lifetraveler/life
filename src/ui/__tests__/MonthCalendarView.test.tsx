/**
 * 月历渲染回归（切片 14 阶段 5c）：真实渲染 MonthCalendarView，
 * 排查并锁定「月视图空白格子」——断言已知条目的 chip 标题与日号出现在渲染树。
 */
import TestRenderer from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import { MonthCalendarView } from '../MonthCalendarView';
import { itemsByDay } from '../../domain/views/itemsByDay';
import type { ItemWithRelations } from '../../domain/relations/itemWithRelations';

/** 2026-11-09 06:00 Asia/Shanghai（= UTC 2026-11-08 22:00） */
const START = Date.UTC(2026, 10, 8, 22, 0, 0);

function makeItem(overrides: Partial<ItemWithRelations>): ItemWithRelations {
  const base: ItemWithRelations = {
    id: 'i1',
    type: 'event',
    title: '晨练',
    content: '',
    status: 'active',
    startAt: START,
    endAt: START + 3_600_000,
    allDay: false,
    sourceType: 'local',
    sourceUid: null,
    sourceReadOnly: false,
    categoryId: 'other',
    priority: 0,
    createdAt: 1,
    updatedAt: 1,
    tags: [],
    category: null,
  };
  return { ...base, ...overrides };
}

function collectTexts(root: ReactTestInstance): string[] {
  const texts: string[] = [];
  for (const node of root.findAll(() => true)) {
    const children = node.props.children;
    if (typeof children === 'string' || typeof children === 'number') {
      texts.push(String(children));
    }
  }
  return texts;
}

describe('MonthCalendarView 渲染', () => {
  it('已知条目的 chip 标题与日号出现在渲染树', async () => {
    const item = makeItem({});
    const dayItems = itemsByDay([item], 'Asia/Shanghai');
    expect(dayItems.get('2026-11-09')?.map((entry) => entry.id)).toEqual(['i1']);

    let tree!: ReactTestRenderer;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <MonthCalendarView
          months={[{ year: 2026, month: 11 }]}
          dayItems={dayItems}
          todayKey="2026-11-09"
          onSelectDay={() => undefined}
          onPrependMonth={() => undefined}
          onAppendMonth={() => undefined}
        />,
      );
    });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('晨练');
    expect(texts).toContain('9');
  });
});
