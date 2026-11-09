/**
 * resolveCategoryDotColor 单测（切片 14 阶段 6，任务卡验收 1「categoryColor 取色与默认回退」）：
 * - 合法 #RRGGBB 原样透传（大小写均接受，与快照「原样携带」语义一致）；
 * - null / 非法值回退 WIDGET_DEFAULT_CATEGORY_COLOR = '#9E9E9E'
 *   （与主页卡片色条 AgendaItemCard FALLBACK_BAR_COLOR 同一默认灰）。
 * 期望值独立构造，不反向 import 实现内常量以外的来源。
 */

import {
  resolveCategoryDotColor,
  WIDGET_DEFAULT_CATEGORY_COLOR,
} from '../categoryDot';

describe('WIDGET_DEFAULT_CATEGORY_COLOR', () => {
  it('默认回退色为 #9E9E9E（预置「其他」分类色，任务卡阶段 6 指定）', () => {
    expect(WIDGET_DEFAULT_CATEGORY_COLOR).toBe('#9E9E9E');
  });
});

describe('resolveCategoryDotColor · 取色', () => {
  it('合法 #RRGGBB 原样透传', () => {
    expect(resolveCategoryDotColor('#E57373')).toBe('#E57373');
    expect(resolveCategoryDotColor('#2E7D32')).toBe('#2E7D32');
  });

  it('小写十六进制同样透传（快照原样携带，不改变大小写）', () => {
    expect(resolveCategoryDotColor('#e57373')).toBe('#e57373');
  });
});

describe('resolveCategoryDotColor · 默认回退', () => {
  it('无分类（null）回退 #9E9E9E', () => {
    expect(resolveCategoryDotColor(null)).toBe('#9E9E9E');
  });

  it('非法色值回退 #9E9E9E（3 位缩写 / 8 位带透明 / 具名色 / 空串）', () => {
    expect(resolveCategoryDotColor('#FFF')).toBe('#9E9E9E');
    expect(resolveCategoryDotColor('#E57373FF')).toBe('#9E9E9E');
    expect(resolveCategoryDotColor('red')).toBe('#9E9E9E');
    expect(resolveCategoryDotColor('')).toBe('#9E9E9E');
  });
});
