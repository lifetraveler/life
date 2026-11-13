/**
 * 切片 15 阶段 1：LocalFallbackProvider —— 无 Key / 断网时的本地正则降级解析器。
 *
 * 设计（任务卡确认方案）：槽位解析器。每个槽位（标签/提醒/重复/日期/区间/时刻/
 * 分类/优先级/类型）独立用正则扫描，先到先得地“认领”字符区间（span 互斥），
 * 避免同一片段被多个槽位重复消费（例如“每周三”被重复槽认领后，日期槽不再把
 * “周三”当作单次日期）。标题 = 输入去掉已认领区间后的剩余文本。
 *
 * 槽位扫描顺序：标签 → 延迟提醒 → 提醒 → 重复 → 日期 → 区间 → 单点时刻 → 分类/优先级/类型。
 * （切片 19 §7.30 新增延迟提醒槽：先于提前提醒槽，命中即整段认领含提醒尾词。）
 *
 * 防误判纪律：
 * - 白名单词表驱动，不做开放语义理解；不认识的词留在标题里，绝不猜；
 * - “第3点/第3号”（列举序号）经前置字符黑名单排除；
 * - 裸汉字数字“三”不构成周几（周几必须带 周/星期/礼拜 前缀）；
 * - 民用时间 → 绝对时刻一律走 resolveCivilTimeToInstant(context.tzid)，
 *   gap 返回 null 不平移，fold 由该函数取较早瞬间（§4.12–4.13）；
 * - 解析器无全局时钟：today 全部由 context.now + context.tzid 计算。
 *
 * 歧义裁决（与 docs/contracts/ai.md、用户确认记录一致）：
 * - 裸“3点”按 03:00、“12点”按 12:00，不猜上下午；
 * - 下午/傍晚/晚上 1..11 点 → +12；下午/傍晚 12 点 → 12:00；
 *   晚上/夜里/深夜 12 点 → 次日 00:00（dayShift+1）；凌晨/半夜 12 点 → 当日 00:00；
 *   中午 11/12 点 → 字面，中午 1..2 点 → +12；带 meridiem 的 13..23 视为 24 小时制字面；
 * - 半/一刻/三刻 → 30/15/45 分钟；汉字数字（一~九十九，含“两”）均支持；
 * - 日期词自带上/下午暗示：今晚8点 → 20:00、明早8点 → 08:00（仅当时刻片段
 *   自身不含 meridiem 时套用）；
 * - 只给日期不给时刻 → allDay=true（startAt=当天 00:00）；
 * - 只给时刻不给日期 → 当天（不因已过去而顺延，不猜）；
 * - 区间“X点到Y点”：Y<X 视为跨午夜（Y +1 天）；Y==X 视为零长度（endAt=null）；
 *   结束时刻无自有 meridiem 时继承起点的；
 * - 相对词（今天/明天/后天/大后天/昨天/前天/X天后）> 周几 > 绝对日期 > 几号 > 月底；
 * - 裸“周X”：下一个该周几（含今天）；“下周X”= 下周一所在周的周X；周末=周六；
 * - “X月X号”：默认今年，已过去则推明年；“N号/日”：本月，已过则下月；“月底”同理；
 * - 重复槽命中时日期槽作废，startAt 取“下一次 occurrence”（daily 今天/明天、
 *   weekly 下一个命中周几、monthly 短月回退当月最后一天——与 RecurrenceRule
 *   注释的 clamp 语义一致）；
 * - 重复但未给时刻 → localTime 默认 09:00（RecurrenceRule 必须携带 localTime，
 *   契约性默认值而非猜测）；重复 + 区间 → 取区间起点作 localTime，endAt 丢弃；
 * - 提醒槽必须同时出现“提前/…前”与“提醒/叫我/闹钟/响铃”，避免把
 *   “提前10分钟出发”误判为提醒；
 * - 延迟提醒槽（切片 19 §7.30）：“X分钟/小时后(再/就)?提醒/叫我/闹钟/响铃” →
 *   reminderDelayMinutes。换算：小时/钟头 → n*60（+半=30，一个半小时=90）；
 *   分钟/分 → n 原样；“半”只修饰小时（半小时=30，“半分钟后”不支持）；
 *   数字支持 \d{1,4} 与汉字（一~九十九，含“两”）；“以后/之后”同“后”；
 *   数量缺一不可（n 与 半 至少一者），结果 <1 分钟无效；
 *   前置字符“前”封锁（“提前30分钟以后提醒”不是延迟——两个槽都不匹配，留标题）；
 * - 分类与优先级关键词只判定槽位，不裁剪标题（“讨论项目”不会被剪成“讨论”）。
 *
 * 已知局限（如实披露，不做静默猜测）：农历、“每隔一天”、周一+N号 这类过指定
 * 输入（周几槽先命中，N号 留在标题）等不在白名单内；LocalFallback 只承诺任务卡
 * 示例级别（明天/明早8点/下午3点/下周三/每月15号/区间/重复/提醒）的可靠解析。
 * 延迟提醒槽的已知边界（切片 19，如实披露）：“过/等10分钟提醒我”（无“后”）、
 * “X天后提醒我”（天单位不在支持单位内；“3天后提醒我”被日期槽认领为 start）
 * 均不产 reminderDelayMinutes——对应短语留在标题或按日期语义解析，不静默造提醒。
 */

import {
  addOneDay,
  assertValidTimeZone,
  daysInMonth,
  getCivilWeekday,
  getZonedParts,
  resolveCivilTimeToInstant,
  type CivilDate,
} from '../recurrence/civilTime';
import type { RecurrenceRule } from '../recurrence/types';
import { AiParseError } from './errors';
import type { DraftField } from './merge';
import type {
  AiParseContext,
  AiParser,
  ParsedItemDraft,
  ParsedItemType,
} from './types';

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

