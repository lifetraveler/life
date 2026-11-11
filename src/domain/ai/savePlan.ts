/**
 * 闪电添加确认落库计划（tasks/slice-15.md 阶段 3，验收 9）。
 *
 * 落库链沿用切片 14 新建页先例（§4.24：时间字段只走 updateItemTime）：
 * createItem（不含时间字段）→ updateItemTime → addTagToItem×N →
 * createReminder（仅重复规则且 tzid 在白名单）→ reminderScheduler.reconcile。
 * 本模块只产出"计划"（纯函数，可单测）；执行在 useFlashChat。
 *
 * 一次性提醒（reminderOffsetMinutes）与冻结 Reminder 模型冲突（无一次性
 * frequency），落库时降级为 reminderNotice 提示，卡片仍保留意图——
 * 变更提案议题见切片 15 阶段 3 汇报。
 */

import type { CreateItemInput } from '../item';
import { isWhitelistedReminderTz } from '../../data/reminderTzWhitelist';
import { mapDraftToCreateInputs } from './mapper';
import type { ReminderPlan } from './mapper';
import type { ParsedItemDraft } from './types';

export interface FlashSavePlan {
  /** 不含时间字段的 createItem 入参（时间走 timePatch/updateItemTime）。 */
  itemInput: CreateItemInput;
  timePatch: { startAt: number | null; endAt: number | null; allDay: boolean };
  tagNames: string[];
  /** 可自动创建的重复提醒计划（tzid 白名单校验后）。 */
  reminderPlan: ReminderPlan | null;
  /** 提醒未能自动落库时的用户可读说明；null = 无提醒或已创建。 */
  reminderNotice: string | null;
}

export function buildFlashSavePlan(
  draft: ParsedItemDraft,
  tzid: string,
  now: number,
): FlashSavePlan {
  const mapped = mapDraftToCreateInputs(draft, tzid, now);
  const { startAt, endAt, allDay, ...itemInput } = mapped.item;

  let reminderPlan = mapped.reminderPlan;
  let reminderNotice: string | null = null;
  if (reminderPlan !== null && !isWhitelistedReminderTz(tzid)) {
    reminderPlan = null;
    reminderNotice = `重复提醒未创建：设备时区 ${tzid} 暂不支持（仅支持上海/纽约）`;
  }
  if (
    reminderPlan === null &&
    reminderNotice === null &&
    draft.reminderOffsetMinutes !== null &&
    draft.recurrence === null
  ) {
    reminderNotice = '一次性提醒暂不支持自动创建，已保留在卡片意图中';
  }

  return {
    itemInput,
    timePatch: {
      startAt: startAt ?? null,
      endAt: endAt ?? null,
      allDay: allDay ?? false,
    },
    tagNames: draft.tags,
    reminderPlan,
    reminderNotice,
  };
}
