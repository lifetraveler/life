/**
 * 确认落库计划测试（tasks/slice-15.md 阶段 3，验收 9；切片 16 阶段 3 扩 once 落库）：
 * 时间字段剥离（§4.24 链）、标签、提醒白名单、once 计划构造与各降级说明。
 */

import { buildFlashSavePlan } from '../savePlan';
import type { ParsedItemDraft } from '../types';

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
    expect(plan.reminderPlan).toBeNull();
    expect(plan.reminderNotice).toBeNull();
  });

  it('重复规则 + 白名单时区 → reminderPlan 保留', () => {
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
    expect(plan.reminderPlan).toEqual({
      frequency: 'weekly',
      localTimeHour: 20,
      localTimeMinute: 0,
      weekdays: [3],
      dayOfMonth: undefined,
      tzid: 'Asia/Shanghai',
      startAt: expect.any(Number),
      enabled: true,
    });
    expect(plan.reminderNotice).toBeNull();
  });

  it('重复规则 + 白名单外时区 → reminderPlan 置空并附说明', () => {
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
    expect(plan.reminderPlan).toBeNull();
    expect(plan.reminderNotice).toContain('Europe/Paris');
    expect(plan.reminderNotice).toContain('暂不支持');
  });

  it('切片 16：有 startAt + 提前量 → once 计划（触发时刻 = startAt - offset，民用分解按 tzid）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ reminderOffsetMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlan).toEqual({
      frequency: 'once',
      localTimeHour: 0,
      localTimeMinute: 0,
      onceAt: { year: 2026, month: 11, day: 11, hour: 14, minute: 50 },
      channels: ['system-notification'],
      channelConfigs: {},
      tzid: 'Asia/Shanghai',
      startAt: new Date('2026-11-11T14:50:00+08:00').getTime(),
      enabled: true,
    });
    expect(plan.reminderNotice).toBeNull();
  });

  it('切片 16：无 startAt + 提前量 → 不落库，提示「需设定时间才能提前提醒」', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminderOffsetMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlan).toBeNull();
    expect(plan.reminderNotice).toBe('需设定时间才能提前提醒');
  });

  it('切片 16：白名单外时区 + 提前量 → 不落库并附说明', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ reminderOffsetMinutes: 10 }),
      'Europe/Paris',
      NOW,
    );
    expect(plan.reminderPlan).toBeNull();
    expect(plan.reminderNotice).toContain('Europe/Paris');
    expect(plan.reminderNotice).toContain('暂不支持');
  });

  it('切片 16：触发时刻已过去（startAt - offset <= now）→ 不落库，避免 reconcile 记 missed', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: NOW + 5 * 60000, endAt: null, reminderOffsetMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlan).toBeNull();
    expect(plan.reminderNotice).toBe('提醒时刻已过去，未创建一次性提醒');
  });

  it('切片 16：重复规则与提前量同时存在 → 重复计划优先（offset 保留在卡片意图，行为不变）', () => {
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
    expect(plan.reminderPlan).not.toBeNull();
    expect(plan.reminderPlan?.frequency).toBe('weekly');
    expect(plan.reminderNotice).toBeNull();
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
    expect(plan.reminderPlan).toEqual({
      frequency: 'once',
      localTimeHour: 0,
      localTimeMinute: 0,
      onceAt: { year: 2026, month: 11, day: 10, hour: 10, minute: 10 },
      channels: ['system-notification'],
      channelConfigs: {},
      tzid: 'Asia/Shanghai',
      startAt: NOW + 10 * 60000,
      enabled: true,
    });
    expect(plan.reminderNotice).toBeNull();
    expect(plan.timePatch.startAt).toBe(NOW + 10 * 60000);
  });

  it('切片 19：仅延迟提醒 + startAt 有值 → 提醒按 delay 落库，timePatch.startAt 照常保留', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ reminderDelayMinutes: 60 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlan?.frequency).toBe('once');
    expect(plan.reminderPlan?.startAt).toBe(NOW + 60 * 60000);
    expect(plan.timePatch.startAt).toBe(new Date('2026-11-11T15:00:00+08:00').getTime());
    expect(plan.reminderNotice).toBeNull();
  });

  it('切片 19：白名单外时区 + 延迟提醒 → 不落库并附说明；条目时刻仍锚定触发时刻', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminderDelayMinutes: 10 }),
      'Europe/Paris',
      NOW,
    );
    expect(plan.reminderPlan).toBeNull();
    expect(plan.reminderNotice).toContain('Europe/Paris');
    expect(plan.reminderNotice).toContain('暂不支持');
    // 提醒未创建不影响条目时间锚定（验收 3 反馈：条目时间与提醒互相独立）。
    expect(plan.timePatch.startAt).toBe(NOW + 10 * 60000);
  });

  it('切片 19：延迟与提前同现 + startAt 有值 → 提前提醒优先，延迟意图披露并保留卡片', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ reminderOffsetMinutes: 5, reminderDelayMinutes: 30 }),
      'Asia/Shanghai',
      NOW,
    );
    // 主提醒锚定事件开始（startAt - 5min），delay 不落库。
    expect(plan.reminderPlan?.frequency).toBe('once');
    expect(plan.reminderPlan?.startAt).toBe(new Date('2026-11-11T14:55:00+08:00').getTime());
    expect(plan.reminderNotice).toContain('提前 5 分钟');
    expect(plan.reminderNotice).toContain('30 分钟后提醒');
    expect(plan.reminderNotice).toContain('已保留在卡片');
  });

  it('切片 19：延迟与提前同现 + startAt null → 按 delay 落库，提前量披露需设定时间', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminderOffsetMinutes: 5, reminderDelayMinutes: 30 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlan?.frequency).toBe('once');
    expect(plan.reminderPlan?.startAt).toBe(NOW + 30 * 60000);
    expect(plan.timePatch.startAt).toBe(NOW + 30 * 60000);
    expect(plan.reminderNotice).toContain('30 分钟后');
    expect(plan.reminderNotice).toContain('提前 5 分钟');
    expect(plan.reminderNotice).toContain('需设定时间');
  });

  it('切片 19：defaultChannels 入参 → once 提醒渠道跟随全局默认（验收 4 反馈），无预设时披露', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminderDelayMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
      ['system-notification', 'webhook'],
    );
    expect(plan.reminderPlan?.channels).toEqual(['system-notification', 'webhook']);
    // 无任何预设：channelConfigs 空 + 一句事实披露（不再催用户补参数）。
    expect(plan.reminderPlan?.channelConfigs).toEqual({});
    expect(plan.reminderNotice).toContain('尚未配置任何渠道预设');
    expect(plan.reminderNotice).toContain('到点投递会失败');
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
    expect(plan.reminderPlan?.channels).toEqual(['system-notification', 'webhook']);
    expect(plan.reminderPlan?.channelConfigs).toEqual({ webhook: 'https://hook.example/def' });
    expect(plan.reminderNotice).toBeNull();
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
    expect(plan.reminderPlan?.channelConfigs).toEqual({ webhook: 'https://hook.example/first' });
    expect(plan.reminderNotice).toBeNull();
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
    expect(plan.reminderPlan?.channelConfigs).toEqual({
      webhook: 'https://hook.example/w',
      apprise: '{"baseUrl":"http://apprise.local","key":"k"}',
    });
    expect(plan.reminderNotice).toBeNull();
  });

  it('切片 19：defaultChannels 入参 → 重复计划渠道同样跟随（验收 4 反馈）', () => {
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
    expect(plan.reminderPlan?.frequency).toBe('daily');
    expect(plan.reminderPlan?.channels).toEqual(['webhook']);
  });

  it('切片 19：defaultChannels 缺省 → 维持系统通知单渠道（旧行为不变）', () => {
    const plan = buildFlashSavePlan(
      baseDraft({ startAt: null, endAt: null, reminderDelayMinutes: 10 }),
      'Asia/Shanghai',
      NOW,
    );
    expect(plan.reminderPlan?.channels).toEqual(['system-notification']);
    expect(plan.reminderNotice).toBeNull();
  });

  it('切片 19：重复规则与延迟提醒同现 → 重复计划优先（delay 保留在卡片意图）', () => {
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
    expect(plan.reminderPlan).not.toBeNull();
    expect(plan.reminderPlan?.frequency).toBe('daily');
    expect(plan.reminderNotice).toBeNull();
  });
});
