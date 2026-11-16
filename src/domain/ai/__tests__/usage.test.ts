/**
 * 切片 26 阶段 1（AGENTS.md §7.38）：AI 用量快照 reader / 展示行格式化 / 单价守卫测试。
 *
 * 边界（ai.md v0.20 变更记录）：usage 取自 chat-completions 信封（非模型 JSON），
 * defensive 读取——任何形状偏差整体回退 null，不炸解析主链；展示段缺失自动省略。
 */

import {
  formatAiUsageLine,
  isPeakBeijing,
  positivePriceOrNull,
  readAiUsageSnapshot,
  readAiUsageSnapshotTiered,
} from '../usage';
import type { AiDeepSeekTierPrices } from '../usage';

describe('positivePriceOrNull', () => {
  it('有限正数返回原值；0/负数/非数值/NaN/Infinity 返回 null', () => {
    expect(positivePriceOrNull(2)).toBe(2);
    expect(positivePriceOrNull(0.5)).toBe(0.5);
    expect(positivePriceOrNull(0)).toBeNull();
    expect(positivePriceOrNull(-1)).toBeNull();
    expect(positivePriceOrNull('2')).toBeNull();
    expect(positivePriceOrNull(null)).toBeNull();
    expect(positivePriceOrNull(undefined)).toBeNull();
    expect(positivePriceOrNull(Number.NaN)).toBeNull();
    expect(positivePriceOrNull(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('readAiUsageSnapshot', () => {
  const PRICES = { input: 2, output: 8 };
  const fullEnvelope = {
    choices: [{ message: { content: '{}' } }],
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 200,
      prompt_tokens_details: { cached_tokens: 600 },
    },
  };

  it('完整信封 + 两价齐备：tokens/缓存/费用全段（费用 round 到 6 位小数）', () => {
    expect(readAiUsageSnapshot(fullEnvelope, PRICES)).toEqual({
      promptTokens: 1000,
      completionTokens: 200,
      cachedPromptTokens: 600,
      // (1000*2 + 200*8) / 1e6 = 0.0036 → 恰好 6 位内
      estimatedCost: 0.0036,
    });
  });

  it('估算四舍五入：0.0000005 边界 round 到 6 位小数（全价上界，不区分缓存折扣）', () => {
    // (5000*1 + 5000*1) / 1e6 = 0.01；缓存 4000 不参与折扣
    const envelope = {
      usage: {
        prompt_tokens: 5000,
        completion_tokens: 5000,
        prompt_tokens_details: { cached_tokens: 4000 },
      },
    };
    expect(readAiUsageSnapshot(envelope, { input: 1, output: 1 })).toEqual({
      promptTokens: 5000,
      completionTokens: 5000,
      cachedPromptTokens: 4000,
      estimatedCost: 0.01,
    });
  });

  it('单价缺一或全缺：estimatedCost 为 null，token 段照常解析', () => {
    const envelope = { usage: { prompt_tokens: 10, completion_tokens: 5 } };
    expect(readAiUsageSnapshot(envelope, { input: null, output: 8 })?.estimatedCost).toBeNull();
    expect(readAiUsageSnapshot(envelope, { input: 2, output: null })?.estimatedCost).toBeNull();
    expect(readAiUsageSnapshot(envelope, { input: null, output: null })).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      cachedPromptTokens: null,
      estimatedCost: null,
    });
  });

  it('usage 缺失/非对象（含数组）→ null', () => {
    expect(readAiUsageSnapshot({ choices: [] }, PRICES)).toBeNull();
    expect(readAiUsageSnapshot({ usage: null }, PRICES)).toBeNull();
    expect(readAiUsageSnapshot({ usage: '1000' }, PRICES)).toBeNull();
    expect(readAiUsageSnapshot({ usage: [] }, PRICES)).toBeNull();
    expect(readAiUsageSnapshot('string', PRICES)).toBeNull();
    expect(readAiUsageSnapshot(null, PRICES)).toBeNull();
    expect(readAiUsageSnapshot([1, 2], PRICES)).toBeNull();
  });

  it('prompt_tokens / completion_tokens 非有限数值或为负 → null', () => {
    const bad = (usage: unknown): unknown => ({ usage });
    expect(readAiUsageSnapshot(bad({ prompt_tokens: '100', completion_tokens: 5 }), PRICES)).toBeNull();
    expect(readAiUsageSnapshot(bad({ prompt_tokens: 100, completion_tokens: undefined }), PRICES)).toBeNull();
    expect(readAiUsageSnapshot(bad({ prompt_tokens: Number.NaN, completion_tokens: 5 }), PRICES)).toBeNull();
    expect(readAiUsageSnapshot(bad({ prompt_tokens: Number.POSITIVE_INFINITY, completion_tokens: 5 }), PRICES)).toBeNull();
    expect(readAiUsageSnapshot(bad({ prompt_tokens: -1, completion_tokens: 5 }), PRICES)).toBeNull();
    expect(readAiUsageSnapshot(bad({ prompt_tokens: 100, completion_tokens: -5 }), PRICES)).toBeNull();
  });

  it('cached_tokens 缺省/null → 段省略；为 0 保留', () => {
    const base = { prompt_tokens: 100, completion_tokens: 20 };
    expect(readAiUsageSnapshot({ usage: { ...base } }, PRICES)).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      cachedPromptTokens: null,
      estimatedCost: 0.00036,
    });
    expect(
      readAiUsageSnapshot(
        { usage: { ...base, prompt_tokens_details: { cached_tokens: null } } },
        PRICES,
      ),
    ).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      cachedPromptTokens: null,
      estimatedCost: 0.00036,
    });
    expect(
      readAiUsageSnapshot(
        { usage: { ...base, prompt_tokens_details: { cached_tokens: 0 } } },
        PRICES,
      )?.cachedPromptTokens,
    ).toBe(0);
  });

  it('prompt_tokens_details 非对象 / cached_tokens 非数值 / 负数 / 越界(>prompt) → null', () => {
    const base = { prompt_tokens: 100, completion_tokens: 20 };
    expect(
      readAiUsageSnapshot({ usage: { ...base, prompt_tokens_details: 'x' } }, PRICES),
    ).toBeNull();
    expect(
      readAiUsageSnapshot({ usage: { ...base, prompt_tokens_details: [] } }, PRICES),
    ).toBeNull();
    expect(
      readAiUsageSnapshot(
        { usage: { ...base, prompt_tokens_details: { cached_tokens: '600' } } },
        PRICES,
      ),
    ).toBeNull();
    expect(
      readAiUsageSnapshot(
        { usage: { ...base, prompt_tokens_details: { cached_tokens: -1 } } },
        PRICES,
      ),
    ).toBeNull();
    // 越界：cached > prompt_tokens
    expect(
      readAiUsageSnapshot(
        { usage: { ...base, prompt_tokens_details: { cached_tokens: 101 } } },
        PRICES,
      ),
    ).toBeNull();
  });
});

