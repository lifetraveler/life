/**
 * buildWeekWidgetSnapshot / getWidgetWeekDayStarts / narrowWidgetWeekSnapshot 单测
 * （切片 14 阶段 7b，docs/proposals/slice-14-widget-phase7.md）：
 * 1) 日起点计算：UTC 下 7 天逐日 +24h，rangeEndMs = 第 8 天 00:00；
 * 2) 7 天恒在：labels 今天/明天/'周X D'、civilKey 'YYYY-MM-DD'；
 * 3) 分桶：条目按 startAt 落到对应天，组内沿用输入序；越界（早于今天）丢弃；
 * 4) 每天护栏 20 截断；
 * 5) 过滤：archived / startAt null 跳过；done 保留；
 * 6) allDay → '全天'（复用 toScheduledEntry，时间标签规则不重测）；
 * 7) 收窄：合法往返、根缺 days → null、坏日跳过、categoryColor 宽松读。
 * 期望值独立构造，时区统一 'UTC'（jest 与真机运行时行为一致，确定性最高）。
 */

import {
  buildWeekWidgetSnapshot,
  getWidgetWeekDayStarts,
  narrowWidgetWeekSnapshot,
  WIDGET_WEEK_MAX_PER_DAY,
  WIDGET_WEEK_SNAPSHOT_PREFS_KEY,
} from '../weekSnapshot';
import type { Category } from '../../category';
import type { ItemWithRelations } from '../../relations/itemWithRelations';
import type { ItemStatus, ItemType } from '../../item';

const NOW = Date.UTC(2026, 2, 15, 6, 0); // UTC 2026-03-15（周日）06:00
const TZID = 'UTC';

/** 测试夹具分类（§7.22 Category 结构子集全字段），同 snapshot.test.ts */
function makeCategory(overrides: {
  id: string;
  name?: string;
  color?: string | null;
  emoji?: string | null;
}): Category {
  return {
    id: overrides.id,
    name: overrides.name ?? `分类${overrides.id}`,
    color: overrides.color ?? null,
    emoji: overrides.emoji ?? null,
    priority: 0,
  };
}

/** 测试夹具：必填字段给确定值，按参数覆盖（同 snapshot.test.ts 模式） */
function makeItem(overrides: {
  id: string;
  title?: string;
  type?: ItemType;
  status?: ItemStatus;
  startAt?: number | null;
  endAt?: number | null;
  allDay?: boolean;
  createdAt?: number;
  category?: Category | null;
}): ItemWithRelations {
  return {
    id: overrides.id,
    type: overrides.type ?? 'task',
    title: overrides.title ?? `标题${overrides.id}`,
    content: '不应出现在快照',
    status: overrides.status ?? 'active',
    startAt: overrides.startAt ?? null,
    endAt: overrides.endAt ?? null,
    allDay: overrides.allDay ?? false,
    sourceType: 'local',
    sourceUid: null,
    sourceReadOnly: false,
    // 切片 14 编译必需夹具补字段（§7.13）
    categoryId: overrides.category?.id ?? 'other',
    priority: 0,
    createdAt: overrides.createdAt ?? 1000,
    updatedAt: 1000,
    tags: [],
    category: overrides.category ?? null,
  };
}

describe('WIDGET_WEEK_SNAPSHOT_PREFS_KEY', () => {
  it('阶段 7b 键名 widget_week_snapshot_v1（今日冻结键不受影响）', () => {
    expect(WIDGET_WEEK_SNAPSHOT_PREFS_KEY).toBe('widget_week_snapshot_v1');
  });
});

describe('getWidgetWeekDayStarts', () => {
  it('UTC 下返回今天起 7 个逐日 +24h 的起点，rangeEndMs 为第 8 天 00:00', () => {
    const { dayStartsMs, rangeEndMs } = getWidgetWeekDayStarts(NOW, TZID);
    expect(dayStartsMs).toHaveLength(7);
    expect(dayStartsMs[0]).toBe(Date.UTC(2026, 2, 15));
    for (let i = 1; i < 7; i += 1) {
      expect(dayStartsMs[i]).toBe(dayStartsMs[i - 1] + 24 * 60 * 60 * 1000);
    }
    expect(rangeEndMs).toBe(Date.UTC(2026, 2, 22));
  });
});

describe('buildWeekWidgetSnapshot · 7 天恒在', () => {
  it('空输入仍产出 7 组：labels 今天/明天/周X D，civilKey 逐日递增', () => {
    const { dayStartsMs } = getWidgetWeekDayStarts(NOW, TZID);
    const snapshot = buildWeekWidgetSnapshot({ items: [], dayStartsMs, nowMs: NOW, tzid: TZID });
    expect(snapshot.generatedAt).toBe(NOW);
    expect(snapshot.tzid).toBe(TZID);
    expect(snapshot.days).toHaveLength(7);
    expect(snapshot.days.map((day) => day.dayLabel)).toEqual([
      '今天',
      '明天',
      '周二 17',
      '周三 18',
      '周四 19',
      '周五 20',
      '周六 21',
    ]);
    expect(snapshot.days.map((day) => day.civilKey)).toEqual([
      '2026-03-15',
      '2026-03-16',
      '2026-03-17',
      '2026-03-18',
      '2026-03-19',
      '2026-03-20',
      '2026-03-21',
    ]);
    expect(snapshot.days.every((day) => day.entries.length === 0)).toBe(true);
  });
});