type Span = { start: number; end: number };

/** { hour, minute } + 相对基准日期的天数偏移（晚上12点 → 次日 = +1）。 */
type CivilTimeOfDay = { hour: number; minute: number; dayShift: number };

type TimeToken = { ct: CivilTimeOfDay; hasMeridiem: boolean };

const MERIDIEM_SRC =
  '(?:凌晨|半夜|清晨|早上|早晨|上午|中午|午后|下午|傍晚|晚上|夜里|夜晚|深夜|早)';
const NUM_SRC = '(?:\\d{1,2}|[零一二两三四五六七八九十]+)';
const HALF_SRC = '(?:半|一刻|三刻)';

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 解析“一~九十九”的汉字数字；不支持的形式返回 null（调用方跳过该候选）。 */
export function parseChineseNumeral(raw: string): number | null {
  if (raw.length === 0) return null;
  if (raw === '十') return 10;
  const tenIdx = raw.indexOf('十');
  if (tenIdx === -1) {
    if (raw.length > 1) return null;
    const d = CN_DIGITS[raw];
    return d === undefined ? null : d;
  }
  const before = raw.slice(0, tenIdx);
  const after = raw.slice(tenIdx + 1);
  let tens = 1;
  if (before.length > 0) {
    if (before.length > 1) return null;
    const b = CN_DIGITS[before];
    if (b === undefined || b === 0) return null;
    tens = b;
  }
  let ones = 0;
  if (after.length > 0) {
    if (after.length > 1) return null;
    const a = CN_DIGITS[after];
    if (a === undefined || a > 9) return null;
    ones = a;
  }
  return tens * 10 + ones;
}

function parseNumToken(raw: string | undefined): number | null {
  if (raw === undefined || raw.length === 0) return null;
  if (/^[0-9]+$/.test(raw)) {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }
  return parseChineseNumeral(raw);
}

function overlaps(start: number, end: number, claimed: readonly Span[]): boolean {
  return claimed.some((sp) => !(end <= sp.start || start >= sp.end));
}

/**
 * 在 text 里扫描 re（自动补 g），跳过与 claimed 重叠的候选与被 convert 拒绝的
 * 候选，返回第一个通过校验的匹配。
 */
function scan<T>(
  re: RegExp,
  text: string,
  claimed: readonly Span[],
  convert: (m: RegExpExecArray, full: string) => T | null,
): { value: T; index: number; end: number } | null {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const r = new RegExp(re.source, flags);
  r.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) {
    if (m[0].length === 0) {
      r.lastIndex += 1;
      continue;
    }
    const start = m.index;
    const end = start + m[0].length;
    if (overlaps(start, end, claimed)) continue;
    const value = convert(m, text);
    if (value !== null) return { value, index: start, end };
  }
  return null;
}

/** 前一天（addDays 负方向用；civilTime 只导出 addOneDay）。 */
function subOneDay(date: CivilDate): CivilDate {
  if (date.day > 1) return { year: date.year, month: date.month, day: date.day - 1 };
  const prevMonth = date.month === 1 ? 12 : date.month - 1;
  const prevYear = date.month === 1 ? date.year - 1 : date.year;
  return { year: prevYear, month: prevMonth, day: daysInMonth(prevYear, prevMonth) };
}

function addDays(date: CivilDate, n: number): CivilDate {
  let d = date;
  if (n >= 0) {
    for (let i = 0; i < n; i += 1) d = addOneDay(d);
  } else {
    for (let i = 0; i < -n; i += 1) d = subOneDay(d);
  }
  return d;
}

/** 前置字符黑名单：命中则该候选无效（排除“第3点/第3号”这类列举序号）。 */
function prevCharBlocked(full: string, index: number, blocked: string): boolean {
  if (index === 0) return false;
  return blocked.includes(full[index - 1]);
}

function claim(
  claimed: Span[],
  titleSpans: Span[],
  span: Span,
  removeFromTitle: boolean,
): void {
  claimed.push(span);
  if (removeFromTitle) titleSpans.push(span);
}

// ---------------------------------------------------------------------------
// 时刻（meridiem + 汉字/数字 + 半/刻）
// ---------------------------------------------------------------------------

/** 用户确认的民用时刻归一化表；返回 null 表示该组合不成立（候选作废）。 */
function applyMeridiem(
  mer: string | undefined,
  hour: number,
  minute: number,
): CivilTimeOfDay | null {
  if (mer === undefined || mer === '') {
    if (hour < 0 || hour > 23) return null;
    return { hour, minute, dayShift: 0 };
  }
  if (mer === '凌晨' || mer === '半夜') {
    if (hour < 0 || hour > 12) return null;
    return { hour: hour === 12 ? 0 : hour, minute, dayShift: 0 };
  }
  if (mer === '清晨' || mer === '早上' || mer === '早晨' || mer === '早' || mer === '上午') {
    if (hour < 1 || hour > 12) return null;
    return { hour, minute, dayShift: 0 };
  }
  if (mer === '中午') {
    if (hour === 11 || hour === 12) return { hour, minute, dayShift: 0 };
    if (hour === 1 || hour === 2) return { hour: hour + 12, minute, dayShift: 0 };
    if (hour >= 13 && hour <= 23) return { hour, minute, dayShift: 0 };
    return null;
  }
  if (mer === '午后' || mer === '下午' || mer === '傍晚') {
    if (hour === 12) return { hour: 12, minute, dayShift: 0 };
    if (hour >= 1 && hour <= 11) return { hour: hour + 12, minute, dayShift: 0 };
    if (hour >= 13 && hour <= 23) return { hour, minute, dayShift: 0 };
    return null;
  }
  if (mer === '晚上' || mer === '夜里' || mer === '夜晚' || mer === '深夜') {
    if (hour === 12) return { hour: 0, minute, dayShift: 1 };
    if (hour >= 1 && hour <= 11) return { hour: hour + 12, minute, dayShift: 0 };
    if (hour >= 13 && hour <= 23) return { hour, minute, dayShift: 0 };
    return null;
  }
  return null;
}

