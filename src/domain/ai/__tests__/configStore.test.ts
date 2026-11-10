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
