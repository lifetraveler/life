import { Model } from '@nozbe/watermelondb';
import { date, field, readonly, text } from '@nozbe/watermelondb/decorators';

import type { ReminderFrequency } from '../../domain/reminder';

/**
 * reminders 表的 WatermelonDB model（AGENTS.md §4.17，schema v3；v8 扩展见切片 16 注记）。
 *
 * - 与 ItemTagModel 同一先例：item_id 为普通字符串列，不用 @relation，
 *   关联查询走 Q.where('item_id', …)。
 * - weekdays 存 JSON 数组字符串（§4.17 冻结决定），解析收敛在
 *   src/data/reminderRuleMapping.ts 的 parseWeekdaysJson——解析失败必须抛错，
 *   不得静默当空数组。
 * - last_fired_occurrence_key / last_reconciled_at 为 nullable（schema isOptional），
 *   仅调度器经 markReminderFired / markReminderReconciled 写入。
 * - 切片 16（schema v8，AGENTS.md §7.26）：once_civil_json / channel / channel_config
 *   三列；解析与归一化同样收敛在 reminderRuleMapping.ts。
 */
export default class ReminderModel extends Model {
  static table = 'reminders';

  @text('item_id') itemId!: string;

  @text('frequency') frequency!: ReminderFrequency;

  /** 0–23 */
  @field('local_time_hour') localTimeHour!: number;

  /** 0–59 */
  @field('local_time_minute') localTimeMinute!: number;

  /** JSON 数组字符串（仅 weekly 非空，其他 frequency 恒为 ''） */
  @text('weekdays') weekdaysJson!: string;

  /** 仅 monthly 使用（1–31），其他 frequency 恒为 0 */
  @field('day_of_month') dayOfMonth!: number;

  /** IANA 时区标识，创建时写入 */
  @text('tzid') tzid!: string;

  /** 规则生效起点（绝对毫秒时间戳） */
  @field('start_at') startAt!: number;

  /**
   * boolean 列用 @field：watermelondb 0.28 的 decorators 不导出 boolean 装饰器，
   * 读取路径由 RawRecord.sanitizedRaw 按列类型（boolean）把 SQLite 1/0 还原为 true/false。
   */
  @field('enabled') enabled!: boolean;

  /**
   * 切片 16（schema v8）：once 一次性提醒的民用时刻 JSON
   * （{"year":…,"month":…,"day":…,"hour":…,"minute":…}）。
   * 仅 frequency='once' 非空；解析收敛在 reminderRuleMapping.parseOnceCivilJson，
   * 坏 JSON 抛错不静默（与 weekdays 同纪律）。
   */
  @text('once_civil_json') onceCivilJson!: string | null;

  /**
   * 切片 16（schema v8）：提醒渠道。存量行经 migration 回填 'system-notification'；
   * LokiJS 测试适配器忽略 'sql' 步骤时读到 ''，由 toDomainReminder 防御回退默认渠道。
   */
  @text('channel') channel!: string;

  /** 切片 16（schema v8）：渠道配置（webhook URL / apprise 配置 JSON）；渠道无关时 null */
  @text('channel_config') channelConfig!: string | null;

  @text('last_fired_occurrence_key') lastFiredOccurrenceKey!: string | null;

  @field('last_reconciled_at') lastReconciledAt!: number | null;

  @readonly @date('created_at') createdAt!: Date;

  @readonly @date('updated_at') updatedAt!: Date;
}
