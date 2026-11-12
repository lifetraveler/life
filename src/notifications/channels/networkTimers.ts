/**
 * 切片 16 阶段 2：网络渠道的进程内定时器注册表（提案 §2.5 确认稿）。
 * 切片 18 阶段 2（docs/proposals/slice-18-multi-channel.md §6.5）：键升级为
 * 复合键 `${channelId}|${occurrenceKey}`——多渠道并行后同一 reminder 的两个
 * 网络渠道各自持有同 occurrenceKey 的定时器，单键下第二次 replace 会清掉
 * 第一个渠道的定时器（slice-16 潜在缺陷），复合键根治。
 *
 * 设计要点（notifications.md v0.16 增补）：
 * - webhook / apprise 渠道不向 OS 注册通知，到点投递由本注册表持有的
 *   setTimeout 内存定时器驱动——App 进程死亡即全部消失，属已知边界。
 * - 幂等：同一复合键重复 replace 会先清旧定时器再重挂（reconcile 全量重建、
 *   编辑 reminder 后的换 URL 生效都靠它）。
 * - setTimeout 延迟上限 clamp 到 2^31-1 ms（超出上限的延迟会被定时器实现
 *   立即误触发），到点未达 fireAt 时续链重挂。
 * - attempts 记录按复合键记录最近一次投递结果，随进程生命周期存在，
 *   clearTimers / cancel 不清除（reconcile 靠它抑制已成功 occurrence 的重复补发，
 *   且按渠道独立判定——webhook 成功不抑制 apprise 的补发）。
 */
import type { ReminderChannelId } from './types';
import type { ScopedReminder } from './types';
import { describeError } from './shared';

/** 单次网络投递结果（与 channels/types 的 NetworkDeliverStatus 同形，此处独立声明避免循环 import）。 */
export type NetworkAttemptStatus = 'ok' | 'failed';

/** 复合键（提案 §6.5）：渠道维度 | occurrence 维度。枚举值不含 '|'，可安全拼接。 */
export function networkTimerKey(channelId: ReminderChannelId, occurrenceKey: string): string {
  return `${channelId}|${occurrenceKey}`;
}

export type NetworkTimerEntry = {
  reminderId: string;
  /** 绝对毫秒触发时刻 */
  fireAt: number;
  /**
   * 触发时刻的 reminder 快照（deliver 用它取 channelConfig 等字段）。
   * 多渠道域模型按投递渠道收敛后的单渠道视角投影（切片 18 提案 §6.2）。
   */
  reminder: ScopedReminder;
  /** 复合键的渠道维度（与 reminder.channel 恒等；显式携带便于 onFire 分发）。 */
  channelId: ReminderChannelId;
};

