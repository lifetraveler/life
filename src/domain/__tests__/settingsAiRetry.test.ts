/**
 * ai_retry_max / flash_deleted_card_display 纯函数测试（切片 30 阶段 1，AGENTS.md §7.41）：
 * - parseAiRetryMax：读层防御归一，永不抛错（null/非有限/非整数/越界 → 回退默认 3；
 *   schema v15 该列为 number isOptional——非可选 number 会回填 0 与「关闭」语义混淆）；
 * - validateAiRetryMax：写路径严格校验（0–5 整数，违反抛错）；
 * - isFlashDeletedCardDisplay / FLASH_DELETED_CARD_DISPLAYS：枚举守卫（集合外回退 'mark'）。
 * 纯函数测试不碰数据库；Repository 归一/校验行为见 data/__tests__（同切片先例）。
 */

import {
  AI_RETRY_MAX_LIMIT,
  AI_RETRY_MIN,
  DEFAULT_AI_RETRY_MAX,
  DEFAULT_APP_SETTINGS,
  FLASH_DELETED_CARD_DISPLAYS,
  isFlashDeletedCardDisplay,
  parseAiRetryMax,
  validateAiRetryMax,
} from '../settings';

describe('parseAiRetryMax（读层防御归一，切片 30）', () => {
  it('null / undefined → 回退默认 3（既有行 schema 迁移 isOptional 回填 null）', () => {
    expect(parseAiRetryMax(null)).toBe(3);
    expect(parseAiRetryMax(undefined)).toBe(3);
  });

  it('非有限数（NaN/±Infinity）→ 回退默认', () => {
    expect(parseAiRetryMax(Number.NaN)).toBe(3);
    expect(parseAiRetryMax(Number.POSITIVE_INFINITY)).toBe(3);
    expect(parseAiRetryMax(Number.NEGATIVE_INFINITY)).toBe(3);
  });

  it('非整数（小数）→ 回退默认', () => {
    expect(parseAiRetryMax(2.5)).toBe(3);
    expect(parseAiRetryMax(0.5)).toBe(3);
  });

  it('越界（-1 与 6）→ 回退默认（不 clamp 到边界）', () => {
    expect(parseAiRetryMax(-1)).toBe(3);
    expect(parseAiRetryMax(6)).toBe(3);
  });

  it('合法值原样返回：0（关闭）/1/3/5', () => {
    expect(parseAiRetryMax(0)).toBe(0);
    expect(parseAiRetryMax(1)).toBe(1);
    expect(parseAiRetryMax(3)).toBe(3);
    expect(parseAiRetryMax(5)).toBe(5);
  });

  it('运行时垃圾（绕过类型层喂字符串）→ 回退默认，永不抛错', () => {
    const garbage = ['3', true, {}, []] as unknown as Array<number | null>;
    for (const raw of garbage) {
      expect(parseAiRetryMax(raw)).toBe(DEFAULT_AI_RETRY_MAX);
    }
  });
});

describe('validateAiRetryMax（写路径严格校验，切片 30）', () => {
  it('合法值（0–5 整数）原样返回', () => {
    expect(validateAiRetryMax(0)).toBe(0);
    expect(validateAiRetryMax(1)).toBe(1);
    expect(validateAiRetryMax(3)).toBe(3);
    expect(validateAiRetryMax(5)).toBe(5);
  });

  it('非整数抛错，错误消息含该值', () => {
    expect(() => validateAiRetryMax(2.5)).toThrow('aiRetryMax 必须是整数，收到 2.5');
  });

  it('越界抛错（-1 / 6），错误消息含 0–5 范围', () => {
    expect(() => validateAiRetryMax(-1)).toThrow(
      `aiRetryMax 必须在 ${AI_RETRY_MIN}–${AI_RETRY_MAX_LIMIT} 之间，收到 -1`,
    );
    expect(() => validateAiRetryMax(6)).toThrow(
      `aiRetryMax 必须在 ${AI_RETRY_MIN}–${AI_RETRY_MAX_LIMIT} 之间，收到 6`,
    );
  });

  it('NaN 抛错（Number.isInteger(NaN) === false）', () => {
    expect(() => validateAiRetryMax(Number.NaN)).toThrow('aiRetryMax 必须是整数');
  });
});

describe('isFlashDeletedCardDisplay / FLASH_DELETED_CARD_DISPLAYS（切片 30）', () => {
  it('枚举常量恰好为 mark / remove（canonical 序）', () => {
    expect(FLASH_DELETED_CARD_DISPLAYS).toEqual(['mark', 'remove']);
  });

  it('合法值放行：mark / remove', () => {
    expect(isFlashDeletedCardDisplay('mark')).toBe(true);
    expect(isFlashDeletedCardDisplay('remove')).toBe(true);
  });

  it('集合外值拒绝（运行时垃圾/旧手改库值）→ 守卫 false，读层回退 mark', () => {
    expect(isFlashDeletedCardDisplay('hide')).toBe(false);
    expect(isFlashDeletedCardDisplay('MARK')).toBe(false);
    expect(isFlashDeletedCardDisplay(null)).toBe(false);
    expect(isFlashDeletedCardDisplay(undefined)).toBe(false);
    expect(isFlashDeletedCardDisplay(42)).toBe(false);
  });
});

describe('DEFAULT_APP_SETTINGS（切片 30 兜底）', () => {
  it('aiRetryMax 默认 3、flashDeletedCardDisplay 默认 mark（读层回退语义一致）', () => {
    expect(DEFAULT_APP_SETTINGS.aiRetryMax).toBe(3);
    expect(DEFAULT_APP_SETTINGS.flashDeletedCardDisplay).toBe('mark');
  });
});
