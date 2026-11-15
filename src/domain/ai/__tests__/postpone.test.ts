import {
  computePostponedOnceAt,
  computePostponedStartAt,
} from '../postpone';

/**
 * 快捷推迟纯函数单测（tasks/slice-22.md 阶段 3 验收 2；AGENTS.md §7.34）。
 * tzid 仅用 §4.25 白名单值（Asia/Shanghai / America/New_York）。
 */

describe('computePostponedStartAt（切片 22 阶段 3）', () => {
  const START = new Date('2026-11-16T15:00:00+08:00').getTime();

  it('+15 分钟按绝对毫秒平移', () => {
    expect(computePostponedStartAt(START, 15)).toBe(START + 15 * 60_000);
  });

  it('+60 分钟按绝对毫秒平移', () => {
    expect(computePostponedStartAt(START, 60)).toBe(START + 60 * 60_000);
  });

  it('负偏移（编辑窄规则复用）同样成立', () => {
    expect(computePostponedStartAt(START, -30)).toBe(START - 30 * 60_000);
  });
});

describe('computePostponedOnceAt（once 提醒 onceAt 联动顺延）', () => {
  it('Asia/Shanghai +15 分钟：08:50 → 09:05（同日）', () => {
    expect(
      computePostponedOnceAt(
        { year: 2026, month: 11, day: 16, hour: 8, minute: 50 },
        'Asia/Shanghai',
        15,
      ),
    ).toEqual({ year: 2026, month: 11, day: 16, hour: 9, minute: 5 });
  });

  it('跨日进位：23:50 +15 分钟 → 次日 00:05', () => {
    expect(
      computePostponedOnceAt(
        { year: 2026, month: 11, day: 16, hour: 23, minute: 50 },
        'Asia/Shanghai',
        15,
      ),
    ).toEqual({ year: 2026, month: 11, day: 17, hour: 0, minute: 5 });
  });

  it('负偏移（编辑窄规则复用）：08:50 -20 分钟 → 08:30', () => {
    expect(
      computePostponedOnceAt(
        { year: 2026, month: 11, day: 16, hour: 8, minute: 50 },
        'Asia/Shanghai',
        -20,
      ),
    ).toEqual({ year: 2026, month: 11, day: 16, hour: 8, minute: 30 });
  });

  it('America/New_York 秋季 fold：01:30（较早瞬间 EDT）+30 绝对分钟落在重复的 1 点（EST）', () => {
    // 2026-11-01 美东夏令时结束（02:00 EDT 回拨到 01:00 EST）。民用 01:30
    // 出现两次，resolveCivilTimeToInstant 取较早瞬间（EDT）；+30 绝对分钟
    // 落在重复小时（EST 侧），新民用字段回到 01:00——绝对平移语义如实呈现。
    expect(
      computePostponedOnceAt(
        { year: 2026, month: 11, day: 1, hour: 1, minute: 30 },
        'America/New_York',
        30,
      ),
    ).toEqual({ year: 2026, month: 11, day: 1, hour: 1, minute: 0 });
  });

  it('春季 gap 存入的脏 onceAt → null（调用方跳过联动、保留原值）', () => {
    // 2026-03-08 美东 02:00-03:00 为春季缺口，民用 02:30 不存在。
    expect(
      computePostponedOnceAt(
        { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
        'America/New_York',
        15,
      ),
    ).toBeNull();
  });
});
