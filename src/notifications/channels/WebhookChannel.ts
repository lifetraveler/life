/**
 * 切片 16 阶段 2：Webhook 渠道（提案 §2.5）。
 * 切片 17 阶段 1：载荷适配（AGENTS.md §7.27）——channelConfig 支持 JSON 形态
 * （url/mode/headers/payloadTemplate），旧纯 URL 形态兼容读，行为与切片 16 逐字段一致。
 *
 * 到点（内存定时器或 reconcile 补发）向配置里的 URL POST 一条通知；2xx 视为成功。
 * 可靠性边界：仅 App 进程存活时保证发送
 * （AGENTS.md §7.26 渠道实现约束 2，UI 阶段必须注明）。
 */
import { parseWebhookChannelConfig, type WebhookChannelConfig } from './webhookConfig';
import {
  renderWebhookFormTemplate,
  renderWebhookJsonTemplate,
  renderWebhookTemplateValue,
  type WebhookTemplateVars,
} from './webhookTemplate';
import { fetchWithTimeout, notificationBody } from './shared';
import { BaseNetworkChannel } from './BaseNetworkChannel';
import type { Item } from '../../domain/item';
import type { Reminder } from '../../domain/reminder';
import type { ReminderChannelId } from './types';

/** 切片 16 固定 payload（json 模式缺省 payloadTemplate 时维持不变，存量提醒零行为变化） */
function legacyFixedPayload(
  occurrenceKey: string,
  reminderId: string,
  item: Item,
  fireAt: number,
  sentAt: number,
): Record<string, unknown> {
  return {
    type: 'life-reminder',
    occurrenceKey,
    reminderId,
    itemId: item.id,
    title: item.title,
    body: notificationBody(item),
    fireAt,
    sentAt,
  };
}

export class WebhookChannel extends BaseNetworkChannel {
  readonly channel: ReminderChannelId = 'webhook';

  protected async send(
    reminder: Reminder,
    occurrenceKey: string,
    fireAt: number,
    item: Item,
  ): Promise<boolean> {
    const config: WebhookChannelConfig = parseWebhookChannelConfig(reminder.channelConfig);
    const sentAt = this.deps.now();
    const vars: WebhookTemplateVars = {
      title: item.title,
      body: notificationBody(item),
      content: item.content,
      occurrenceKey,
      reminderId: reminder.id,
      itemId: item.id,
      fireAt: String(fireAt),
      sentAt: String(sentAt),
    };

    let headers: Record<string, string>;
    let body: string;
    if (config.mode === 'json') {
      headers = { 'Content-Type': 'application/json', ...config.headers };
      body =
        config.payloadTemplate === undefined
          ? JSON.stringify(legacyFixedPayload(occurrenceKey, reminder.id, item, fireAt, sentAt))
          : JSON.stringify(renderWebhookJsonTemplate(config.payloadTemplate, vars));
    } else if (config.mode === 'form') {
      headers = { 'Content-Type': 'application/x-www-form-urlencoded', ...config.headers };
      body = renderWebhookFormTemplate(config.payloadTemplate, vars);
    } else {
      headers = { 'Content-Type': 'text/plain; charset=utf-8', ...config.headers };
      body = renderWebhookTemplateValue(config.payloadTemplate, vars);
    }

    const response = await fetchWithTimeout(this.deps.fetchImpl, config.url, {
      method: 'POST',
      headers,
      body,
    });
    return response.ok;
  }
}
