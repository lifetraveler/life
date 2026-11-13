/**
 * 切片 16 阶段 2：Apprise 渠道（提案 §2.5）。
 *
 * 对接 Apprise API（https://github.com/caronc/apprise/wiki/Outline-JSON-API）：
 * - 配置含 key → POST {baseUrl}/notify/{key}（stateful 简写）；
 * - 配置含 urls → POST {baseUrl}/notify 并携带 urls 数组（stateless 直发）。
 * 2xx 视为成功；仅 App 进程存活时保证发送（§7.26 约束 2）。
 */
import { fetchWithTimeout, notificationBody } from './shared';
import { parseAppriseChannelConfig } from './appriseConfig';
import { BaseNetworkChannel } from './BaseNetworkChannel';
import type { Item } from '../../domain/item';
import type { ReminderChannelId, ScopedReminder } from './types';

export class AppriseChannel extends BaseNetworkChannel {
  readonly channel: ReminderChannelId = 'apprise';

  protected async send(
    reminder: ScopedReminder,
    occurrenceKey: string,
    fireAt: number,
    item: Item,
  ): Promise<boolean> {
    const config = parseAppriseChannelConfig(reminder.channelConfig);
    const title = item.title;
    const body = notificationBody(item);

    const requestInit: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };
    if (config.key !== null) {
      requestInit.body = JSON.stringify({ title, body, type: 'info' });
      const response = await fetchWithTimeout(
        this.deps.fetchImpl,
        `${config.baseUrl}/notify/${encodeURIComponent(config.key)}`,
        requestInit,
      );
      return response.ok;
    }

    requestInit.body = JSON.stringify({ title, body, type: 'info', urls: config.urls });
    const response = await fetchWithTimeout(this.deps.fetchImpl, `${config.baseUrl}/notify`, requestInit);
    return response.ok;
  }
}
