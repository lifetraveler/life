/**
 * 渲染显示选项读取（切片 14 阶段 7c）：widget 层唯一读 app_settings 的入口。
 * taskHandler（重绘管线）与 snapshotBridge（数据变更刷新）渲染前各读一次，
 * 把当下设置传给 TodayWidget —— 开关不入快照 JSON，改完设置立即生效。
 */

import { itemRepository } from '../data';
import type { WidgetDisplayOptions } from '../domain/widget';

/**
 * 读当下设置（AppSettings 全字段非可选，schema v7 列非空；getSettings 无记录时
 * Repository 自行兜底建行）。
 */
export async function readWidgetDisplayOptions(): Promise<WidgetDisplayOptions> {
  const settings = await itemRepository.getSettings();
  return {
    showCategoryEmoji: settings.widgetShowCategoryEmoji,
    showTags: settings.widgetShowTags,
    tagMode: settings.tagDisplayMode,
  };
}
