/**
 * 切片 16 阶段 2：网络渠道基类（webhook / apprise 共用，提案 §2.5 确认稿）。
 *
 * 边界（notifications.md v0.16 增补）：
 * - 不向 OS 注册任何通知：schedule 仅登记内存定时器（NetworkTimerRegistry.replace），
 *   App 进程死亡即全部失效，重启后由 reconcile 重建。
 * - deliver 绝不抛出：item 失活、配置缺失、网络失败、非 2xx 一律记 'failed'
 *   并 console.warn，让 reconcile 的补发机会继续可用。
 * - attempts 记录（recordAttempt）用于 reconcile 抑制已成功 occurrence 的重复补发。
 */
import { describeError } from './shared';
import type { Item } from '../../domain/item';
import type {
  NetworkChannelDeps,
  NetworkDeliverStatus,
  NetworkReminderChannel,
  ReminderChannelId,
  ScopedReminder,
} from './types';

export abstract class BaseNetworkChannel implements NetworkReminderChannel {
  abstract readonly channel: ReminderChannelId;
  protected readonly deps: NetworkChannelDeps;

  constructor(deps: NetworkChannelDeps) {
    this.deps = deps;
  }

  /** 不向 OS 注册：登记内存定时器（幂等 replace，重建/刷新均安全）。 */
  async schedule(reminder: ScopedReminder, occurrenceKey: string, fireAt: number): Promise<void> {
    this.deps.registry.replace(occurrenceKey, {
      reminderId: reminder.id,
      fireAt,
      reminder,
    });
  }

  /** 取消内存定时器；occurrenceKey 缺省时清该 reminder 名下全部。 */
  async cancel(reminderId: string, occurrenceKey?: string): Promise<void> {
    if (occurrenceKey !== undefined) {
      this.deps.registry.cancel(occurrenceKey);
      return;
    }
    this.deps.registry.cancelByReminder(reminderId);
  }

  /** 到点投递（定时器触发与 reconcile missed 补发共用入口）；吞错返回状态。 */
  async deliver(
    reminder: ScopedReminder,
    occurrenceKey: string,
    fireAt: number,
  ): Promise<NetworkDeliverStatus> {
    try {
      const item = await this.deps.repository.getItem(reminder.itemId);
      if (!item || item.status !== 'active') {
        console.warn(
          `[ReminderChannel:${this.channel}] deliver skipped for ${occurrenceKey}: item missing or not active`,
        );
        this.deps.registry.recordAttempt(occurrenceKey, 'failed');
        return 'failed';
      }
      const delivered = await this.send(reminder, occurrenceKey, fireAt, item);
      const status: NetworkDeliverStatus = delivered ? 'ok' : 'failed';
      if (!delivered) {
        console.warn(`[ReminderChannel:${this.channel}] deliver failed for ${occurrenceKey}: non-2xx response`);
      }
      this.deps.registry.recordAttempt(occurrenceKey, status);
      return status;
    } catch (error) {
      console.warn(
        `[ReminderChannel:${this.channel}] deliver failed for ${occurrenceKey}: ${describeError(error)}`,
      );
      this.deps.registry.recordAttempt(occurrenceKey, 'failed');
      return 'failed';
    }
  }

  /**
   * 具体投递实现：返回 true = 远端确认（2xx），false = 失败；
   * 抛错由 deliver 统一捕获记 'failed'。
   */
  protected abstract send(
    reminder: ScopedReminder,
    occurrenceKey: string,
    fireAt: number,
    item: Item,
  ): Promise<boolean>;
}