describe('buildWeekWidgetSnapshot · 分桶与条目', () => {
  it('条目按 startAt 落到对应天；allDay → 全天；组内沿用输入序；越界项丢弃', () => {
    const { dayStartsMs } = getWidgetWeekDayStarts(NOW, TZID);
    const snapshot = buildWeekWidgetSnapshot({
      items: [
        makeItem({ id: 'before', startAt: Date.UTC(2026, 2, 14, 10, 0) }), // 早于今天 → 丢
        makeItem({ id: 'd0-b', startAt: Date.UTC(2026, 2, 15, 10, 30), title: '今天晚的' }),
        makeItem({ id: 'd0-a', startAt: Date.UTC(2026, 2, 15, 8, 0), title: '今天早的' }),
        makeItem({ id: 'd2-allday', startAt: Date.UTC(2026, 2, 17, 0, 0), allDay: true }),
        makeItem({
          id: 'd6-done',
          status: 'done',
          startAt: Date.UTC(2026, 2, 21, 23, 5),
          category: makeCategory({ id: 'work', color: '#E57373' }),
        }),
      ],
      dayStartsMs,
      nowMs: NOW,
      tzid: TZID,
    });
    // 纯函数不重排：组内沿用输入序（startAt 升序是查询端职责），此处输入乱序
    // 恰好实证「不重排」口径
    expect(snapshot.days[0].entries.map((e) => e.id)).toEqual(['d0-b', 'd0-a']);
    expect(snapshot.days[1].entries).toHaveLength(0);
    expect(snapshot.days[2].entries).toHaveLength(1);
    expect(snapshot.days[2].entries[0].timeLabel).toBe('全天');
    expect(snapshot.days[6].entries).toHaveLength(1);
    expect(snapshot.days[6].entries[0].status).toBe('done');
    expect(snapshot.days[6].entries[0].timeLabel).toBe('23:05');
    expect(snapshot.days[6].entries[0].categoryColor).toBe('#E57373');
    // 越界项（before）不出现在任何组
    expect(snapshot.days.flatMap((day) => day.entries.map((e) => e.id))).not.toContain('before');
  });

  it('archived 与 startAt null 条目跳过（防御）', () => {
    const { dayStartsMs } = getWidgetWeekDayStarts(NOW, TZID);
    const snapshot = buildWeekWidgetSnapshot({
      items: [
        makeItem({ id: 'archived', status: 'archived', startAt: Date.UTC(2026, 2, 15, 9, 0) }),
        makeItem({ id: 'no-start', startAt: null }),
      ],
      dayStartsMs,
      nowMs: NOW,
      tzid: TZID,
    });
    expect(snapshot.days.flatMap((day) => day.entries)).toHaveLength(0);
  });

  it(`每天最多 ${WIDGET_WEEK_MAX_PER_DAY} 条（护栏截断，超出丢弃）`, () => {
    const { dayStartsMs } = getWidgetWeekDayStarts(NOW, TZID);
    const items = Array.from({ length: WIDGET_WEEK_MAX_PER_DAY + 5 }, (_, i) =>
      makeItem({ id: `x${i}`, startAt: Date.UTC(2026, 2, 18, 8, i) }),
    );
    const snapshot = buildWeekWidgetSnapshot({ items, dayStartsMs, nowMs: NOW, tzid: TZID });
    expect(snapshot.days[3].entries).toHaveLength(WIDGET_WEEK_MAX_PER_DAY);
    expect(snapshot.days[3].entries[0].id).toBe('x0');
    // 其余天不受影响
    expect(snapshot.days[0].entries).toHaveLength(0);
  });

  it('dayStartsMs 数量不是 7 时抛错（编程错误，防静默错桶）', () => {
    expect(() =>
      buildWeekWidgetSnapshot({ items: [], dayStartsMs: [NOW], nowMs: NOW, tzid: TZID }),
    ).toThrow('expected 7 day starts');
  });
});

describe('narrowWidgetWeekSnapshot', () => {
  it('合法快照往返保留；categoryColor undefined 宽松读为 null', () => {
    const parsed = narrowWidgetWeekSnapshot({
      generatedAt: NOW,
      tzid: TZID,
      days: [
        {
          civilKey: '2026-03-15',
          dayLabel: '今天',
          entries: [
            {
              id: 'a',
              title: 'A',
              type: 'task',
              timeLabel: '10:00',
              status: 'active',
              // 无 categoryColor 字段（旧版本快照）
            },
          ],
        },
      ],
    });
    expect(parsed).toEqual({
      generatedAt: NOW,
      tzid: TZID,
      days: [
        {
          civilKey: '2026-03-15',
          dayLabel: '今天',
          entries: [
            { id: 'a', title: 'A', type: 'task', timeLabel: '10:00', status: 'active', categoryColor: null },
          ],
        },
      ],
    });
  });

  it('根缺 days / 类型不对 → null', () => {
    expect(narrowWidgetWeekSnapshot(null)).toBeNull();
    expect(narrowWidgetWeekSnapshot('week')).toBeNull();
    expect(narrowWidgetWeekSnapshot({ generatedAt: NOW, tzid: TZID })).toBeNull();
    expect(narrowWidgetWeekSnapshot({ generatedAt: NOW, days: [] })).toBeNull();
  });

  it('单个 day 形状不对跳过该日；坏 entry 丢弃，其余保留', () => {
    const parsed = narrowWidgetWeekSnapshot({
      generatedAt: NOW,
      tzid: TZID,
      days: [
        { civilKey: '2026-03-15', entries: [] }, // 缺 dayLabel → 整日跳过
        {
          civilKey: '2026-03-16',
          dayLabel: '明天',
          entries: [
            { id: 'ok', title: 'B', type: 'task', timeLabel: '全天', status: 'done', categoryColor: '#FF0000' },
            '垃圾',
            { id: 42 },
          ],
        },
      ],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.days).toHaveLength(1);
    expect(parsed?.days[0].civilKey).toBe('2026-03-16');
    expect(parsed?.days[0].entries).toHaveLength(1);
    expect(parsed?.days[0].entries[0].id).toBe('ok');
  });
});
