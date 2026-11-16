/**
 * 切片 15 阶段 1：AI Provider 配置的领域契约与存储接口。
 *
 * §7.24：API Key 必须存 expo-secure-store，严禁明文写入 WatermelonDB。
 * 分层：domain 只定义纯数据形状、JSON 守卫与 AiConfigStore 接口；
 * SecureStore 实现在 src/data/SecureAiConfigStore.ts（阶段 3 编排层注入）。
 */

import { positivePriceOrNull } from './usage';

/**
 * AI 平台标识（阶段 2b / v0.21）：预设平台 + 自定义。
 * undefined / 'custom' 均按自定义平台消费（全价上界两价字段）；
 * 'deepseek' 消费峰谷分层六价字段。
 */
export type AiPlatform = 'deepseek' | 'volcano' | 'bailian' | 'xiaomi' | 'custom';

/** 平台预设（BaseURL / 常用 Model，供设置页 UI 下拉与预填；domain 只放数据）。 */
export interface AiPlatformPreset {
  /** UI 展示名。 */
  label: string;
  /** 预设 BaseURL（OpenAI 兼容格式）；空串 = 暂无公开端点（占位），不预填。 */
  baseURL: string;
  /** 常用 Model 预设（点选填入输入框；输入框始终可自由编辑）。 */
  models: string[];
}

/**
 * 平台预设表（阶段 2b）。deepseek 按官方价格页口径（api-docs.deepseek.com
 * pricing，2026-11）：BASE URL (OpenAI 格式) https://api.deepseek.com；
 * 火山方舟/百炼为各自 OpenAI 兼容端点；小米暂无公开 OpenAI 兼容端点，占位。
 */
export const AI_PLATFORM_PRESETS: Record<AiPlatform, AiPlatformPreset> = {
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
  },
  volcano: {
    label: '火山方舟（豆包）',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seed-1-6', 'doubao-1.5-pro-32k'],
  },
  bailian: {
    label: '阿里云百炼',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
  },
  xiaomi: {
    label: '小米（占位）',
    baseURL: '',
    models: [],
  },
  custom: {
    label: '自定义',
    baseURL: '',
    models: [],
  },
};

export const AI_PLATFORM_IDS = Object.keys(AI_PLATFORM_PRESETS) as AiPlatform[];

/** 当前仅支持 OpenAI 兼容端点；为未来官方代理预留 provider 字段扩展。 */
export interface AiProviderConfig {
  provider: 'openai-compatible';
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 请求超时毫秒；缺省由 Provider 决定（20000） */
  timeoutMs?: number;
  /**
   * 每百万 tokens 输入/输出单价（切片 26 / §7.38，可选；正数才有效）。
   * 旧 JSON 缺键容忍；非正数/非数值在守卫里丢弃为 undefined，不整包拒绝。
   * 两价齐备且为正数时按全价上界估算费用（不区分缓存折扣）。
   * platform === 'deepseek' 时改用下方峰谷分层六价（阶段 2b / v0.21），
   * 本两价保留为非 deepseek 平台的全价上界口径。
   */
  priceInputPerMillion?: number;
  priceOutputPerMillion?: number;
  /**
   * 平台标识（阶段 2b / v0.21，可选）；缺省/无效值丢弃为 undefined（等价 custom）。
   */
  platform?: AiPlatform;
  /**
   * DeepSeek 峰谷分层单价（元/百万 tokens，可选；正数才有效）——
   * 缓存命中/缓存未命中/输出 × 高峰/空闲 六档。非正数丢弃为 undefined，
   * 不整包拒绝；仅 platform === 'deepseek' 时参与估算。
   */
  priceCachedPeak?: number;
  priceCachedOffPeak?: number;
  priceUncachedPeak?: number;
  priceUncachedOffPeak?: number;
  priceOutputPeak?: number;
  priceOutputOffPeak?: number;
}

/** SecureStore 单键存储的顶层形状（键名见 AI_CONFIG_STORE_KEY）。 */
export interface AiConfig {
  /** null = 未配置 Key（此时编排层应直接走 LocalFallbackProvider）。
   * 阶段 2c（v0.22）语义收窄：恒等于 slots[activePlatform] ?? null。 */
  active: AiProviderConfig | null;
  /**
   * 阶段 2c（v0.22）：每平台独立配置槽——BaseURL/Key/Model/单价按平台各自
   * 保存；切换平台 chip 只切换编辑视图，「保存配置」写入对应槽并激活。
   * 旧 JSON（v1，无此键）由 isAiConfig 归一化：active 按其 platform 归槽。
   */
  slots?: Record<AiPlatform, AiProviderConfig | null>;
  /** 阶段 2c（v0.22）：正在使用的平台（保存即激活）。 */
  activePlatform?: AiPlatform;
}

