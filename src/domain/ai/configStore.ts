/**
 * 切片 15 阶段 1：AI Provider 配置的领域契约与存储接口。
 *
 * §7.24：API Key 必须存 expo-secure-store，严禁明文写入 WatermelonDB。
 * 分层：domain 只定义纯数据形状、JSON 守卫与 AiConfigStore 接口；
 * SecureStore 实现在 src/data/SecureAiConfigStore.ts（阶段 3 编排层注入）。
 */

/** 当前仅支持 OpenAI 兼容端点；为未来官方代理预留 provider 字段扩展。 */
export interface AiProviderConfig {
  provider: 'openai-compatible';
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 请求超时毫秒；缺省由 Provider 决定（20000） */
  timeoutMs?: number;
}

/** SecureStore 单键存储的顶层形状（键名见 AI_CONFIG_STORE_KEY）。 */
export interface AiConfig {
  /** null = 未配置 Key（此时编排层应直接走 LocalFallbackProvider） */
  active: AiProviderConfig | null;
}

export const AI_CONFIG_STORE_KEY = 'ai_provider_config_v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 运行时守卫：SecureStore 读出的 JSON 必须通过校验才可信（损坏视为无配置）。 */
export function isAiProviderConfig(value: unknown): AiProviderConfig | null {
  if (!isRecord(value)) return null;
  if (value.provider !== 'openai-compatible') return null;
  if (typeof value.baseUrl !== 'string' || value.baseUrl.length === 0) return null;
  if (typeof value.apiKey !== 'string' || value.apiKey.length === 0) return null;
  if (typeof value.model !== 'string' || value.model.length === 0) return null;
  if (value.timeoutMs !== undefined && typeof value.timeoutMs !== 'number') return null;
  return {
    provider: 'openai-compatible',
    baseUrl: value.baseUrl,
    apiKey: value.apiKey,
    model: value.model,
    timeoutMs: value.timeoutMs,
  };
}

/** 运行时守卫：AiConfig 顶层形状。 */
export function isAiConfig(value: unknown): AiConfig | null {
  if (!isRecord(value)) return null;
  if (!('active' in value)) return null;
  if (value.active === null) return { active: null };
  const provider = isAiProviderConfig(value.active);
  return provider === null ? null : { active: provider };
}

/** 配置存储接口：实现方（data 层）不得在实现里打日志输出 apiKey。 */
export interface AiConfigStore {
  load(): Promise<AiConfig | null>;
  save(config: AiConfig): Promise<void>;
  clear(): Promise<void>;
}
