/**
 * 切片 15 阶段 1：AiConfigStore 的 SecureStore 实现。
 *
 * §7.24：API Key 存 expo-secure-store（Android Keystore 加密），单键
 * ai_provider_config_v1 存整个 AiConfig JSON。domain 层不 import expo-secure-store，
 * 本文件是 data 层唯一接触点。读出的 JSON 经 isAiConfig 校验，损坏一律返回
 * null（视为未配置，走 LocalFallback），绝不抛错、绝不打日志输出 apiKey。
 */

import * as SecureStore from 'expo-secure-store';
import {
  AI_CONFIG_STORE_KEY,
  isAiConfig,
  type AiConfig,
  type AiConfigStore,
} from '../domain/ai/configStore';

export class SecureAiConfigStore implements AiConfigStore {
  async load(): Promise<AiConfig | null> {
    const raw: string | null = await SecureStore.getItemAsync(AI_CONFIG_STORE_KEY);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isAiConfig(parsed);
    } catch {
      return null;
    }
  }

  async save(config: AiConfig): Promise<void> {
    await SecureStore.setItemAsync(AI_CONFIG_STORE_KEY, JSON.stringify(config));
  }

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(AI_CONFIG_STORE_KEY);
  }
}
