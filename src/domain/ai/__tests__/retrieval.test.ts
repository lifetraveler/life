/**
 * buildScheduleRetrievalContext 纯函数单测（切片 36 阶段 1，AGENTS.md §7.48
 * 提案 D3）：窗口相交过滤（epoch / allDay 民用日 / 无时刻单列节）、行式
 * 民用化组包（分类后缀/归档完成标注/content 80 字截断）、上限 50 truncated。
 * 时区固定 Asia/Shanghai（无 DST）。
 */

import { buildScheduleRetrievalContext, RETRIEVAL_MAX_ITEMS, CONTENT_SNIPPET_MAX_CHARS } from '../retrieval';
import type { Item } from '../../item';
import type { Category } from '../../category';
import type { ItemWithRelations } from '../../relations/itemWithRelations';

const TZ = 'Asia/Shanghai';
// 2026-11-23 10:00 上海 = UTC 02:00；默认窗口 = 2026-11-23 至 2026-11-29
const NOW = Date.UTC(2026, 10, 23, 2, 0);
const dayStart = (y: number, m1: number, d: number): number => Date.UTC(y, m1 - 1, d) - 8 * 3600_000;
const at = (y: number, m1: number, d: number, h: number, min: number): number =>
  dayStart(y, m1, d) + (h * 60 + min) * 60_000;
const WINDOW = { startMs: dayStart(2026, 11, 23), endMs: dayStart(2026, 11, 30) - 1 };

let seq = 0;
function makeItem(overrides: Partial<Item> & { category?: Category | null } = {}): ItemWithRelations {
  seq += 1;
  const base: Item = {
    id: `item-${seq}`,
    type: 'task',
    title: '标题',
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
    createdAt: NOW,
    updatedAt: NOW,
  };
  const { category = null, ...itemOverrides } = overrides;
  return { ...base, ...itemOverrides, tags: [], category };
}

const WORK: Category = { id: 'work', name: '工作', color: '#ff0000', emoji: null, priority: 0 };
const HEALTH: Category = { id: 'health', name: '健康', color: '#00ff00', emoji: '💊', priority: 0 };

