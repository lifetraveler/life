/**
 * 闪电添加确认落库计划（tasks/slice-15.md 阶段 3，验收 9；切片 16 阶段 3 扩 once 落库）。
 *
 * 落库链沿用切片 14 新建页先例（§4.24：时间字段只走 updateItemTime）：
 * createItem（不含时间字段）→ updateItemTime → addTagToItem×N →
 * createReminder（重复规则或 once 一次性提醒，tzid 白名单内）→ reminderScheduler.reconcile。
 * 本模块只产出"计划"（纯函数，可单测）；执行在 useFlashChat。
 *
 * 切片 16 阶段 3（AGENTS.md §7.26）：reminderOffsetMinutes 不再降级为提示——
 * 无重复规则且有提前量时自动创建 once 提醒，触发时刻 = startAt - offset；
 * 民用分解只用 civilTime.getZonedParts（不自行实现时区/DST 换算）。
 * 无时间 / 白名单外 / 触发时刻已过去时不落库，保留卡片意图并以 reminderNotice 说明。
 * 切片 19 阶段 2（AGENTS.md §7.30）：reminderDelayMinutes 落库——无重复规则时
 * 以 now + delay*60000 创建 once 提醒（无需 startAt）；白名单外不落库并披露。
 */

import type { CreateItemInput } from '../item';
import { isWhitelistedReminderTz } from '../../data/reminderTzWhitelist';
import { resolveOnceAt } from '../../data/reminderRuleMapping';
import { getZonedParts } from '../recurrence/civilTime';
import { mapDraftToCreateInputs } from './mapper';
import type { ReminderPlan } from './mapper';
import type { ParsedItemDraft } from './types';

export interface FlashSavePlan {
  /** 不含时间字段的 createItem 入参（时间走 timePatch/updateItemTime）。 */
  itemInput: CreateItemInput;
  timePatch: { startAt: number | null; endAt: number | null; allDay: boolean };
  tagNames: string[];
  /** 可自动创建的提醒计划（重复规则或 once 一次性，tzid 白名单校验后）。 */
  reminderPlan: ReminderPlan | null;
  /** 提醒未能自动落库时的用户可读说明；null = 无提醒或已创建。 */
  reminderNotice: string | null;
}

/**
 * once 提醒计划构造（切片 16 阶段 3）。不落库的降级路径（notice 非空、plan null）：
 * - 无 startAt：「提前 X 分钟」无从锚定（验收 7：提示并保留卡片意图）；
 * - tzid 白名单外：onceAt 民用换算与调度展开都限定上海/纽约（提案 §2.3）；
 * - fireInstant <= now：调度器对 once 不过滤 startAt，computeMissed 会把该
 *   occurrence 立即记 missed 并弹聚合补提醒——刚保存即弹「错过」属坏体验，故不落库。
 * allDay 条目不做特殊分支：机械按「当天 00:00 - offset」计算，可能落在前一日晚间；
 * 披露为已知边界（AI 仅对明确带时刻的输入产出 offset）。
 */
function toOncePlan(
  fireInstant: number,
  tzid: string,
): { plan: ReminderPlan | null; notice: string | null } {
  if (!isWhitelistedReminderTz(tzid)) {
    return { plan: null, notice: `提醒未创建：设备时区 ${tzid} 暂不支持（仅支持上海/纽约）` };
  }
  // 民用换算唯一入口（任务约束）：不自行实现时区/DST 逻辑。
  const parts = getZonedParts(fireInstant, tzid);
  // getZonedParts 输出恒在 OnceCivilTime 合法范围内，resolveOnceAt 实际不会抛错；
  // 走一遍与 Repository 写路径相同的校验，作为对上游假设的显式防线。
  const onceAt = resolveOnceAt('once', {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  });
  if (onceAt === null) {
    // 不可达防御分支（frequency='once' 且入参非 null 时恒返回校验后的时刻）。
    return { plan: null, notice: '提醒未创建：一次性时刻无效' };
  }
  return {
    plan: {
      frequency: 'once',
      localTimeHour: 0,
      localTimeMinute: 0,
      onceAt,
      // 切片 18（提案 §5）：多渠道形状；闪电添加恒系统通知单渠道。
      channels: ['system-notification'],
      channelConfigs: {},
      tzid,
      // once 下 startAt 不参与触发计算（唯一来源 onceAt + tzid），取 fireInstant 展示信息量最大。
      startAt: fireInstant,
      enabled: true,
    },
    notice: null,
  };
}

