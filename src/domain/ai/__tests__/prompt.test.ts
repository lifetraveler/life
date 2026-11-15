/**
 * AI_SYSTEM_PROMPT 关键句断言（切片 19 阶段 1）。
 *
 * 设计原则（prompt.ts 头注同款）：只断言关键句存在，不做脆弱的全文比对。
 * 任务卡要求：prompt 必须明确写清“X分钟后提醒我”的边界与示例，不能依赖模型
 * 自行推断——这里的断言就是那道防回归闸门：边界句被删掉时测试直接失败。
 */

import { AI_SYSTEM_PROMPT, buildHistoryBriefing, buildNowFacts } from '../prompt';

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

describe('AI_SYSTEM_PROMPT：澄清与渠道推荐（切片 23 §7.35）', () => {
  const P = AI_SYSTEM_PROMPT;

  it('字段定义含 reminderChannels / needsClarification / clarificationPrompt（必填、语义描述）', () => {
    expect(P).toContain(
      'reminderChannels: ("system-notification" | "alarm" | "webhook" | "apprise")[] | null，必填',
    );
    expect(P).toContain('needsClarification: boolean，必填');
    expect(P).toContain('clarificationPrompt: string | null，必填');
  });

  it('“强提醒场景与渠道推荐”一节存在：alarm 推荐 + 普通提醒禁自填 system-notification', () => {
    expect(P).toContain('强提醒场景与渠道推荐');
    expect(P).toContain('reminderChannels 填 ["alarm"]');
    expect(P).toContain('禁止自填 ["system-notification"]');
    expect(P).toContain('全局默认渠道决定');
  });

  it('渠道边界句：用户明示渠道才填 + system-notification 与 alarm 互斥', () => {
    expect(P).toContain('仅当用户明确要求特定渠道时才填该渠道');
    expect(P).toContain('"system-notification" 与 "alarm" 互斥，禁止出现在同一个数组里');
  });

  it('“主动澄清”一节存在：缺时刻反问（含仅日期场景）+ 示例文案', () => {
    expect(P).toContain('主动澄清');
    expect(P).toContain('“提醒我吃药”“叫我起床”“定个闹钟”“明天提醒我交报告”');
    expect(P).toContain('你要在什么时间提醒你吃药？');
    expect(P).toContain('不要编造时间落库');
  });

  it('澄清边界句：叫醒类已带时刻默认起床不反问 + 已有 offset/delay/重复禁反问', () => {
    expect(P).toContain('“明天上午8点叫我起床”');
    expect(P).toContain('默认事由就是起床');
    expect(P).toContain('needsClarification=false，禁止反问');
    expect(P).toContain('已表达提前量/延迟/重复规则、或时间已完整（有具体时刻）');
  });

  it('反问文案纪律：复用原词、只问缺失属性、单句', () => {
    expect(P).toContain('复用用户原词、只问缺失的那一个属性，单句');
  });

  it('“多轮上下文（history）与澄清续答”一节存在：assistant=上一轮草稿 JSON + 续答合并 + 摘要块编辑指令', () => {
    expect(P).toContain('多轮上下文（history）与澄清续答');
    expect(P).toContain('history 中每条 assistant 消息就是上一轮解析出的完整草稿 JSON');
    expect(P).toContain('needsClarification=true 时，用户本轮回复通常就是补全的信息');
    expect(P).toContain('把补全值并入上一轮草稿的对应字段');
    expect(P).toContain('并把 needsClarification 置回 false');
    // 切片 23 阶段 2：编辑指令从占位升级为摘要块引用（民用日期基准 + 不新建条目）。
    expect(P).toContain('上一张卡片草稿摘要');
    expect(P).toContain('以摘要中的日期为基准');
    expect(P).toContain('其余字段照抄摘要');
    expect(P).toContain('不要新建条目');
  });

  it('毫秒禁令：民用时间一律以摘要块为准，禁止由毫秒反算日期（切片 23 阶段 2）', () => {
    expect(P).toContain('startAt/endAt 是毫秒时间戳，仅供程序读取');
    expect(P).toContain('禁止由毫秒反算日期');
    expect(P).toContain('民用时间一律以摘要块为准');
    expect(P).toContain('无摘要块时按“当前时间”基准正常解析');
  });
});

