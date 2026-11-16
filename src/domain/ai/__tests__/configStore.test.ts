/**
 * AiConfig 守卫（configStore.ts 的 domain 部分）测试。
 * SecureStore 交互在 src/data/__tests__/SecureAiConfigStore.test.ts。
 */

import {
  createEmptyAiSlots,
  isAiConfig,
  isAiProviderConfig,
} from '../configStore';

const validConfig = {
  provider: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
};

describe('isAiProviderConfig', () => {
  it('接受合法配置（返回校验后的对象）', () => {
    expect(isAiProviderConfig(validConfig)).toEqual(validConfig);
    expect(isAiProviderConfig({ ...validConfig, timeoutMs: 30000 })).not.toBeNull();
  });

  it('拒绝缺字段/错 provider/timeoutMs 非正整数（返回 null）', () => {
    expect(isAiProviderConfig(null)).toBeNull();
    expect(isAiProviderConfig({ ...validConfig, baseUrl: '' })).toBeNull();
    expect(isAiProviderConfig({ ...validConfig, apiKey: '' })).toBeNull();
    expect(isAiProviderConfig({ ...validConfig, model: '' })).toBeNull();
    expect(
      isAiProviderConfig({ ...validConfig, provider: 'azure' }),
    ).toBeNull();
    expect(isAiProviderConfig({ ...validConfig, timeoutMs: 0 })).toBeNull();
    expect(isAiProviderConfig({ ...validConfig, timeoutMs: 1.5 })).toBeNull();
  });

  it('单价（切片 26 / §7.38）：正数透传，非正数/非数值丢弃为 undefined，不整包拒绝', () => {
    expect(
      isAiProviderConfig({
        ...validConfig,
        priceInputPerMillion: 2,
        priceOutputPerMillion: 8,
      }),
    ).toEqual({
      ...validConfig,
      priceInputPerMillion: 2,
      priceOutputPerMillion: 8,
    });
    for (const badPrice of [0, -1, '2', Number.NaN, Number.POSITIVE_INFINITY, null, {}]) {
      const guarded = isAiProviderConfig({
        ...validConfig,
        priceInputPerMillion: badPrice,
        priceOutputPerMillion: badPrice,
      });
      expect(guarded).not.toBeNull();
      expect(guarded?.priceInputPerMillion).toBeUndefined();
      expect(guarded?.priceOutputPerMillion).toBeUndefined();
    }
  });

  it('旧版本 JSON 无单价键：守卫通过，单价为 undefined（向后兼容）', () => {
    expect(isAiProviderConfig(validConfig)).toEqual(validConfig);
    expect(isAiProviderConfig(validConfig)?.priceInputPerMillion).toBeUndefined();
    expect(isAiProviderConfig(validConfig)?.priceOutputPerMillion).toBeUndefined();
  });

  it('平台标识（阶段 2b / v0.21）：集合内透传，集合外/非字符串丢弃为 undefined，不整包拒绝', () => {
    for (const id of ['deepseek', 'volcano', 'bailian', 'xiaomi', 'custom'] as const) {
      expect(isAiProviderConfig({ ...validConfig, platform: id })?.platform).toBe(id);
    }
    for (const bad of ['azure', 'DEEPSEEK', 1, null, {}]) {
      const guarded = isAiProviderConfig({ ...validConfig, platform: bad });
      expect(guarded).not.toBeNull();
      expect(guarded?.platform).toBeUndefined();
    }
    expect(isAiProviderConfig(validConfig)?.platform).toBeUndefined();
  });

  it('DeepSeek 分层六价（阶段 2b / v0.21）：正数透传，非正数/非数值丢弃为 undefined，不整包拒绝', () => {
    const tiered = {
      ...validConfig,
      platform: 'deepseek' as const,
      priceCachedPeak: 0.04,
      priceCachedOffPeak: 0.02,
      priceUncachedPeak: 2,
      priceUncachedOffPeak: 1,
      priceOutputPeak: 8,
      priceOutputOffPeak: 4,
    };
    expect(isAiProviderConfig(tiered)).toEqual(tiered);
    for (const bad of [0, -1, '2', Number.NaN, Number.POSITIVE_INFINITY, null, {}]) {
      const guarded = isAiProviderConfig({
        ...validConfig,
        priceCachedPeak: bad,
        priceCachedOffPeak: bad,
        priceUncachedPeak: bad,
        priceUncachedOffPeak: bad,
        priceOutputPeak: bad,
        priceOutputOffPeak: bad,
      });
      expect(guarded).not.toBeNull();
      expect(guarded?.priceCachedPeak).toBeUndefined();
      expect(guarded?.priceCachedOffPeak).toBeUndefined();
      expect(guarded?.priceUncachedPeak).toBeUndefined();
      expect(guarded?.priceUncachedOffPeak).toBeUndefined();
      expect(guarded?.priceOutputPeak).toBeUndefined();
      expect(guarded?.priceOutputOffPeak).toBeUndefined();
    }
    // 旧 JSON 无六价键：undefined（向后兼容）
    expect(isAiProviderConfig(validConfig)?.priceCachedPeak).toBeUndefined();
    expect(isAiProviderConfig(validConfig)?.priceOutputOffPeak).toBeUndefined();
  });
});

