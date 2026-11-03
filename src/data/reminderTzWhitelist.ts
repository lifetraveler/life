/**
 * 切片 6（AGENTS.md §4.25）：Reminder 时区白名单。
 *
 * 允许的 tzid 仅 Asia/Shanghai、America/New_York——Hermes polyfill 用 add-golden-tz，
 * 只含这两个时区数据，其他时区在真机未验证。
 * Repository.createReminder / updateReminder 遇白名单外 tzid 必须抛明确错误；
 * DB 中已存在的白名单外 reminder 只读展示、不自动改写、不删除。
 * 扩展白名单必须先换 add-all-tz 并真机验证（§4.25 冻结）。
 */

export const REMINDER_TZ_WHITELIST = ['Asia/Shanghai', 'America/New_York'] as const;

export type ReminderTzid = (typeof REMINDER_TZ_WHITELIST)[number];

export function isWhitelistedReminderTz(tzid: string): tzid is ReminderTzid {
  return (REMINDER_TZ_WHITELIST as readonly string[]).includes(tzid);
}

/** 白名单外 tzid 抛明确错误（§4.25：createReminder / updateReminder 必须抛错） */
export function assertWhitelistedReminderTz(tzid: string): void {
  if (!isWhitelistedReminderTz(tzid)) {
    throw new Error(
      `createReminder/updateReminder: tzid "${tzid}" is not supported. ` +
        `Allowed: ${REMINDER_TZ_WHITELIST.join(', ')}`,
    );
  }
}
