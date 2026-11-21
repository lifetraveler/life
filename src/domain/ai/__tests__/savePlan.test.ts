/**
 * 确认落库计划测试（tasks/slice-15.md 阶段 3，验收 9；切片 16 阶段 3 扩 once 落库）：
 * 时间字段剥离（§4.24 链）、标签、提醒白名单、once 计划构造与各降级说明。
 * 切片 32（AGENTS.md §7.44 / ai.md v0.23）：FlashSavePlan 多计划化（reminderPlans /
 * reminderNotices 数组）——reminders 逐条落库、offset/delay 独立落库（L5 关闭）、
 * 跨来源去重、recurrence 同现全披露、渠道覆盖/预设回填循环应用。
 */

import { buildFlashSavePlan, diffItemTags, diffOnceReminderPlans } from '../savePlan';
import type { ParsedItemDraft } from '../types';
import type { OnceCivilTime, Reminder } from '../../reminder';
import type { ReminderPlan } from '../mapper';
import { resolveCivilTimeToInstant } from '../../recurrence/civilTime';

describe('buildFlashSavePlan（阶段 3 落库计划）', () => {
  const NOW = new Date('2026-11-10T10:00:00+08:00').getTime();

  function baseDraft(overrides: Partial<ParsedItemDraft>): ParsedItemDraft {
    return {
      title: '买菜',
      content: '',
      type: 'task',
      startAt: new Date('2026-11-11T15:00:00+08:00').getTime(),
      endAt: new Date('2026-11-11T16:00:00+08:00').getTime(),
      allDay: false,
      categoryId: 'work',
      tags: ['生活'],
      priority: 2,
      recurrence: null,
      reminderOffsetMinutes: null,
      reminderDelayMinutes: null,
      ...overrides,
    };
  }

  it('时间字段从 itemInput 剥离，进 timePatch（§4.24：时间只走 updateItemTime）', () => {
    const plan = buildFlashSavePlan(baseDraft({}), 'Asia/Shanghai', NOW);
    expect(plan.itemInput).toEqual({
      type: 'task',
      title: '买菜',
      content: undefined,
      categoryId: 'work',
      priority: 2,
    });
    expect(plan.timePatch).toEqual({
      startAt: new Date('2026-11-11T15:00:00+08:00').getTime(),
      endAt: new Date('2026-11-11T16:00:00+08:00').getTime(),
      allDay: false,
    });
    expect(plan.tagNames).toEqual(['生活']);
    expect(plan.reminderPlans).toEqual([]);
    expect(plan.reminderNotices).toEqual([]);
  });

  it('重复规则 + 白名单时区 → reminderPlans 保留重复计划', () => {
    const plan = buildFlashSavePlan(
      baseDraft({
        startAt: null,
        endAt: null,
        recurrence: {
          frequency: 'weekly',
          weekdays: [3],
          localTime: { hour: 20, minute: 0 },
        },
      }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toEqual([
      {
        frequency: 'weekly',
        localTimeHour: 20,
        localTimeMinute: 0,
        weekdays: [3],
        dayOfMonth: undefined,
        tzid: 'Asia/Shanghai',
        startAt: expect.any(Number),
        enabled: true,
      },
    ]);
    expect(plan.reminderNotices).toEqual([]);
  });

  it('重复规则 + 白名单外时区 → 重复计划置空并附说明', () => {
    const plan = buildFlashSavePlan(
      baseDraft({
        recurrence: {
          frequency: 'daily',
          localTime: { hour: 9, minute: 0 },
        },
      }),
      'Europe/Paris',
      NOW,
    );
    expect(plan.reminderPlans).toEqual([]);
    expect(plan.reminderNotices).toHaveLength(1);
    expect(plan.reminderNotices[0]).toContain('Europe/Paris');
    expect(plan.reminderNotices[0]).toContain('暂不支持');
  });

  it('切片 16：有 startAt + 提前量 → once 计划（触发时刻 = startAt - offset，民用分解按 tzid）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ reminderOffsetMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toEqual([
      {
        frequency: 'once',
        localTimeHour: 0,
        localTimeMinute: 0,
        onceAt: { year: 2026, month: 11, day: 11, hour: 14, minute: 50 },
        channels: ['system-notification'],
        channelConfigs: {},
        tzid: 'Asia/Shanghai',
        startAt: new Date('2026-11-11T14:50:00+08:00').getTime(),
        enabled: true,
      },
    ]);
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 16：无 startAt + 提前量 → 不落库，披露「需设定时间才能提前提醒」', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminderOffsetMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toEqual([]);
    expect(plan.reminderNotices).toEqual(['需设定时间才能提前提醒']);
  });

  it('切片 16：白名单外时区 + 提前量 → 不落库并附说明', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ reminderOffsetMinutes: 10 }),
      'Europe/Paris',
      NOW,
    );
    expect(plan.reminderPlans).toEqual([]);
    expect(plan.reminderNotices).toHaveLength(1);
    expect(plan.reminderNotices[0]).toContain('Europe/Paris');
    expect(plan.reminderNotices[0]).toContain('暂不支持');
  });

  it('切片 16：触发时刻已过去（startAt - offset <= now）→ 不落库，避免 reconcile 记 missed', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: NOW + 5 * 60000, endAt: null, reminderOffsetMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toEqual([]);
    expect(plan.reminderNotices).toEqual(['提醒时刻已过去，未创建一次性提醒']);
  });

  it('切片 32：重复规则与提前量同现 → 重复计划落库，offset 显式披露（v0.22 静默保留 → v0.23 披露）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({
        startAt: null,
        endAt: null,
        recurrence: {
          frequency: 'weekly',
          weekdays: [3],
          localTime: { hour: 20, minute: 0 },
        },
        reminderOffsetMinutes: 10,
      }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toHaveLength(1);
    expect(plan.reminderPlans[0]?.frequency).toBe('weekly');
    expect(plan.reminderNotices).toEqual([
      '重复提醒已创建；「提前 10 分钟」未创建（重复规则下不另建一次性提醒）',
    ]);
  });

  // —— 切片 19 阶段 2：延迟提醒落库（AGENTS.md §7.30 第一条） ——

  it('切片 19：仅延迟提醒 + startAt null → once 计划（触发时刻 = now + delay*60000，不再报错）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminderDelayMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
    );
    // NOW = 2026-11-10T10:00+08:00 → 触发 10:10；条目 startAt 锚定触发时刻（验收 3 反馈），
    // 不再落入无时间「待办」组。
    expect(plan.reminderPlans).toEqual([
      {
        frequency: 'once',
        localTimeHour: 0,
        localTimeMinute: 0,
        onceAt: { year: 2026, month: 11, day: 10, hour: 10, minute: 10 },
        channels: ['system-notification'],
        channelConfigs: {},
        tzid: 'Asia/Shanghai',
        startAt: NOW + 10 * 60000,
        enabled: true,
      },
    ]);
    expect(plan.reminderNotices).toEqual([]);
    expect(plan.timePatch.startAt).toBe(NOW + 10 * 60000);
  });

  it('切片 19：仅延迟提醒 + startAt 有值 → 提醒按 delay 落库，timePatch.startAt 照常保留', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ reminderDelayMinutes: 60 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toHaveLength(1);
    expect(plan.reminderPlans[0]?.frequency).toBe('once');
    expect(plan.reminderPlans[0]?.startAt).toBe(NOW + 60 * 60000);
    expect(plan.timePatch.startAt).toBe(new Date('2026-11-11T15:00:00+08:00').getTime());
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 19：白名单外时区 + 延迟提醒 → 不落库并附说明；条目时刻仍锚定触发时刻', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminderDelayMinutes: 10 }),
      'Europe/Paris',
      NOW,
    );
    expect(plan.reminderPlans).toEqual([]);
    expect(plan.reminderNotices).toHaveLength(1);
    expect(plan.reminderNotices[0]).toContain('Europe/Paris');
    expect(plan.reminderNotices[0]).toContain('暂不支持');
    // 提醒未创建不影响条目时间锚定（验收 3 反馈：条目时间与提醒互相独立）。
    expect(plan.timePatch.startAt).toBe(NOW + 10 * 60000);
  });

  it('切片 32（L5 关闭）：延迟与提前同现 + startAt 有值 → 两条计划各自落库（原降级文案废除）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ reminderOffsetMinutes: 5, reminderDelayMinutes: 30 }),
      'Asia/Shanghai',
      NOW,
    );
    // 两条独立 once：offset 锚定事件开始（startAt - 5min），delay 锚定 now+30min。
    expect(plan.reminderPlans).toHaveLength(2);
    expect(plan.reminderPlans[0]?.frequency).toBe('once');
    expect(plan.reminderPlans[0]?.startAt).toBe(new Date('2026-11-11T14:55:00+08:00').getTime());
    expect(plan.reminderPlans[1]?.frequency).toBe('once');
    expect(plan.reminderPlans[1]?.startAt).toBe(NOW + 30 * 60000);
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 32（L5 关闭）：延迟与提前同现 + startAt null → delay 落库，offset 披露需设定时间', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminderOffsetMinutes: 5, reminderDelayMinutes: 30 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toHaveLength(1);
    expect(plan.reminderPlans[0]?.frequency).toBe('once');
    expect(plan.reminderPlans[0]?.startAt).toBe(NOW + 30 * 60000);
    expect(plan.timePatch.startAt).toBe(NOW + 30 * 60000);
    expect(plan.reminderNotices).toEqual(['需设定时间才能提前提醒']);
  });

  it('切片 19：defaultChannels 入参 → once 提醒渠道跟随全局默认（验收 4 反馈），无预设时披露', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminderDelayMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
      ['system-notification', 'webhook'],
    );
    expect(plan.reminderPlans[0]?.channels).toEqual(['system-notification', 'webhook']);
    // 无任何预设：channelConfigs 空 + 一句事实披露（不再催用户补参数）。
    expect(plan.reminderPlans[0]?.channelConfigs).toEqual({});
    expect(plan.reminderNotices).toEqual([
      '网络渠道（webhook）尚未配置任何渠道预设，到点投递会失败',
    ]);
  });

  it('切片 19：默认渠道含 webhook + 有默认预设 → channelConfigs 自动取默认预设配置，不再披露', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminderDelayMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
      ['system-notification', 'webhook'],
      [
        { id: 'p1', name: '旧', type: 'webhook', configJson: 'https://hook.example/old', isDefault: false, createdAt: 1 },
        { id: 'p2', name: '默认', type: 'webhook', configJson: 'https://hook.example/def', isDefault: true, createdAt: 2 },
      ],
    );
    expect(plan.reminderPlans[0]?.channels).toEqual(['system-notification', 'webhook']);
    expect(plan.reminderPlans[0]?.channelConfigs).toEqual({ webhook: 'https://hook.example/def' });
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 19：无默认预设 → 网络渠道参数取该渠道第一条预设（用户既定需求）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminderDelayMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
      ['webhook'],
      [
        { id: 'p1', name: '第一条', type: 'webhook', configJson: 'https://hook.example/first', isDefault: false, createdAt: 2 },
        { id: 'p0', name: '更早', type: 'webhook', configJson: 'https://hook.example/older', isDefault: false, createdAt: 1 },
      ],
    );
    // 「第一条」= 入参首位（listChannelPresets 为 created_at 降序 → 最新创建）。
    expect(plan.reminderPlans[0]?.channelConfigs).toEqual({ webhook: 'https://hook.example/first' });
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 19：webhook/apprise 同时默认勾选 → 各自按默认→第一条解析', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminderDelayMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
      ['webhook', 'apprise'],
      [
        { id: 'pW', name: '钩子', type: 'webhook', configJson: 'https://hook.example/w', isDefault: false, createdAt: 1 },
        { id: 'pA', name: '通知', type: 'apprise', configJson: '{"baseUrl":"http://apprise.local","key":"k"}', isDefault: true, createdAt: 2 },
      ],
    );
    expect(plan.reminderPlans[0]?.channelConfigs).toEqual({
      webhook: 'https://hook.example/w',
      apprise: '{"baseUrl":"http://apprise.local","key":"k"}',
    });
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 19：defaultChannels 入参 → 重复计划渠道同样跟随（验收 4 反馈）；同现 delay 显式披露', () => {
    const plan = buildFlashSavePlan(
      baseDraft({
        startAt: null,
        endAt: null,
        recurrence: {
          frequency: 'daily',
          localTime: { hour: 9, minute: 0 },
        },
        reminderDelayMinutes: 10,
      }),
      'Asia/Shanghai',
      NOW,
      ['webhook'],
    );
    expect(plan.reminderPlans).toHaveLength(1);
    expect(plan.reminderPlans[0]?.frequency).toBe('daily');
    expect(plan.reminderPlans[0]?.channels).toEqual(['webhook']);
    expect(plan.reminderNotices).toEqual([
      '重复提醒已创建；「10 分钟后」未创建（重复规则下不另建一次性提醒）',
      '网络渠道（webhook）尚未配置任何渠道预设，到点投递会失败',
    ]);
  });

  it('切片 19：defaultChannels 缺省 → 维持系统通知单渠道（旧行为不变）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminderDelayMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans[0]?.channels).toEqual(['system-notification']);
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 19：重复规则与延迟提醒同现 → 重复计划优先（delay 显式披露，v0.22 静默 → v0.23 披露）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({
        startAt: null,
        endAt: null,
        recurrence: {
          frequency: 'daily',
          localTime: { hour: 9, minute: 0 },
        },
        reminderDelayMinutes: 10,
      }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toHaveLength(1);
    expect(plan.reminderPlans[0]?.frequency).toBe('daily');
    expect(plan.reminderNotices).toEqual([
      '重复提醒已创建；「10 分钟后」未创建（重复规则下不另建一次性提醒）',
    ]);
  });

  // —— 切片 23（AGENTS.md §7.35 / ai.md v0.19）：强提醒渠道推荐落库 ——

  it('切片 23：draft 显式 alarm 渠道 + startAt → 在 startAt 时刻建 once 提醒（闹钟语义：8点叫就8点响）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ reminderChannels: ['alarm'] }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toEqual([
      {
        frequency: 'once',
        localTimeHour: 0,
        localTimeMinute: 0,
        onceAt: { year: 2026, month: 11, day: 11, hour: 15, minute: 0 },
        channels: ['alarm'],
        channelConfigs: {},
        tzid: 'Asia/Shanghai',
        startAt: new Date('2026-11-11T15:00:00+08:00').getTime(),
        enabled: true,
      },
    ]);
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 23：draft 显式渠道优先于 defaultChannels（强提醒语义不被全局偏好覆盖）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ reminderChannels: ['alarm'] }),
      'Asia/Shanghai',
      NOW,
      ['system-notification'],
    );
    expect(plan.reminderPlans[0]?.channels).toEqual(['alarm']);
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 23：draft 未携带渠道 → defaultChannels 照旧生效（普通提醒路径回归）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminderDelayMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
      ['system-notification', 'webhook'],
      [
        { id: 'p1', name: '默认', type: 'webhook', configJson: 'https://hook.example/def', isDefault: true, createdAt: 1 },
      ],
    );
    expect(plan.reminderPlans[0]?.channels).toEqual(['system-notification', 'webhook']);
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 23：显式渠道 + 提前量 → 提前量锚定触发时刻，渠道用显式渠道（提前10分钟叫我起床）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ reminderChannels: ['alarm'], reminderOffsetMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toHaveLength(1);
    expect(plan.reminderPlans[0]?.frequency).toBe('once');
    expect(plan.reminderPlans[0]?.startAt).toBe(new Date('2026-11-11T14:50:00+08:00').getTime());
    expect(plan.reminderPlans[0]?.onceAt).toEqual({ year: 2026, month: 11, day: 11, hour: 14, minute: 50 });
    expect(plan.reminderPlans[0]?.channels).toEqual(['alarm']);
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 23：显式渠道 + 延迟提醒 → delay 落库且渠道用显式渠道', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ reminderChannels: ['alarm'], startAt: null, endAt: null, reminderDelayMinutes: 30 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toHaveLength(1);
    expect(plan.reminderPlans[0]?.frequency).toBe('once');
    expect(plan.reminderPlans[0]?.startAt).toBe(NOW + 30 * 60000);
    expect(plan.reminderPlans[0]?.channels).toEqual(['alarm']);
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 23：显式渠道 + startAt null → 不建提醒并披露（需设定时间才能创建强提醒）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ reminderChannels: ['alarm'], startAt: null, endAt: null }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toEqual([]);
    expect(plan.reminderNotices).toEqual(['需设定时间才能创建强提醒']);
  });

  it('切片 23：显式渠道 + allDay → 不建提醒并披露（全天 00:00 响铃属误伤）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({
        reminderChannels: ['alarm'],
        startAt: new Date('2026-11-11T00:00:00+08:00').getTime(),
        endAt: null,
        allDay: true,
      }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toEqual([]);
    expect(plan.reminderNotices).toEqual(['全天条目暂不创建强提醒（未表达具体时刻）']);
  });

  it('切片 23：重复规则 + 显式渠道 → 重复计划仍优先，渠道被显式渠道覆盖（每天8点叫我起床）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({
        startAt: null,
        endAt: null,
        recurrence: { frequency: 'daily', localTime: { hour: 8, minute: 0 } },
        reminderChannels: ['alarm'],
      }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toHaveLength(1);
    expect(plan.reminderPlans[0]?.frequency).toBe('daily');
    expect(plan.reminderPlans[0]?.channels).toEqual(['alarm']);
    expect(plan.reminderNotices).toEqual([]);
  });

  // —— 切片 32（AGENTS.md §7.44 / ai.md v0.23）：绝对时刻 reminders 多计划 ——

  it('切片 32：reminders 两条未来时刻 → 逐条 once 计划（升序，F1 修复核心）', () => {
    const eightAm = new Date('2026-11-11T08:00:00+08:00').getTime();
    const tenAm = new Date('2026-11-11T10:00:00+08:00').getTime();
    // draft.reminders 约定为升序（wireToParsedItemDraft 换算层保证），savePlan 按序消费。
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminders: [eightAm, tenAm] }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toHaveLength(2);
    expect(plan.reminderPlans[0]).toMatchObject({
      frequency: 'once',
      onceAt: { year: 2026, month: 11, day: 11, hour: 8, minute: 0 },
      startAt: eightAm,
    });
    expect(plan.reminderPlans[1]).toMatchObject({
      frequency: 'once',
      onceAt: { year: 2026, month: 11, day: 11, hour: 10, minute: 0 },
      startAt: tenAm,
    });
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 32：reminders 含过去时刻 → 过去条目披露（含民用时刻），未来条目照常落库', () => {
    const past = new Date('2026-11-10T09:00:00+08:00').getTime();
    const future = new Date('2026-11-11T10:00:00+08:00').getTime();
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminders: [past, future] }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toHaveLength(1);
    expect(plan.reminderPlans[0]?.startAt).toBe(future);
    expect(plan.reminderNotices).toEqual([
      '提醒时刻已过去（2026-11-10 09:00），未创建一次性提醒',
    ]);
  });

  it('切片 32：reminders 与 offset 同现 → 各自独立成条（reminders 先产出，去重池顺序）', () => {
    const tenAm = new Date('2026-11-11T10:00:00+08:00').getTime();
    const plan = buildFlashSavePlan(
      baseDraft({ reminders: [tenAm], reminderOffsetMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toHaveLength(2);
    expect(plan.reminderPlans[0]?.startAt).toBe(tenAm);
    expect(plan.reminderPlans[1]?.startAt).toBe(new Date('2026-11-11T14:50:00+08:00').getTime());
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 32：reminders 与 offset 同刻 → 跨来源去重保留先产出（reminders 胜出）', () => {
    // startAt 15:00 − 300min = 10:00，与 reminders 条目同刻。
    const tenAm = new Date('2026-11-11T10:00:00+08:00').getTime();
    const plan = buildFlashSavePlan(
      baseDraft({ reminders: [tenAm], reminderOffsetMinutes: 300 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toHaveLength(1);
    expect(plan.reminderPlans[0]?.startAt).toBe(tenAm);
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 32：reminders 已表达时强提醒锚点不触发（渠道经覆盖循环带给 reminders）', () => {
    const startAt = new Date('2026-11-11T15:00:00+08:00').getTime();
    const plan = buildFlashSavePlan(
      baseDraft({ reminders: [startAt], reminderChannels: ['alarm'] }),
      'Asia/Shanghai',
      NOW,
    );
    // 锚点不触发：唯一计划来自 reminders（15:00），channels 被显式 alarm 覆盖。
    expect(plan.reminderPlans).toHaveLength(1);
    expect(plan.reminderPlans[0]?.startAt).toBe(startAt);
    expect(plan.reminderPlans[0]?.channels).toEqual(['alarm']);
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 32：recurrence + reminders → 重复计划落库，reminders 条数披露不落库', () => {
    const tenAm = new Date('2026-11-11T10:00:00+08:00').getTime();
    const plan = buildFlashSavePlan(
      baseDraft({
        startAt: null,
        endAt: null,
        recurrence: { frequency: 'daily', localTime: { hour: 9, minute: 0 } },
        reminders: [tenAm],
      }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toHaveLength(1);
    expect(plan.reminderPlans[0]?.frequency).toBe('daily');
    expect(plan.reminderNotices).toEqual([
      '重复提醒已创建；1 条绝对时刻提醒未逐条创建（重复规则下不另建一次性提醒）',
    ]);
  });

  it('切片 32：渠道覆盖循环应用到每条计划（reminders 2 条 + 显式 alarm）', () => {
    const eightAm = new Date('2026-11-11T08:00:00+08:00').getTime();
    const tenAm = new Date('2026-11-11T10:00:00+08:00').getTime();
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminders: [eightAm, tenAm], reminderChannels: ['alarm'] }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlans).toHaveLength(2);
    expect(plan.reminderPlans[0]?.channels).toEqual(['alarm']);
    expect(plan.reminderPlans[1]?.channels).toEqual(['alarm']);
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 32：预设回填循环应用到每条计划（reminders 2 条 + defaultChannels webhook）', () => {
    const eightAm = new Date('2026-11-11T08:00:00+08:00').getTime();
    const tenAm = new Date('2026-11-11T10:00:00+08:00').getTime();
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminders: [eightAm, tenAm] }),
      'Asia/Shanghai',
      NOW,
      ['webhook'],
      [
        { id: 'p1', name: '默认', type: 'webhook', configJson: 'https://hook.example/def', isDefault: true, createdAt: 1 },
      ],
    );
    expect(plan.reminderPlans).toHaveLength(2);
    expect(plan.reminderPlans[0]?.channels).toEqual(['webhook']);
    expect(plan.reminderPlans[0]?.channelConfigs).toEqual({ webhook: 'https://hook.example/def' });
    expect(plan.reminderPlans[1]?.channelConfigs).toEqual({ webhook: 'https://hook.example/def' });
    expect(plan.reminderNotices).toEqual([]);
  });

  it('切片 32：白名单外 + reminders → 逐条披露（多计划数组化动机：不合并语义）', () => {
    const tenAm = new Date('2026-11-11T10:00:00+08:00').getTime();
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminders: [tenAm, tenAm + 60 * 60000] }),
      'Europe/Paris',
      NOW,
    );
    expect(plan.reminderPlans).toEqual([]);
    expect(plan.reminderNotices).toHaveLength(2);
    expect(plan.reminderNotices[0]).toContain('Europe/Paris');
    expect(plan.reminderNotices[1]).toContain('Europe/Paris');
  });
});

