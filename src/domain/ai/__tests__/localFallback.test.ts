/**
 * LocalFallbackProvider 正则解析测试。
 * 期望时间一律用 resolveCivilTimeToInstant 构造（§4.15：不做本地时区手算）。
 * 基准：now = 2026-11-10 10:00（周二，Asia/Shanghai）。
 */

import { LocalFallbackProvider } from '../localFallback';
import { AiParseError } from '../errors';
import type { AiParseContext, ParsedItemDraft } from '../types';
import { resolveCivilTimeToInstant } from '../../recurrence/civilTime';

const TZID = 'Asia/Shanghai';
/** 非空断言包装：测试期望值不允许是 gap（null）。 */
const mustAt = (y: number, m: number, d: number, h: number, min: number): number => {
  const instant = resolveCivilTimeToInstant(TZID, y, m, d, h, min);
  if (instant === null) throw new Error('测试期望时间落进 DST gap，请换基准时间');
  return instant;
};
const NOW = mustAt(2026, 11, 10, 10, 0);
const CONTEXT: AiParseContext = { now: NOW, tzid: TZID, history: [] };
const provider = new LocalFallbackProvider();

const at = mustAt;

async function parse(input: string): Promise<ParsedItemDraft> {
  return provider.parse(input, CONTEXT);
}

describe('LocalFallbackProvider：空输入', () => {
  it('空白输入抛 empty-input', async () => {
    await expect(parse('   ')).rejects.toBeInstanceOf(AiParseError);
    await expect(parse('   ')).rejects.toMatchObject({ kind: 'empty-input' });
  });
});

describe('LocalFallbackProvider：单点时刻', () => {
  it('明天下午3点开会 → 15:00、event、work 分类、标题开会', async () => {
    const d = await parse('明天下午3点开会');
    expect(d.startAt).toBe(at(2026, 11, 11, 15, 0));
    expect(d.endAt).toBeNull();
    expect(d.allDay).toBe(false);
    expect(d.type).toBe('event');
    expect(d.title).toBe('开会');
    expect(d.categoryId).toBe('work');
  });

  it('裸“3点”不猜上下午 → 当天 03:00（不顺延，不猜）', async () => {
    const d = await parse('3点写日记');
    expect(d.startAt).toBe(at(2026, 11, 10, 3, 0));
    expect(d.allDay).toBe(false);
  });

  it('裸“12点”字面取 12:00', async () => {
    const d = await parse('12点吃饭');
    expect(d.startAt).toBe(at(2026, 11, 10, 12, 0));
  });

  it('今晚8点喂猫 → 当天 20:00（日期 hint 套用到无自有 meridiem 的时刻）', async () => {
    const d = await parse('今晚8点喂猫');
    expect(d.startAt).toBe(at(2026, 11, 10, 20, 0));
    expect(d.title).toBe('喂猫');
  });

  it('明早8点跑步 → 明天 08:00、health 分类、task', async () => {
    const d = await parse('明早8点跑步');
    expect(d.startAt).toBe(at(2026, 11, 11, 8, 0));
    expect(d.categoryId).toBe('health');
    expect(d.type).toBe('task');
  });

  it('24小时制：明天14:30起飞 → 14:30（冒号形式）', async () => {
    const d = await parse('明天14:30起飞');
    expect(d.startAt).toBe(at(2026, 11, 11, 14, 30));
  });

  it('汉字数字时刻：下午三点半开会 → 15:30', async () => {
    const d = await parse('下午三点半开会');
    expect(d.startAt).toBe(at(2026, 11, 10, 15, 30));
  });

  it('汉字数字时刻：晚上八点一刻读书 → 20:15、study 分类', async () => {
    const d = await parse('晚上八点一刻读书');
    expect(d.startAt).toBe(at(2026, 11, 10, 20, 15));
    expect(d.categoryId).toBe('study');
  });

  it('汉字数字时刻：二十三点五十写周报 → 23:50', async () => {
    const d = await parse('二十三点五十写周报');
    expect(d.startAt).toBe(at(2026, 11, 10, 23, 50));
  });

  it('只有时刻没有标题内容时标题回退为原文', async () => {
    const d = await parse('下午3点');
    expect(d.startAt).toBe(at(2026, 11, 10, 15, 0));
    expect(d.title).toBe('下午3点');
  });
});