export type NetworkTimerRegistryDeps = {
  now: () => number;
  /** 到点回调（调度器注入 → channel.deliver）；回调内部需吞错，这里再兜底 try/catch。 */
  onFire: (channelId: ReminderChannelId, occurrenceKey: string, entry: NetworkTimerEntry) => Promise<void> | void;
  /** 定时器实现注入（测试用）；默认全局 setTimeout / clearTimeout。 */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

/** RN/Node 定时器延迟上限：2^31-1 ms，超过会立即误触发。 */
const MAX_TIMEOUT_MS = 2_147_483_647;

type ArmedTimer = {
  entry: NetworkTimerEntry;
  timerId: ReturnType<typeof setTimeout>;
};

export class NetworkTimerRegistry {
  /** 键为复合键 networkTimerKey(channelId, occurrenceKey)。 */
  private readonly timers = new Map<string, ArmedTimer>();
  /** 键为复合键（attempts 保留原始 occurrenceKey 无必要：渠道维度参与判定）。 */
  private readonly attempts = new Map<string, NetworkAttemptStatus>();
  private readonly now: () => number;
  private readonly onFire: (
    channelId: ReminderChannelId,
    occurrenceKey: string,
    entry: NetworkTimerEntry,
  ) => Promise<void> | void;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;

  constructor(deps: NetworkTimerRegistryDeps) {
    this.now = deps.now;
    this.onFire = deps.onFire;
    this.setTimeoutFn = deps.setTimeoutFn ?? setTimeout.bind(globalThis);
    this.clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout.bind(globalThis);
  }

  /** 幂等登记（或刷新）某个（渠道 × occurrence）的定时器；到点投递由 onFire 完成。 */
  replace(channelId: ReminderChannelId, occurrenceKey: string, entry: NetworkTimerEntry): void {
    this.cancel(channelId, occurrenceKey);
    this.armTimer(channelId, occurrenceKey, entry);
  }

  /** 取消单个（渠道 × occurrence）的挂起定时器（attempts 记录保留）。 */
  cancel(channelId: ReminderChannelId, occurrenceKey: string): void {
    const key = networkTimerKey(channelId, occurrenceKey);
    const armed = this.timers.get(key);
    if (!armed) {
      return;
    }
    this.clearTimeoutFn(armed.timerId);
    this.timers.delete(key);
  }

  /** 取消某 reminder 名下全部挂起定时器（跨所有渠道；编辑/删除/禁用的清理入口）。 */
  cancelByReminder(reminderId: string): void {
    for (const key of [...this.timers.keys()]) {
      const armed = this.timers.get(key);
      if (armed && armed.entry.reminderId === reminderId) {
        this.clearTimeoutFn(armed.timerId);
        this.timers.delete(key);
      }
    }
  }

  /**
   * 只保留某 reminder 名下期望复合键集合内的定时器，其余取消
   * （scheduleForReminder 网络路径的幂等重建入口；expectedKeys 为复合键）。
   */
  retainReminderKeys(reminderId: string, expectedKeys: Set<string>): void {
    for (const key of [...this.timers.keys()]) {
      const armed = this.timers.get(key);
      if (armed && armed.entry.reminderId === reminderId && !expectedKeys.has(key)) {
        this.clearTimeoutFn(armed.timerId);
        this.timers.delete(key);
      }
    }
  }

  /** 全局修剪：只保留期望复合键集合内的定时器（reconcile 每轮收口用）。 */
  pruneExcept(expectedKeys: Set<string>): void {
    for (const key of [...this.timers.keys()]) {
      if (!expectedKeys.has(key)) {
        const armed = this.timers.get(key);
        if (armed) {
          this.clearTimeoutFn(armed.timerId);
        }
        this.timers.delete(key);
      }
    }
  }

  /** 清空全部挂起定时器（cancelAll / forceRebuild 用）；attempts 保留。 */
  clearTimers(): void {
    for (const armed of this.timers.values()) {
      this.clearTimeoutFn(armed.timerId);
    }
    this.timers.clear();
  }

  /** 记录某（渠道 × occurrence）最近一次投递结果（进程生命周期）。 */
  recordAttempt(channelId: ReminderChannelId, occurrenceKey: string, status: NetworkAttemptStatus): void {
    this.attempts.set(networkTimerKey(channelId, occurrenceKey), status);
  }

  /** 查询投递结果；未投递过（含进程重启后）返回 null。 */
  attemptStatus(channelId: ReminderChannelId, occurrenceKey: string): NetworkAttemptStatus | null {
    return this.attempts.get(networkTimerKey(channelId, occurrenceKey)) ?? null;
  }

  /** 当前挂起的复合键集合（调试/断言用；形如 `webhook|recurrence:v1|...`）。 */
  armedKeys(): string[] {
    return [...this.timers.keys()];
  }

  private armTimer(channelId: ReminderChannelId, occurrenceKey: string, entry: NetworkTimerEntry): void {
    const delay = entry.fireAt - this.now();
    const timerId = this.setTimeoutFn(() => {
      this.handleTimerWake(channelId, occurrenceKey, entry);
    }, Math.max(0, Math.min(delay, MAX_TIMEOUT_MS)));
    this.timers.set(networkTimerKey(channelId, occurrenceKey), { entry, timerId });
  }

  private handleTimerWake(
    channelId: ReminderChannelId,
    occurrenceKey: string,
    entry: NetworkTimerEntry,
  ): void {
    const armed = this.timers.get(networkTimerKey(channelId, occurrenceKey));
    if (!armed) {
      // 已被 cancel / replace 清掉：静默返回。
      return;
    }
    if (entry.fireAt > this.now()) {
      // 被 MAX_TIMEOUT_MS clamp 后提前醒来：尚未到点，续链重挂剩余延迟。
      this.armTimer(channelId, occurrenceKey, entry);
      return;
    }
    this.timers.delete(networkTimerKey(channelId, occurrenceKey));
    void this.dispatchFire(channelId, occurrenceKey, entry);
  }

  private async dispatchFire(
    channelId: ReminderChannelId,
    occurrenceKey: string,
    entry: NetworkTimerEntry,
  ): Promise<void> {
    try {
      await this.onFire(channelId, occurrenceKey, entry);
    } catch (error) {
      console.warn(
        `[NetworkTimerRegistry] onFire failed for ${channelId}|${occurrenceKey}: ${describeError(error)}`,
      );
    }
  }
}
