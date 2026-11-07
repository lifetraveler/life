/**
 * 颜色对比工具（纯 TypeScript，不依赖 React Native；tasks/slice-14.md 阶段 2）。
 *
 * 按传入的背景色（十六进制）自动计算文字颜色（黑色或白色），
 * 采用 WCAG 相对亮度 + 对比度公式：分别计算与黑/白的对比度，取更高者。
 * 判定不引入魔法阈值——对比度相等（L=0.1791…）时取白色，仅影响理论中性灰。
 *
 * 解析失败返回 null，由调用方回退默认样式（repository.md v0.14 数据异常回退约定）。
 */

/** 0–255 的 sRGB 分量 */
export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** 解析 '#RGB' / '#RRGGBB'（大小写不敏感，'#' 可省略）；非法返回 null。 */
export function parseHexColor(hex: string): RgbColor | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match || !match[1]) {
    return null;
  }
  const body = match[1];
  const full = body.length === 3
    ? body
      .split('')
      .map((ch) => ch + ch)
      .join('')
    : body;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** WCAG 相对亮度（sRGB 线性化后按 0.2126/0.7152/0.0722 加权），返回 0–1。 */
export function relativeLuminance(color: RgbColor): number {
  const linearize = (channel: number): number => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * linearize(color.r)
    + 0.7152 * linearize(color.g)
    + 0.0722 * linearize(color.b)
  );
}

/**
 * 背景色 → 文字色：与白/黑对比度取更高者。
 * 无法解析的输入返回 null（调用方回退默认配色，不得自造颜色）。
 */
export function contrastTextColor(hex: string): '#000000' | '#FFFFFF' | null {
  const color = parseHexColor(hex);
  if (!color) {
    return null;
  }
  const luminance = relativeLuminance(color);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  return contrastWithWhite >= contrastWithBlack ? '#FFFFFF' : '#000000';
}