describe('LocalFallbackProvider：时间区间', () => {
  it('下午3点到5点写周报 → 15:00–17:00、event（区间即事件）', async () => {
    const d = await parse('下午3点到5点写周报');
    expect(d.startAt).toBe(at(2026, 11, 10, 15, 0));
    expect(d.endAt).toBe(at(2026, 11, 10, 17, 0));
    expect(d.type).toBe('event');
    expect(d.title).toBe('写周报');
  });

  it('跨午夜区间：晚上11点到凌晨1点睡觉 → 23:00 到次日 01:00', async () => {
    const d = await parse('晚上11点到凌晨1点睡觉');
    expect(d.startAt).toBe(at(2026, 11, 10, 23, 0));
    expect(d.endAt).toBe(at(2026, 11, 11, 1, 0));
  });

  it('起止相同：9点到9点站会 → endAt 为 null', async () => {
    const d = await parse('9点到9点站会');
    expect(d.startAt).toBe(at(2026, 11, 10, 9, 0));
    expect(d.endAt).toBeNull();
  });
});

describe('LocalFallbackProvider：日期', () => {
  it('裸周几取下一次出现（含今天）：周三交材料 → 11-11 全天', async () => {
    const d = await parse('周三交材料');
    expect(d.startAt).toBe(at(2026, 11, 11, 0, 0));
    expect(d.allDay).toBe(true);
  });

  it('下周三交作业 → 11-18 全天、study 分类、task', async () => {
    const d = await parse('下周三交作业');
    expect(d.startAt).toBe(at(2026, 11, 18, 0, 0));
    expect(d.categoryId).toBe('study');
    expect(d.type).toBe('task');
  });

  it('昨天交了材料 → 11-09 全天（过去日期也如实解析）', async () => {
    const d = await parse('昨天交了材料');
    expect(d.startAt).toBe(at(2026, 11, 9, 0, 0));
  });

  it('N天后：3天后体检 → 11-13 全天、health 分类', async () => {
    const d = await parse('3天后体检');
    expect(d.startAt).toBe(at(2026, 11, 13, 0, 0));
    expect(d.categoryId).toBe('health');
  });

  it('绝对日期：2027年1月1日跨年 → 2027-01-01 全天', async () => {
    const d = await parse('2027年1月1日跨年');
    expect(d.startAt).toBe(at(2027, 1, 1, 0, 0));
    expect(d.allDay).toBe(true);
  });

  it('N月N号：今年已过则推明年：1月1号还房贷 → 2027-01-01、task', async () => {
    const d = await parse('1月1号还房贷');
    expect(d.startAt).toBe(at(2027, 1, 1, 0, 0));
    expect(d.type).toBe('task');
  });

  it('N号日：本月已过则下月：25号发工资 → 2026-11-25 全天', async () => {
    const d = await parse('25号发工资');
    expect(d.startAt).toBe(at(2026, 11, 25, 0, 0));
  });

  it('月底交总结 → 2026-11-30 全天', async () => {
    const d = await parse('月底交总结');
    expect(d.startAt).toBe(at(2026, 11, 30, 0, 0));
  });

  it('“第3号”不当作日期：第3号文件明天交 → 日期取明天', async () => {
    const d = await parse('第3号文件明天交');
    expect(d.startAt).toBe(at(2026, 11, 11, 0, 0));
  });
});

