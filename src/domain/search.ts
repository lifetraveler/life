/**
 * 搜索关键词规范化与 LIKE 转义（纯 TypeScript，不依赖 React Native / WatermelonDB）。
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
