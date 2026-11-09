/**
 * 小组件分类色点解析（切片 14 阶段 6，AGENTS §7.21「分类颜色点」）：
 * - 快照按契约原样携带 categoryColor（缺失/未设置为 null，snapshot.ts 注释）；
 *   渲染层回退规则与主页卡片色条同一规则（repository.md v0.14「UI 层回退到默认灰色」、
 *   AgendaItemCard FALLBACK_BAR_COLOR）：默认灰 '#9E9E9E'，即预置「其他」分类色
 *   （data-model.md §Category，§7.22）。中灰在小组件亮/暗两套底色上均可辨识；
 * - 放 domain 层（纯 TS）的原因：TodayWidget 依赖 react-native-android-widget 原语，
 *   不便直接单测；回退规则在此处可被 jest 覆盖（任务卡阶段 6 验收 1）。
 */

/** 分类缺失 / 颜色未设置 / 颜色非法时的回退色（任务卡阶段 6 指定默认值）。 */
export const WIDGET_DEFAULT_CATEGORY_COLOR = '#9E9E9E';

/** 与 TodayWidget 渲染校验同源：仅接受 #RRGGBB（6 位十六进制）。 */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * 解析条目色点颜色：合法 #RRGGBB 原样透传；null / 非法值回退默认灰。
 * 返回值恒为合法 HexColor 形态（'#' 前缀），渲染层可安全收窄。
 */
export function resolveCategoryDotColor(categoryColor: string | null): string {
  if (categoryColor !== null && HEX_COLOR_PATTERN.test(categoryColor)) {
    return categoryColor;
  }
  return WIDGET_DEFAULT_CATEGORY_COLOR;
}
