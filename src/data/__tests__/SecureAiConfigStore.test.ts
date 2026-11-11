/**
 * SecureAiConfigStore 测试：mock expo-secure-store，验证 load/save/clear
 * 与损坏数据处理（绝不抛错）。
 */

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { SecureAiConfigStore } from '../SecureAiConfigStore';
import { AI_CONFIG_STORE_KEY } from '../../domain/ai/configStore';

const mockedGetItem = jest.mocked(SecureStore.getItemAsync);
const mockedSetItem = jest.mocked(SecureStore.setItemAsync);
const mockedDeleteItem = jest.mocked(SecureStore.deleteItemAsync);

const storedConfig = {
  provider: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
} as const;

describe('SecureAiConfigStore', () => {
  let store: SecureAiConfigStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new SecureAiConfigStore();
  });

  it('load：键不存在返回 null', async () => {
    mockedGetItem.mockResolvedValue(null);
    await expect(store.load()).resolves.toBeNull();
    expect(mockedGetItem).toHaveBeenCalledWith(AI_CONFIG_STORE_KEY);
  });

  it('load：合法 JSON 返回 AiConfig', async () => {
    mockedGetItem.mockResolvedValue(
      JSON.stringify({ active: storedConfig }),
    );
    const config = await store.load();
    expect(config).toEqual({ active: storedConfig });
  });

  it('load：损坏 JSON 返回 null，不抛错', async () => {
    mockedGetItem.mockResolvedValue('{broken json');
    await expect(store.load()).resolves.toBeNull();
  });

  it('load：形状非法 JSON 返回 null，不抛错', async () => {
    mockedGetItem.mockResolvedValue(JSON.stringify({ active: { foo: 1 } }));
    await expect(store.load()).resolves.toBeNull();
  });

  it('load：SecureStore 底层异常向上冒泡（网络/系统问题不应被吞）', async () => {
    mockedGetItem.mockRejectedValue(new Error('keystore unavailable'));
    await expect(store.load()).rejects.toThrow('keystore unavailable');
  });

  it('save：序列化整个 AiConfig 写入单键', async () => {
    await store.save({ active: storedConfig });
    expect(mockedSetItem).toHaveBeenCalledWith(
      AI_CONFIG_STORE_KEY,
      JSON.stringify({ active: storedConfig }),
    );
  });

  it('save：active 为 null（清除当前 provider）也允许写入', async () => {
    await store.save({ active: null });
    expect(mockedSetItem).toHaveBeenCalledWith(
      AI_CONFIG_STORE_KEY,
      JSON.stringify({ active: null }),
    );
  });

  it('clear：删除单键', async () => {
    await store.clear();
    expect(mockedDeleteItem).toHaveBeenCalledWith(AI_CONFIG_STORE_KEY);
  });
});
