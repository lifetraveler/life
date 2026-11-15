import {
  matchesEditIntent,
  parseEditTimeRequest,
  resolveEditStartAt,
} from '../editIntent';

/**
 * 「修改成X点」编辑窄规则单测（tasks/slice-22.md 阶段 3 注记，用户
 * 2026-11-15 确认折叠）。核心回归场景：保存「明天上午8点叫我起床」后
 * 紧跟「修改成7点半吧」，应识别为编辑意图而不是新建事项。
 */

describe('matchesEditIntent（编辑意图识别）', () => {
  it.each([
    ['修改成7点半吧', true],
    ['改成明天', true],
    ['改到下午3点', true],
    ['改为晚上8点', true],
    ['修改时间至7点半', true],
    ['把会议改成3点', true],
    ['调整到下午4点', true],
    ['换成明天', true],
    ['更改为晚上8点', true],
  ])('%s → 识别为编辑意图', (text, expected) => {
    expect(matchesEditIntent(text)).toBe(expected);
  });

  it.each([
    // 以「修改」开头的正常新事项标题：动词后不是时间 token。
    ['修改简历下午3点', false],
    // 裸「修改」不带成/为/到/至连接词。
    ['修改一下提醒', false],
    // 动词与时间之间插了名词（窄规则明确不覆盖，落原解析流程）。
    ['调整说明到下午3点', false],
    // 动词后不是时间 token（改成爬山 = 新事项语义）。
    ['周末改成爬山', false],
    // 普通创建语句。
    ['明天上午8点叫我起床', false],
    ['明天下午3点开周会 提前10分钟提醒 #工作', false],
  ])('%s → 不识别为编辑意图', (text, expected) => {
    expect(matchesEditIntent(text)).toBe(expected);
  });
});

describe('parseEditTimeRequest（相对时间表达解析）', () => {
  it('时刻 + 半点：修改成7点半吧 → 07:30（不带午别按上午解读）', () => {
    expect(parseEditTimeRequest('修改成7点半吧')).toEqual({
      dayShift: null,
      timeOfDay: { hour: 7, minute: 30 },
    });
  });

  it('全角数字：７点半 → 07:30', () => {
    expect(parseEditTimeRequest('７点半')).toEqual({
      dayShift: null,
      timeOfDay: { hour: 7, minute: 30 },
    });
  });

  it('日期 + 时刻：改成明天8点 → 明天 08:00', () => {
    expect(parseEditTimeRequest('改成明天8点')).toEqual({
      dayShift: 1,
      timeOfDay: { hour: 8, minute: 0 },
    });
  });

  it('下午午别映射：改到下午3点半 → 15:30', () => {
    expect(parseEditTimeRequest('改到下午3点半')).toEqual({
      dayShift: null,
      timeOfDay: { hour: 15, minute: 30 },
    });
  });

  it('晚上午别映射：晚上8点 → 20:00', () => {
    expect(parseEditTimeRequest('晚上8点')).toEqual({
      dayShift: null,
      timeOfDay: { hour: 20, minute: 0 },
    });
  });

  it('仅日期：改成明天 → dayShift 1、时刻 null', () => {
    expect(parseEditTimeRequest('改成明天')).toEqual({
      dayShift: 1,
      timeOfDay: null,
    });
  });

  it('大后天优先于后天（子串包含关系）', () => {
    expect(parseEditTimeRequest('改成大后天10点').dayShift).toBe(3);
    expect(parseEditTimeRequest('改成后天10点').dayShift).toBe(2);
  });

  it('X点Y分：7点30分 → 07:30', () => {
    expect(parseEditTimeRequest('改成7点30分').timeOfDay).toEqual({ hour: 7, minute: 30 });
  });

  it('冒号时刻：改成15:30 → 15:30', () => {
    expect(parseEditTimeRequest('改成15:30').timeOfDay).toEqual({ hour: 15, minute: 30 });
  });

  it('中午 12 点保持 12；凌晨 12 点归 0 点', () => {
    expect(parseEditTimeRequest('中午12点半').timeOfDay).toEqual({ hour: 12, minute: 30 });
    expect(parseEditTimeRequest('凌晨12点').timeOfDay).toEqual({ hour: 0, minute: 0 });
  });

  it('非法时刻（25点）→ timeOfDay null', () => {
    expect(parseEditTimeRequest('修改成25点').timeOfDay).toBeNull();
  });
});

describe('resolveEditStartAt（编辑请求落到目标时刻）', () => {
  const TZID = 'Asia/Shanghai';
  const NOW = new Date('2026-11-15T14:00:00+08:00').getTime();
  /** 用户回归场景的目标：明天上午8点叫我起床。 */
  const TARGET = new Date('2026-11-16T08:00:00+08:00').getTime();

  it('仅时刻：保留目标日期，08:00 → 07:30（回归场景）', () => {
    expect(
      resolveEditStartAt({ dayShift: null, timeOfDay: { hour: 7, minute: 30 } }, TARGET, NOW, TZID),
    ).toBe(new Date('2026-11-16T07:30:00+08:00').getTime());
  });

  it('仅日期（后天）：保留目标时刻，民用日相对今天推进 → 11-17 08:00', () => {
    expect(
      resolveEditStartAt({ dayShift: 2, timeOfDay: null }, TARGET, NOW, TZID),
    ).toBe(new Date('2026-11-17T08:00:00+08:00').getTime());
  });

  it('日期 + 时刻齐备：后天 15:00', () => {
    expect(
      resolveEditStartAt({ dayShift: 2, timeOfDay: { hour: 15, minute: 0 } }, TARGET, NOW, TZID),
    ).toBe(new Date('2026-11-17T15:00:00+08:00').getTime());
  });

  it('目标 startAt 为 null（无时间待办）→ null（调用方落到原解析流程）', () => {
    expect(
      resolveEditStartAt({ dayShift: null, timeOfDay: { hour: 7, minute: 30 } }, null, NOW, TZID),
    ).toBeNull();
  });

  it('请求为空（日期时刻都没提）→ null', () => {
    expect(resolveEditStartAt({ dayShift: null, timeOfDay: null }, TARGET, NOW, TZID)).toBeNull();
  });

  it('America/New_York 跨春季缺口 dayShift=1：民用日算术不漂移（08:00 EST → 08:00 EDT）', () => {
    const nowNY = new Date('2026-03-07T14:00:00-05:00').getTime();
    const targetNY = new Date('2026-03-07T08:00:00-05:00').getTime();
    const result = resolveEditStartAt(
      { dayShift: 1, timeOfDay: null },
      targetNY,
      nowNY,
      'America/New_York',
    );
    expect(result).toBe(new Date('2026-03-08T08:00:00-04:00').getTime());
    // 对照：naive 的 target + 24h 绝对毫秒会落到 09:00 EDT——民用日算术必须避免。
    expect(result).not.toBe(targetNY + 86_400_000);
  });

  it('解析出的民用时刻落在春季 gap → null（调用方给引导文案）', () => {
    const nowNY = new Date('2026-03-07T14:00:00-05:00').getTime();
    const targetNY = new Date('2026-03-07T08:00:00-05:00').getTime();
    // dayShift 1 → 民用日推进到 03-08，02:30 落在春季缺口（02:00-03:00）内。
    expect(
      resolveEditStartAt(
        { dayShift: 1, timeOfDay: { hour: 2, minute: 30 } },
        targetNY,
        nowNY,
        'America/New_York',
      ),
    ).toBeNull();
  });
});
