import {
  buildCreateReminderInput,
  buildUpdateReminderInput,
  isWebhookConfigJson,
  validateReminderForm,
} from '../reminderForm';
import type { ReminderFormValues } from '../reminderForm';
import type { Reminder } from '../../domain/reminder';

function validValues(overrides: Partial<ReminderFormValues> = {}): ReminderFormValues {
  return {
    frequency: 'daily',
    localTimeHour: 9,
    localTimeMinute: 30,
    weekdays: [],
    dayOfMonth: null,
    onceAt: { date: '', hour: null, minute: null },
    tzid: 'Asia/Shanghai',
    startAt: 1749427200000,
    enabled: true,
    channel: 'system-notification',
    channelConfigText: '',
    appriseBaseUrl: '',
    appriseKey: '',
    channelPresetId: null,
    ...overrides,
  };
}

describe('validateReminderForm（切片 6 表单纯校验）', () => {
  it('合法 daily 表单返回空错误对象', () => {
    expect(validateReminderForm(validValues())).toEqual({});
  });

  it('时间越界/未填报 localTime 错误', () => {
    expect(validateReminderForm(validValues({ localTimeHour: 24 })).localTime).toBeDefined();
    expect(validateReminderForm(validValues({ localTimeMinute: 60 })).localTime).toBeDefined();
    expect(validateReminderForm(validValues({ localTimeHour: null })).localTime).toBeDefined();
    expect(validateReminderForm(validValues({ localTimeMinute: null })).localTime).toBeDefined();
  });

  it('weekly：未选星期 / 星期越界报 weekdays 错误', () => {
    expect(validateReminderForm(validValues({ frequency: 'weekly' })).weekdays).toBeDefined();
    expect(
      validateReminderForm(validValues({ frequency: 'weekly', weekdays: [0, 8] })).weekdays,
    ).toBeDefined();
    expect(
      validateReminderForm(validValues({ frequency: 'weekly', weekdays: [1, 7] })).weekdays,
    ).toBeUndefined();
  });

  it('monthly：dayOfMonth 越界/未填报 dayOfMonth 错误', () => {
    expect(validateReminderForm(validValues({ frequency: 'monthly', dayOfMonth: null })).dayOfMonth)
      .toBeDefined();
    expect(validateReminderForm(validValues({ frequency: 'monthly', dayOfMonth: 0 })).dayOfMonth)
      .toBeDefined();
    expect(validateReminderForm(validValues({ frequency: 'monthly', dayOfMonth: 32 })).dayOfMonth)
      .toBeDefined();
    expect(validateReminderForm(validValues({ frequency: 'monthly', dayOfMonth: 31 })).dayOfMonth)
      .toBeUndefined();
  });

  it('白名单外 tzid 报 tzid 错误', () => {
    expect(validateReminderForm(validValues({ tzid: 'Europe/London' })).tzid).toBeDefined();
    expect(validateReminderForm(validValues({ tzid: 'America/New_York' })).tzid).toBeUndefined();
  });

  it('startAt 非法报 startAt 错误', () => {
    expect(validateReminderForm(validValues({ startAt: null })).startAt).toBeDefined();
    expect(validateReminderForm(validValues({ startAt: Number.NaN })).startAt).toBeDefined();
  });
});