describe('LocalFallbackProvider：重复', () => {
  it('每周三下午3点开会 → weekly[3] 15:00，startAt 是下一次 occurrence（11-11）', async () => {
    const d = await parse('每周三下午3点开会');
    expect(d.recurrence).toEqual({
      frequency: 'weekly',
      weekdays: [3],
      localTime: { hour: 15, minute: 0 },
    });
    expect(d.startAt).toBe(at(2026, 11, 11, 15, 0));
    expect(d.type).toBe('event');
  });

  it('每天9点到11点学习 → daily 09:00，startAt 跳过已过的今天 09:00（→明天）', async () => {
    const d = await parse('每天9点到11点学习');
    expect(d.recurrence).toEqual({
      frequency: 'daily',
      localTime: { hour: 9, minute: 0 },
    });
    expect(d.startAt).toBe(at(2026, 11, 11, 9, 0));
    expect(d.endAt).toBeNull();
    expect(d.title).toBe('学习');
  });

  it('每天跑步（重复无时刻）→ 默认 09:00，startAt 取下一次', async () => {
    const d = await parse('每天跑步');
    expect(d.recurrence).toEqual({
      frequency: 'daily',
      localTime: { hour: 9, minute: 0 },
    });
    expect(d.startAt).toBe(at(2026, 11, 11, 9, 0));
    expect(d.categoryId).toBe('health');
  });

  it('每月15号交房租 → monthly 15、默认 09:00、startAt=11-15 09:00', async () => {
    const d = await parse('每月15号交房租');
    expect(d.recurrence).toEqual({
      frequency: 'monthly',
      dayOfMonth: 15,
      localTime: { hour: 9, minute: 0 },
    });
    expect(d.startAt).toBe(at(2026, 11, 15, 9, 0));
  });

  it('工作日晚上8点学习 → weekly [1-5]，startAt 取下一次工作日 occurrence', async () => {
    const d = await parse('工作日晚上8点学习');
    expect(d.recurrence).toEqual({
      frequency: 'weekly',
      weekdays: [1, 2, 3, 4, 5],
      localTime: { hour: 20, minute: 0 },
    });
    // 今天周二 20:00 仍晚于 now（10:00）→ 下一次 occurrence 是今天 20:00。
    expect(d.startAt).toBe(at(2026, 11, 10, 20, 0));
  });

  it('周末爬山 → 裸“周末”按日期语义取本周六 11-14 全天（不升格为重复）', async () => {
    const d = await parse('周末爬山');
    expect(d.recurrence).toBeNull();
    expect(d.startAt).toBe(at(2026, 11, 14, 0, 0));
    expect(d.allDay).toBe(true);
    expect(d.type).toBe('task');
  });
});

describe('LocalFallbackProvider：提醒偏移', () => {
  it('提前30分钟提醒我吃药 → reminderOffsetMinutes=30、task、health', async () => {
    const d = await parse('提前30分钟提醒我吃药');
    expect(d.reminderOffsetMinutes).toBe(30);
    expect(d.type).toBe('task');
    expect(d.categoryId).toBe('health');
    expect(d.title).toBe('吃药');
  });

  it('15分钟之前提醒我开会 → 15、event', async () => {
    const d = await parse('15分钟之前提醒我开会');
    expect(d.reminderOffsetMinutes).toBe(15);
    expect(d.type).toBe('event');
  });

  it('提前半小时叫我起床 → 30 分钟', async () => {
    const d = await parse('提前半小时叫我起床');
    expect(d.reminderOffsetMinutes).toBe(30);
    expect(d.title).toBe('起床');
  });
});

describe('LocalFallbackProvider：标签', () => {
  it('明天买牛奶 #购物 → tags=[购物]、全天、task', async () => {
    const d = await parse('明天买牛奶 #购物');
    expect(d.tags).toEqual(['购物']);
    expect(d.startAt).toBe(at(2026, 11, 11, 0, 0));
    expect(d.allDay).toBe(true);
    expect(d.type).toBe('task');
    expect(d.title).toBe('买牛奶');
  });
});

describe('LocalFallbackProvider：优先级', () => {
  it('紧急！下午3点见客户 → priority 3、event（“见客户”算事件）', async () => {
    const d = await parse('紧急！下午3点见客户');
    expect(d.priority).toBe(3);
    expect(d.type).toBe('event');
  });

  it('重要！明天交报告 → priority 2', async () => {
    const d = await parse('重要！明天交报告');
    expect(d.priority).toBe(2);
  });

  it('不紧急，有空再写日记 → priority 1（否定词优先）', async () => {
    const d = await parse('不紧急，有空再写日记');
    expect(d.priority).toBe(1);
  });
});

describe('LocalFallbackProvider：误判防护', () => {
  it('“第3点”不当作时刻：第3点讲得很清楚 → startAt 保持 null', async () => {
    const d = await parse('第3点讲得很清楚');
    expect(d.startAt).toBeNull();
    expect(d.title).toContain('第3点');
  });

  it('“约合/交流/见到/还是”等复合词不触发类型误判', async () => {
    const d = await parse('和朋友交流心得');
    expect(d.type).not.toBe('task');
    const d2 = await parse('垃圾还是分类的好');
    expect(d2.type).not.toBe('task');
  });
});
