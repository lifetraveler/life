/**
 * 切片 5：Reminder 领域类型（AGENTS.md §4.17–4.19）。
 *
 * 纯 TypeScript，不依赖 React Native / WatermelonDB / expo-notifications。
 * 字段集合与 reminders 表（schema v3）一一对应；Reminder ↔ RecurrenceRule 互转
 * 由 src/data/reminderRuleMapping.ts 负责（§4.17），ReminderScheduler 不得自行解析
 * 存储格式。
 */

import type { Occurrence } from './recurrence';

export type ReminderFrequency = 'daily' | 'weekly' | 'monthly';

/** 数据模型：Reminder（AGENTS.md §4.17，schema v3 冻结字段集合） */
export interface Reminder {
  id: string;
  itemId: string;
  frequency: ReminderFrequency;
  /** 0–23 */
  localTimeHour: number;
  /** 0–59 */
  localTimeMinute: number;
  /** 仅 weekly 使用（1=周一 … 7=周日）；其他 frequency 恒为 [] */
  weekdays: number[];
  /** 仅 monthly 使用（1–31）；其他 frequency 恒为 0 */
  dayOfMonth: number;
  /** IANA 时区标识，创建时写入，不随后续系统时区变化自动改写 */
  tzid: string;
  /** 规则生效起点（绝对毫秒时间戳） */
  startAt: number;
  enabled: boolean;
  /** 调度器内部状态：最后一个已计入触发/missed 的 occurrenceKey（AGENTS.md §4.19） */
  lastFiredOccurrenceKey: string | null;
  /** 调度器内部状态：上次对账完成时间 */
  lastReconciledAt: number | null;
  /** 毫秒时间戳 */
  createdAt: number;
  /** 毫秒时间戳 */
  updatedAt: number;
}

export interface CreateReminderInput {
  itemId: string;
  frequency: ReminderFrequency;
  localTimeHour: number;
  localTimeMinute: number;
  /** 仅 weekly 必填（1–7，至少一个）；其他 frequency 传了也会被归一化为 [] */
  weekdays?: number[];
  /** 仅 monthly 必填（1–31）；其他 frequency 传了也会被归一化为 0 */
  dayOfMonth?: number;
  tzid: string;
  startAt: number;
  enabled: boolean;
  // lastFiredOccurrenceKey / lastReconciledAt 不在输入内：
  // 由 Repository 初始化为 null（AGENTS.md §4.18），仅调度器经 mark* 方法更新。
}

/**
 * 更新 Reminder 的输入（§4.18 updateReminder 的参数形状）：
 * 允许更新规则字段、enabled 与 tzid；不允许更新 id、itemId、createdAt。
 * tzid（切片 6）：允许在两个白名单值之间显式切换（任务卡实现要求 5，§4.25）；
 * §4.17 的“不随后续系统时区变化自动改写”仅禁止自动改写，不禁止用户显式编辑。
 * lastFiredOccurrenceKey / lastReconciledAt 不在此列——只经 mark* 方法写入。
 */
export interface UpdateReminderInput {
  frequency?: ReminderFrequency;
  localTimeHour?: number;
  localTimeMinute?: number;
  weekdays?: number[];
  dayOfMonth?: number;
  startAt?: number;
  enabled?: boolean;
  /** 仅接受时区白名单值（§4.25）；Repository 对白名单外值抛错 */
  tzid?: string;
}

/** 对账结果（AGENTS.md §4.16）：missed 为本次新发现的错过 occurrence，不重复计入。 */
export interface ReconcileResult {
  newlyScheduled: string[];
  cancelled: string[];
  missed: Occurrence[];
}