describe('validateReminderForm（切片 16 阶段 3：once 与渠道）', () => {
  it('once：date 空/格式错/范围越界报 onceAt 错误；合法通过且不再要求 localTime', () => {
    const once = validValues({
      frequency: 'once',
      onceAt: { date: '2026-11-12', hour: 8, minute: 50 },
    });
    expect(validateReminderForm(once)).toEqual({});

    expect(
      validateReminderForm(validValues({ frequency: 'once', onceAt: { date: '', hour: 8, minute: 50 } })).onceAt,
    ).toBeDefined();
    expect(
      validateReminderForm(validValues({ frequency: 'once', onceAt: { date: '2026/11/12', hour: 8, minute: 50 } })).onceAt,
    ).toBeDefined();
    expect(
      validateReminderForm(validValues({ frequency: 'once', onceAt: { date: '2026-13-01', hour: 8, minute: 50 } })).onceAt,
    ).toBeDefined();
    // once 下 localTime 是占位零值：未填不报 localTime（触发时刻由 onceAt 承载）
    expect(
      validateReminderForm(validValues({
        frequency: 'once',
        onceAt: { date: '2026-11-12', hour: 8, minute: 50 },
        localTimeHour: null,
        localTimeMinute: null,
      })).localTime,
    ).toBeUndefined();
  });

  it('once：时分缺失或越界报 onceAt 错误', () => {
    expect(
      validateReminderForm(validValues({ frequency: 'once', onceAt: { date: '2026-11-12', hour: null, minute: 50 } })).onceAt,
    ).toBeDefined();
    expect(
      validateReminderForm(validValues({ frequency: 'once', onceAt: { date: '2026-11-12', hour: 24, minute: 50 } })).onceAt,
    ).toBeDefined();
    expect(
      validateReminderForm(validValues({ frequency: 'once', onceAt: { date: '2026-11-12', hour: 8, minute: 60 } })).onceAt,
    ).toBeDefined();
  });

  it('webhook：空/空白/格式错 URL 拦截，合法 http/https 通过（含 trim）', () => {
    expect(validateReminderForm(validValues({ channel: 'webhook', channelConfigText: '' })).channelConfig)
      .toBeDefined();
    expect(validateReminderForm(validValues({ channel: 'webhook', channelConfigText: '   ' })).channelConfig)
      .toBeDefined();
    expect(
      validateReminderForm(validValues({ channel: 'webhook', channelConfigText: 'ftp://example.com/hook' })).channelConfig,
    ).toBeDefined();
    expect(validateReminderForm(validValues({ channel: 'webhook', channelConfigText: 'http://' })).channelConfig)
      .toBeDefined();
    expect(
      validateReminderForm(validValues({ channel: 'webhook', channelConfigText: 'https://example.com/hook' })).channelConfig,
    ).toBeUndefined();
    expect(
      validateReminderForm(validValues({ channel: 'webhook', channelConfigText: '  http://localhost:8080/hook ' })).channelConfig,
    ).toBeUndefined();
  });

  it('apprise：BaseURL 空/格式错、Key 空拦截；齐全通过', () => {
    expect(
      validateReminderForm(validValues({ channel: 'apprise', appriseBaseUrl: '', appriseKey: 'k' })).channelConfig,
    ).toBeDefined();
    expect(
      validateReminderForm(validValues({ channel: 'apprise', appriseBaseUrl: 'example.com', appriseKey: 'k' })).channelConfig,
    ).toBeDefined();
    expect(
      validateReminderForm(validValues({ channel: 'apprise', appriseBaseUrl: 'https://a.example.com', appriseKey: '' })).channelConfig,
    ).toBeDefined();
    expect(
      validateReminderForm(validValues({ channel: 'apprise', appriseBaseUrl: 'https://a.example.com', appriseKey: 'secret' })).channelConfig,
    ).toBeUndefined();
  });
});

describe('buildCreateReminderInput', () => {
  it('weekly 透传 weekdays；monthly 归零 weekdays、透传 dayOfMonth', () => {
    const weekly = buildCreateReminderInput(
      validValues({ frequency: 'weekly', weekdays: [1, 3] }),
      'item-1',
    );
    expect(weekly.weekdays).toEqual([1, 3]);
    expect(weekly.dayOfMonth).toBe(0);

    const monthly = buildCreateReminderInput(
      validValues({ frequency: 'monthly', dayOfMonth: 15 }),
      'item-1',
    );
    expect(monthly.weekdays).toEqual([]);
    expect(monthly.dayOfMonth).toBe(15);
  });

  it('itemId / enabled / startAt / tzid 原样透传', () => {
    const input = buildCreateReminderInput(validValues({ enabled: false }), 'item-9');
    expect(input.itemId).toBe('item-9');
    expect(input.enabled).toBe(false);
    expect(input.startAt).toBe(1749427200000);
    expect(input.tzid).toBe('Asia/Shanghai');
    expect(input.localTimeHour).toBe(9);
    expect(input.localTimeMinute).toBe(30);
  });
});

describe('buildCreateReminderInput（切片 16 阶段 3：渠道与 once）', () => {
  it('webhook：channelConfig 为 trim 后 URL；system-notification 渠道 config 恒 null', () => {
    const webhook = buildCreateReminderInput(
      validValues({ channel: 'webhook', channelConfigText: '  https://example.com/hook  ' }),
      'item-1',
    );
    expect(webhook.channel).toBe('webhook');
    expect(webhook.channelConfig).toBe('https://example.com/hook');

    const sys = buildCreateReminderInput(validValues(), 'item-1');
    expect(sys.channel).toBe('system-notification');
    expect(sys.channelConfig).toBeNull();
  });

  it('apprise：channelConfig 序列化为 {baseUrl,key} JSON（trim）', () => {
    const apprise = buildCreateReminderInput(
      validValues({
        channel: 'apprise',
        appriseBaseUrl: ' https://apprise.example.com/ ',
        appriseKey: ' k1 ',
      }),
      'item-1',
    );
    expect(apprise.channel).toBe('apprise');
    expect(apprise.channelConfig).toBe(JSON.stringify({ baseUrl: 'https://apprise.example.com/', key: 'k1' }));
  });

  it('once：localTime 归零、onceAt 由表单文本解析、非 weekly/monthly 字段归零', () => {
    const input = buildCreateReminderInput(
      validValues({ frequency: 'once', onceAt: { date: '2026-11-12', hour: 8, minute: 50 } }),
      'item-1',
    );
    expect(input.frequency).toBe('once');
    expect(input.localTimeHour).toBe(0);
    expect(input.localTimeMinute).toBe(0);
    expect(input.onceAt).toEqual({ year: 2026, month: 11, day: 12, hour: 8, minute: 50 });
    expect(input.weekdays).toEqual([]);
    expect(input.dayOfMonth).toBe(0);
  });
});