const HALF_MINUTES: Record<string, number> = { 半: 30, 一刻: 15, 三刻: 45 };

const WORD_TIME_RE = new RegExp(
  `(${MERIDIEM_SRC})?\\s*(${NUM_SRC})\\s*点\\s*(?:(${HALF_SRC})|(${NUM_SRC})\\s*分?)?`,
  'u',
);

const COLON_TIME_RE = new RegExp(`(${MERIDIEM_SRC})?\\s*(\\d{1,2}):(\\d{2})`, 'u');

/** 裸词法时刻（“8点”“八点半”，无 meridiem）：供明早/今晚等复合词之后兜底。 */
const BARE_WORD_TIME_RE = new RegExp(
  `(${NUM_SRC})\\s*点\\s*(?:(${HALF_SRC})|(${NUM_SRC})\\s*分?)?`,
  'u',
);

/**
 * 纠正动词（“改成后天”“时间换成下午3点”）：多轮对话里这些词是元指令，
 * 不属于标题。仅当 context.history 非空（非首轮）才扫描，避免
 * “把会议室改成大间”这类普通句子首轮被误裁。
 */
const CORRECTION_RE =
  /(?:时间|日期|时刻|提醒|地点|标题)?(?:改成|改为|换成|改到|调到|挪到|定在|改在|放到|定到)/u;

/** 词法时刻（“下午3点半”“3点”）→ TimeToken；返回 null 表示候选作废。 */
function convertWordTime(m: RegExpExecArray, full: string): TimeToken | null {
  if (prevCharBlocked(full, m.index, '第')) return null;
  const mer = m[1];
  const hour = parseNumToken(m[2]);
  if (hour === null) return null;
  let minute = 0;
  if (m[3] !== undefined) {
    const v = HALF_MINUTES[m[3]];
    if (v === undefined) return null;
    minute = v;
  } else if (m[4] !== undefined) {
    const v = parseNumToken(m[4]);
    if (v === null || v < 0 || v > 59) return null;
    minute = v;
  }
  const ct = applyMeridiem(mer, hour, minute);
  if (ct === null) return null;
  return { ct, hasMeridiem: mer !== undefined };
}

/** 裸词法时刻（无 meridiem）→ TimeToken；上下午由 dateHint 决定。 */
function convertBareWordTime(m: RegExpExecArray, full: string): TimeToken | null {
  if (prevCharBlocked(full, m.index, '第')) return null;
  const hour = parseNumToken(m[1]);
  if (hour === null) return null;
  let minute = 0;
  if (m[2] !== undefined) {
    const v = HALF_MINUTES[m[2]];
    if (v === undefined) return null;
    minute = v;
  } else if (m[3] !== undefined) {
    const v = parseNumToken(m[3]);
    if (v === null || v < 0 || v > 59) return null;
    minute = v;
  }
  return { ct: { hour, minute, dayShift: 0 }, hasMeridiem: false };
}

/** 冒号时刻（“15:30”/“下午3:30”）。冒号形式默认 24 小时制。 */
function convertColonTime(m: RegExpExecArray, full: string): TimeToken | null {
  if (prevCharBlocked(full, m.index, '第')) return null;
  const mer = m[1];
  const hour = Number.parseInt(m[2], 10);
  const minute = Number.parseInt(m[3], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour > 23 || minute > 59) return null;
  if (mer !== undefined && hour >= 1 && hour <= 12) {
    const ct = applyMeridiem(mer, hour, minute);
    if (ct === null) return null;
    return { ct, hasMeridiem: true };
  }
  return { ct: { hour, minute, dayShift: 0 }, hasMeridiem: mer !== undefined };
}

// ---------------------------------------------------------------------------
// 日期
// ---------------------------------------------------------------------------

type DateHint = 'morning' | 'evening' | null;

const COMPOUND_DATE_RE =
  /(今天|今日|今晚|今早|明天|明日|明早|明晚|后天|大后天|前天|昨天)/u;

const COMPOUND_DATE_MAP: Record<string, { deltaDays: number; hint: DateHint }> = {
  今天: { deltaDays: 0, hint: null },
  今日: { deltaDays: 0, hint: null },
  今晚: { deltaDays: 0, hint: 'evening' },
  今早: { deltaDays: 0, hint: 'morning' },
  明天: { deltaDays: 1, hint: null },
  明日: { deltaDays: 1, hint: null },
  明早: { deltaDays: 1, hint: 'morning' },
  明晚: { deltaDays: 1, hint: 'evening' },
  后天: { deltaDays: 2, hint: null },
  大后天: { deltaDays: 3, hint: null },
  昨天: { deltaDays: -1, hint: null },
  前天: { deltaDays: -2, hint: null },
};

const N_DAYS_LATER_RE = new RegExp(`(${NUM_SRC})\\s*天\\s*[之以]?\\s*后`, 'u');

/** 周几必须带 周/星期/礼拜 前缀（裸“三”绝不构成日期）。 */
const WEEKDAY_RE = /(?:(下下|下|本|这)(?:周|星期|礼拜)|(?:周|星期|礼拜))([一二三四五六日天]|末)/u;

type WeekdayValue =
  | { kind: 'next'; weekday: number }
  | { kind: 'nextWeek'; weekday: number; weekOffset: number }
  | { kind: 'weekendNext' }
  | { kind: 'weekendNextWeek'; weekOffset: number };

