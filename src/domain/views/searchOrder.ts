/**
 * 搜索结果排序（切片 14 阶段 5b，tasks/slice-14.md 阶段 5b-7）：
 * - 有 startAt 的项按开始时间倒序在前（最近的在最上，并列按 createdAt 倒序、再按 id 确定化）；
 * - 无 startAt 的项按 createdAt 倒序排在末尾（并列按 id 确定化）。
 *
 * 纯函数；不改 LIKE 匹配语义（§7.18：搜索增强只做 UI 层与排序呈现）。
 */

import type { ItemWithRelations } from '../relations/itemWithRelations';

function compareWithStart(a: ItemWithRelations, b: ItemWithRelations): number {
  // 调用方保证有 startAt 的项先比较；?? 0 仅为类型收窄
  const startA = a.startAt ?? 0;
  const startB = b.startAt ?? 0;
  if (startA !== startB) {
    return startB - startA;
  }
  if (a.createdAt !== b.createdAt) {
    return b.createdAt - a.createdAt;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareWithoutStart(a: ItemWithRelations, b: ItemWithRelations): number {
  if (a.createdAt !== b.createdAt) {
    return b.createdAt - a.createdAt;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 稳定排序：有 startAt（开始时间倒序）在前，无 startAt（createdAt 倒序）在末尾。 */
export function sortSearchResults(items: ItemWithRelations[]): ItemWithRelations[] {
  const withStart = items.filter((item) => item.startAt !== null);
  const withoutStart = items.filter((item) => item.startAt === null);
  withStart.sort(compareWithStart);
  withoutStart.sort(compareWithoutStart);
  return [...withStart, ...withoutStart];
}
