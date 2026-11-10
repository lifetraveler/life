import { PRESET_CATEGORIES } from '../../domain/category';
import { parseHexColor } from '../color';
import { EMOJI_CHOICES, PALETTE_COLORS } from '../visualOptions';

/**
 * 切片 14 阶段 3：视觉配置预设常量单测（src/ui/visualOptions.ts，纯常量模块）。
 * 沿用阶段 2 的测试方案 A：不引入 react-test-renderer，常量直接断言；
 * 色值合法性借助 parseHexColor（阶段 2 已有独立单测）复核。
 * 预置分类默认图标不硬编码两份：直接对齐 domain/category.ts 的 PRESET_CATEGORIES。
 */

describe('PALETTE_COLORS（调色盘预设色）', () => {
  it('数量在 8–10 之间', () => {
    expect(PALETTE_COLORS.length).toBeGreaterThanOrEqual(8);
    expect(PALETTE_COLORS.length).toBeLessThanOrEqual(10);
  });

  it('每一项都可被 parseHexColor 解析（非 null）', () => {
    for (const hex of PALETTE_COLORS) {
      expect(parseHexColor(hex)).not.toBeNull();
    }
  });

  it('包含黑色 #000000（验收 5：工作改黑色背景）与橙色 #FFB74D（验收 6：周报改橙色背景）', () => {
    expect(PALETTE_COLORS).toContain('#000000');
    expect(PALETTE_COLORS).toContain('#FFB74D');
  });

  it('无重复色值', () => {
    expect(new Set(PALETTE_COLORS).size).toBe(PALETTE_COLORS.length);
  });
});

describe('EMOJI_CHOICES（Emoji 选择器预设）', () => {
  it('数量在 20–30 之间', () => {
    expect(EMOJI_CHOICES.length).toBeGreaterThanOrEqual(20);
    expect(EMOJI_CHOICES.length).toBeLessThanOrEqual(30);
  });

  it('全部是非空 string', () => {
    for (const emoji of EMOJI_CHOICES) {
      expect(typeof emoji).toBe('string');
      expect(emoji.length).toBeGreaterThan(0);
    }
  });

  it('无重复', () => {
    expect(new Set(EMOJI_CHOICES).size).toBe(EMOJI_CHOICES.length);
  });

  it('每个预置分类的默认 emoji 都在预设中（对齐 PRESET_CATEGORIES，避免两份硬编码漂移）', () => {
    expect(PRESET_CATEGORIES.length).toBeGreaterThan(0);
    for (const preset of PRESET_CATEGORIES) {
      // §7.22 预置分类均带默认 emoji；先显式断言非 null，失败信息更清晰
      expect(preset.emoji).not.toBeNull();
      expect(EMOJI_CHOICES).toContain(preset.emoji);
    }
  });
});
