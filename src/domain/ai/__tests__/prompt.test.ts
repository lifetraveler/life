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

  it('反问文案纪律：复用原词、只问缺失关键信息、单句（预约类允许顺带一问细节）', () => {
    expect(P).toContain('复用用户原词、只问缺失的关键信息，单句');
    expect(P).toContain('预约/预订类允许顺带一问自然相伴的细节（见上），其余场景不要罗列多个问题');
  });

  it('澄清节扩展（验收反馈修补）：预约/预订/安排类缺时间主动澄清', () => {
    expect(P).toContain('预约/预订/安排类输入');
    expect(P).toContain('预约、预订、挂号、订票、订酒店、订餐厅');
    expect(P).toContain('或只有“下周/周末/近期”这类模糊说法：needsClarification=true');
    expect(P).toContain('先问具体时间（哪一天、什么时候）');
    // 可顺带问自然细节，但仍是单句。
    expect(P).toContain('可顺带问与该动作自然相伴的一个细节（如哪家医院/机构、常规还是专项）');
    expect(P).toContain('但仍是单句，不要列问题清单');
  });

  it('澄清节扩展：预约类有时间直接出卡、细节写入 content、防误伤边界', () => {
    expect(P).toContain('时间已明确（说了具体日期/时刻）：needsClarification=false 直接出卡');
    expect(P).toContain('禁止再为细节反问');
    // 机构/医院/地点写入 content，标题保留主题词（验收反馈修补 v2）。
    expect(P).toContain('机构/医院/地点名称一律写入 content（补充说明）');
    expect(P).toContain('title 只保留动作主题词');
    expect(P).toContain('不要把医院/机构/地名写进标题');
    // 防误伤：note/纯想法/感叹不反问。
    expect(P).toContain('“体检很重要”“记一下体检报告指标”）不是预约动作，不澄清');
    expect(P).toContain('type 为 note 且用户没表达安排意图时一律不反问');
    expect(P).toContain('只有明确的预约/预订/挂号/订类动词才触发上一条');
  });

  it('澄清续答与补充轮：细节写入 content、标题沿用主题词（验收反馈修补）', () => {
    expect(P).toContain('补全里出现的机构/医院/地点等细节写入 content');
    expect(P).toContain('title 沿用上一轮主题词（不要改写标题）');
    expect(P).toContain('已有卡片后用户只是补充细节');
    expect(P).toContain('title 沿用摘要中的标题主题词');
  });

  it('反向边界：全新意图不复用上一张卡标题（切片 25 §7.37，清单随切片 29 扩展）', () => {
    expect(P).toContain('用户输入是全新意图（与上一张卡无关的新事项）');
    expect(P).toContain('title 取本轮输入的主题词，禁止复用/照抄上一张卡的标题');
    expect(P).toContain('只有修改类输入（改成/改为、补充细节、澄清续答、短纠正句）才以上一张卡草稿为基准');
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

describe('AI_SYSTEM_PROMPT：短纠正句与推迟语义（切片 29 §7.40）', () => {
  const P = AI_SYSTEM_PROMPT;

  it('短纠正句判定条款存在：摘要块存在时不含新事由名词的修正句默认编辑上一张卡', () => {
    expect(P).toContain('短纠正句判定');
    expect(P).toContain('「还是30分钟后吧」');
    expect(P).toContain('「就改成明天上午吧」「算了，改到周五」');
    expect(P).toContain('默认视为对上一张卡的编辑');
    expect(P).toContain('以摘要为基准修正被提及的字段，其余字段照抄摘要');
    expect(P).toContain('禁止新建条目。无摘要块时本条不生效');
  });

  it('短纠正句判定锚定：不含新事由名词（新标题性名词短语/新动作主体）+ 语气词', () => {
    expect(P).toContain('不含新事由名词的短句');
    expect(P).toContain('没有引入摘要标题之外的新标题性名词短语或新动作主体');
    expect(P).toContain('「还是/就/吧/算了」等语气词');
  });

  it('推迟语义：「推迟/延后 X 分钟」＝卡摘要基准 ±X（start/end 同 Δ 保时长）', () => {
    expect(P).toContain('「推迟/延后 X 分钟」＝以上一张卡（摘要块）的时间为基准平移 ±X 分钟');
    expect(P).toContain('start 与 end（如有）同 Δ 平移、保持时长不变');
    expect(P).toContain('摘要块时间是唯一基准，禁止以当前说话时刻平移');
  });

  it('推迟语义：「X 分钟后」＝说话时刻基准（编辑语境改卡时间；全新意图仍 delay 语义）', () => {
    expect(P).toContain('「X 分钟后」＝以当前说话时刻为基准');
    expect(P).toContain('卡片新时间＝说话时刻+X 分钟');
    expect(P).toContain('全新意图语境下仍按 reminderDelayMinutes 延迟提醒语义');
    expect(P).toContain('（不换算成 start）');
  });

  it('两种表达可同现互不覆盖', () => {
    expect(P).toContain('两种表达可在同一句出现，各按各的基准计算，互不覆盖');
  });

  it('反向边界修订：新事由名词短句不是短纠正句，仍全新意图防误伤（切片 29）', () => {
    expect(P).toContain('含新事由名词的短句（如「明天开会」「周六聚餐」）不是短纠正句');
    expect(P).toContain('仍是全新意图照常新建，防误伤');
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
