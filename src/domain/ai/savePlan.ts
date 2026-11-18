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
 * 切片 19 真机验收修正：
 * - 验收 3 反馈：延迟落库时条目 startAt 锚定触发时刻（now + delay），否则条目
 *   没有任何时间、落入无时间「待办」组，用户预期是出现在日程/时刻上；
 * - 验收 4 反馈：AI 落库提醒的渠道跟随全局默认渠道（defaultChannels 入参，
 *   app_settings.defaultChannels），不再恒为系统通知单渠道；网络渠道参数自动取
 *   渠道预设（默认预设 → 第一条，用户既定需求），完全无预设时才披露投递会失败。
 * 切片 23（AGENTS.md §7.35 / ai.md v0.19）：强提醒场景——解析层显式携带渠道推荐
 * （draft.reminderChannels，如“叫我起床”→ ['alarm']）且无 offset/delay 锚点时，
 * 在 startAt 时刻创建 once 提醒（闹钟语义：8点叫就8点响）；draft 显式渠道优先于
 * defaultChannels（强提醒语义来自用户输入本身，不被全局偏好覆盖）。allDay / 无时间
 * 不建并披露。普通提醒不出渠道字段，落库渠道仍走 defaultChannels（§7.30 不变）。
 * 切片 32（AGENTS.md §7.44 / ai.md v0.23，F1 修复 + backlog L5 关闭）：多计划组装
 * ——draft.reminders（绝对时刻提醒，epoch 升序）逐条 toOncePlan（≤ now 不落库并
 * 披露「提醒时刻已过去」）；offset 与 delay 各自独立落库（废除「闪电落库一次只产
 * 一条计划」约束及其降级文案）；跨来源同触发时刻去重；渠道覆盖与网络渠道预设
 * 回填循环应用到每条计划。recurrence 非空时重复计划优先，once 类来源全部不落库
 * 并逐条披露（v0.22「重复计划优先」语义的多计划对齐扩展）。强提醒锚点在
 * reminders 已表达时不再触发（渠道覆盖循环已把渠道带给 reminders 计划，
 * 锚点只在无任何提醒表达时落点）。
 */

import type { CreateItemInput } from '../item';
import { isWhitelistedReminderTz } from '../../data/reminderTzWhitelist';
import { resolveOnceAt } from '../../data/reminderRuleMapping';
import { resolveChannelPreset, type ChannelPreset } from '../channelPreset';
import { getZonedParts } from '../recurrence/civilTime';
import { isNetworkReminderChannel, type ReminderChannel } from '../reminder';
import { mapDraftToCreateInputs } from './mapper';
import type { ReminderPlan } from './mapper';
import type { ParsedItemDraft } from './types';

export interface FlashSavePlan {
  /** 不含时间字段的 createItem 入参（时间走 timePatch/updateItemTime）。 */
  itemInput: CreateItemInput;
  timePatch: { startAt: number | null; endAt: number | null; allDay: boolean };
  tagNames: string[];
  /**
   * 可自动创建的提醒计划（切片 32 多计划 / §7.44）：绝对时刻提醒（draft.reminders
   * 逐条）、「提前 X 分钟」、「X 分钟后」、强提醒锚点（startAt 处 once）各自独立
   * 成条（L5 关闭：不再「一次只产一条计划」）；跨来源同触发时刻去重后输出。
   * recurrence 非空时仅含重复计划。空数组 = 无可自动创建的提醒。
   */
  reminderPlans: ReminderPlan[];
  /**
   * 提醒未能自动落库 / 部分落库 / 边界披露的用户可读行（切片 32：数组化，逐条
   * 披露不合并语义）；空数组 = 全部创建成功且无边界披露。
   */
  reminderNotices: string[];
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
): { plan: ReminderPlan | null; notice: string | null; fireInstant: number } {
  const fireInstant = now + delayMinutes * 60000;
  return { ...toOncePlan(fireInstant, tzid), fireInstant };
}

/**
 * 披露文案用民用时刻格式化（切片 32）：仅展示面使用，落库仍走 toOncePlan 的
 * 民用换算唯一入口。tzid 非白名单时 getZonedParts 仍可通用换算（展示容忍）。
 */