/** 全空槽（阶段 2c）：未配置任何平台时的初始形状。工厂函数防外部突变共享引用。 */
export function createEmptyAiSlots(): Record<AiPlatform, AiProviderConfig | null> {
  return { deepseek: null, volcano: null, bailian: null, xiaomi: null, custom: null };
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
  if (value.timeoutMs !== undefined) {
    if (
      typeof value.timeoutMs !== 'number' ||
      !Number.isInteger(value.timeoutMs) ||
      value.timeoutMs <= 0
    ) {
      return null;
    }
  }
  return {
    provider: 'openai-compatible',
    baseUrl: value.baseUrl,
    apiKey: value.apiKey,
    model: value.model,
    timeoutMs: value.timeoutMs,
    // 切片 26（§7.38）：单价透传——非正数/非数值丢弃为 undefined，不整包拒绝
    //（若作必填强校验，旧版本写入的配置会让整条 AI 配置失效）。
    priceInputPerMillion: positivePriceOrNull(value.priceInputPerMillion) ?? undefined,
    priceOutputPerMillion: positivePriceOrNull(value.priceOutputPerMillion) ?? undefined,
    // 阶段 2b（v0.21）：平台标识——不在集合内的值丢弃为 undefined（等价
    // custom，消费侧全价上界路径），不整包拒绝。
    platform:
      typeof value.platform === 'string' &&
      (AI_PLATFORM_IDS as string[]).includes(value.platform)
        ? (value.platform as AiPlatform)
        : undefined,
    // 阶段 2b（v0.21）：DeepSeek 峰谷分层六价——同「非正数丢弃」口径。
    priceCachedPeak: positivePriceOrNull(value.priceCachedPeak) ?? undefined,
    priceCachedOffPeak: positivePriceOrNull(value.priceCachedOffPeak) ?? undefined,
    priceUncachedPeak: positivePriceOrNull(value.priceUncachedPeak) ?? undefined,
    priceUncachedOffPeak: positivePriceOrNull(value.priceUncachedOffPeak) ?? undefined,
    priceOutputPeak: positivePriceOrNull(value.priceOutputPeak) ?? undefined,
    priceOutputOffPeak: positivePriceOrNull(value.priceOutputOffPeak) ?? undefined,
  };
}

/** 运行时守卫：AiConfig 顶层形状（阶段 2c 升级为归一化）。
 *
 * - v2 新格式（slots/activePlatform 显式存在）：逐槽校验（null 或有效 config），
 *   activePlatform 必须在集合内，active 按 slots[activePlatform] 重算（不变式：
 *   active === slots[activePlatform] ?? null）。损坏一律 null（视为未配置）。
 * - v1 旧格式（无 slots 键）：active 迁移归槽——按其 platform（缺省 custom）
 *   放入对应槽，其余槽 null，activePlatform = 该平台。 */
export function isAiConfig(value: unknown): AiConfig | null {
  if (!isRecord(value)) return null;
  if (!('active' in value)) return null;

  if ('slots' in value || 'activePlatform' in value) {
    const rawSlots = value.slots;
    if (!isRecord(rawSlots)) return null;
    const slots = createEmptyAiSlots();
    for (const id of AI_PLATFORM_IDS) {
      const slot = rawSlots[id];
      if (slot === undefined || slot === null) {
        slots[id] = null;
        continue;
      }
      const cfg = isAiProviderConfig(slot);
      if (cfg === null) return null;
      slots[id] = cfg;
    }
    const rawPlatform = value.activePlatform;
    if (
      typeof rawPlatform !== 'string' ||
      !(AI_PLATFORM_IDS as string[]).includes(rawPlatform)
    ) {
      return null;
    }
    const activePlatform = rawPlatform as AiPlatform;
    return { active: slots[activePlatform], slots, activePlatform };
  }

  if (value.active === null) {
    return { active: null, slots: createEmptyAiSlots(), activePlatform: 'custom' };
  }
  const provider = isAiProviderConfig(value.active);
  if (provider === null) return null;
  const home = provider.platform ?? 'custom';
  const slots = createEmptyAiSlots();
  slots[home] = provider;
  return { active: provider, slots, activePlatform: home };
}

/** 配置存储接口：实现方（data 层）不得在实现里打日志输出 apiKey。 */
export interface AiConfigStore {
  load(): Promise<AiConfig | null>;
  save(config: AiConfig): Promise<void>;
  clear(): Promise<void>;
}