describe('diffOnceReminderPlans（切片 34 §7.46 / 提案 D4-c once 集合差异）', () => {
  const SH = 'Asia/Shanghai';
  const civil = (y: number, mo: number, d: number, h: number, mi: number) => ({
    year: y,
    month: mo,
    day: d,
    hour: h,
    minute: mi,
  });
  const instant = (y: number, mo: number, d: number, h: number, mi: number): number => {
    const value = resolveCivilTimeToInstant(SH, y, mo, d, h, mi);
    if (value === null) throw new Error('测试基准时间不应落进 DST gap');
    return value;
  };

  function baselineReminder(
    id: string,
    onceAt: OnceCivilTime,
    overrides: Partial<Reminder> = {},
  ): Reminder {
    return {
      id,
      itemId: 'item-001',
      frequency: 'once',
      localTimeHour: 0,
      localTimeMinute: 0,
      weekdays: [],
      dayOfMonth: 0,
      onceAt,
      tzid: SH,
      startAt: instant(onceAt.year, onceAt.month, onceAt.day, onceAt.hour, onceAt.minute),
      enabled: true,
      channels: ['system-notification'],
      channelConfigs: {},
      lastFiredOccurrenceKey: null,
      lastReconciledAt: null,
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    };
  }

  function targetPlan(
    onceAt: OnceCivilTime,
    overrides: Partial<ReminderPlan> = {},
  ): ReminderPlan {
    return {
      frequency: 'once',
      localTimeHour: 0,
      localTimeMinute: 0,
      weekdays: [],
      dayOfMonth: undefined,
      onceAt,
      tzid: SH,
      startAt: instant(onceAt.year, onceAt.month, onceAt.day, onceAt.hour, onceAt.minute),
      enabled: true,
      channels: ['system-notification'],
      channelConfigs: {},
      ...overrides,
    };
  }

  const TEN = civil(2026, 11, 11, 10, 0);
  const NOON = civil(2026, 11, 11, 12, 0);
  const TWO = civil(2026, 11, 11, 14, 0);

  it('replace 全量替换：目标新 epoch → toCreate；基线独有 epoch → toDelete；同 epoch → toKeep（基线行，渠道不漂移）', () => {
    const diff = diffOnceReminderPlans(
      [baselineReminder('r1', TEN), baselineReminder('r2', NOON)],
      [targetPlan(NOON), targetPlan(TWO)],
      'replace',
    );
    expect(diff.toCreate.map((p) => p.onceAt)).toEqual([TWO]);
    expect(diff.toDelete.map((r) => r.id)).toEqual(['r1']);
    expect(diff.toKeep.map((r) => r.id)).toEqual(['r2']);
  });

  it('append（reminders 缺省，备案语义）：toDelete 恒空、全基线保留、仅新增目标独有 epoch（同 epoch 不重复建）', () => {
    const diff = diffOnceReminderPlans(
      [baselineReminder('r1', TEN), baselineReminder('r2', NOON)],
      [targetPlan(TWO)],
      'append',
    );
    expect(diff.toDelete).toEqual([]);
    expect(diff.toKeep.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(diff.toCreate.map((p) => p.onceAt)).toEqual([TWO]);
  });

  it('append 同 epoch：目标产物与基线重合 → 不创建（offset/delay 产物照抄保留语义）', () => {
    const diff = diffOnceReminderPlans([baselineReminder('r1', TEN)], [targetPlan(TEN)], 'append');
    expect(diff.toCreate).toEqual([]);
    expect(diff.toKeep.map((r) => r.id)).toEqual(['r1']);
  });

  it('不可解析 epoch 的基线行（onceAt 落 DST gap）→ 保留 toKeep，永不误删', () => {
    const gapOnceAt = civil(2026, 3, 8, 2, 30);
    expect(resolveCivilTimeToInstant('America/New_York', 2026, 3, 8, 2, 30)).toBeNull();
    const gapRow = baselineReminder('r-gap', gapOnceAt, { tzid: 'America/New_York' });
    const diff = diffOnceReminderPlans([gapRow], [targetPlan(TEN)], 'replace');
    expect(diff.toDelete).toEqual([]);
    expect(diff.toKeep.map((r) => r.id)).toEqual(['r-gap']);
  });

  it('重复提醒与非 once 频率基线行不参与差异（恒保留）', () => {
    const weekly = baselineReminder('r-weekly', TEN, {
      frequency: 'weekly',
      onceAt: null,
      weekdays: [3],
      localTimeHour: 10,
      localTimeMinute: 0,
      startAt: instant(2026, 11, 11, 10, 0),
    });
    const diff = diffOnceReminderPlans([weekly], [], 'replace');
    expect(diff.toDelete).toEqual([]);
    expect(diff.toKeep.map((r) => r.id)).toEqual(['r-weekly']);
  });

  it('空基线 + replace：目标全部创建；空目标 + replace：基线全部删除', () => {
    const fromEmpty = diffOnceReminderPlans([], [targetPlan(TEN), targetPlan(TWO)], 'replace');
    expect(fromEmpty.toCreate).toHaveLength(2);
    expect(fromEmpty.toDelete).toEqual([]);
    expect(fromEmpty.toKeep).toEqual([]);

    const toEmpty = diffOnceReminderPlans([baselineReminder('r1', TEN)], [], 'replace');
    expect(toEmpty.toCreate).toEqual([]);
    expect(toEmpty.toKeep).toEqual([]);
    expect(toEmpty.toDelete.map((r) => r.id)).toEqual(['r1']);
  });
});

describe('diffItemTags（切片 34 §7.46 / 提案 D4-d tags 差异）', () => {
  it('目标有基线没有 → toAdd；基线有目标没有 → toRemoveTagIds（dedupKey 大小写不敏感归一）', () => {
    const diff = diffItemTags(
      [
        { id: 'tag-1', name: '工作' },
        { id: 'tag-2', name: '生活' },
      ],
      ['生活', '学习'],
    );
    expect(diff.toAdd).toEqual(['学习']);
    expect(diff.toRemoveTagIds).toEqual(['tag-1']);
  });

  it('大小写不同的同名标签视为命中（Work vs work 不重复添加）', () => {
    const diff = diffItemTags([{ id: 'tag-1', name: 'work' }], ['Work']);
    expect(diff.toAdd).toEqual([]);
    expect(diff.toRemoveTagIds).toEqual([]);
  });

  it('目标空串跳过、重复名去重；目标为空 → 基线全部移除', () => {
    const diff = diffItemTags(
      [{ id: 'tag-1', name: '工作' }],
      ['', '学习', '学习', '  '],
    );
    expect(diff.toAdd).toEqual(['学习']);
    expect(diff.toRemoveTagIds).toEqual(['tag-1']);
  });
});
