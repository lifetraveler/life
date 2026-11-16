/**
 * AiConfig 守卫（configStore.ts 的 domain 部分）测试。
 * SecureStore 交互在 src/data/__tests__/SecureAiConfigStore.test.ts。
 */

import {
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
});

describe('isAiConfig', () => {
  it('active 为 null 合法（未配置状态，返回校验后对象）', () => {
    expect(isAiConfig({ active: null })).toEqual({ active: null });
  });

  it('active 为合法 provider 配置时通过', () => {
    expect(isAiConfig({ active: validConfig })).toEqual({ active: validConfig });
  });

  it('active 残缺时返回 null（走本地降级，不抛错）', () => {
    expect(isAiConfig({ active: { provider: 'openai-compatible' } })).toBeNull();
    expect(isAiConfig({})).toBeNull();
    expect(isAiConfig(null)).toBeNull();
    expect(isAiConfig('config')).toBeNull();
  });
});
