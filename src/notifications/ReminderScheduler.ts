/**
 * ReminderScheduler —— 本地通知调度与对账（AGENTS.md §4.16，接口签名冻结）。
 *
 * - 本目录是唯一允许 import expo-notifications 的地方（§4.20）。
 * - notification identifier 必须等于 occurrenceKey（§4.20），
 *   因此对账可以纯靠 identifier 前缀 + 集合 diff 完成。
 * - 规则一律来自 src/data/reminderRuleMapping 的 toRecurrenceRule，
 *   调度器不得自行解析字符串化规则（§4.17）。
 */

import * as Notifications from 'expo-notifications';
import type { NotificationBehavior } from 'expo-notifications';

import type { ItemRepository } from '../data/ItemRepository';
import { toRecurrenceRule } from '../data/reminderRuleMapping';
import type { ReconcileResult, Reminder } from '../domain/reminder';
import type { Item } from '../domain/item';
import type { Occurrence } from '../domain/recurrence';
import { expandOccurrences } from '../domain/recurrence';
import {
  IDENTIFIER_ROOT_PREFIX,
  computeMissed,
  diffNotifications,
  reminderIdentifierPrefix,
} from './reconcileDiff';

/** 单条 reminder 最多调度的通知数（§4.16/§4.20 冻结）。 */
const MAX_SCHEDULED_PER_REMINDER = 30;

/** 调度窗口：instant > now 且 instant <= now + 30 天（§4.16）。 */
const SCHEDULE_WINDOW_DAYS = 30;

/** 全 App 调度通知预算（§4.20：Android 上限约 500，超过需跳过最远的一批并记录 warning）。 */
const RECONCILE_SCHEDULE_BUDGET = 500;

const DAY_MS = 86_400_000;

/** Item.content 为空时通知正文按类型给文案（tasks/slice-05.md 实现要求 4）。 */
const ITEM_TYPE_FALLBACK_BODY: Record<Item['type'], string> = {
  note: '你有一条笔记提醒',
  task: '你有一条任务提醒',
  event: '你有一个日程提醒',
};