/** 北京时间（UTC+8，无夏令时）民用时刻 → epoch 毫秒（测试判峰边界用）。 */
function atBeijing(year: number, month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(year, month - 1, day, hour, minute) - 8 * 60 * 60 * 1000;
}

describe('isPeakBeijing（阶段 2b：DeepSeek 高峰时段，官方口径）', () => {
  // 2026-11-16 是周一；11-21/11-22 是周六/周日。
  it('工作日窗口 [9:00,12:00) 与 [14:00,18:00) 左闭右开', () => {
    expect(isPeakBeijing(atBeijing(2026, 11, 16, 8, 59))).toBe(false);
    expect(isPeakBeijing(atBeijing(2026, 11, 16, 9, 0))).toBe(true);
    expect(isPeakBeijing(atBeijing(2026, 11, 16, 11, 59))).toBe(true);
    expect(isPeakBeijing(atBeijing(2026, 11, 16, 12, 0))).toBe(false);
    expect(isPeakBeijing(atBeijing(2026, 11, 16, 13, 59))).toBe(false);
    expect(isPeakBeijing(atBeijing(2026, 11, 16, 14, 0))).toBe(true);
    expect(isPeakBeijing(atBeijing(2026, 11, 16, 17, 59))).toBe(true);
    expect(isPeakBeijing(atBeijing(2026, 11, 16, 18, 0))).toBe(false);
  });

  it('周末全天空闲（周六/周日午间也在窗口内仍判空闲）', () => {
    expect(isPeakBeijing(atBeijing(2026, 11, 21, 10, 0))).toBe(false);
    expect(isPeakBeijing(atBeijing(2026, 11, 22, 15, 0))).toBe(false);
  });

  it('法定节假日不做识别（2026-10-01 周四按工作日窗口判高峰）——已知限制，记 ai.md v0.21', () => {
    expect(isPeakBeijing(atBeijing(2026, 10, 1, 10, 0))).toBe(true);
  });
});

