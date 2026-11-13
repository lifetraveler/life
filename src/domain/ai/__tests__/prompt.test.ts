/**
 * AI_SYSTEM_PROMPT 关键句断言（切片 19 阶段 1）。
 *
 * 设计原则（prompt.ts 头注同款）：只断言关键句存在，不做脆弱的全文比对。
 * 任务卡要求：prompt 必须明确写清“X分钟后提醒我”的边界与示例，不能依赖模型
 * 自行推断——这里的断言就是那道防回归闸门：边界句被删掉时测试直接失败。
 */

import { AI_SYSTEM_PROMPT, buildNowFacts } from '../prompt';

describe('AI_SYSTEM_PROMPT：延迟提醒（切片 19 §7.30）', () => {
  const P = AI_SYSTEM_PROMPT;

  it('字段定义含 reminderDelayMinutes（必填、语义描述）', () => {
    expect(P).toContain('reminderDelayMinutes: number | null，必填');
    expect(P).toContain('X分钟/小时后提醒我');
  });

  it('“延迟提醒判定规则”一节存在且声明“不得自行推断”', () => {
    expect(P).toContain('延迟提醒判定规则');
    expect(P).toContain('不得自行推断');
  });

  it('换算示例齐全：10/30/60/90/120 五档', () => {
    expect(P).toContain('“10分钟后提醒我吃药”→10');
    expect(P).toContain('“半小时后叫我起床”→30');
    expect(P).toContain('“1小时后提醒我出门”→60');
    expect(P).toContain('“一个半小时后提醒我拿外卖”→90');
    expect(P).toContain('“两小时后提醒我拿外卖”→120');
  });

  it('边界句：只支持分钟/小时，不支持单位一律 null', () => {
    expect(P).toContain('只支持“分钟/小时”两种单位');
    expect(P).toContain('不支持的单位一律填 null，禁止自行换算');
    expect(P).toContain('“X天后提醒我”（天）');
    expect(P).toContain('“X秒后提醒我”（秒）');
  });

  it('边界句：start 语义不是延迟（明天/下午3点提醒我）', () => {
    expect(P).toContain('没有“延迟多久”语义时填 null');
    expect(P).toContain('“明天提醒我吃药”“下午3点提醒我吃药”是 start 时间语义');
  });

  it('边界句：提前X → reminderOffsetMinutes，两者独立可同现互不覆盖', () => {
    expect(P).toContain('“提前X分钟提醒”填 reminderOffsetMinutes，不填 reminderDelayMinutes');
    expect(P).toContain('互不覆盖');
  });

  it('边界句：delay 禁止换算成 start/end，同句另有具体时间时 start 照常', () => {
    expect(P).toContain('禁止换算成 start/end 的具体时刻');
    expect(P).toContain('start 照常按字面填写');
  });
});

describe('buildNowFacts（既有行为回归）', () => {
  it('输出当前时间事实与相对时间基准说明', () => {
    const now = new Date('2026-11-13T10:30:00+08:00').getTime();
    const facts = buildNowFacts({ now, tzid: 'Asia/Shanghai', history: [] });
    expect(facts).toContain('当前时间：2026年11月13日 周五 10:30（时区 Asia/Shanghai）');
    expect(facts).toContain('以上述当前时间为基准');
  });
});
