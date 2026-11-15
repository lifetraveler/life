/**
 * 「修改成X点」编辑意图窄规则（tasks/slice-22.md 阶段 3 注记，用户
 * 2026-11-15 确认折叠；AGENTS.md §7.25 纠正交互的降级层补充）。
 *
 * 背景（真机反馈）：保存成功后紧跟着说「修改成7点半吧」，期望改上一条
 * 结果卡的时间，而降级解析是独立逐句正则，把整句当成了新事项标题。
 * 本模块用一条窄规则识别该场景——动宾短语后紧跟日期/时刻表达式才判定为
 * 编辑意图，避免误伤「修改简历下午3点」这类以「修改」开头的正常新事项。
 *
 * 明确的窄（已知限制，记反馈文件）：
 * - 只覆盖「动词+成/为/到/至 + 时间」且时间紧跟动词的句式；「把会议改成
 *   3点」这类动词前带宾语、或「调整说明到下午3点」这类动词与时间间插
 *   名词的改法不识别（落到原解析流程，按新事项处理）；
 * - 「7点半」不带午别按上午解读（07:30）；创建流（非编辑）不支持半点
 *   表达式是既有行为，本切片不顺带扩；
 * - 配置了 AI Key 的远端解析不经过本模块（意图判断交给模型与契约）。
 */

import {
  addOneDay,
  getZonedParts,
  resolveCivilTimeToInstant,
  type CivilDate,
} from '../recurrence/civilTime';

/**
 * 编辑请求解析出的相对时间表达：
 * - dayShift：相对「今天」的民用日偏移（0=今天 1=明天 2=后天 3=大后天），
 *   null=未提日期；
 * - timeOfDay：24 小时制时刻，null=未提时刻。
 */
export interface EditTimeRequest {
  dayShift: number | null;
  timeOfDay: { hour: number; minute: number } | null;
}

/**
 * 编辑意图动词短语（动宾+补语连接词）。注意刻意不含裸「修改」「调整」
 * ——它们常出现在正常事项标题里（如「修改简历」），只有带上
 * 成/为/到/至 连接词（或「修改时间至」整体）才视为编辑意图。
 */
const EDIT_VERB_PATTERN =
  /改成|改到|改为|改至|调成|调到|调为|换到|换成|换为|修改成|修改为|修改到|修改至|修改时间(?:为|成|到|至)|调整(?:成|为|到|至)|更改(?:成|为|到|至)/;

/** 日期/时刻表达式的起始 token（用于校验动词短语后是否紧跟时间）。 */
const TIME_TOKEN_START_PATTERN =
  /^(?:大后天|后天|明天|明早|明晚|今天|今晚|今早|凌晨|早上|上午|中午|下午|晚上|傍晚|[0-9０-９]{1,2}[点时:：])/;

/** 文本是否命中编辑意图：存在动词短语，且其后紧跟日期/时刻表达式。 */
export function matchesEditIntent(text: string): boolean {
  const match = EDIT_VERB_PATTERN.exec(text);
  if (match === null) return false;
  const remainder = text.slice(match.index + match[0].length);
  return TIME_TOKEN_START_PATTERN.test(remainder);
}

/**
 * 从文本解析相对时间表达（动词短语之后的任意位置均可命中，容忍
 * 「吧/啦」等语气词后缀）。
 *
 * 日期优先级：大后天 > 后天 > 明(天/早/晚) > 今(天/晚/早)——按子串包含
 * 关系从具体到宽泛依次判定。
 */
export function parseEditTimeRequest(text: string): EditTimeRequest {
  return {
    dayShift: parseDayShift(text),
    timeOfDay: parseTimeOfDay(text),
  };
}

function parseDayShift(text: string): number | null {
  if (text.includes('大后天')) return 3;
  if (text.includes('后天')) return 2;
  if (text.includes('明天') || text.includes('明早') || text.includes('明晚')) return 1;
  if (text.includes('今天') || text.includes('今晚') || text.includes('今早')) return 0;
  return null;
}

/**
 * 时刻解析。午别映射：下午/晚上/傍晚/今晚 +12（<12 时）；中午 <12 +12；
 * 凌晨 12 点归 0 点；上午/早上/无午别按字面（7点半 → 07:30，上午偏好的
 * 已知简化）。解析结果非法（时>23/分>59）返回 null。
 */
function parseTimeOfDay(text: string): { hour: number; minute: number } | null {
  const pattern =
    /(凌晨|早上|上午|中午|下午|晚上|傍晚|今晚|今早|明早)?\s*([0-9０-９]{1,2})[点时:：]\s*(?:半|([0-9０-９]{1,2})分?)?/;
  const match = pattern.exec(text);
  if (match === null) return null;
  const prefix = match[1];
  let hour = normalizeDigits(match[2] ?? '');
  const rawTail = match[3];
  let minute = match[0].includes('半') ? 30 : rawTail === undefined ? 0 : normalizeDigits(rawTail);
  if (prefix === '下午' || prefix === '晚上' || prefix === '傍晚' || prefix === '今晚') {
    if (hour < 12) hour += 12;
  } else if (prefix === '中午') {
    if (hour < 12) hour += 12;
  } else if (prefix === '凌晨') {
    if (hour === 12) hour = 0;
  }
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** 全角数字转半角；非数字字符原样传入会被 Number 得 NaN，由调用方拦截。 */
function normalizeDigits(raw: string): number {
  const halfWidth = raw.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  return Number(halfWidth);
}

/**
 * 把编辑请求落到目标时刻上，返回新的绝对毫秒时间戳。
 *
 * 语义（任务卡阶段 3 注记）：
 * - 时刻缺省（未提X点）→ 保留目标时刻；日期缺省 → 保留目标日期；
 * - dayShift 用民用日算术（addOneDay 逐日推进），跨 DST 不产生 ±1 小时
 *   漂移；
 * - 目标 startAt 为 null（无时间待办/allDay 走不了本规则）→ 返回 null，
 *   调用方落到原解析流程（按新事项处理）；
 * - 解析出的民用时刻落在春季 gap → 返回 null（调用方同样落到原流程）。
 */
export function resolveEditStartAt(
  request: EditTimeRequest,
  targetStartAt: number | null,
  now: number,
  tzid: string,
): number | null {
  if (
    targetStartAt === null ||
    (request.dayShift === null && request.timeOfDay === null)
  ) {
    return null;
  }
  const targetParts = getZonedParts(targetStartAt, tzid);
  const baseDate: CivilDate =
    request.dayShift !== null
      ? civilAddDays(getZonedParts(now, tzid), request.dayShift)
      : { year: targetParts.year, month: targetParts.month, day: targetParts.day };
  const hour = request.timeOfDay !== null ? request.timeOfDay.hour : targetParts.hour;
  const minute =
    request.timeOfDay !== null ? request.timeOfDay.minute : targetParts.minute;
  return resolveCivilTimeToInstant(
    tzid,
    baseDate.year,
    baseDate.month,
    baseDate.day,
    hour,
    minute,
  );
}

/** 民用日 +n 天（逐日推进，n 为 dayShift 约定的小非负整数）。 */
function civilAddDays(date: CivilDate, days: number): CivilDate {
  let result = date;
  for (let i = 0; i < days; i += 1) {
    result = addOneDay(result);
  }
  return result;
}
