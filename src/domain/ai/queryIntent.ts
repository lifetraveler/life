/**
 * 切片 36（§7.48 / 提案 D1）：闪电录入查询意图本地预路由。
 *
 * 保守策略：宁可漏判不可误判——漏判走录入分支（用户可重述），
 * 误判把录入当查询代价高。判定顺序：先查排除表（录入/编辑动词），
 * 再查疑问表；两表都不含 → false（照常走解析）。
 * 澄清待补轮（如「下午2点」）不含疑问词，天然不冲突。
 */

/**
 * 显式排除表：命中即非查询（录入/编辑动词）。
 * 「改成/改到/推迟」等编辑动词开头或中途出现时，即便句中含疑问词
 * （如「改到周二的话还有什么」）也不判查询。
 */
export const SCHEDULE_QUERY_EXCLUDE_WORDS: readonly string[] = [
  '帮我记',
  '帮我安排',
  '提醒我',
  '改成',
  '改到',
  '加一个',
  '新增',
  '推迟',
];

/**
 * 强疑问信号：命中即查询。
 * 「安排了」「预约了」不在本表——其后是否带明确事由名词需短语级
 * 正则（见 TAIL_VERB_PATTERNS），不做分词。
 */
export const SCHEDULE_QUERY_HINT_WORDS: readonly string[] = [
  '什么',
  '哪些',
  '有没有',
  '忙不忙',
  '空吗',
  '有空吗',
  '几号',
  '周几',
  '星期几',
  '查一下',
  '看看我',
  '提醒过我',
];

/**
 * 「安排了 / 预约了」短语级正则：仅当其后无明确事由名词时命中——
 * 正向环视放行句尾、标点/空白或语气助词（吗/呢/没）；其余汉字/字母/
 * 数字（事由名词开头）拒绝。
 * 例：「周六安排了吗」「这个月安排了」命中；「周六安排了体检」不命中。
 * （初版负向环视 (?![汉字字母数字]) 把 吗/呢/没 一并挡住——它们本身
 * 属汉字区，须改为正向环视白名单放行。）
 */
const TAIL_VERB_PATTERNS: readonly RegExp[] = [
  /安排了(?=$|[^\u4e00-\u9fa5A-Za-z0-9]|[吗呢没])/u,
  /预约了(?=$|[^\u4e00-\u9fa5A-Za-z0-9]|[吗呢没])/u,
];

/**
 * 查询意图预判（纯函数）。空输入恒 false（调用方 send() 已 trim 拦空，
 * 此处兜底防误路由）。
 */
export function matchesScheduleQueryIntent(input: string): boolean {
  const text = input.trim();
  if (text.length === 0) {
    return false;
  }
  for (const word of SCHEDULE_QUERY_EXCLUDE_WORDS) {
    if (text.includes(word)) {
      return false;
    }
  }
  for (const word of SCHEDULE_QUERY_HINT_WORDS) {
    if (text.includes(word)) {
      return true;
    }
  }
  for (const pattern of TAIL_VERB_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}
