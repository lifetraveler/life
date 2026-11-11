/**
 * 切片 16 阶段 2：Webhook 渠道（提案 §2.5）。
 *
 * 到点（内存定时器或 reconcile 补发）向 channelConfig 里的 URL POST 一条
 * JSON 通知；2xx 视为成功。可靠性边界：仅 App 进程存活时保证发送
 * （AGENTS.md §7.26 渠道实现约束 2，UI 阶段必须注明）。
 */
import { fetchWithTimeout, notificationBody } from './shared';
import { BaseNetworkChannel } from './BaseNetworkChannel';
import type { Item } from '../../domain/item';
import type { Reminder } from '../../domain/reminder';
import type { ReminderChannelId } from './types';

export class WebhookChannel extends BaseNetworkChannel {
  readonly channel: ReminderChannelId = 'webhook';

  protected async send(
    reminder: Reminder,
    occurrenceKey: string,
    fireAt: number,
    item: Item,
  ): Promise<boolean> {
    const url = (reminder.channelConfig ?? '').trim();
    if (url.length === 0) {
      throw new Error(
        `WebhookChannel: reminder ${reminder.id} has no webhook URL in channelConfig`,
      );
    }
    const response = await fetchWithTimeout(this.deps.fetchImpl, url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'life-reminder',
        occurrenceKey,
        reminderId: reminder.id,
        itemId: item.id,
        title: item.title,
        body: notificationBody(item),
        fireAt,
        sentAt: this.deps.now(),
      }),
    });
    return response.ok;
  }
}
