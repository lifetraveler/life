/**
 * ReminderScheduler —— 本地通知调度与对账（AGENTS.md §4.16，接口签名冻结）。
 *
 * - 本目录是唯一允许 import expo-notifications 的地方（§4.20）。
 * - notification identifier 必须等于 occurrenceKey（§4.20），
 *   因此对账可以纯靠 identifier 前缀 + 集合 diff 完成。
 * - 规则一律来自 src/data/reminderRuleMapping 的 toRecurrenceRule，
 *   调度器不得自行解析字符串化规则（§4.17）。
 * - 切片 16 阶段 2（提案 docs/proposals/slice-16-reminder-channels.md）：
 *   按 reminder.channel 分发到 ReminderChannel 渠道实现。
 *   system-notification / alarm 走 expo-notifications（本文件原逻辑）；
 *   webhook / apprise 为网络渠道：不向 OS 注册，内存定时器到点 fetch，
 *   不占 §4.20 的 500 条预算，missed occurrence 在对账时立即补发一次
 *   （notifications.md v0.16 增补）。
 */

import * as Notifications from 'expo-notifications';
import type { NotificationBehavior } from 'expo-notifications';

import type { ItemRepository } from '../data/ItemRepository';
import { toRecurrenceRule } from '../data/reminderRuleMapping';
import type { ReconcileResult, Reminder, ReminderChannel as ReminderChannelId } from '../domain/reminder';
import type { Item } from '../domain/item';
import type { Occurrence } from '../domain/recurrence';
import { buildOnceOccurrence, expandOccurrences } from '../domain/recurrence';
import {
  computeMissed,
  diffNotifications,
  isOurOccurrenceIdentifier,
  reminderIdentifierPrefix,
  reminderOccurrencePrefixes,
} from './reconcileDiff';
import {
  NetworkTimerRegistry,
  createReminderChannel,
  isNetworkReminderChannel,
} from './channels';
import type {
  NetworkTimerEntry,
  NetworkTimerRegistry as NetworkTimerRegistryType,
  NetworkReminderChannel,
  ReminderChannel,
} from './channels';
import { describeError } from './channels/shared';

/** 单条 reminder 最多调度的通知数（§4.16/§4.20 冻结）。 */
const MAX_SCHEDULED_PER_REMINDER = 30;

/** 调度窗口：instant > now 且 instant <= now + 30 天（§4.16）。 */
const SCHEDULE_WINDOW_DAYS = 30;

/** 全 App 调度通知预算（§4.20：Android 上限约 500，超过需跳过最远的一批并记录 warning）。 */
const RECONCILE_SCHEDULE_BUDGET = 500;

const DAY_MS = 86_400_000;

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
  reconcile(options?: { forceRebuild?: boolean }): Promise<ReconcileResult>;
}

export type ReminderSchedulerDeps = {
  repository: ItemRepository;
  /** 时钟注入（测试用）；默认 Date.now。 */
  now?: () => number;
  /** 网络渠道 fetch 注入（测试用）；默认 globalThis.fetch。 */
  fetchImpl?: typeof fetch;
  /** 网络定时器注册表注入（测试用）；默认内部新建。 */
  registry?: NetworkTimerRegistryType;
};

function isNetworkChannelId(channel: ReminderChannelId): boolean {
  return channel === 'webhook' || channel === 'apprise';
}

export class WatermelonReminderScheduler implements ReminderScheduler {
  private readonly repository: ItemRepository;
  private readonly now: () => number;
  private readonly logs: string[] = [];
  /** 网络渠道的内存定时器注册表（webhook/apprise 到点投递与 attempts 记录）。 */
  private readonly registry: NetworkTimerRegistry;
  /** 渠道实例表（channelFactory 组装；穷尽 switch 保证四渠道齐备）。 */
  private readonly channels: Record<ReminderChannelId, ReminderChannel>;

  constructor(deps: ReminderSchedulerDeps) {
    this.repository = deps.repository;
    this.now = deps.now ?? Date.now;
    this.registry =
      deps.registry ??
      new NetworkTimerRegistry({
        now: this.now,
        onFire: (occurrenceKey, entry) => this.dispatchNetworkFire(occurrenceKey, entry),
      });
    const factoryDeps = {
      repository: this.repository,
      registry: this.registry,
      fetchImpl: deps.fetchImpl,
      now: this.now,
    };
    this.channels = {
      'system-notification': createReminderChannel('system-notification', factoryDeps),
      alarm: createReminderChannel('alarm', factoryDeps),
      webhook: createReminderChannel('webhook', factoryDeps),
      apprise: createReminderChannel('apprise', factoryDeps),
    };
  }