describe('buildHistoryBriefing（切片 23 阶段 2）', () => {
  const BRIEFING_TZID = 'Asia/Shanghai';
  // 2026-11-16 00:30 Asia/Shanghai（民用换算断言的基准 epoch）。
  const START = new Date('2026-11-16T00:30:00+08:00').getTime();
  const END = new Date('2026-11-16T01:30:00+08:00').getTime();

  function draftJson(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      title: '吃药',
      content: '',
      type: 'task',
      startAt: START,
      endAt: null,
      allDay: false,
      categoryId: 'health',
      tags: ['健康'],
      priority: 0,
      recurrence: null,
      reminderOffsetMinutes: 10,
      reminderDelayMinutes: null,
      reminderChannels: ['alarm'],
      needsClarification: false,
      clarificationPrompt: null,
      ...overrides,
    });
  }

  it('无草稿（空 history / assistant 文本非 JSON）→ null', () => {
    expect(buildHistoryBriefing([], BRIEFING_TZID)).toBeNull();
    expect(
      buildHistoryBriefing(
        [
          { role: 'user', text: '改成明天' },
          { role: 'assistant', text: '已改为 2026-11-14 15:00（请核对卡片）' },
        ],
        BRIEFING_TZID,
      ),
    ).toBeNull();
  });

  it('渲染块头/标题/民用时间/渠道推荐，且输出不含毫秒时间戳', () => {
    const briefing = buildHistoryBriefing(
      [
        { role: 'user', text: '提醒我吃药' },
        { role: 'assistant', text: draftJson() },
      ],
      BRIEFING_TZID,
    );
    expect(briefing).not.toBeNull();
    expect(briefing).toContain('上一张卡片草稿摘要（修改时以此为准，禁止新建条目）：');
    expect(briefing).toContain('- 标题：吃药');
    expect(briefing).toContain('- 时间：2026-11-16 00:30（时区 Asia/Shanghai）');
    expect(briefing).toContain('- 渠道推荐：["alarm"]');
    // 核心防回归：摘要块绝不携带毫秒 epoch（模型由毫秒反算日期不可靠）。
    expect(briefing).not.toContain(String(START));
  });

  it('endAt 有值时展示区间；allDay → 全天；startAt null → 未设时间', () => {
    const ranged = buildHistoryBriefing(
      [{ role: 'assistant', text: draftJson({ endAt: END }) }],
      BRIEFING_TZID,
    );
    expect(ranged).toContain('- 时间：2026-11-16 00:30 ～ 2026-11-16 01:30（时区 Asia/Shanghai）');
    const allDay = buildHistoryBriefing(
      [{ role: 'assistant', text: draftJson({ allDay: true }) }],
      BRIEFING_TZID,
    );
    expect(allDay).toContain('- 时间：2026-11-16 全天');
    const untimed = buildHistoryBriefing(
      [{ role: 'assistant', text: draftJson({ startAt: null }) }],
      BRIEFING_TZID,
    );
    expect(untimed).toContain('- 时间：未设时间');
  });

  it('needsClarification=true 注记澄清状态，供远端识别续答轮', () => {
    const briefing = buildHistoryBriefing(
      [
        {
          role: 'assistant',
          text: draftJson({
            startAt: null,
            needsClarification: true,
            clarificationPrompt: '你要在什么时间提醒你吃药？',
          }),
        },
      ],
      BRIEFING_TZID,
    );
    expect(briefing).toContain(
      '- 上一轮状态：澄清反问中（缺具体时间），用户本轮回复通常是补充信息，补全后并入此草稿。',
    );
  });

  it('note（非草稿 JSON）消息被跳过，向前取最近一条草稿', () => {
    const briefing = buildHistoryBriefing(
      [
        { role: 'user', text: '提醒我吃药' },
        { role: 'assistant', text: draftJson() },
        { role: 'user', text: '改成明天' },
        { role: 'assistant', text: '已改为 2026-11-14 15:00' },
      ],
      BRIEFING_TZID,
    );
    expect(briefing).toContain('- 标题：吃药');
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