function convertWeekday(m: RegExpExecArray, full: string): WeekdayValue | null {
  if (prevCharBlocked(full, m.index, '第')) return null;
  const wRaw = m[2];
  if (wRaw === '末') {
    if (m[1] === '下下') return { kind: 'weekendNextWeek', weekOffset: 2 };
    if (m[1] === '下') return { kind: 'weekendNextWeek', weekOffset: 1 };
    return { kind: 'weekendNext' };
  }
  const weekday = wRaw === '天' ? 7 : parseChineseNumeral(wRaw);
  if (weekday === null || weekday < 1 || weekday > 7) return null;
  if (m[1] === '下下') return { kind: 'nextWeek', weekday, weekOffset: 2 };
  if (m[1] === '下') return { kind: 'nextWeek', weekday, weekOffset: 1 };
  return { kind: 'next', weekday };
}

function weekdayToDate(today: CivilDate, v: WeekdayValue): CivilDate {
  const wd = getCivilWeekday(today);
  if (v.kind === 'next') {
    const delta = (v.weekday - wd + 7) % 7;
    return addDays(today, delta);
  }
  if (v.kind === 'weekendNext') {
    const delta = (6 - wd + 7) % 7;
    return addDays(today, delta);
  }
  if (v.kind === 'weekendNextWeek') {
    // 下/下下周末 = 对应周的周六（weekdays 重复槽会扩展为 [6,7]）。
    const monday = addDays(today, -(wd - 1) + 7 * v.weekOffset);
    return addDays(monday, 5);
  }
  if (v.kind === 'nextWeek') {
    // 下周X：下周一 = 本周一 + 7*weekOffset，再取该周的 (weekday-1) 天后。
    const monday = addDays(today, -(wd - 1) + 7 * v.weekOffset);
    return addDays(monday, v.weekday - 1);
  }
  // 类型上不可达（WeekdayValue 四种 kind 已全部覆盖）；防御性兜底。
  return today;
}

const ABS_DATE_RE = new RegExp(
  `(?:(\\d{4})\\s*年\\s*)?(${NUM_SRC})\\s*月\\s*(${NUM_SRC})\\s*[号日]`,
  'u',
);

function convertAbsDate(
  m: RegExpExecArray,
  full: string,
  today: CivilDate,
): CivilDate | null {
  if (prevCharBlocked(full, m.index, '第')) return null;
  const yRaw = m[1];
  const mo = parseNumToken(m[2]);
  const d = parseNumToken(m[3]);
  if (mo === null || d === null || mo < 1 || mo > 12) return null;
  let year = today.year;
  if (yRaw !== undefined) {
    year = Number.parseInt(yRaw, 10);
    if (!Number.isFinite(year)) return null;
  } else {
    // 未写年份：默认今年；该日期在今年已过去则推到明年。
    const passed = mo < today.month || (mo === today.month && d < today.day);
    if (passed) year += 1;
  }
  if (d < 1 || d > daysInMonth(year, mo)) return null;
  return { year, month: mo, day: d };
}

const BARE_DAY_RE = new RegExp(`(${NUM_SRC})\\s*[号日]`, 'u');

function convertBareDay(
  m: RegExpExecArray,
  full: string,
  today: CivilDate,
): CivilDate | null {
  if (prevCharBlocked(full, m.index, '第')) return null;
  const d = parseNumToken(m[1]);
  if (d === null || d < 1 || d > 31) return null;
  let year = today.year;
  let month = today.month;
  if (d < today.day) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  if (d > daysInMonth(year, month)) return null;
  return { year, month, day: d };
}

const MONTH_END_RE = /(月底|月末)/u;

function convertMonthEnd(today: CivilDate): CivilDate | null {
  let year = today.year;
  let month = today.month;
  if (today.day >= daysInMonth(year, month)) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return { year, month, day: daysInMonth(year, month) };
}

// ---------------------------------------------------------------------------
// 提醒 / 重复 / 分类 / 优先级 / 类型 / 标签
// ---------------------------------------------------------------------------

const REMINDER_BEFORE_RE = new RegExp(
  `提前\\s*(?<n>${NUM_SRC}|半)\\s*个?\\s*(?<u>小时|钟头|分钟|分)\\s*(?:提醒|叫我|闹钟|响铃)`,
  'u',
);

const REMINDER_AGO_RE = new RegExp(
  `(?<n>${NUM_SRC})\\s*个?\\s*(?<u>分钟|分)\\s*(?:之?前|以前)\\s*(?:提醒|叫我)`,
  'u',
);

// 切片 19（§7.30）：延迟提醒槽——“X分钟/小时后提醒我”（相对当前时刻的延迟）。
// 与用户给定的 /(\d+)(分钟|小时).*?后.*?(提醒|叫我|闹钟)/ 相比刻意收紧：
// - 数字限 \d{1,4}（≤9999 < 10080=CHIPS_MAX_MINUTES；汉字沿用 parseChineseNumeral ≤99），
//   避免 NUM_SRC 的 \d{1,2} 漏掉“100分钟后提醒我”这类输入（防静默丢失）；
// - 去掉松散的 .*? 段，改为紧邻结构 + 提醒尾词必选（提醒/叫我/闹钟/响铃），
//   防止跨词误配；“过/等10分钟提醒我”（无“后”）不产 delay（已知边界，见文件头）。
// - n 与 half 至少一者存在；“半分钟”（=30 秒）不支持；分钟单位下 half 必须缺席。
const DELAY_NUM_SRC = '(?:\\d{1,4}|[零一二两三四五六七八九十]+)';
const REMINDER_DELAY_RE = new RegExp(
  `(?:(?<n>${DELAY_NUM_SRC})\\s*个?\\s*)?(?<half>半)?\\s*(?<u>小时|钟头|分钟|分)\\s*(?:以|之)?\\s*后\\s*(?:再|就)?\\s*(?:提醒|叫我|闹钟|响铃)`,
  'u',
);

