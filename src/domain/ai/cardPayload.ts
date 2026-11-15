/**
 * 切片 22 阶段 1（AGENTS.md §7.34，tasks/slice-22.md）：闪电录入保存成功后的
 * 结果卡片载荷组装。domain 纯函数（不依赖 React Native / WatermelonDB），
 * 执行点在 src/ui/useFlashChat.ts confirmSave 保存链成功分支。
 *
 * 输入取保存链的真实落库产物：
 * - created：createItem 返回（id/title/type/categoryId 已定，时间字段此时仍为 null）；
 * - timePatch：buildFlashSavePlan 的 timePatch（含切片 19 delay 锚定后的最终 startAt），
 *   载荷 startAt/endAt/allDay 必须取落库终值，不能取 createItem 原始返回；
 * - reminder：createReminder 返回（保存链未创建提醒时为 null → 卡片不渲染提醒行）；
 * - categories：水合分类列表（§7.23 纪律：UI/domain 只消费传入的 Category，不自查分类表）。
 *
 * 快照语义：weekdays / onceAt 做防御性拷贝，载荷不受后续对 Reminder 对象的
 * 变异影响（阶段 3 原地刷新走替换整个 cardPayload 的不可变路径）。
 */

import type { Category } from '../category';
import type { Item } from '../item';
import type { Reminder } from '../reminder';
import type { FlashCardPayload } from './types';

/** timePatch 形状（FlashSavePlan.timePatch 的子集，避免引入 savePlan 依赖环）。 */
export interface FlashCardTimePatch {
  startAt: number | null;
  endAt: number | null;
  allDay: boolean;
}

export function buildFlashCardPayload(
  created: Item,
  timePatch: FlashCardTimePatch,
  reminder: Reminder | null,
  categories: ReadonlyArray<Category>,
): FlashCardPayload {
  const category = categories.find((candidate) => candidate.id === created.categoryId) ?? null;
  return {
    itemId: created.id,
    title: created.title,
    content: created.content,
    type: created.type,
    startAt: timePatch.startAt,
    endAt: timePatch.endAt,
    allDay: timePatch.allDay,
    category:
      category === null
        ? null
        : {
            id: category.id,
            name: category.name,
            color: category.color,
            emoji: category.emoji,
          },
    reminder:
      reminder === null
        ? null
        : {
            id: reminder.id,
            frequency: reminder.frequency,
            localTimeHour: reminder.localTimeHour,
            localTimeMinute: reminder.localTimeMinute,
            weekdays: [...reminder.weekdays],
            dayOfMonth: reminder.dayOfMonth,
            onceAt: reminder.onceAt === null ? null : { ...reminder.onceAt },
            tzid: reminder.tzid,
            channels: [...reminder.channels],
          },
  };
}