  /** 供调试页展示的最近日志（环形，最多 50 条）。 */
  getRecentLogs(): string[] {
    return [...this.logs];
  }

  /** 网络渠道当前挂起的内存定时器 occurrenceKey 列表（调试/测试用，非冻结接口）。 */
  getNetworkArmedKeys(): string[] {
    return this.registry.armedKeys();
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

  /** 本 App 双族前缀（recurrence:v1| 与 once:）下的现网 identifier 集合。 */
  private async listScheduledOurKeys(): Promise<Set<string>> {
    const identifiers = await this.listScheduledIdentifiers();
    return new Set(identifiers.filter((identifier) => isOurOccurrenceIdentifier(identifier)));
  }

  /** §4.16 窗口过滤：instant > now 且 instant <= now + 30 天。 */
  private windowOccurrences(occurrences: Occurrence[], now: number): Occurrence[] {
    const horizon = now + SCHEDULE_WINDOW_DAYS * DAY_MS;
    return occurrences.filter((o) => o.instant > now && o.instant <= horizon);
  }

  /**
   * occurrence 展开：按 frequency 分支（提案 §2.3）。
   * - once：buildOnceOccurrence（gap → 无 occurrence，§4.12：跳过不平移）；
   * - daily/weekly/monthly：toRecurrenceRule + expandOccurrences（原逻辑）。
   * toRecurrenceRule 对 'once' 抛错，故此处必须在分支内避免对其调用。
   */
  private expandReminderOccurrences(reminder: Reminder): Occurrence[] {
    if (reminder.frequency === 'once') {
      if (reminder.onceAt === null) {
        // Repository 写路径保证 once 必有 onceAt；防御分支按无 occurrence 处理。
        this.log(`expandReminderOccurrences(${reminder.id}): once reminder without onceAt, no occurrence`);
        return [];
      }
      const occurrence = buildOnceOccurrence({
        scheduleId: reminder.id,
        onceAt: reminder.onceAt,
        tzid: reminder.tzid,
      });
      if (occurrence === null) {
        this.log(`expandReminderOccurrences(${reminder.id}): onceAt falls in DST gap, no occurrence`);
        return [];
      }
      return [occurrence];
    }
    return expandOccurrences({
      scheduleId: reminder.id,
      rule: toRecurrenceRule(reminder),
      startAt: reminder.startAt,
      tzid: reminder.tzid,
      count: MAX_SCHEDULED_PER_REMINDER,
    });
  }

  /** 内存定时器到点 → 对应网络渠道 deliver（NetworkTimerRegistry.onFire 入口）。 */
  private async dispatchNetworkFire(occurrenceKey: string, entry: NetworkTimerEntry): Promise<void> {
    const channel = this.channels[entry.reminder.channel];
    if (!isNetworkReminderChannel(channel)) {
      // 理论不可达：只有网络渠道会往注册表挂 timer。
      console.warn(
        `[ReminderScheduler] network timer fired for non-network channel "${entry.reminder.channel}" (${occurrenceKey})`,
      );
      return;
    }
    await channel.deliver(entry.reminder, occurrenceKey, entry.fireAt);
  }

  /** 网络渠道实例守卫取值（reminder.channel 已断言为网络 id 时使用）。 */
  private networkChannelFor(reminder: Reminder): NetworkReminderChannel {
    const channel = this.channels[reminder.channel];
    if (!isNetworkReminderChannel(channel)) {
      throw new Error(`ReminderScheduler: channel "${reminder.channel}" is not a network channel`);
    }
    return channel;
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

  /** 清理若干 expo 前缀族下的现网通知（跨渠道切换卫生 / cancelForReminder 共用）。 */
  private async cancelExpoForPrefixes(prefixes: string[]): Promise<void> {
    const identifiers = await this.listScheduledIdentifiers();
    for (const identifier of identifiers) {
      if (!prefixes.some((prefix) => identifier.startsWith(prefix))) {
        continue;
      }
      if (await this.safeCancel(identifier)) {
        this.log(`cancelled ${identifier}`);
      }
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
    const occurrences = this.expandReminderOccurrences(reminder);
    const windowed = this.windowOccurrences(occurrences, now);
    const expectedKeys = new Set(windowed.map((o) => o.occurrenceKey));
    const channel = this.channels[reminder.channel];

    if (isNetworkReminderChannel(channel)) {
      // 网络渠道：不向 OS 注册，登记/刷新内存定时器（幂等 replace）。
      for (const occurrence of windowed) {
        await channel.schedule(reminder, occurrence.occurrenceKey, occurrence.instant);
      }
      // 清掉该 reminder 名下不在期望集合内的残留定时器（如编辑后时间前移）。
      this.registry.retainReminderKeys(reminderId, expectedKeys);
      // 渠道切换卫生：原为 expo 渠道的残留通知一并清掉。
      await this.cancelExpoForPrefixes(reminderOccurrencePrefixes(reminderId));
      return;
    }

    // system / alarm：expo 集合 diff（原 v0.5 逻辑，identifier 前缀双族并认）。
    const prefixes = reminderOccurrencePrefixes(reminderId);
    const actualKeys = await this.listScheduledOurKeys();
    const actualForReminder = new Set(
      [...actualKeys].filter((identifier) => prefixes.some((prefix) => identifier.startsWith(prefix))),
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
      try {
        await channel.schedule(reminder, identifier, occurrence.instant);
        this.log(`scheduled ${identifier}`);
      } catch (error) {
        // 单条调度失败（如权限被拒）必须捕获记录，不得抛到 UI（§4.20）。
        this.log(`schedule failed for ${identifier}: ${describeError(error)}`);
      }
    }

    // 渠道切换卫生：expo 渠道不持有内存定时器，清掉原网络渠道的残留 timer。
    this.registry.cancelByReminder(reminderId);
  }

  async cancelForReminder(reminderId: string): Promise<void> {
    // expo 侧：双族前缀并认清理（recurring + once）。
    await this.cancelExpoForPrefixes(reminderOccurrencePrefixes(reminderId));
    // 网络侧：清该 reminder 名下全部挂起内存定时器。
    this.registry.cancelByReminder(reminderId);
  }

  async cancelAll(): Promise<void> {
    // 只取消本 App 双族前缀的通知，不得取消其他来源（§4.16）。
    const identifiers = await this.listScheduledIdentifiers();
    for (const identifier of identifiers) {
      if (!isOurOccurrenceIdentifier(identifier)) {
        continue;
      }
      if (await this.safeCancel(identifier)) {
        this.log(`cancelled ${identifier}`);
      }
    }
    this.registry.clearTimers();
  }

  /**
   * 对账（notifications.md v0.11：reconcile(options?: { forceRebuild?: boolean })）。
   * - forceRebuild 缺省/false：与 v0.5 语义完全一致（纯 diff）。
   * - forceRebuild=true：先 cancelAllScheduledNotificationsAsync 清掉本 App 全部
   *   已调度通知（并清空网络定时器），再把现网集合视为空集全量重建（missed 逻辑
   *   不变，仍基于 lastFiredOccurrenceKey）。用于修复 force-stop / install -r /
   *   pm clear 后 AlarmManager 真实闹钟已清、expo SharedPreferences 注册表残留的
   *   「幽灵注册表」（切片 8 发现）。已知边界：cancelAllScheduledNotificationsAsync
   *   的范围是「本 App 全部通知」，当前只有 reminder 前缀通知，可接受。
   * - 切片 16：期望/现网集合 diff 只作用于 expo 渠道（system/alarm）桶——
   *   网络渠道桶不占 500 预算，靠 registry 幂等 replace + pruneExcept 收口；
   *   missed 循环对网络渠道 occurrence 立即补发一次（attempt 'ok' 抑制双发）。
   */
  async reconcile(options?: { forceRebuild?: boolean }): Promise<ReconcileResult> {
    const now = this.now();
    const forceRebuild = options?.forceRebuild === true;
    if (forceRebuild) {
      await Notifications.cancelAllScheduledNotificationsAsync();
      this.registry.clearTimers();
      this.log('reconcile: forceRebuild — cancelled ALL app notifications and network timers, rebuilding');
    }
    const reminders = await this.repository.listEnabledReminders();
    const actualKeys = forceRebuild ? new Set<string>() : await this.listScheduledOurKeys();

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
        occurrences: this.expandReminderOccurrences(reminder),
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

    // 渠道分桶：expo 桶（system/alarm，受 §4.20 500 预算约束）与网络桶（webhook/apprise，
    // 内存定时器无 OS 上限，不占预算——notifications.md v0.16 增补）。
    const expoEntries = ordered.filter((entry) => !isNetworkChannelId(entry.reminder.channel));
    const networkEntries = ordered.filter((entry) => isNetworkChannelId(entry.reminder.channel));

    // —— expo 桶：§4.20 预算 + 集合 diff（原 v0.11 逻辑，作用于 system/alarm 提醒） ——
    const processable: { reminder: Reminder; item: Item; windowed: Occurrence[] }[] = [];
    const skippedReminderIds: string[] = [];
    let used = 0;
    for (const entry of expoEntries) {
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
      const channel = this.channels[entry.reminder.channel];
      for (const occurrence of entry.windowed) {
        if (!toScheduleSet.has(occurrence.occurrenceKey)) {
          continue;
        }
        try {
          await channel.schedule(entry.reminder, occurrence.occurrenceKey, occurrence.instant);
          newlyScheduled.push(occurrence.occurrenceKey);
          this.log(`scheduled ${occurrence.occurrenceKey}`);
        } catch (error) {
          // 单条调度失败（如权限被拒）必须捕获记录，不得抛到 UI（§4.20）。
          this.log(`schedule failed for ${occurrence.occurrenceKey}: ${describeError(error)}`);
        }
      }
    }

    // —— 网络桶：内存定时器重建（进程重启自愈）+ 陈旧清理 ——
    // channel.schedule 即 registry.replace（幂等）；编辑/切渠道后 URL 等配置随
    // reminder 快照刷新。不占 §4.20 预算。
    const networkExpectedKeys = new Set<string>();
    for (const entry of networkEntries) {
      const windowed = this.windowOccurrences(entry.occurrences, now);
      const channel = this.networkChannelFor(entry.reminder);
      for (const occurrence of windowed) {
        networkExpectedKeys.add(occurrence.occurrenceKey);
        await channel.schedule(entry.reminder, occurrence.occurrenceKey, occurrence.instant);
      }
    }
    // 覆盖：渠道切走 / disabled / item 失活 / 删除 的网络提醒残留定时器。
    this.registry.pruneExcept(networkExpectedKeys);

    // —— missed 判定：对全部 enabled reminder 生效（含被预算跳过者）；
    // 去重靠 markReminderFired 推进游标（§4.19）。网络渠道的 missed occurrence
    // 立即补发一次：本进程内已确认投递（attempt 'ok'）则跳过防双发；否则先撤掉
    // 可能仍在挂起的定时器再 deliver——补发与定时器到点互斥（at-least-once 边界见
    // notifications.md v0.16）。
    const missed: Occurrence[] = [];
    for (const entry of ordered) {
      const reminderMissed = computeMissed(
        entry.occurrences,
        entry.reminder.lastFiredOccurrenceKey,
        now,
      );
      if (reminderMissed.length > 0) {
        if (isNetworkChannelId(entry.reminder.channel)) {
          const channel = this.networkChannelFor(entry.reminder);
          for (const occurrence of reminderMissed) {
            if (this.registry.attemptStatus(occurrence.occurrenceKey) === 'ok') {
              continue;
            }
            this.registry.cancel(occurrence.occurrenceKey);
            await channel.deliver(entry.reminder, occurrence.occurrenceKey, occurrence.instant);
          }
        }
        const lastMissedKey = reminderMissed[reminderMissed.length - 1].occurrenceKey;
        await this.repository.markReminderFired(entry.reminder.id, lastMissedKey);
        missed.push(...reminderMissed);
      }
      await this.repository.markReminderReconciled(entry.reminder.id, now);
    }

    return { newlyScheduled, cancelled, missed };
  }

  /**
   * 全部 enabled reminder 的 lastReconciledAt 最大值（毫秒）；无记录返回 null。
   * 切片 11（变更提案决议②）：cold start 以「距上次对账 > 60s」判断是否传
   * forceRebuild，阈值数据源是 DB（markReminderReconciled 落库，reconcile 每轮
   * 对全部 active reminder 刷新），不引入 AsyncStorage。非冻结接口方法，
   * 由 _layout.tsx 直接经 WatermelonReminderScheduler 实例调用。
   */
  async getLastReconciledAt(): Promise<number | null> {
    const reminders = await this.repository.listEnabledReminders();
    let latest: number | null = null;
    for (const reminder of reminders) {
      const at = reminder.lastReconciledAt;
      if (at !== null && (latest === null || at > latest)) {
        latest = at;
      }
    }
    return latest;
  }

  // —— 以下为调试页（tasks/slice-05.md 实现要求 7）所需的附加能力，不进入冻结接口 ——

  /** 现网本 App 双族前缀下的已调度 identifier 列表（调试页展示用）。 */
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
   * identifier 不带 recurrence:v1| / once: 前缀，避免混入对账 diff；
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
