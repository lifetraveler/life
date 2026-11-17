import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

import type { FlashDeletedCardDisplay, TagDisplayMode } from '../../domain/settings';

/**
 * app_settings 表的 WatermelonDB model（切片 14，AGENTS.md §7.22，schema v6；
 * v7 阶段 7a 扩展小组件显示开关 4 列，docs/proposals/slice-14-widget-phase7.md；
 * v10/v11 扩展（chips_increments / default_channels_json）见各字段注释；
 * v13/v14 扩展（show_ai_usage / display_calendar_ids_json）见各字段注释）。
 * 单行表：主键固定 'global'（domain/settings.ts APP_SETTINGS_ROW_ID）；
 * 无记录时 Repository 的 getSettings 兜底返回默认值（repository.md v0.14）。
 */
export default class AppSettingsModel extends Model {
  static table = 'app_settings';

  @text('tag_display_mode') tagDisplayMode!: TagDisplayMode;

  // —— 阶段 7a：小组件显示开关（非可选 boolean，默认值见 domain/settings.ts DEFAULT_APP_SETTINGS）——
  @field('widget_show_overdue') widgetShowOverdue!: boolean;
  @field('widget_show_todos') widgetShowTodos!: boolean;
  @field('widget_show_category_emoji') widgetShowCategoryEmoji!: boolean;
  @field('widget_show_tags') widgetShowTags!: boolean;

  /**
   * 切片 18（schema v10，AGENTS.md §7.29）：once 快捷 Chips 增量（分钟）JSON 数字数组，
   * 默认 [10,60]；null/坏值由读取层防御归一（domain/settings.ts parseChipsIncrements），
   * 写路径校验 1–4 项、每项 1–10080 整数。
   */
  @text('chips_increments') chipsIncrementsJson!: string | null;

  /**
   * 切片 19（schema v11，AGENTS.md §7.30）：新建提醒表单的默认渠道集合，
   * JSON 字符串数组，默认 ["system-notification"]；null/坏值由读取层防御归一
   * （domain/settings.ts parseDefaultChannels），写路径校验（validateDefaultChannels：
   * 非法渠道/空/expo 家族双开抛错）。
   */
  @text('default_channels_json') defaultChannelsJson!: string | null;
  // v12（切片 25，AGENTS.md §7.37）：闪电录入认真模式；非可选 boolean 同 widget* 先例。
  @field('careful_mode') carefulMode!: boolean;
  // v13（切片 26，AGENTS.md §7.38）：AI 用量展示开关（默认 false = 不显示）；
  // 非可选 boolean 同 careful_mode 先例。
  @field('show_ai_usage') showAiUsage!: boolean;
  /**
   * 切片 27（schema v14，AGENTS.md §7.39）：系统日历 live 直读显示开关，
   * JSON 字符串数组（选中日历 id），空串/null/缺省/[] = 功能关闭；null/坏值由
   * 读取层防御归一（domain/settings.ts parseDisplayCalendarIds，不抛错回退 []），
   * 写路径校验（validateDisplayCalendarIds：仅非空字符串、去重）。
   */
  @text('display_calendar_ids_json') displayCalendarIdsJson!: string | null;
  /**
   * 切片 30（schema v15，AGENTS.md §7.41）：AI 远端解析传输层自动重试次数
   * （0–5 整数，0=关闭，默认 3）。isOptional：既有行回填 null（非可选 number 会
   * 回填 0 与「关闭」语义混淆），读取层归一（domain/settings.ts parseAiRetryMax：
   * null/越界/非整数 → 默认 3），写路径校验（validateAiRetryMax 否则抛错）。
   */
  @field('ai_retry_max') aiRetryMax!: number | null;
  /**
   * 切片 30（schema v15，AGENTS.md §7.41）：已删除条目在聊天结果卡中的显示方式
   * 'mark'（置灰+角标+禁用，默认）| 'remove'（从对话移除）；null/坏值由读取层
   * 归一（domain/settings.ts isFlashDeletedCardDisplay 回退 'mark'），写路径校验
   * （枚举外抛错）。
   */
  @text('flash_deleted_card_display') flashDeletedCardDisplay!: FlashDeletedCardDisplay | null;
}
