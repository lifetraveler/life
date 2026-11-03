import {
  REMINDER_TZ_WHITELIST,
  assertWhitelistedReminderTz,
  isWhitelistedReminderTz,
} from '../reminderTzWhitelist';

describe('reminderTzWhitelist（AGENTS.md §4.25）', () => {
  it('白名单恰好为 Asia/Shanghai 与 America/New_York（冻结，不得增删）', () => {
    expect([...REMINDER_TZ_WHITELIST]).toEqual(['Asia/Shanghai', 'America/New_York']);
  });

  it('isWhitelistedReminderTz：两个白名单值通过', () => {
    expect(isWhitelistedReminderTz('Asia/Shanghai')).toBe(true);
    expect(isWhitelistedReminderTz('America/New_York')).toBe(true);
  });

  it('isWhitelistedReminderTz：其他 IANA 时区、固定偏移、大小写变体、空串全部拒绝', () => {
    expect(isWhitelistedReminderTz('Europe/London')).toBe(false);
    expect(isWhitelistedReminderTz('UTC')).toBe(false);
    expect(isWhitelistedReminderTz('+08:00')).toBe(false);
    expect(isWhitelistedReminderTz('asia/shanghai')).toBe(false);
    expect(isWhitelistedReminderTz('')).toBe(false);
  });

  it('assertWhitelistedReminderTz：白名单内不抛错', () => {
    expect(() => assertWhitelistedReminderTz('Asia/Shanghai')).not.toThrow();
    expect(() => assertWhitelistedReminderTz('America/New_York')).not.toThrow();
  });

  it('assertWhitelistedReminderTz：白名单外抛含 tzid 与白名单内容的明确错误', () => {
    expect(() => assertWhitelistedReminderTz('Europe/London')).toThrow(
      /"Europe\/London".*Asia\/Shanghai.*America\/New_York/s,
    );
  });
});
