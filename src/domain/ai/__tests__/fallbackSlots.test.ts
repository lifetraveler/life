/**
 * parseSlots expressed 掩码测试（tasks/slice-15.md 阶段 3，验收 7）：
 * 哪些字段是"本轮真正表达过的"，供多轮合并使用。
 */

import { LocalFallbackProvider } from '../localFallback';

describe('LocalFallbackProvider.parseSlots：expressed 掩码（阶段 3）', () => {
  const NOW = new Date('2026-11-10T10:00:00+08:00').getTime();
  const provider = new LocalFallbackProvider();

  function slots(input: string, historyCount: number) {
    return provider.parseSlots(input, {
      now: NOW,
      tzid: 'Asia/Shanghai',
      history: Array.from({ length: historyCount }, (_, i) => ({
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        text: `h${i}`,
      })),
    });
  }

  it('纯文本首轮：只表达 title/type，不表达时间', () => {
    const { draft, expressed } = slots('买牛奶', 0);
    expect(draft.title).toBe('买牛奶');
    expect(draft.type).toBe('task');
    expect(expressed.has('title')).toBe(true);
    expect(expressed.has('type')).toBe(true);
    expect(expressed.has('startAt')).toBe(false);
    expect(expressed.has('allDay')).toBe(false);
    expect(expressed.has('categoryId')).toBe(false);
    expect(expressed.has('priority')).toBe(false);
  });

  it('带日期时刻：表达 startAt/allDay/type', () => {
    const { expressed } = slots('明天下午3点开会', 0);
    expect(expressed.has('startAt')).toBe(true);
    expect(expressed.has('allDay')).toBe(true);
    expect(expressed.has('type')).toBe(true);
  });

  it('纠正句（非首轮）：标题被裁空 → title 未表达，日期表达', () => {
    const { draft, expressed } = slots('改成后天', 2);
    expect(draft.title).toBe('改成后天'); // 兜底标题，合并时按掩码忽略
    expect(expressed.has('title')).toBe(false);
    expect(expressed.has('startAt')).toBe(true);
    expect(expressed.has('allDay')).toBe(true);
  });

  it('纠正句带前缀（非首轮）："时间改成明天下午3点" 全部裁净', () => {
    const { draft, expressed } = slots('时间改成明天下午3点', 2);
    expect(expressed.has('title')).toBe(false);
    expect(expressed.has('startAt')).toBe(true);
    // 带自有 meridiem：allDay=false 也算表达
    expect(draft.allDay).toBe(false);
  });

  it('同样句子首轮（history 空）不启用纠正槽：纠正动词留在标题里', () => {
    const { draft, expressed } = slots('时间改成明天下午3点', 0);
    expect(draft.title).toBe('时间改成'); // 首轮无纠正槽：改成 不是元指令
    expect(expressed.has('title')).toBe(true);
  });

  it('重复规则：表达 recurrence/startAt/allDay', () => {
    const { expressed } = slots('每周三跑步', 0);
    expect(expressed.has('recurrence')).toBe(true);
    expect(expressed.has('startAt')).toBe(true);
    expect(expressed.has('allDay')).toBe(true);
  });

  it('提醒句：表达 reminderOffsetMinutes 与 type(task)', () => {
    const { draft, expressed } = slots('提前30分钟提醒我吃药', 0);
    expect(draft.title).toBe('吃药');
    expect(expressed.has('reminderOffsetMinutes')).toBe(true);
    expect(expressed.has('title')).toBe(true);
  });

  it('延迟提醒句：表达 reminderDelayMinutes 与 type(task)，不表达 startAt（切片 19）', () => {
    const { draft, expressed } = slots('10分钟后提醒我吃药', 0);
    expect(draft.title).toBe('吃药');
    expect(draft.reminderDelayMinutes).toBe(10);
    expect(expressed.has('reminderDelayMinutes')).toBe(true);
    expect(expressed.has('title')).toBe(true);
    expect(expressed.has('startAt')).toBe(false);
    // 提前句不表达 delay 槽（语义独立）
    const offsetOnly = slots('提前30分钟提醒我吃药', 0);
    expect(offsetOnly.expressed.has('reminderDelayMinutes')).toBe(false);
  });

  it('标签/优先级/分类命中即表达', () => {
    const a = slots('#生活 买牛奶', 0);
    expect(a.expressed.has('tags')).toBe(true);
    const b = slots('紧急 买牛奶', 0);
    expect(b.expressed.has('priority')).toBe(true);
    const c = slots('工作相关：写周报', 0);
    expect(c.expressed.has('categoryId')).toBe(true);
  });

  it('区间：表达 startAt/endAt/allDay', () => {
    const { expressed } = slots('明天3点到5点开会', 0);
    expect(expressed.has('startAt')).toBe(true);
    expect(expressed.has('endAt')).toBe(true);
    expect(expressed.has('allDay')).toBe(true);
  });
});