function formatCivilInstant(instant: number, tzid: string): string {
  const parts = getZonedParts(instant, tzid);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * once 计划收集辅助（切片 32）：plan 落库、notice 披露（双 null 不可能——
 * toOncePlan/构造器恒返回其一非空），调用方无需分支重复。
 */
function collectOnceResult(
  result: { plan: ReminderPlan | null; notice: string | null },
  plans: ReminderPlan[],
  notices: string[],
): void {
  if (result.plan !== null) {
    plans.push(result.plan);
  } else if (result.notice !== null) {
    notices.push(result.notice);
  }
}

export function buildFlashSavePlan(
  draft: ParsedItemDraft,
  tzid: string,
  now: number,
  defaultChannels?: ReminderChannel[],
  presets?: readonly ChannelPreset[],
): FlashSavePlan {
  const mapped = mapDraftToCreateInputs(draft, tzid, now);
  const { startAt, endAt, allDay, ...itemInput } = mapped.item;

  const reminderPlans: ReminderPlan[] = [];
  const reminderNotices: string[] = [];

  // 重复计划（mapper 产出）：tzid 白名单外不落库并披露（既有语义原样）。
  let recurrencePlan = mapped.reminderPlan;
  if (recurrencePlan !== null && !isWhitelistedReminderTz(tzid)) {
    recurrencePlan = null;
    reminderNotices.push(`重复提醒未创建：设备时区 ${tzid} 暂不支持（仅支持上海/纽约）`);
  }
  // 延迟意图锚定条目 startAt（切片 19 验收 3 反馈）：仅当原 draft 没有给出 startAt
  // 且按延迟落库时，条目开始时刻取触发时刻，避免落入无时间「待办」组。提醒即使
  // 因白名单/去重等原因未落库，该时刻锚定仍成立（条目时间与提醒互相独立）。
  let delayAnchoredStartAt: number | null = null;

  if (draft.recurrence === null) {
    // 切片 32（§7.44 / ai.md v0.23）：绝对时刻提醒逐条落库（F1 修复核心）——
    // fireInstant ≤ now 不落库并披露（既有 offset「提醒时刻已过去」保护的同语义
    // 扩展：调度器对 once 不过滤 startAt，computeMissed 会立即记 missed 弹聚合
    // 补提醒，刚保存即弹「错过」属坏体验）；白名单外由 toOncePlan 披露。
    if (draft.reminders !== undefined && draft.reminders.length > 0) {
      for (const fireInstant of draft.reminders) {
        if (fireInstant <= now) {
          reminderNotices.push(
            `提醒时刻已过去（${formatCivilInstant(fireInstant, tzid)}），未创建一次性提醒`,
          );
          continue;
        }
        collectOnceResult(toOncePlan(fireInstant, tzid), reminderPlans, reminderNotices);
      }
    }
    // 切片 19 阶段 2：提前量 / 延迟量各自独立落库（L5 关闭——废除「一次只产一条
    // 计划」约束及 offset+delay 同现的降级文案；两条意图本就独立，ai.md v0.17）。
    const offset = draft.reminderOffsetMinutes;
    const delay = draft.reminderDelayMinutes;
    if (offset !== null) {
      collectOnceResult(
        buildOnceReminderPlan(offset, startAt ?? null, tzid, now),
        reminderPlans,
        reminderNotices,
      );
    }
    if (delay !== null) {
      const delayed = buildDelayReminderPlan(delay, tzid, now);
      delayAnchoredStartAt = startAt === null ? delayed.fireInstant : null;
      collectOnceResult(delayed, reminderPlans, reminderNotices);
    }
    // 切片 23：强提醒场景且无 offset/delay 锚点 → 在 startAt 时刻建 once 提醒
    //（闹钟语义：8点叫就8点响，不需要提前量）。allDay / 无时间不建并披露。
    // （startAt 来自 CreateItemInput 可选字段：undefined 与 null 同义=未表达。）
    // 切片 32：reminders 已表达提醒意图时锚点不再触发——渠道经下方覆盖循环
    // 带给 reminders 计划，锚点只会在无任何提醒表达时落点（否则同刻靠去重、
    // 异刻产出冗余第三条，startAt null 还会噪音披露「需设定时间」）。
    if (
      offset === null &&
      delay === null &&
      (draft.reminders === undefined || draft.reminders.length === 0) &&
      draft.reminderChannels !== undefined &&
      draft.reminderChannels.length > 0
    ) {
      if (startAt === null || startAt === undefined) {
        reminderNotices.push('需设定时间才能创建强提醒');
      } else if (allDay === true) {
        reminderNotices.push('全天条目暂不创建强提醒（未表达具体时刻）');
      } else {
        collectOnceResult(toOncePlan(startAt, tzid), reminderPlans, reminderNotices);
      }
    }
  } else {
    // 切片 32：recurrence 非空——重复计划优先；once 类来源全部不落库并逐条披露
    //（v0.22「重复计划优先」语义的多计划对齐扩展；v0.22 对 offset/delay 静默保留
    // 卡片意图，v0.23 起显式披露）。渠道推荐不在此列——它覆盖重复计划的 channels
    //（下方渠道覆盖循环），语义是「改渠道」而非「另建提醒」。
    if (draft.reminders !== undefined && draft.reminders.length > 0) {
      reminderNotices.push(
        `重复提醒已创建；${draft.reminders.length} 条绝对时刻提醒未逐条创建（重复规则下不另建一次性提醒）`,
      );
    }
    if (draft.reminderOffsetMinutes !== null) {
      reminderNotices.push(
        `重复提醒已创建；「提前 ${draft.reminderOffsetMinutes} 分钟」未创建（重复规则下不另建一次性提醒）`,
      );
    }
    if (draft.reminderDelayMinutes !== null) {
      reminderNotices.push(
        `重复提醒已创建；「${draft.reminderDelayMinutes} 分钟后」未创建（重复规则下不另建一次性提醒）`,
      );
    }
  }

  // 跨来源去重（切片 32）：同触发时刻只落一条（防 reminders 条目与强提醒锚点/
  // offset 锚定同刻重复建提醒）。保留先产出的条目（重复计划 → reminders 时间序
  // → offset → delay → 强提醒锚点）。once 计划的 startAt 恒等于触发时刻
  //（toOncePlan）。重复计划加入同一池：渠道覆盖与预设回填循环对它同样生效
  //（v0.22 既有语义）。
  const dedupePool = recurrencePlan !== null ? [recurrencePlan, ...reminderPlans] : reminderPlans;
  const seenFireInstants = new Set<number>();
  const dedupedPlans: ReminderPlan[] = [];
  for (const plan of dedupePool) {
    if (seenFireInstants.has(plan.startAt)) {
      continue;
    }
    seenFireInstants.add(plan.startAt);
    dedupedPlans.push(plan);
  }

  // 切片 19 验收 4 反馈：渠道覆盖——draft 显式渠道（切片 23 强提醒语义）优先于
  // defaultChannels（app_settings.defaultChannels），循环应用到每条计划。
  // 入参来自设置读层（已 canonical/去重/expo 互斥归一），Repository 写路径仍会再校验。
  const channelsOverride =
    draft.reminderChannels !== undefined && draft.reminderChannels.length > 0
      ? [...draft.reminderChannels]
      : defaultChannels !== undefined && defaultChannels.length > 0
        ? [...defaultChannels]
        : null;
  // 切片 19 验收 4 反馈：网络渠道参数自动取渠道预设——默认预设优先，无默认取
  // 第一条（resolveChannelPreset 与手动表单共用）。完全无预设时披露投递会失败；
  // 多条计划缺同一渠道的预设时合并为一句披露（不逐条重复）。
  const missingPresetChannels = new Set<string>();
  const finalPlans = dedupedPlans.map((plan) => {
    let next = channelsOverride !== null ? { ...plan, channels: channelsOverride } : plan;
    const baseConfigs = next.channelConfigs ?? {};
    const filledConfigs: Record<string, string> = { ...baseConfigs };
    for (const channel of next.channels ?? []) {
      // 手写窄化（isNetworkReminderChannel 不携带类型谓词）：仅在 channel 为
      // webhook/apprise 时做预设解析。
      if (channel !== 'webhook' && channel !== 'apprise') {
        continue;
      }
      if (filledConfigs[channel] !== undefined && filledConfigs[channel] !== '') {
        continue;
      }
      const preset = resolveChannelPreset(channel, presets ?? []);
      if (preset !== null) {
        filledConfigs[channel] = preset.configJson;
      } else {
        missingPresetChannels.add(channel);
      }
    }
    // 仅在真正解析出配置时重建计划对象：mapper 的重复计划不含 channelConfigs 键，
    // 无谓重建会在全量断言测试里多出一个空对象键（表现层无差，但不诚实）。
    if (Object.keys(filledConfigs).length > Object.keys(baseConfigs).length) {
      next = { ...next, channelConfigs: filledConfigs };
    }
    return next;
  });
  if (missingPresetChannels.size > 0) {
    reminderNotices.push(
      `网络渠道（${[...missingPresetChannels].join('/')}）尚未配置任何渠道预设，到点投递会失败`,
    );
  }

  return {
    itemInput,
    timePatch: {
      startAt: delayAnchoredStartAt ?? startAt ?? null,
      endAt: endAt ?? null,
      allDay: allDay ?? false,
    },
    tagNames: draft.tags,
    reminderPlans: finalPlans,
    reminderNotices,
  };
}