function reminderDelayMinutesFromMatch(m: RegExpExecArray): number | null {
  const u = m.groups?.u;
  const nRaw = m.groups?.n;
  const half = m.groups?.half;
  if (u === undefined) return null;
  const isHour = u === '小时' || u === '钟头';
  const isMinute = u === '分钟' || u === '分';
  if (!isHour && !isMinute) return null;
  // “半”只修饰小时（半小时=30 分钟）；“半分钟后”=30 秒，不在支持范围。
  if (half !== undefined && !isHour) return null;
  if (nRaw === undefined && half === undefined) return null;
  const n = nRaw === undefined ? 0 : parseNumToken(nRaw);
  if (n === null || n < 0) return null;
  const minutes = (isHour ? n * 60 : n) + (half !== undefined ? 30 : 0);
  if (minutes < 1) return null;
  return minutes;
}

function reminderMinutes(m: RegExpExecArray): number | null {
  const u = m.groups?.u;
  const nRaw = m.groups?.n;
  if (u === undefined || nRaw === undefined) return null;
  if (nRaw === '半') {
    return u === '小时' || u === '钟头' ? 30 : null;
  }
  const n = parseNumToken(nRaw);
  if (n === null || n < 1) return null;
  return u === '小时' || u === '钟头' ? n * 60 : n;
}

const WEEKDAY_CN_TO_NUM: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};

const REC_DAILY_RE = /(每天|每日|天天)/u;
const REC_WEEKLY_RE = /每(?:个|逢)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天]|末)/u;
const REC_WEEKLY_BARE_RE = /每(?:个|逢)?\s*(?:周|星期|礼拜)/u;
const REC_WORKDAY_RE = /(?:每个)?工作日/u;
const REC_MONTHLY_RE = new RegExp(
  `每(?:个|逢)?\\s*月\\s*(?:(?<d>${NUM_SRC})\\s*[号日])?`,
  'u',
);

/** 分类只判定不裁剪标题；顺序即优先级（先命中先得）。 */
const CATEGORY_RULES: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: 'work', re: /工作|上班|加班|开会|会议|汇报|周报|日报|项目|客户|老板|同事|需求|评审/u },
  { id: 'study', re: /学习|读书|上课|考试|复习|预习|作业|论文|课程|背单词/u },
  { id: 'health', re: /运动|锻炼|跑步|健身|体检|吃药|看病|复诊|瑜伽|游泳|早睡/u },
  { id: 'personal', re: /生活|家庭|家人|爸妈|购物|买菜|做饭|家务|搬家|理发|缴费|快递/u },
];

/** 否定词表必须排在“紧急/重要”之前，否则“不紧急”会命中 /紧急/。 */
const PRIORITY_RULES: ReadonlyArray<{ value: number; re: RegExp }> = [
  { value: 1, re: /不急|不着急|不紧急|低优先|有空(的时候|时)?再做/u },
  { value: 3, re: /紧急|特急|非常重要|最高优先/u },
  { value: 2, re: /重要|优先/u },
];

const EVENT_WORDS_RE =
  /开会|会议|见面|见(?!到|鬼|怪|笑)|约(?![合计算])|聚餐|早饭|午饭|晚饭|吃饭|电影|航班|飞机|高铁|火车|机票|值机|课程|上课|讲座|面试|生日|婚礼|体检|看病|值班|下班/u;

const TASK_WORDS_RE =
  /写|做|完成|提交|交(?!流|互)|买|还(?!是)|复习|预习|整理|打扫|修理|预约|缴费|回复|发送|填|办|背|订|取|寄|退|装|爬山|运动|锻炼|跑步|健身/u;

const TAG_RE = /#([^\s#，,。.；;！!？?：:]+)/gu;

// ---------------------------------------------------------------------------
// next occurrence（重复草稿的 startAt）
// ---------------------------------------------------------------------------

/** 重复槽未带时刻时的契约性默认 localTime（见文件头注释）。 */
const DEFAULT_RECURRENCE_LOCAL_TIME = { hour: 9, minute: 0 } as const;

