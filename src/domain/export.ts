/**
 * 切片 12：数据导出序列化纯函数（tasks/slice-12.md 实现要求 3）。
 *
 * 纯 TypeScript：输入领域对象、输出 JSON 字符串，不依赖 React Native /
 * WatermelonDB / expo-file-system，可单测（任务卡验收 8）。
 *
 * 字段集合按切片 12 决策 D（用户确认）：
 * - Item 侧：id/type/title/content/status/startAt/endAt/allDay/sourceType/
 *   sourceUid/sourceReadOnly/createdAt/updatedAt + tags 名称数组；
 * - Reminder 摘要（挂在所属 Item 下）：frequency/localTime/weekdays/
 *   dayOfMonth/tzid/enabled/startAt；剔除调度器内部字段
 *   lastFiredOccurrenceKey / lastReconciledAt 与 reminder 的 id/itemId。
 * 顶层不含导出时间戳（文件名已含时间戳；纯函数输出只由输入决定）。
 */

import type { Item } from './item';
import type { Reminder, ReminderFrequency } from './reminder';
import type { ItemWithTags } from './tag';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 导出 Reminder 摘要（不含 id/itemId 与调度器内部字段，决策 D） */
export interface ExportedReminderSummary {
  frequency: ReminderFrequency;
  /** 'HH:mm'（规则本地时刻，pad2 补零） */
  localTime: string;
  /** 仅 weekly 使用（1=周一 … 7=周日）；其他 frequency 恒为 [] */
  weekdays: number[];
  /** 仅 monthly 使用（1–31）；其他 frequency 恒为 0 */
  dayOfMonth: number;
  /** IANA 时区标识（创建时写入的规则时区） */
  tzid: string;
  /** 规则生效起点（绝对毫秒时间戳） */
  startAt: number;
  enabled: boolean;
}

/** 导出条目：Item 字段 + 标签名数组 + 所属提醒摘要 */
export interface ExportedItem {
  id: string;
  type: Item['type'];
  title: string;
  content: string;
  status: Item['status'];
  startAt: number | null;
  endAt: number | null;
  allDay: boolean;
  sourceType: Item['sourceType'];
  sourceUid: string | null;
  sourceReadOnly: boolean;
  createdAt: number;
  updatedAt: number;
  /** 标签名数组（保持传入顺序） */
  tags: string[];
  /** 所属提醒摘要（保持传入顺序） */
  reminders: ExportedReminderSummary[];
}

/** 导出负载顶层结构；version 便于后续演进 */
export interface ExportPayload {
  version: 1;
  items: ExportedItem[];
}

function toReminderSummary(reminder: Reminder): ExportedReminderSummary {
  return {
    frequency: reminder.frequency,
    localTime: `${pad2(reminder.localTimeHour)}:${pad2(reminder.localTimeMinute)}`,
    weekdays: [...reminder.weekdays],
    dayOfMonth: reminder.dayOfMonth,
    tzid: reminder.tzid,
    startAt: reminder.startAt,
    enabled: reminder.enabled,
  };
}

function toExportedItem(item: ItemWithTags, reminders: Reminder[]): ExportedItem {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    content: item.content,
    status: item.status,
    startAt: item.startAt,
    endAt: item.endAt,
    allDay: item.allDay,
    sourceType: item.sourceType,
    sourceUid: item.sourceUid,
    sourceReadOnly: item.sourceReadOnly,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    tags: item.tags.map((tag) => tag.name),
    reminders: reminders.map(toReminderSummary),
  };
}

/**
 * 序列化导出数据（tasks/slice-12.md 实现要求 3，签名冻结）：
 * items 为默认列表 ∪ 归档列表（决策 B，含 archived/done），reminders 为全库
 * Reminder（决策 A-1）；按 itemId 把提醒摘要挂到对应条目下。对应 Item 不在
 * items 内的提醒（孤儿）忽略——列表范围即导出范围。
 * 输出为 JSON.stringify(payload, null, 2) 文本，可直接 JSON.parse 反解析。
 */
export function serializeExportData(
  items: ItemWithTags[],
  reminders: Reminder[],
): string {
  const byItemId = new Map<string, Reminder[]>();
  for (const reminder of reminders) {
    const bucket = byItemId.get(reminder.itemId);
    if (bucket) {
      bucket.push(reminder);
    } else {
      byItemId.set(reminder.itemId, [reminder]);
    }
  }
  const payload: ExportPayload = {
    version: 1,
    items: items.map((item) => {
      const itemReminders = byItemId.get(item.id);
      return toExportedItem(item, itemReminders ?? []);
    }),
  };
  return JSON.stringify(payload, null, 2);
}