function buildOnceReminderPlan(
  offsetMinutes: number,
  startAt: number | null,
  tzid: string,
  now: number,
): { plan: ReminderPlan | null; notice: string | null } {
  if (startAt === null) {
    return { plan: null, notice: '需设定时间才能提前提醒' };
  }
  const fireInstant = startAt - offsetMinutes * 60000;
  if (fireInstant <= now) {
    return { plan: null, notice: '提醒时刻已过去，未创建一次性提醒' };
  }
  return toOncePlan(fireInstant, tzid);
}

/**
 * 延迟提醒计划构造（切片 19 阶段 2，AGENTS.md §7.30 第一条）：
 * 触发时刻 = now + delay*60000，相对当前时刻、无需 startAt（startAt 为 null 也正常落库）。
 * delay ≥ 1（guard 纪律）保证 fireInstant 恒晚于 now，无需「已过去」降级；
 * tzid 白名单校验与民用换算复用 once 通道（toOncePlan）。
 */
function buildDelayReminderPlan(
  delayMinutes: number,
  tzid: string,
  now: number,
): { plan: ReminderPlan | null; notice: string | null } {
  const fireInstant = now + delayMinutes * 60000;
  return toOncePlan(fireInstant, tzid);
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

  // 切片 16 阶段 3：无重复规则 + 有提前量 → 自动创建 once 提醒。
  // recurrence 命中时重复计划优先（mapper 产出），offset/delay 仍只保留在卡片意图，行为不变。
  // 切片 19 阶段 2（AGENTS.md §7.30 第一条）：无重复规则 + 延迟提醒 → once 提醒
  // （触发时刻 = now + delay*60000，无需 startAt）。提前量与延迟量同现时二者是两条
  // 独立意图（ai.md v0.17），但闪电落库一次只产一条计划（任务卡「生成一条」）：
  // 提前量可锚定（startAt 非空）时提前提醒优先（「再提醒一次」语义中锚定事件开始的
  // 是主提醒），延迟意图披露在 notice 并保留卡片；提前量无法锚定时按延迟落库并披露。
  if (draft.recurrence === null) {
    const offset = draft.reminderOffsetMinutes;
    const delay = draft.reminderDelayMinutes;
    if (offset !== null && delay !== null) {
      if (startAt !== null) {
        const once = buildOnceReminderPlan(offset, startAt ?? null, tzid, now);
        reminderPlan = once.plan;
        reminderNotice =
          once.plan !== null
            ? `已按「提前 ${offset} 分钟」创建提醒；「${delay} 分钟后提醒」意图已保留在卡片（暂不支持一次创建两条提醒）`
            : once.notice;
      } else {
        const delayed = buildDelayReminderPlan(delay, tzid, now);
        reminderPlan = delayed.plan;
        reminderNotice =
          delayed.plan !== null
            ? `已按「${delay} 分钟后」创建提醒；「提前 ${offset} 分钟」需设定时间，已保留在卡片`
            : delayed.notice;
      }
    } else if (offset !== null) {
      const once = buildOnceReminderPlan(offset, startAt ?? null, tzid, now);
      reminderPlan = once.plan;
      reminderNotice = once.notice;
    } else if (delay !== null) {
      const delayed = buildDelayReminderPlan(delay, tzid, now);
      reminderPlan = delayed.plan;
      reminderNotice = delayed.notice;
    }
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