export function nextOccurrenceInstant(
  rule: RecurrenceRule,
  now: number,
  tzid: string,
  today: CivilDate,
): number | null {
  const lt = rule.localTime;
  if (rule.frequency === 'daily') {
    for (let i = 0; i <= 1; i += 1) {
      const d = addDays(today, i);
      const t = resolveCivilTimeToInstant(tzid, d.year, d.month, d.day, lt.hour, lt.minute);
      if (t !== null && t > now) return t;
    }
    return null;
  }
  if (rule.frequency === 'weekly') {
    const targets = [...new Set(rule.weekdays)];
    for (let delta = 0; delta <= 13; delta += 1) {
      const d = addDays(today, delta);
      if (!targets.includes(getCivilWeekday(d))) continue;
      const t = resolveCivilTimeToInstant(tzid, d.year, d.month, d.day, lt.hour, lt.minute);
      if (t !== null && t > now) return t;
    }
    return null;
  }
  // monthly：短月固定回退到当月最后一天（clamp，与 RecurrenceRule 注释一致）。
  for (let m = 0; m <= 13; m += 1) {
    let month = today.month + m;
    let year = today.year;
    while (month > 12) {
      month -= 12;
      year += 1;
    }
    const day = Math.min(rule.dayOfMonth, daysInMonth(year, month));
    if (year === today.year && month === today.month && day < today.day) continue;
    const t = resolveCivilTimeToInstant(tzid, year, month, day, lt.hour, lt.minute);
    if (t !== null && t > now) return t;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 标题
// ---------------------------------------------------------------------------

function buildTitle(
  input: string,
  spans: readonly Span[],
): { title: string; expressed: boolean } {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let s = '';
  let cursor = 0;
  for (const sp of sorted) {
    if (sp.start < cursor) continue;
    s += `${input.slice(cursor, sp.start)} `;
    cursor = sp.end;
  }
  s += input.slice(cursor);
  s = s.replace(/[\s，,。.；;、！!？?：:·…\-—~～]+/g, ' ').trim();
  s = s.replace(/^[的得地了要]+/, '').replace(/[的得地了]+$/, '').trim();
  // 提醒句式裁剪后常以委托代词/处置介词开头（“提醒我吃药”→“我吃药”）。
  s = s.replace(/^(?:请|麻烦|帮我|记得|记得要|给我|把|将|我)+/, '').trim();
  // expressed = 清理后还剩真实标题（纠正句“改成后天”会被裁空 → 标题未表达）。
  const expressed = s.length > 0;
  if (s.length === 0) {
    s = input.replace(/[\s，,。.；;、！!？?：:]+/g, ' ').trim();
  }
  return { title: s.length > 0 ? s : input.trim(), expressed };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

function resolveTimeOnDate(
  tzid: string,
  date: CivilDate,
  t: CivilTimeOfDay,
): number | null {
  const d = addDays(date, t.dayShift);
  return resolveCivilTimeToInstant(tzid, d.year, d.month, d.day, t.hour, t.minute);
}

type RecurrenceCore =
  | { frequency: 'daily' }
  | { frequency: 'weekly'; weekdays: number[] }
  | { frequency: 'monthly'; dayOfMonth: number };

export class LocalFallbackProvider implements AiParser {
  async parse(input: string, context: AiParseContext): Promise<ParsedItemDraft> {
    return this.parseSlots(input, context).draft;
  }

  /**
   * 槽位解析 + expressed 掩码（阶段 3 多轮合并用）：
   * expressed 标记"本轮输入真正表达过的字段"——未表达的字段在多轮合并时
   * 沿用上一轮卡片值（merge.ts），避免纠正句把标题/分类冲成默认值。
   */
  parseSlots(input: string, context: AiParseContext): {
    draft: ParsedItemDraft;
    expressed: ReadonlySet<DraftField>;
  } {
    const expressed = new Set<DraftField>();
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      throw new AiParseError('empty-input', 'AI 解析输入为空');
    }
    assertValidTimeZone(context.tzid);

    const now = context.now;
    const tzid = context.tzid;
    const parts = getZonedParts(now, tzid);
    const today: CivilDate = { year: parts.year, month: parts.month, day: parts.day };

    const claimed: Span[] = [];
    const titleSpans: Span[] = [];
    const tags: string[] = [];

    // --- 标签（#tag；最多收集 5 个）---
    const tagRegex = new RegExp(TAG_RE.source, TAG_RE.flags);
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRegex.exec(trimmed)) !== null) {
      if (tags.length >= 5) break;
      const raw = tagMatch[1];
      if (raw.length === 0 || raw.length > 20) continue;
      const span = { start: tagMatch.index, end: tagMatch.index + tagMatch[0].length };
      tags.push(raw);
      claim(claimed, titleSpans, span, true);
    }
    if (tags.length > 0) expressed.add('tags');

    // --- 纠正动词（仅非首轮：把“改成/换成…”当元指令裁出标题）---
    if (context.history.length > 0) {
      const correction = scan(CORRECTION_RE, trimmed, claimed, () => true);
      if (correction !== null) {
        claim(
          claimed,
          titleSpans,
          { start: correction.index, end: correction.end },
          true,
        );
      }
    }

    // --- 延迟提醒（切片 19 §7.30：“X分钟/小时后提醒我”）---
    // 先于提前提醒槽扫描：延迟命中即整段认领（含提醒尾词），提前槽不会重复消费；
    // prevCharBlocked('前') 排除“提前30分钟以后提醒”——“提前X”是 offset 语义，
    // 且带“以后”后缀时两个槽都不匹配，短语留在标题（既有行为的自然延伸，非回归）。
    let reminderDelayMinutes: number | null = null;
    const delayScan = scan(REMINDER_DELAY_RE, trimmed, claimed, (m, full) => {
      if (prevCharBlocked(full, m.index, '前')) return null;
      return reminderDelayMinutesFromMatch(m);
    });
    if (delayScan !== null) {
      reminderDelayMinutes = delayScan.value;
      claim(claimed, titleSpans, { start: delayScan.index, end: delayScan.end }, true);
      expressed.add('reminderDelayMinutes');
    }

    // --- 提醒 ---
    let reminderOffsetMinutes: number | null = null;
    const reminderScan =
      scan(REMINDER_BEFORE_RE, trimmed, claimed, (m) => reminderMinutes(m)) ??
      scan(REMINDER_AGO_RE, trimmed, claimed, (m) => reminderMinutes(m));
    if (reminderScan !== null) {
      reminderOffsetMinutes = reminderScan.value;
      claim(claimed, titleSpans, { start: reminderScan.index, end: reminderScan.end }, true);
      expressed.add('reminderOffsetMinutes');
    }

    // --- 重复 ---
    let recurrenceCore: RecurrenceCore | null = null;
    const weeklyFull = scan(REC_WEEKLY_RE, trimmed, claimed, (m) => {
      const wRaw = m[1];
      if (wRaw === '末') return { weekdays: [6, 7] };
      const w = WEEKDAY_CN_TO_NUM[wRaw];
      return w === undefined ? null : { weekdays: [w] };
    });
    if (weeklyFull !== null) {
      recurrenceCore = { frequency: 'weekly', weekdays: weeklyFull.value.weekdays };
      claim(claimed, titleSpans, { start: weeklyFull.index, end: weeklyFull.end }, true);
    } else {
      const workday = scan(REC_WORKDAY_RE, trimmed, claimed, () => ({ weekdays: [1, 2, 3, 4, 5] }));
      if (workday !== null) {
        recurrenceCore = { frequency: 'weekly', weekdays: workday.value.weekdays };
        claim(claimed, titleSpans, { start: workday.index, end: workday.end }, true);
      } else {
        const monthlyFull = scan(REC_MONTHLY_RE, trimmed, claimed, (m) => {
          const dRaw = m.groups?.d;
          if (dRaw === undefined) return { dayOfMonth: today.day };
          const d = parseNumToken(dRaw);
          if (d === null || d < 1 || d > 31) return null;
          return { dayOfMonth: d };
        });
        if (monthlyFull !== null) {
          recurrenceCore = { frequency: 'monthly', dayOfMonth: monthlyFull.value.dayOfMonth };
          claim(claimed, titleSpans, { start: monthlyFull.index, end: monthlyFull.end }, true);
        } else {
          const daily = scan(REC_DAILY_RE, trimmed, claimed, () => ({ daily: true }));
          if (daily !== null) {
            recurrenceCore = { frequency: 'daily' };
            claim(claimed, titleSpans, { start: daily.index, end: daily.end }, true);
          } else {
            // 裸“每周”：重复槽按“今天所在的周几”解释（文档化默认）。
            const weeklyBare = scan(
              REC_WEEKLY_BARE_RE,
              trimmed,
              claimed,
              () => ({ weekdays: [parts.weekday] }),
            );
            if (weeklyBare !== null) {
              recurrenceCore = { frequency: 'weekly', weekdays: weeklyBare.value.weekdays };
              claim(claimed, titleSpans, { start: weeklyBare.index, end: weeklyBare.end }, true);
            }
          }
        }
      }
    }

    // --- 日期（相对词 → X天后 → 周几 → 绝对日期 → 几号 → 月底）---
    let dateHint: DateHint = null;
    let date: CivilDate | null = null;
    const compound = scan(COMPOUND_DATE_RE, trimmed, claimed, (m) => {
      const entry = COMPOUND_DATE_MAP[m[1]];
      return entry === undefined ? null : entry;
    });
    if (compound !== null) {
      dateHint = compound.value.hint;
      date = addDays(today, compound.value.deltaDays);
      claim(claimed, titleSpans, { start: compound.index, end: compound.end }, true);
    } else {
      const nDays = scan(N_DAYS_LATER_RE, trimmed, claimed, (m) => {
        const n = parseNumToken(m[1]);
        return n === null || n < 1 || n > 99 ? null : n;
      });
      if (nDays !== null) {
        date = addDays(today, nDays.value);
        claim(claimed, titleSpans, { start: nDays.index, end: nDays.end }, true);
      } else {
        const weekdayScan = scan(WEEKDAY_RE, trimmed, claimed, (m, full) => convertWeekday(m, full));
        if (weekdayScan !== null) {
          date = weekdayToDate(today, weekdayScan.value);
          claim(claimed, titleSpans, { start: weekdayScan.index, end: weekdayScan.end }, true);
        } else {
          const abs = scan(ABS_DATE_RE, trimmed, claimed, (m, full) => convertAbsDate(m, full, today));
          if (abs !== null) {
            date = abs.value;
            claim(claimed, titleSpans, { start: abs.index, end: abs.end }, true);
          } else {
            const bare = scan(BARE_DAY_RE, trimmed, claimed, (m, full) => convertBareDay(m, full, today));
            if (bare !== null) {
              date = bare.value;
              claim(claimed, titleSpans, { start: bare.index, end: bare.end }, true);
            } else {
              const monthEnd = scan(MONTH_END_RE, trimmed, claimed, () => convertMonthEnd(today));
              if (monthEnd !== null) {
                date = monthEnd.value;
                claim(claimed, titleSpans, { start: monthEnd.index, end: monthEnd.end }, true);
              }
            }
          }
        }
      }
    }

    // --- 区间（X点到Y点；结束无自有 meridiem 时继承起点）---
    let startCt: CivilTimeOfDay | null = null;
    let endCt: CivilTimeOfDay | null = null;
    const intervalScan = scan(
      new RegExp(
        `(${MERIDIEM_SRC})?\\s*(${NUM_SRC})\\s*点\\s*(?:(${HALF_SRC})|(${NUM_SRC})\\s*分?)?\\s*(?:到|至|–|—|~|～)\\s*(${MERIDIEM_SRC})?\\s*(${NUM_SRC})\\s*点\\s*(?:(${HALF_SRC})|(${NUM_SRC})\\s*分?)?`,
        'u',
      ),
      trimmed,
      claimed,
      (m, full) => {
        if (prevCharBlocked(full, m.index, '第')) return null;
        const h1 = parseNumToken(m[2]);
        if (h1 === null) return null;
        const min1 =
          m[3] !== undefined
            ? HALF_MINUTES[m[3]] ?? null
            : m[4] !== undefined
              ? parseNumToken(m[4])
              : 0;
        if (min1 === null || min1 < 0 || min1 > 59) return null;
        const startT = applyMeridiem(m[1], h1, min1);
        if (startT === null) return null;
        const h2 = parseNumToken(m[6]);
        if (h2 === null) return null;
        const min2 =
          m[7] !== undefined
            ? HALF_MINUTES[m[7]] ?? null
            : m[8] !== undefined
              ? parseNumToken(m[8])
              : 0;
        if (min2 === null || min2 < 0 || min2 > 59) return null;
        const endT = applyMeridiem(m[5] ?? m[1], h2, min2);
        if (endT === null) return null;
        return { startT, endT };
      },
    );
    if (intervalScan !== null) {
      startCt = intervalScan.value.startT;
      endCt = intervalScan.value.endT;
      claim(claimed, titleSpans, { start: intervalScan.index, end: intervalScan.end }, true);
      expressed.add('startAt');
      expressed.add('endAt');
      expressed.add('allDay');
    }

    // --- 单点时刻（区间未命中时；无自有 meridiem 时套用日期词暗示）---
    let singleCt: CivilTimeOfDay | null = null;
    if (startCt === null) {
      let timeScan = scan(WORD_TIME_RE, trimmed, claimed, convertWordTime);
      if (timeScan === null && compound !== null && dateHint !== null) {
        // 复合日期词“明早/今晚”末位的 早/晚 已被日期槽认领，普通词法时刻
        // （会再次吞掉 早/晚）因 span 重叠被拒；退一步用“裸数字+点”再试，
        // 上下午交给 dateHint 处理。
        timeScan = scan(BARE_WORD_TIME_RE, trimmed, claimed, convertBareWordTime);
      }
      const finalScan =
        timeScan ?? scan(COLON_TIME_RE, trimmed, claimed, convertColonTime);
      if (finalScan !== null) {
        let ct = finalScan.value.ct;
        if (!finalScan.value.hasMeridiem && dateHint !== null) {
          const hinted = applyMeridiem(
            dateHint === 'morning' ? '早上' : '晚上',
            ct.hour,
            ct.minute,
          );
          if (hinted !== null) ct = hinted;
        }
        singleCt = ct;
        claim(claimed, titleSpans, { start: finalScan.index, end: finalScan.end }, true);
        expressed.add('startAt');
        expressed.add('allDay');
      }
    }

    // --- 组装 startAt / endAt / allDay / recurrence ---
    if (recurrenceCore !== null) {
      expressed.add('recurrence');
    }
    let startAt: number | null = null;
    let endAt: number | null = null;
    let allDay = false;
    let recurrence: RecurrenceRule | null = null;

    if (recurrenceCore !== null) {
      const recurrenceCt = startCt ?? singleCt;
      const localTime = recurrenceCt !== null
        ? { hour: recurrenceCt.hour, minute: recurrenceCt.minute }
        : { hour: DEFAULT_RECURRENCE_LOCAL_TIME.hour, minute: DEFAULT_RECURRENCE_LOCAL_TIME.minute };
      if (recurrenceCore.frequency === 'daily') {
        recurrence = { frequency: 'daily', localTime };
      } else if (recurrenceCore.frequency === 'weekly') {
        recurrence = { frequency: 'weekly', weekdays: recurrenceCore.weekdays, localTime };
      } else {
        recurrence = { frequency: 'monthly', dayOfMonth: recurrenceCore.dayOfMonth, localTime };
      }
      startAt = nextOccurrenceInstant(recurrence, now, tzid, today);
      expressed.add('startAt');
      expressed.add('allDay');
    } else if (startCt !== null) {
      const baseDate = date ?? today;
      startAt = resolveTimeOnDate(tzid, baseDate, startCt);
      if (endCt !== null && startAt !== null) {
        const startTotal = startCt.hour * 60 + startCt.minute;
        const endTotal = endCt.hour * 60 + endCt.minute;
        if (endTotal < startTotal) {
          const endBase = addDays(baseDate, endCt.dayShift + 1);
          endAt = resolveCivilTimeToInstant(
            tzid,
            endBase.year,
            endBase.month,
            endBase.day,
            endCt.hour,
            endCt.minute,
          );
        } else if (endTotal > startTotal) {
          endAt = resolveTimeOnDate(tzid, baseDate, endCt);
        }
        // endTotal === startTotal：零长度区间，endAt 保持 null。
      }
    } else if (singleCt !== null) {
      const baseDate = date ?? today;
      startAt = resolveTimeOnDate(tzid, baseDate, singleCt);
    } else if (date !== null) {
      startAt = resolveCivilTimeToInstant(tzid, date.year, date.month, date.day, 0, 0);
      allDay = true;
      expressed.add('startAt');
      expressed.add('allDay');
    }

    // --- 分类 / 优先级 / 类型（仅判定，不裁剪标题）---
    let categoryId: string | null = null;
    for (const rule of CATEGORY_RULES) {
      if (rule.re.test(trimmed)) {
        categoryId = rule.id;
        break;
      }
    }

    let priority: number | null = null;
    for (const rule of PRIORITY_RULES) {
      if (rule.re.test(trimmed)) {
        priority = rule.value;
        break;
      }
    }

    let type: ParsedItemType = 'note';
    const isEvent = EVENT_WORDS_RE.test(trimmed) || startCt !== null;
    const isTask =
      TASK_WORDS_RE.test(trimmed) || reminderOffsetMinutes !== null || reminderDelayMinutes !== null;
    if (isEvent) {
      type = 'event';
    } else if (isTask) {
      type = 'task';
    }
    if (categoryId !== null) expressed.add('categoryId');
    if (priority !== null) expressed.add('priority');
    if (type !== 'note') expressed.add('type');

    const built = buildTitle(trimmed, titleSpans);
    if (built.expressed) expressed.add('title');

    return {
      draft: {
        title: built.title,
        content: '',
        type,
        startAt,
        endAt,
        allDay,
        categoryId,
        tags,
        priority,
        recurrence,
        reminderOffsetMinutes,
        reminderDelayMinutes,
      },
      expressed,
    };
  }
}