describe('buildUpdateReminderInput（切片 16 阶段 3）', () => {
  function targetReminder(overrides: Partial<Reminder> = {}): Reminder {
    return {
      id: 'r-1',
      itemId: 'item-1',
      frequency: 'daily',
      localTimeHour: 9,
      localTimeMinute: 30,
      weekdays: [],
      dayOfMonth: 0,
      onceAt: null,
      tzid: 'Asia/Shanghai',
      startAt: 1749427200000,
      enabled: true,
      channel: 'system-notification',
      channelConfig: null,
      lastFiredOccurrenceKey: null,
      lastReconciledAt: null,
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    };
  }

  it('重复频率：onceAt 显式 null、渠道字段透传、startAt 未填回退 target 现值', () => {
    const patch = buildUpdateReminderInput(
      validValues({ channel: 'alarm', channelConfigText: '' }),
      targetReminder(),
    );
    expect(patch.frequency).toBe('daily');
    expect(patch.onceAt).toBeNull();
    expect(patch.channel).toBe('alarm');
    expect(patch.channelConfig).toBeNull();
    expect(patch.startAt).toBe(1749427200000);
    expect(patch.tzid).toBe('Asia/Shanghai');
    expect(patch.enabled).toBe(true);
  });

  it('once：patch 携带解析后的 onceAt 与渠道配置（once→once 编辑）', () => {
    const patch = buildUpdateReminderInput(
      validValues({
        frequency: 'once',
        onceAt: { date: '2026-11-12', hour: 8, minute: 50 },
        channel: 'webhook',
        channelConfigText: 'https://example.com/hook',
      }),
      targetReminder({ frequency: 'once', onceAt: { year: 2026, month: 11, day: 11, hour: 9, minute: 0 } }),
    );
    expect(patch.frequency).toBe('once');
    expect(patch.onceAt).toEqual({ year: 2026, month: 11, day: 12, hour: 8, minute: 50 });
    expect(patch.channel).toBe('webhook');
    expect(patch.channelConfig).toBe('https://example.com/hook');
    expect(patch.localTimeHour).toBe(0);
    expect(patch.localTimeMinute).toBe(0);
  });
});

describe('isWebhookConfigJson（切片 17 阶段 2：预设整串复制的配置 JSON 形态）', () => {
  it('含 url 的完整配置 JSON（form 模板）→ true', () => {
    expect(
      isWebhookConfigJson(
        JSON.stringify({
          url: 'https://hooks.example.com/zulip',
          mode: 'form',
          payloadTemplate: { type: 'stream', to: 'general', topic: '生活提醒', content: '{{title}}' },
        }),
      ),
    ).toBe(true);
  });

  it('含 url 的 json 模式配置 JSON → true；url 缺失/非法 → false', () => {
    expect(isWebhookConfigJson(JSON.stringify({ url: 'https://example.com/hook' }))).toBe(true);
    expect(isWebhookConfigJson(JSON.stringify({ url: 'https://a.com', mode: 'text', payloadTemplate: 'hi' }))).toBe(true);
    expect(isWebhookConfigJson(JSON.stringify({ foo: 1 }))).toBe(false);
    expect(isWebhookConfigJson(JSON.stringify({ url: 'ftp://x' }))).toBe(false);
  });

  it('纯 URL / 任意非 JSON 串 / 非对象 JSON → false（走 URL 校验分支）', () => {
    expect(isWebhookConfigJson('https://example.com/hook')).toBe(false);
    expect(isWebhookConfigJson('{bad json')).toBe(false);
    expect(isWebhookConfigJson('123')).toBe(false);
    expect(isWebhookConfigJson('[1,2]')).toBe(false);
    expect(isWebhookConfigJson('')).toBe(false);
  });

  it('validate：webhook 选预设后 channelConfigText=配置 JSON 不再报 URL 错误', () => {
    const values = validValues({ channel: 'webhook' });
    values.channelConfigText = JSON.stringify({
      url: 'https://hooks.example.com/zulip',
      mode: 'form',
      payloadTemplate: { type: 'stream', to: 'general', content: '{{title}}' },
    });
    expect(validateReminderForm(values).channelConfig).toBeUndefined();
    values.channelConfigText = 'not a url at all';
    expect(validateReminderForm(values).channelConfig).toContain('URL 或配置 JSON 无效');
  });
});
