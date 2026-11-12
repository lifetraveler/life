import { Model } from '@nozbe/watermelondb';
import { date, readonly, text } from '@nozbe/watermelondb/decorators';

import type { ChannelPresetType } from '../../domain/channelPreset';

/**
 * channel_presets 表的 WatermelonDB model（切片 17 阶段 1，AGENTS.md §7.27，schema v9）。
 *
 * - 渠道预设：Webhook/Apprise 常用配置抽取为全局预设，详情页（阶段 2）只做选择。
 * - config_json 存渠道配置 JSON 原文，写路径经对应渠道守卫校验（Repository 层），
 *   model 层不解析；选中预设时整串复制进 reminders.channel_config。
 * - name 不强制唯一（trim 非空由 Repository 层保证，同 tags.name 先例）。
 * - created_at 供预设列表稳定排序（created_at 降序）。
 */
export default class ChannelPresetModel extends Model {
  static table = 'channel_presets';

  @text('name') name!: string;

  /** 仅 'webhook' | 'apprise'（写路径守卫），读取层 isChannelPresetType 防御 */
  @text('type') type!: ChannelPresetType;

  /** 渠道配置 JSON 原文（webhook → WebhookChannelConfig；apprise → AppriseChannelConfig） */
  @text('config_json') configJson!: string;

  /** 毫秒时间戳（WatermelonDB create 时自动写入，Model/helpers.js createTimestampsFor）；列表排序用 */
  @readonly @date('created_at') createdAt!: Date;
}