describe('readAiUsageSnapshotTiered（阶段 2b：DeepSeek 峰谷分层估算）', () => {
  const FULL: AiDeepSeekTierPrices = {
    cachedPeak: 0.04,
    cachedOffPeak: 0.02,
    uncachedPeak: 2,
    uncachedOffPeak: 1,
    outputPeak: 8,
    outputOffPeak: 4,
  };
  const MON_1000 = atBeijing(2026, 11, 16, 10, 0); // 高峰
  const SAT_1000 = atBeijing(2026, 11, 21, 10, 0); // 空闲
  const envelope = {
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 200,
      prompt_tokens_details: { cached_tokens: 600 },
    },
  };

  it('高峰全价：cached×cachedPeak + uncached×uncachedPeak + output×outputPeak', () => {
    // (600*0.04 + 400*2 + 200*8) / 1e6 = (24 + 800 + 1600) / 1e6 = 0.002424
    expect(readAiUsageSnapshotTiered(envelope, FULL, MON_1000)).toEqual({
      promptTokens: 1000,
      completionTokens: 200,
      cachedPromptTokens: 600,
      estimatedCost: 0.002424,
    });
  });

  it('空闲全价：同信封换空闲档', () => {
    // (600*0.02 + 400*1 + 200*4) / 1e6 = (12 + 400 + 800) / 1e6 = 0.001212
    expect(readAiUsageSnapshotTiered(envelope, FULL, SAT_1000)?.estimatedCost).toBe(0.001212);
  });

  it('cached_tokens 缺省：输入段全按未命中价（上界语义），缓存段照旧省略', () => {
    const noCache = { usage: { prompt_tokens: 1000, completion_tokens: 200 } };
    // 高峰：(1000*2 + 200*8)/1e6 = 0.0036；缓存价不参与（无需配置）
    expect(readAiUsageSnapshotTiered(noCache, { ...FULL, cachedPeak: null, cachedOffPeak: null }, MON_1000)).toEqual({
      promptTokens: 1000,
      completionTokens: 200,
      cachedPromptTokens: null,
      estimatedCost: 0.0036,
    });
  });

  it('cached_tokens = 0：缓存段金额为 0，不要求缓存价', () => {
    const zero = {
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 200,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    };
    expect(
      readAiUsageSnapshotTiered(zero, { ...FULL, cachedPeak: null, cachedOffPeak: null }, MON_1000)
        ?.estimatedCost,
    ).toBe(0.0036);
  });

  it('非零段缺价 → estimatedCost null（token 段照常解析）', () => {
    // 缓存段有量但缓存价缺失
    expect(
      readAiUsageSnapshotTiered(envelope, { ...FULL, cachedPeak: null }, MON_1000)?.estimatedCost,
    ).toBeNull();
    // 未命中段缺价
    expect(
      readAiUsageSnapshotTiered(envelope, { ...FULL, uncachedOffPeak: null }, SAT_1000)
        ?.estimatedCost,
    ).toBeNull();
    // 输出段缺价
    expect(
      readAiUsageSnapshotTiered(envelope, { ...FULL, outputPeak: null }, MON_1000)?.estimatedCost,
    ).toBeNull();
    // 全缺价
    const NONE: AiDeepSeekTierPrices = {
      cachedPeak: null,
      cachedOffPeak: null,
      uncachedPeak: null,
      uncachedOffPeak: null,
      outputPeak: null,
      outputOffPeak: null,
    };
    expect(readAiUsageSnapshotTiered(envelope, NONE, MON_1000)?.estimatedCost).toBeNull();
    expect(readAiUsageSnapshotTiered(envelope, NONE, MON_1000)?.promptTokens).toBe(1000);
  });

  it('全缓存命中（uncached 金额 0）与零输出：对应段缺价不影响估算', () => {
    const fullCache = {
      usage: {
        prompt_tokens: 600,
        completion_tokens: 0,
        prompt_tokens_details: { cached_tokens: 600 },
      },
    };
    // 高峰：600*0.04/1e6 = 0.000024；未命中价缺失不拦截（金额 0）
    expect(
      readAiUsageSnapshotTiered(
        fullCache,
        { ...FULL, uncachedPeak: null, uncachedOffPeak: null, outputPeak: null, outputOffPeak: null },
        MON_1000,
      ),
    ).toEqual({
      promptTokens: 600,
      completionTokens: 0,
      cachedPromptTokens: 600,
      estimatedCost: 0.000024,
    });
  });

  it('信封形状偏差与 v0.20 全价路径一致 → null', () => {
    expect(readAiUsageSnapshotTiered({ usage: [] }, FULL, MON_1000)).toBeNull();
    expect(readAiUsageSnapshotTiered(null, FULL, MON_1000)).toBeNull();
    expect(
      readAiUsageSnapshotTiered(
        { usage: { prompt_tokens: -1, completion_tokens: 5 } },
        FULL,
        MON_1000,
      ),
    ).toBeNull();
  });
});

describe('formatAiUsageLine', () => {
  it('全段：📊 用量：输入 tokens（缓存）· 输出 · ≈费用（6 位小数）', () => {
    expect(
      formatAiUsageLine({
        promptTokens: 123,
        completionTokens: 67,
        cachedPromptTokens: 45,
        estimatedCost: 0.001234,
      }),
    ).toBe('📊 用量：输入 123 tokens（缓存 45） · 输出 67 · ≈0.001234');
  });

  it('段缺失自动省略：无缓存 / 无费用 / 全缺三种形态', () => {
    expect(
      formatAiUsageLine({
        promptTokens: 123,
        completionTokens: 67,
        cachedPromptTokens: null,
        estimatedCost: 0.001234,
      }),
    ).toBe('📊 用量：输入 123 tokens · 输出 67 · ≈0.001234');
    expect(
      formatAiUsageLine({
        promptTokens: 123,
        completionTokens: 67,
        cachedPromptTokens: 45,
        estimatedCost: null,
      }),
    ).toBe('📊 用量：输入 123 tokens（缓存 45） · 输出 67');
    expect(
      formatAiUsageLine({
        promptTokens: 123,
        completionTokens: 67,
        cachedPromptTokens: null,
        estimatedCost: null,
      }),
    ).toBe('📊 用量：输入 123 tokens · 输出 67');
  });
});
