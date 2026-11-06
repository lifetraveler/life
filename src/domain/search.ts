/**
 * 搜索关键词规范化与 LIKE 转义、日期片段识别与格式化日期匹配
 * （纯 TypeScript，不依赖 React Native / WatermelonDB）。
 *
 * 对应 AGENTS.md §4.9：
 * - 关键词先 trim；空字符串或纯空白由调用方判定为"无关键词"（searchItems 返回 []）。
 * - 关键词中的 `%`、`_`、`\` 必须转义后再用于 Q.like，不得直接拼接原始关键词。
 *
 * 转义约定：在 `%`、`_`、`\` 前插入反斜杠（`\%`、`\_`、`\\`）。
 * 注意：WatermelonDB 0.28 将 Q.like 编译为不带 ESCAPE 子句的裸 SQLite LIKE
 * （src/adapters/sqlite/encodeQuery/index.js 的 like: 'like'），因此本转义的
 * 实际效果是"特殊字符关键词既不报错、也不会扩大成全表匹配"，而非对字面
 * %/_/\ 内容的精确命中——该差异已在切片 3 报告中披露。
 */

// v0.12（切片 12）：格式化日期复用冻结区 src/domain/recurrence/civilTime.ts 的
// 只读导出（不修改该目录；先例：src/ui/timeFormat.ts 对同一模块的只读 import）。
import { formatLocalDate, getZonedParts } from './recurrence/civilTime';

/** LIKE 通配符与转义符：%、_、\ */
const LIKE_SPECIALS = /[\\%_]/g;

/**
 * 规范化搜索关键词：仅 trim，不做大小写折叠。
 * 大小写不敏感匹配由 SQLite LIKE 的 ASCII 不敏感语义提供（中文无大小写，不受影响）。
 * 返回空串表示"无有效关键词"，调用方应直接返回空结果。
 */
export function normalizeSearchKeyword(rawKeyword: string): string {
  return rawKeyword.trim();
}

/**
 * LIKE 转义纯函数：把 `\`、`%`、`_` 逐一变为 `\%` 形式（先转义 `\` 本身，
 * 再转义通配符，避免二次转义破坏已转义序列）。其余字符（含中文）原样保留。
 */
export function escapeLikePattern(raw: string): string {
  return raw.replace(LIKE_SPECIALS, '\\$&');
}

// —— v0.12（切片 12）：日期片段识别与格式化日期匹配 ——

/**
 * 日期片段形态：整个关键词（trim 后）必须完整匹配其一，不做内嵌识别。
 * 月/日均须零填充两位，`-` 分隔：
 * - YYYY        如 2026       → 匹配该年任意日期
 * - YYYY-MM     如 2026-11    → 匹配该月任意日期
 * - YYYY-MM-DD  如 2026-11-05 → 匹配当天
 * - MM-DD       如 11-05      → 匹配任意年份的当天
 */
const FULL_YEAR_PATTERN = /^\d{4}$/;
const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const FULL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_DAY_PATTERN = /^(\d{2})-(\d{2})$/;

function isValidMonthSegment(segment: string): boolean {
  const value = Number(segment);
  return value >= 1 && value <= 12;
}

function isValidDaySegment(segment: string): boolean {
  const value = Number(segment);
  return value >= 1 && value <= 31;
}

/**
 * 识别搜索关键词是否为日期片段（repository.md v0.12 搜索范围扩展）：
 * 仅当整个关键词是上述四种形态之一（月 01-12、日 01-31）时返回该片段，
 * 否则返回 null——调用方完全不触发日期匹配路径，搜索行为与 v0.11 一致。
 * 非法或非片段关键词（如 13-01、2026-00、2026/11、「周会 2026-11」）一律
 * 返回 null，交回普通 LIKE 文本匹配。
 */
export function extractDateFragment(rawKeyword: string): string | null {
  const keyword = rawKeyword.trim();
  if (FULL_YEAR_PATTERN.test(keyword)) {
    return keyword;
  }
  const yearMonth = YEAR_MONTH_PATTERN.exec(keyword);
  if (yearMonth !== null && isValidMonthSegment(yearMonth[2] ?? '')) {
    return keyword;
  }
  const fullDate = FULL_DATE_PATTERN.exec(keyword);
  if (
    fullDate !== null &&
    isValidMonthSegment(fullDate[2] ?? '') &&
    isValidDaySegment(fullDate[3] ?? '')
  ) {
    return keyword;
  }
  const monthDay = MONTH_DAY_PATTERN.exec(keyword);
  if (
    monthDay !== null &&
    isValidMonthSegment(monthDay[1] ?? '') &&
    isValidDaySegment(monthDay[2] ?? '')
  ) {
    return keyword;
  }
  return null;
}

/**
 * 绝对时刻的格式化日期（tzid 时区，'YYYY-MM-DD'）是否包含日期片段（子串匹配）。
 * instant 为 null（未安排 / 无结束时间）不命中。tzid 必须显式传入（§4.13 精神），
 * 不读系统本地时区、不依赖 process.env.TZ。
 */
export function matchesDateFragment(
  instant: number | null,
  fragment: string,
  tzid: string,
): boolean {
  if (instant === null) {
    return false;
  }
  return formatLocalDate(getZonedParts(instant, tzid)).includes(fragment);
}