/** 通知正文：content 前 60 字符（截断时补省略号），空白内容用类型文案。 */
function notificationBody(item: Item): string {
  const content = item.content.trim();
  if (content.length === 0) {
    return ITEM_TYPE_FALLBACK_BODY[item.type];
  }
  return content.length > 60 ? `${content.slice(0, 60)}…` : content;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 前台收到通知时的展示行为（App 在前台时锁屏/横幅仍提示；后台与杀进程由系统接管）。 */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (): Promise<NotificationBehavior> => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * ReminderScheduler 接口（AGENTS.md §4.16 冻结，不得增删方法签名）。
 * 调试页所需的附加能力（看现网通知/权限/日志/聚合补提醒）由
 * WatermelonReminderScheduler 以类方法提供，不进入本接口。
 */
export interface ReminderScheduler {
  scheduleForReminder(reminderId: string): Promise<void>;
  cancelForReminder(reminderId: string): Promise<void>;
  cancelAll(): Promise<void>;
  reconcile(): Promise<ReconcileResult>;
}

export type ReminderSchedulerDeps = {
  repository: ItemRepository;
  /** 时钟注入（测试用）；默认 Date.now。 */
  now?: () => number;
};

export class WatermelonReminderScheduler implements ReminderScheduler {
  private readonly repository: ItemRepository;
  private readonly now: () => number;
  private readonly logs: string[] = [];

  constructor(deps: ReminderSchedulerDeps) {
    this.repository = deps.repository;
    this.now = deps.now ?? Date.now;
  }

  /** 供调试页展示的最近日志（环形，最多 50 条）。 */
  getRecentLogs(): string[] {
    return [...this.logs];
  }

  private log(message: string): void {
    const line = `${new Date(this.now()).toISOString()} ${message}`;
    this.logs.push(line);
    if (this.logs.length > 50) {
      this.logs.shift();
    }
    console.warn('[ReminderScheduler]', line);
  }

  /** 现网全部已调度通知的 identifier。 */
  private async listScheduledIdentifiers(): Promise<string[]> {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return scheduled.map((notification) => notification.identifier);
  }

  /** 本 App 前缀（recurrence:v1|）下的现网 identifier 集合。 */
  private async listScheduledOurKeys(): Promise<Set<string>> {
    const identifiers = await this.listScheduledIdentifiers();
    return new Set(identifiers.filter((identifier) => identifier.startsWith(IDENTIFIER_ROOT_PREFIX)));
  }

  /** §4.16 窗口过滤：instant > now 且 instant <= now + 30 天。 */
  private windowOccurrences(occurrences: Occurrence[], now: number): Occurrence[] {
    const horizon = now + SCHEDULE_WINDOW_DAYS * DAY_MS;
    return occurrences.filter((o) => o.instant > now && o.instant <= horizon);
  }

  /** 单条调度：失败（如权限被拒）必须捕获记录，不得抛到 UI（§4.20）。 */
  private async safeSchedule(reminder: Reminder, item: Item, occurrence: Occurrence): Promise<boolean> {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: occurrence.occurrenceKey,
        content: {
          title: item.title,
          body: notificationBody(item),
          data: {
            occurrenceKey: occurrence.occurrenceKey,
            reminderId: reminder.id,
            itemId: item.id,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(occurrence.instant),
        },
      });
      return true;
    } catch (error) {
      this.log(`scheduleNotificationAsync failed for ${occurrence.occurrenceKey}: ${describeError(error)}`);
      return false;
    }
  }

  /** 单条取消：失败捕获记录，不中断对账其余部分。 */
  private async safeCancel(identifier: string): Promise<boolean> {
    try {
      await Notifications.cancelScheduledNotificationAsync(identifier);
      return true;
    } catch (error) {
      this.log(`cancelScheduledNotificationAsync failed for ${identifier}: ${describeError(error)}`);
      return false;
    }
  }

  async scheduleForReminder(reminderId: string): Promise<void> {
    const enabledReminders = await this.repository.listEnabledReminders();
    const reminder = enabledReminders.find((r) => r.id === reminderId);
    if (!reminder) {
      // 不在 enabled 列表（enabled=false 或已删除）→ 等价 cancel（§4.16）。
      await this.cancelForReminder(reminderId);
      return;
    }

    const item = await this.repository.getItem(reminder.itemId);
    if (!item || item.status !== 'active') {
      // Item 不存在 / 已完成 / 已归档 → 等价 cancel（§4.16）。
      this.log(`scheduleForReminder(${reminderId}): item missing or not active, cancelling`);
      await this.cancelForReminder(reminderId);
      return;
    }

    const now = this.now();
    const occurrences = expandOccurrences({
      scheduleId: reminder.id,
      rule: toRecurrenceRule(reminder),
      startAt: reminder.startAt,
      tzid: reminder.tzid,
      count: MAX_SCHEDULED_PER_REMINDER,
    });
    const windowed = this.windowOccurrences(occurrences, now);
    const expectedKeys = new Set(windowed.map((o) => o.occurrenceKey));

    const prefix = reminderIdentifierPrefix(reminderId);
    const actualKeys = await this.listScheduledOurKeys();
    const actualForReminder = new Set(
      [...actualKeys].filter((identifier) => identifier.startsWith(prefix)),
    );

    const { toSchedule, toCancel } = diffNotifications(expectedKeys, actualForReminder);

    for (const identifier of toCancel) {
      if (await this.safeCancel(identifier)) {
        this.log(`cancelled ${identifier}`);
      }
    }

    const occurrenceByKey = new Map(windowed.map((o) => [o.occurrenceKey, o] as const));
    for (const identifier of toSchedule) {
      const occurrence = occurrenceByKey.get(identifier);
      if (!occurrence) {
        // 理论不可达：expectedKeys 由 windowed 生成；保守跳过而非抛错。
        this.log(`scheduleForReminder(${reminderId}): missing occurrence for ${identifier}`);
        continue;
      }
      if (await this.safeSchedule(reminder, item, occurrence)) {
        this.log(`scheduled ${identifier}`);
      }
    }
  }

  async cancelForReminder(reminderId: string): Promise<void> {
    const prefix = reminderIdentifierPrefix(reminderId);
    const identifiers = await this.listScheduledIdentifiers();
    for (const identifier of identifiers) {
      if (!identifier.startsWith(prefix)) {
        continue;
      }
      if (await this.safeCancel(identifier)) {
        this.log(`cancelled ${identifier}`);
      }
    }
  }

  async cancelAll(): Promise<void> {
    // 只取消本 App 前缀的通知，不得取消其他来源（§4.16）。
    const identifiers = await this.listScheduledIdentifiers();
    for (const identifier of identifiers) {
      if (!identifier.startsWith(IDENTIFIER_ROOT_PREFIX)) {
        continue;
      }
      if (await this.safeCancel(identifier)) {
        this.log(`cancelled ${identifier}`);
      }
    }
  }

  async reconcile(): Promise<ReconcileResult> {
    const now = this.now();
    const reminders = await this.repository.listEnabledReminders();
    const actualKeys = await this.listScheduledOurKeys();

    // §4.16（与 scheduleForReminder 同语义）：Item 不存在 / 已完成 / 已归档 → 等价 cancel。
    // 在 reconcile 中：该 reminder 不展开、不计 missed，其现网通知因不在期望集合而被对账取消。
    type ReconcileEntry = { reminder: Reminder; item: Item; occurrences: Occurrence[] };
    const activeEntries: ReconcileEntry[] = [];
    for (const reminder of reminders) {
      const item = await this.repository.getItem(reminder.itemId);
      if (!item || item.status !== 'active') {
        this.log(
          `reconcile: reminder ${reminder.id} item missing or not active (${item ? item.status : 'gone'})`,
        );
        continue;
      }
      activeEntries.push({
        reminder,
        item,
        occurrences: expandOccurrences({
          scheduleId: reminder.id,
          rule: toRecurrenceRule(reminder),
          startAt: reminder.startAt,
          tzid: reminder.tzid,
          count: MAX_SCHEDULED_PER_REMINDER,
        }),
      });
    }

    // 记录每个 entry 最近一次未来触发时刻，供 §4.20 超额时「跳过最远的一批」排序。
    const ordered = activeEntries
      .map((entry) => {
        let nextInstant = Number.POSITIVE_INFINITY;
        for (const o of entry.occurrences) {
          if (o.instant > now && o.instant < nextInstant) {
            nextInstant = o.instant;
          }
        }
        return {
          reminder: entry.reminder,
          item: entry.item,
          occurrences: entry.occurrences,
          nextInstant,
        };
      })
      .sort(
        (a, b) =>
          a.nextInstant - b.nextInstant ||
          (a.reminder.id < b.reminder.id ? -1 : a.reminder.id > b.reminder.id ? 1 : 0),
      );

    // §4.20：按期望条数占用预算；放不下的最远一批跳过并记录 warning（不静默截断）。
    const processable: { reminder: Reminder; item: Item; windowed: Occurrence[] }[] = [];
    const skippedReminderIds: string[] = [];
    let used = 0;
    for (const entry of ordered) {
      const windowed = this.windowOccurrences(entry.occurrences, now);
      if (used + windowed.length > RECONCILE_SCHEDULE_BUDGET) {
        skippedReminderIds.push(entry.reminder.id);
        continue;
      }
      used += windowed.length;
      processable.push({ reminder: entry.reminder, item: entry.item, windowed });
    }
    if (skippedReminderIds.length > 0) {
      this.log(
        `reconcile: schedule budget ${RECONCILE_SCHEDULE_BUDGET} reached; skipped furthest reminders: ${skippedReminderIds.join(', ')}`,
      );
    }

    const expectedKeys = new Set<string>();
    for (const entry of processable) {
      for (const occurrence of entry.windowed) {
        expectedKeys.add(occurrence.occurrenceKey);
      }
    }

    const { toSchedule, toCancel } = diffNotifications(expectedKeys, actualKeys);

    // 被预算跳过的 reminder：本轮不动其现有通知（避免取消-重排抖动），只跳过不清理。
    const skippedPrefixes = skippedReminderIds.map(reminderIdentifierPrefix);
    const isSkipped = (identifier: string): boolean =>
      skippedPrefixes.some((prefix) => identifier.startsWith(prefix));

    const newlyScheduled: string[] = [];
    const cancelled: string[] = [];

    for (const identifier of toCancel) {
      if (isSkipped(identifier)) {
        continue;
      }
      if (await this.safeCancel(identifier)) {
        cancelled.push(identifier);
        this.log(`cancelled ${identifier}`);
      }
    }

    const toScheduleSet = new Set(toSchedule);
    for (const entry of processable) {
      for (const occurrence of entry.windowed) {
        if (!toScheduleSet.has(occurrence.occurrenceKey)) {
          continue;
        }
        if (await this.safeSchedule(entry.reminder, entry.item, occurrence)) {
          newlyScheduled.push(occurrence.occurrenceKey);
          this.log(`scheduled ${occurrence.occurrenceKey}`);
        }
      }
    }

    // 错过判定对全部 enabled reminder 生效（含被预算跳过者）；
    // 去重靠 markReminderFired 推进游标（§4.19）。
    const missed: Occurrence[] = [];
    for (const entry of ordered) {
      const reminderMissed = computeMissed(
        entry.occurrences,
        entry.reminder.lastFiredOccurrenceKey,
        now,
      );
      if (reminderMissed.length > 0) {
        const lastMissedKey = reminderMissed[reminderMissed.length - 1].occurrenceKey;
        await this.repository.markReminderFired(entry.reminder.id, lastMissedKey);
        missed.push(...reminderMissed);
      }
      await this.repository.markReminderReconciled(entry.reminder.id, now);
    }

    return { newlyScheduled, cancelled, missed };
  }

  // —— 以下为调试页（tasks/slice-05.md 实现要求 7）所需的附加能力，不进入冻结接口 ——

  /** 现网本 App 前缀下的已调度 identifier 列表（调试页展示用）。 */
  async getScheduledNotificationIdentifiers(): Promise<string[]> {
    const keys = await this.listScheduledOurKeys();
    return [...keys];
  }

  /** 通知权限状态（调试页展示「通知权限未授予」用）。 */
  async getPermissionState(): Promise<'granted' | 'denied' | 'undetermined'> {
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted) {
      return 'granted';
    }
    return settings.status === 'denied' ? 'denied' : 'undetermined';
  }

  /**
   * 立即展示一条错过聚合通知（§4.19 调试入口；真机验收用）。
   * identifier 不带 recurrence:v1| 前缀，避免混入对账 diff；
   * trigger: null 表示立即展示（SDK 54 中 presentNotificationAsync 已被移除）。
   */
  async presentMissedSummary(missed: Occurrence[]): Promise<void> {
    if (missed.length === 0) {
      return;
    }
    const summary = missed.map((o) => o.occurrenceKey).join('\n');
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `错过 ${missed.length} 条提醒`,
        body: summary.length > 200 ? `${summary.slice(0, 200)}…` : summary,
        data: { missedCount: missed.length },
      },
      trigger: null,
    });
  }
}
