/**
 * 小组件渲染显示选项（切片 14 阶段 7c，docs/proposals/slice-14-widget-phase7.md）：
 * - 来源 app_settings（widgetShowCategoryEmoji / widgetShowTags / tagDisplayMode，
 *   schema v7 前两列在阶段 7a 已落库）；
 * - 与快照解耦：渲染时（taskHandler / snapshotBridge）读当下设置传给 TodayWidget，
 *   改开关后设置页走 refreshWidgetDataNow 立即重写快照并重绘，渲染输入永远新鲜，
 *   快照 JSON schema 不再额外携带 display 段；
 * - 默认值 = 阶段 7a 行为（emoji/标签均不显示），与 DEFAULT_APP_SETTINGS 一致。
 */

import type { TagDisplayMode } from '../settings';

export interface WidgetDisplayOptions {
  /** 条目是否显示分类 emoji（色点恒在，emoji 追加在色点之后） */
  showCategoryEmoji: boolean;
  /** 条目是否显示标签 chips（文案跟随 tagMode） */
  showTags: boolean;
  /** 标签文案模式：跟随 app 的 tagDisplayMode（'text' | 'emoji' | 'both'） */
  tagMode: TagDisplayMode;
}

/** 读取失败/旧数据兜底（≡ 阶段 7a 渲染行为） */
export const WIDGET_DISPLAY_DEFAULTS: WidgetDisplayOptions = {
  showCategoryEmoji: false,
  showTags: false,
  tagMode: 'text',
};
