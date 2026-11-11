/**
 * 切片 15 阶段 1：ParsedItemDraft → CreateItemInput（+ 重复提醒计划）Mapper。
 *
 * 职责与边界：
 * - 纯函数，无 IO；输入是已通过 isParsedItemDraft 校验的草稿；
 * - endAt < startAt 时把 endAt 归一为 null（repository.md §4.24 的 Repository
 *   会在落库时抛错，这里先归一，杜绝该错误路径）；
 * - categoryId 不在预置分类内 / 为 null → DEFAULT_CATEGORY_ID（'other'，§7.22）；
 * - priority 非法（不在 0..3）→ 不传（Repository 按 0 处理）；
 * - recurrence 命中时产出 ReminderPlan（Omit<CreateReminderInput,'itemId'>），
 *   由阶段 3 编排层在 createItem 成功后带 itemId 落库；
 *   - startAt 兜底：草稿 startAt 为 null（OpenAI 路径可能发生）时用
 *     nextOccurrenceInstant 计算“下一次 occurrence”；
 *   - tzid 透传 context.tzid（Reminder tzid 白名单校验在 Repository 层）；
 * - reminderOffsetMinutes 在本阶段不映射：冻结的 Reminder 模型只有
 *   daily/weekly/monthly 三种 frequency，没有一次性提醒（open item，
 *   阶段 3 落库前需用户对“一次性提醒”出变更提案）；
 * - tags 不映射到 CreateItemInput（领域模型 Item 无 tags 字段；标签落库需要
 *   Repository 的 tags 关联能力，属阶段 3 与 UI 的议题；本阶段 tags 仅用于
 *   预览卡片）。
 */

import { DEFAULT_CATEGORY_ID, isValidItemPriority, PRESET_CATEGORIES } from '../category';
import type { CreateItemInput } from '../item';
import type { CreateReminderInput } from '../reminder';
import { getZonedParts } from '../recurrence/civilTime';
import type { ParsedItemDraft } from './types';
import { nextOccurrenceInstant } from './localFallback';

/** 重复提醒计划：itemId 由编排层补齐。 */
export type ReminderPlan = Omit<CreateReminderInput, 'itemId'>;

export interface MappedDraft {
  item: CreateItemInput;
  reminderPlan: ReminderPlan | null;
}

export function mapDraftToCreateInputs(
  draft: ParsedItemDraft,
  tzid: string,
  now: number,
): MappedDraft {
  let endAt = draft.endAt;
  if (draft.startAt !== null && endAt !== null && endAt < draft.startAt) {
    endAt = null;
  }

  const categoryId =
    draft.categoryId !== null &&
    PRESET_CATEGORIES.some((c) => c.id === draft.categoryId)
      ? draft.categoryId
      : DEFAULT_CATEGORY_ID;

  const item: CreateItemInput = {
    type: draft.type,
    title: draft.title,
    content: draft.content.length > 0 ? draft.content : undefined,
    startAt: draft.startAt,
    endAt,
    allDay: draft.allDay,
    categoryId,
    priority:
      draft.priority !== null && isValidItemPriority(draft.priority)
        ? draft.priority
        : undefined,
  };

  let reminderPlan: ReminderPlan | null = null;
  if (draft.recurrence !== null) {
    const rule = draft.recurrence;
    const parts = getZonedParts(now, tzid);
    const today = { year: parts.year, month: parts.month, day: parts.day };
    const startAt =
      draft.startAt ??
      nextOccurrenceInstant(rule, now, tzid, today);
    if (startAt === null) {
      // 理论上不可达（nextOccurrenceInstant 对合法规则总能找到未来 occurrence）；
      // 防御性处理：放弃 reminderPlan 但保留 item，不让解析结果整体丢失。
      reminderPlan = null;
    } else {
      reminderPlan = {
        frequency: rule.frequency,
        localTimeHour: rule.localTime.hour,
        localTimeMinute: rule.localTime.minute,
        weekdays: rule.frequency === 'weekly' ? [...rule.weekdays] : undefined,
        dayOfMonth: rule.frequency === 'monthly' ? rule.dayOfMonth : undefined,
        tzid,
        startAt,
        enabled: true,
      };
    }
  }

  return { item, reminderPlan };
}
