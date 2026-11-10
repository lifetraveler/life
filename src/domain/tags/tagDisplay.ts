/**
 * 标签展示文案纯函数（tasks/slice-14.md 阶段 2 / AGENTS.md §7.22 tagDisplayMode）。
 *
 * - text → '工作'
 * - emoji → '💼'
 * - both → '💼 工作'
 * 兜底：tag.emoji 为 null/空串时，emoji 与 both 模式都必须回退 tag.name
 * （任务卡明文：无论在 emoji 还是 both 模式下，都必须回退展示 tag.name）。
 */

import type { TagDisplayMode } from '../settings';
import type { Tag } from '../tag';

export function formatTagDisplay(tag: Pick<Tag, 'name' | 'emoji'>, mode: TagDisplayMode): string {
  if (mode === 'text') {
    return tag.name;
  }
  if (!tag.emoji) {
    return tag.name;
  }
  return mode === 'emoji' ? tag.emoji : `${tag.emoji} ${tag.name}`;
}
