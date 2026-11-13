/**
 * default_channels 三件套纯函数测试（切片 19 阶段 1，AGENTS.md §7.30）：
 * - parseDefaultChannels：读层防御归一，永不抛错（null/''/坏JSON/非数组/全非法→回退）；
 * - validateDefaultChannels：写路径严格校验（空/非法成员/expo 双开抛错），canonical 序；
 * - serializeDefaultChannels：恒 JSON 数组（先 validate 后 stringify）。
 * 纯函数测试不碰数据库；Repository 层行为（兜底建行/往返）见 data/__tests__。
 */

import {
  DEFAULT_APP_SETTINGS,
  parseDefaultChannels,
  serializeDefaultChannels,
  validateDefaultChannels,
} from '../settings';
import type { ReminderChannel } from '../reminder';

describe('parseDefaultChannels（读层防御归一）', () => {
  it('null / undefined / 空串 → 回退默认 ["system-notification"]', () => {
    expect(parseDefaultChannels(null)).toEqual(['system-notification']);
    expect(parseDefaultChannels(undefined)).toEqual(['system-notification']);
    expect(parseDefaultChannels('')).toEqual(['system-notification']);
  });

  it('坏 JSON / 非数组 JSON / 对象 → 回退默认', () => {
    expect(parseDefaultChannels('not-json')).toEqual(['system-notification']);
    expect(parseDefaultChannels('"system-notification"')).toEqual(['system-notification']);
    expect(parseDefaultChannels('{"channel":"webhook"}')).toEqual(['system-notification']);
    expect(parseDefaultChannels('null')).toEqual(['system-notification']);
  });

  it('数组元素全非法 → 回退默认（结果为空不返回空数组）', () => {
    expect(parseDefaultChannels('["sms","email"]')).toEqual(['system-notification']);
    expect(parseDefaultChannels('[42,null]')).toEqual(['system-notification']);
    expect(parseDefaultChannels('[]')).toEqual(['system-notification']);
  });

  it('非法元素丢弃、合法保留：["webhook","sms"] → ["webhook"]', () => {
    expect(parseDefaultChannels('["webhook","sms"]')).toEqual(['webhook']);
  });

  it('去重：["webhook","webhook","apprise"] → ["webhook","apprise"]', () => {
    expect(parseDefaultChannels('["webhook","webhook","apprise"]')).toEqual([
      'webhook',
      'apprise',
    ]);
  });

  it('expo 双开（手工改库/旧 bug）：保留 canonical 序靠前者 system-notification，丢 alarm', () => {
    expect(parseDefaultChannels('["alarm","system-notification"]')).toEqual([
      'system-notification',
    ]);
    expect(parseDefaultChannels('["system-notification","alarm","webhook"]')).toEqual([
      'system-notification',
      'webhook',
    ]);
    // 只开 alarm 是合法的：保留
    expect(parseDefaultChannels('["alarm"]')).toEqual(['alarm']);
  });

  it('按 REMINDER_CHANNELS canonical 序排列（不信任存储顺序）', () => {
    expect(parseDefaultChannels('["apprise","webhook"]')).toEqual(['webhook', 'apprise']);
  });

  it('永不抛错：喂任意垃圾输入都返回可用数组', () => {
    const garbage = ['{', '[', '1', 'true', '[[1]]', '""'] as const;
    for (const raw of garbage) {
      expect(Array.isArray(parseDefaultChannels(raw))).toBe(true);
    }
  });
});

describe('validateDefaultChannels（写路径严格校验）', () => {
  it('非法成员抛错，错误消息含该值', () => {
    expect(() => validateDefaultChannels(['sms' as ReminderChannel])).toThrow(
      'defaultChannels 含非法渠道：sms',
    );
  });

  it('空数组抛错', () => {
    expect(() => validateDefaultChannels([])).toThrow('defaultChannels 至少需要 1 个渠道');
  });

  it('非数组抛错（运行时防御，绕过类型层喂垃圾）', () => {
    const notAnArray = '["system-notification"]' as unknown as ReminderChannel[];
    expect(() => validateDefaultChannels(notAnArray)).toThrow('defaultChannels 必须是数组');
  });

  it('expo 家族双开抛错（system-notification + alarm）', () => {
    expect(() => validateDefaultChannels(['system-notification', 'alarm'])).toThrow(
      'expo 家族渠道（system-notification/alarm）至多一个',
    );
    expect(() => validateDefaultChannels(['alarm', 'system-notification', 'webhook'])).toThrow(
      'expo 家族渠道',
    );
  });

  it('通过校验：去重 + canonical 序排列的标准化拷贝', () => {
    expect(validateDefaultChannels(['apprise', 'webhook', 'webhook'])).toEqual([
      'webhook',
      'apprise',
    ]);
    expect(validateDefaultChannels(['alarm'])).toEqual(['alarm']);
    expect(validateDefaultChannels(['system-notification'])).toEqual(['system-notification']);
    // 不修改入参
    const input: ReminderChannel[] = ['webhook', 'apprise'];
    validateDefaultChannels(input);
    expect(input).toEqual(['webhook', 'apprise']);
  });
});

describe('serializeDefaultChannels', () => {
  it('恒输出 JSON 数组字符串（经 validate）', () => {
    expect(serializeDefaultChannels(['webhook'])).toBe('["webhook"]');
    expect(serializeDefaultChannels(['apprise', 'webhook'])).toBe('["webhook","apprise"]');
  });

  it('非法输入同样抛错（不静默序列化）', () => {
    expect(() => serializeDefaultChannels([])).toThrow();
    expect(() => serializeDefaultChannels(['system-notification', 'alarm'])).toThrow();
  });
});

describe('DEFAULT_APP_SETTINGS.defaultChannels（切片 19 兜底）', () => {
  it('默认值 = ["system-notification"]（复用 DEFAULT_REMINDER_CHANNELS，拷贝隔离）', () => {
    expect(DEFAULT_APP_SETTINGS.defaultChannels).toEqual(['system-notification']);
    // fallback 每次返回新拷贝：外部改动返回值不污染默认值
    const fallback = parseDefaultChannels(null);
    fallback.push('webhook');
    expect(DEFAULT_APP_SETTINGS.defaultChannels).toEqual(['system-notification']);
    expect(parseDefaultChannels(null)).toEqual(['system-notification']);
  });
});