describe('buildScheduleRetrievalContext（全域检索组包，切片 36）', () => {
  it('常量冻结：上限 50 / content 截断 80', () => {
    expect(RETRIEVAL_MAX_ITEMS).toBe(50);
    expect(CONTENT_SNIPPET_MAX_CHARS).toBe(80);
  });

  it('空列表 → 占位说明（窗口内没有日程条目）', () => {
    const result = buildScheduleRetrievalContext([], WINDOW, TZ);
    expect(result).toEqual({ context: '（窗口内没有日程条目。）', included: 0, truncated: false });
  });

  it('时段条目窗口相交：行格式「11-24 周二 09:00 标题」；窗口外排除', () => {
    const inWindow = makeItem({
      title: '体检',
      startAt: at(2026, 11, 24, 9, 0),
    });
    const beforeWindow = makeItem({ title: '早于窗口', startAt: at(2026, 11, 22, 9, 0) });
    const afterWindow = makeItem({ title: '晚于窗口', startAt: at(2026, 11, 30, 9, 0) });
    const result = buildScheduleRetrievalContext([beforeWindow, inWindow, afterWindow], WINDOW, TZ);
    expect(result.truncated).toBe(false);
    expect(result.included).toBe(1);
    expect(result.context).toBe('11-24 周二 09:00 体检');
  });

  it('时段条目按 startAt 升序；瞬时条目（endAt null）端点相交语义', () => {
    const later = makeItem({ title: '晚场', startAt: at(2026, 11, 24, 18, 0) });
    const earlier = makeItem({ title: '早场', startAt: at(2026, 11, 24, 9, 0) });
    const result = buildScheduleRetrievalContext([later, earlier], WINDOW, TZ);
    expect(result.context).toBe('11-24 周二 09:00 早场\n11-24 周二 18:00 晚场');

    // endAt null 视为瞬时点：恰在窗口终点 23:59:59.999 相交
    const edge = makeItem({ title: '窗口末点', startAt: WINDOW.endMs });
    const edgeResult = buildScheduleRetrievalContext([edge], WINDOW, TZ);
    expect(edgeResult.included).toBe(1);
    // 越过终点 1ms 排除
    const past = makeItem({ title: '越界', startAt: WINDOW.endMs + 1 });
    const pastResult = buildScheduleRetrievalContext([past], WINDOW, TZ);
    expect(pastResult.included).toBe(0);
    expect(pastResult.context).toBe('（窗口内没有日程条目。）');
  });

  it('allDay 民用日粒度相交：尾日按 endAt-1ms（ICS 排他）；时间标签「全天」', () => {
    // 11-25 全天 至 11-27 排他尾日 → 尾日 11-26，窗口相交
    const allDay = makeItem({
      title: '出差',
      allDay: true,
      startAt: dayStart(2026, 11, 25),
      endAt: dayStart(2026, 11, 27),
    });
    const result = buildScheduleRetrievalContext([allDay], WINDOW, TZ);
    expect(result.context).toBe('11-25 周三 全天 出差');

    // 跨窗口首日相交：11-20 至 11-24 排他（尾日 11-23 = 窗口首日）→ 包含
    const overlapStart = makeItem({
      title: '跨首日',
      allDay: true,
      startAt: dayStart(2026, 11, 20),
      endAt: dayStart(2026, 11, 24),
    });
    expect(buildScheduleRetrievalContext([overlapStart], WINDOW, TZ).included).toBe(1);

    // 完全在窗口前 → 排除
    const before = makeItem({
      title: '过去全天',
      allDay: true,
      startAt: dayStart(2026, 11, 1),
      endAt: dayStart(2026, 11, 3),
    });
    expect(buildScheduleRetrievalContext([before], WINDOW, TZ).included).toBe(0);
  });

  it('无时刻条目单列【无时刻待办】节（- 前缀），时段行在前', () => {
    const untimed = makeItem({ title: '买牛奶' });
    const timed = makeItem({ title: '开会', startAt: at(2026, 11, 24, 9, 0) });
    const result = buildScheduleRetrievalContext([untimed, timed], WINDOW, TZ);
    expect(result.context).toBe('11-24 周二 09:00 开会\n【无时刻待办】\n- 买牛奶');
    expect(result.included).toBe(2);
  });

  it('分类后缀：无分类无后缀 / 无 emoji（名称）/ 有 emoji（emoji 名称）', () => {
    const noCategory = makeItem({ title: '裸条目', startAt: at(2026, 11, 24, 8, 0), category: null });
    const nameOnly = makeItem({ title: '只有名称', startAt: at(2026, 11, 24, 9, 0), category: WORK });
    const withEmoji = makeItem({ title: '带图标', startAt: at(2026, 11, 24, 10, 0), category: HEALTH });
    const result = buildScheduleRetrievalContext([noCategory, nameOnly, withEmoji], WINDOW, TZ);
    expect(result.context).toBe(
      '11-24 周二 08:00 裸条目\n11-24 周二 09:00 只有名称（工作）\n11-24 周二 10:00 带图标（💊 健康）',
    );
  });

  it('状态标注：[已归档] / [已完成] 可叠加（Q4 全域含归档）', () => {
    const archived = makeItem({
      title: '归档项',
      status: 'archived',
      startAt: at(2026, 11, 24, 8, 0),
    });
    const done = makeItem({ title: '完成项', status: 'done', startAt: at(2026, 11, 24, 9, 0) });
    const both = makeItem({
      title: '归档且完成',
      status: 'archived',
      content: 'x',
      startAt: at(2026, 11, 24, 10, 0),
    });
    // archived 且 done 无法经 Item 单值 status 直接表达；archived+done 叠加由
    // formatStatusSuffix 逻辑覆盖（两分支独立 push），此处以归档+备注验证顺序。
    const result = buildScheduleRetrievalContext([archived, done, both], WINDOW, TZ);
    expect(result.context).toBe(
      '11-24 周二 08:00 归档项[已归档]\n11-24 周二 09:00 完成项[已完成]\n11-24 周二 10:00 归档且完成[已归档] 备注：x',
    );
  });

  it('content 备注：空白折叠；超 80 字截断加省略号', () => {
    const short = makeItem({
      title: '短备注',
      content: '第一行\n\n第二行',
      startAt: at(2026, 11, 24, 8, 0),
    });
    expect(buildScheduleRetrievalContext([short], WINDOW, TZ).context).toBe(
      '11-24 周二 08:00 短备注 备注：第一行 第二行',
    );

    const long = makeItem({
      title: '长备注',
      content: 'x'.repeat(81),
      startAt: at(2026, 11, 24, 9, 0),
    });
    expect(buildScheduleRetrievalContext([long], WINDOW, TZ).context).toBe(
      `11-24 周二 09:00 长备注 备注：${'x'.repeat(80)}…`,
    );
    const exact = makeItem({
      title: '恰好八十',
      content: 'y'.repeat(80),
      startAt: at(2026, 11, 24, 10, 0),
    });
    expect(buildScheduleRetrievalContext([exact], WINDOW, TZ).context).toBe(
      `11-24 周二 10:00 恰好八十 备注：${'y'.repeat(80)}`,
    );
  });

  it('上限 50 条：51 条 → included 50 truncated true + 披露行；50 条不截断', () => {
    const many = Array.from({ length: 51 }, (_, i) =>
      makeItem({ title: `条目${i + 1}`, startAt: at(2026, 11, 23, 0, i) }),
    );
    const truncated = buildScheduleRetrievalContext(many, WINDOW, TZ);
    expect(truncated.included).toBe(50);
    expect(truncated.truncated).toBe(true);
    const lines = truncated.context.split('\n');
    expect(lines).toHaveLength(51);
    expect(lines[50]).toBe('（日程较多，本次仅显示前 50 条，请在回答末尾提及仅展示前 50 条。）');
    expect(lines[0]).toBe('11-23 周一 00:00 条目1');
    expect(lines[49]).toBe('11-23 周一 00:49 条目50');

    const exactly = buildScheduleRetrievalContext(many.slice(0, 50), WINDOW, TZ);
    expect(exactly.included).toBe(50);
    expect(exactly.truncated).toBe(false);
    expect(exactly.context.split('\n')).toHaveLength(50);
  });
});
