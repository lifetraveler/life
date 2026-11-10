import { contrastTextColor, parseHexColor, relativeLuminance } from '../color';

describe('parseHexColor', () => {
  it('#RRGGBB 六位：大写/小写/混合大小写等价', () => {
    expect(parseHexColor('#aabbcc')).toEqual({ r: 170, g: 187, b: 204 });
    expect(parseHexColor('#AABBCC')).toEqual({ r: 170, g: 187, b: 204 });
    expect(parseHexColor('#aAbBcC')).toEqual({ r: 170, g: 187, b: 204 });
    expect(parseHexColor('#E57373')).toEqual({ r: 229, g: 115, b: 115 });
  });

  it('#RGB 三位等价六位展开（#abc ≡ #aabbcc）', () => {
    expect(parseHexColor('#abc')).toEqual({ r: 170, g: 187, b: 204 });
    expect(parseHexColor('#ABC')).toEqual({ r: 170, g: 187, b: 204 });
    expect(parseHexColor('#f00')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("'#' 可省略", () => {
    expect(parseHexColor('abc')).toEqual({ r: 170, g: 187, b: 204 });
    expect(parseHexColor('E57373')).toEqual({ r: 229, g: 115, b: 115 });
  });

  it('非法输入 → null', () => {
    expect(parseHexColor('')).toBeNull();
    expect(parseHexColor('xyz')).toBeNull();
    expect(parseHexColor('#12')).toBeNull();
    expect(parseHexColor('#1234')).toBeNull();
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('#1234567')).toBeNull();
    expect(parseHexColor('#GGGGGG')).toBeNull();
    expect(parseHexColor('##abc')).toBeNull();
  });
});

describe('relativeLuminance', () => {
  it('黑 = 0，白 = 1（WCAG sRGB 线性化加权）', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBe(1);
  });

  it('中间色落在 0–1 之间', () => {
    const mid = relativeLuminance({ r: 128, g: 128, b: 128 });
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe('contrastTextColor', () => {
  it('已知断言参考（黑底白字 / 白底黑字 / 预置分类色）', () => {
    expect(contrastTextColor('#000000')).toBe('#FFFFFF');
    expect(contrastTextColor('#FFFFFF')).toBe('#000000');
    expect(contrastTextColor('#E57373')).toBe('#000000');
    expect(contrastTextColor('#304FFE')).toBe('#FFFFFF');
    expect(contrastTextColor('#9E9E9E')).toBe('#000000');
  });

  it('解析失败 → null', () => {
    expect(contrastTextColor('#12345')).toBeNull();
    expect(contrastTextColor('xyz')).toBeNull();
    expect(contrastTextColor('')).toBeNull();
  });
});