describe('isAiConfig（阶段 2c 归一化）', () => {
  it('v1 旧格式 active=null → 空槽 + custom（未配置状态）', () => {
    expect(isAiConfig({ active: null })).toEqual({
      active: null,
      slots: createEmptyAiSlots(),
      activePlatform: 'custom',
    });
  });

  it('v1 旧格式 active 合法 → 按其 platform 归槽（deepseek）', () => {
    const cfg = { ...validConfig, platform: 'deepseek' };
    const result = isAiConfig({ active: cfg });
    expect(result).not.toBeNull();
    expect(result?.active).toEqual(cfg);
    expect(result?.activePlatform).toBe('deepseek');
    expect(result?.slots?.deepseek).toEqual(cfg);
    expect(result?.slots?.volcano).toBeNull();
    expect(result?.slots?.custom).toBeNull();
  });

  it('v1 旧格式无 platform 键 → 归 custom 槽', () => {
    const result = isAiConfig({ active: validConfig });
    expect(result?.activePlatform).toBe('custom');
    expect(result?.slots?.custom).toEqual(validConfig);
  });

  it('v2 新格式合法 → 透传且 active 按 slots[activePlatform] 重算', () => {
    const deepseekCfg = { ...validConfig, platform: 'deepseek' };
    const slots = { ...createEmptyAiSlots(), deepseek: deepseekCfg };
    const result = isAiConfig({
      active: deepseekCfg,
      slots,
      activePlatform: 'deepseek',
    });
    expect(result?.active).toEqual(deepseekCfg);
    expect(result?.activePlatform).toBe('deepseek');
    expect(result?.slots).toEqual(slots);
  });

  it('v2 新格式 active 与槽不一致 → 以槽为准重算 active', () => {
    const deepseekCfg = { ...validConfig, platform: 'deepseek' };
    const slots = { ...createEmptyAiSlots(), deepseek: deepseekCfg };
    const result = isAiConfig({
      active: validConfig,
      slots,
      activePlatform: 'deepseek',
    });
    expect(result?.active).toEqual(deepseekCfg);
  });

  it('v2 新格式使用中平台槽为 null → active=null', () => {
    const result = isAiConfig({
      active: null,
      slots: createEmptyAiSlots(),
      activePlatform: 'custom',
    });
    expect(result?.active).toBeNull();
    expect(result?.activePlatform).toBe('custom');
  });

  it('v2 新格式损坏（槽配置残缺 / activePlatform 非法 / slots 非对象）→ null', () => {
    expect(
      isAiConfig({
        active: null,
        slots: { ...createEmptyAiSlots(), deepseek: { provider: 'openai-compatible' } },
        activePlatform: 'deepseek',
      }),
    ).toBeNull();
    expect(
      isAiConfig({ active: null, slots: createEmptyAiSlots(), activePlatform: 'azure' }),
    ).toBeNull();
    expect(isAiConfig({ active: null, slots: 'bad', activePlatform: 'custom' })).toBeNull();
    expect(
      isAiConfig({ active: null, slots: createEmptyAiSlots(), activePlatform: 42 }),
    ).toBeNull();
  });

  it('active 残缺时返回 null（走本地降级，不抛错）', () => {
    expect(isAiConfig({ active: { provider: 'openai-compatible' } })).toBeNull();
    expect(isAiConfig({})).toBeNull();
    expect(isAiConfig(null)).toBeNull();
    expect(isAiConfig('config')).toBeNull();
  });
});
