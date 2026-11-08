/**
 * 卡片/月历 chip 的分类色条取色（切片 14 阶段 5b 提取公共，plan/search/月历共用）：
 * - 合法分类色：'#RRGGBB' 六位十六进制（数据异常回退约定 repository.md v0.14）；
 * - 回退色 CARD_STRIPE_FALLBACK='#DDDDDD'（原 plan.tsx 视觉约定，语义不变）。
 */

export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const CARD_STRIPE_FALLBACK = '#DDDDDD';

/** 取分类色条颜色：合法 '#RRGGBB' 原样返回，否则回退灰。 */
export function stripeColorOf(color: string | null | undefined): string {
  return color && HEX_COLOR_PATTERN.test(color) ? color : CARD_STRIPE_FALLBACK;
}
