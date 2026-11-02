/**
 * 列表页展示用常量与格式化（纯函数，不依赖 React Native）。
 * 从切片 2 的 index.tsx 提取共用，避免双屏（默认/已归档）定义漂移。
 */

import type { ItemType } from '../domain/item';

export const TYPE_LABELS: Record<ItemType, string> = {
  note: '笔记',
  task: '任务',
  event: '事件',
};

/** 毫秒时间戳 → 'YYYY-MM-DD HH:mm:ss'（UTC，与切片 1/2 列表显示一致） */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19);
}
