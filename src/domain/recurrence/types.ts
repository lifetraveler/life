/**
 * 切片 4：重复规则模块的类型定义。
 *
 * 对应 AGENTS.md §4.11–4.15 与 tasks/slice-04.md：
 * - 本模块是纯 TypeScript，不依赖 React / React Native / WatermelonDB / expo-notifications。
 * - 重复提醒按“民用时间规则”计算，必须同时携带 localTime 与 IANA tzid。
 */

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';

export type LocalTime = {
  /** 0–23 */
  hour: number;
  /** 0–59 */
  minute: number;
};

/** MVP 冻结的三种规则；不得扩展其它 frequency。 */
export type RecurrenceRule =
  | { frequency: 'daily'; localTime: LocalTime }
  /** weekdays：1=周一 … 7=周日 */
  | { frequency: 'weekly'; weekdays: number[]; localTime: LocalTime }
  /** dayOfMonth：1–31，短月固定回退到当月最后一天 */
  | { frequency: 'monthly'; dayOfMonth: number; localTime: LocalTime };

export type ExpandOccurrencesInput = {
  scheduleId: string;
  rule: RecurrenceRule;
  /** 绝对毫秒时间戳，规则生效起点；startAt 本身不一定是 occurrence。 */
  startAt: number;
  /** IANA 时区标识，如 'Asia/Shanghai'、'America/New_York'。 */
  tzid: string;
  /** 输出数量，默认 30，上限 30（超过时截断到 30）。 */
  count?: number;
};

export type Occurrence = {
  /** 由 scheduleId / localDate / localTime / tzid 确定性拼接，不含 UTC 时间戳。 */
  occurrenceKey: string;
  /** 'YYYY-MM-DD' */
  localDate: string;
  /** 'HH:mm' */
  localTime: string;
  tzid: string;
  /** 对应的绝对毫秒时间戳。 */
  instant: number;
};

export type BuildOccurrenceKeyInput = {
  scheduleId: string;
  localDate: string;
  localTime: string;
  tzid: string;
};
