/**
 * 切片 26 阶段 1（AGENTS.md §7.38 AI 透明度）：AI 用量快照与展示行格式化。
 *
 * usage 传输边界（ai.md v0.20 变更记录，冻结）：快照取自 chat-completions
 * 信封（非模型 JSON），经 OpenAICompatibleProvider.lastUsage 副通道暴露、
 * FlashTurnResult 域内字段携带到 hook；不进入 ParsedItemDraft、不进入
 * history JSON、不触碰 RemoteDraftWire/isRemoteDraftWire。
 * AiParser.parse 冻结签名与返回类型不变。
 *
 * 兼容性：信封 usage 字段各家形态有差异（如 prompt_tokens_details 缺失）——
 * reader 全程 defensive（unknown 收窄，禁 any），任何形状偏差整体回退 null，
 * 不炸解析主链；展示段缺失自动省略。
 */

/** 单轮用量快照；段缺失为 null，由 formatAiUsageLine 自动省略该段。 */
export interface AiUsageSnapshot {
  /** 信封 usage.prompt_tokens（输入 tokens）。 */
  promptTokens: number;
  /** 信封 usage.completion_tokens（输出 tokens）。 */
  completionTokens: number;
  /** 信封 usage.prompt_tokens_details.cached_tokens（缓存命中数）；缺省/无效 → null。 */
  cachedPromptTokens: number | null;
  /**
   * 按配置单价估算的费用（元）；单价未配齐 → null。
   * deepseek 平台为峰谷分层估算（阶段 2b，v0.21）；其余平台为全价上界（v0.20）。
   */
  estimatedCost: number | null;
}

/** 每百万 tokens 单价；null = 未配置（或非正数被丢弃）。 */
export interface AiUsagePrices {
  input: number | null;
  output: number | null;
}

/**
 * DeepSeek 峰谷分层单价（元/百万 tokens，阶段 2b / v0.21）。
 * 仅 platform === 'deepseek' 时由 provider 传入；三段（缓存命中/未命中/输出）
 * 各按当前时段取价，非零 token 段缺价 → estimatedCost null。
 */
export interface AiDeepSeekTierPrices {
  /** 输入·缓存命中·高峰。 */
  cachedPeak: number | null;
  /** 输入·缓存命中·空闲。 */
  cachedOffPeak: number | null;
  /** 输入·缓存未命中·高峰。 */
  uncachedPeak: number | null;
  /** 输入·缓存未命中·空闲。 */
  uncachedOffPeak: number | null;
  /** 输出·高峰。 */
  outputPeak: number | null;
  /** 输出·空闲。 */
  outputOffPeak: number | null;
}

/**
 * DeepSeek 高峰时段判定（阶段 2b，官方口径）：北京时间周一至周五 9:00–12:00、
 * 14:00–18:00 为高峰；其余（含周末与法定节假日——节假日表不做，已知限制记
 * ai.md v0.21）为空闲。北京时间为固定 UTC+8（Asia/Shanghai 无夏令时）。
 * 边界：[9:00,12:00) 与 [14:00,18:00) 左闭右开。
 */
export function isPeakBeijing(now: number): boolean {
  const beijing = new Date(now + 8 * 60 * 60 * 1000);
  const day = beijing.getUTCDay();
  if (day < 1 || day > 5) {
    return false;
  }
  const minuteOfDay = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
  return (minuteOfDay >= 540 && minuteOfDay < 720) || (minuteOfDay >= 840 && minuteOfDay < 1080);
}

/** 有限正数 → 原值；否则 null（「非正数丢弃」守卫语义的单一实现）。 */
export function positivePriceOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

interface UsageEnvelopeShape {
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number | null;
}

/**
 * 信封 usage 的 defensive 校验与提取（全价/分层两条 reader 共用）：
 * - usage 缺失（非对象）→ null；
 * - prompt_tokens / completion_tokens 非有限数值或为负 → null；
 * - prompt_tokens_details 存在但非对象 → null；cached_tokens 非有限数值、
 *   为负或越界（> prompt_tokens）→ null；details/cached 缺省或 null → 该段省略。
 */
function readUsageEnvelope(envelope: unknown): UsageEnvelopeShape | null {
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    return null;
  }
  const usage = (envelope as { usage?: unknown }).usage;
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) {
    return null;
  }
  const u = usage as Record<string, unknown>;
  if (!isFiniteNumber(u.prompt_tokens) || !isFiniteNumber(u.completion_tokens)) {
    return null;
  }
  const promptTokens = u.prompt_tokens;
  const completionTokens = u.completion_tokens;
  if (promptTokens < 0 || completionTokens < 0) {
    return null;
  }
  let cachedPromptTokens: number | null = null;
  const details = (u as { prompt_tokens_details?: unknown }).prompt_tokens_details;
  if (details !== undefined && details !== null) {
    if (typeof details !== 'object' || Array.isArray(details)) {
      return null;
    }
    const cached = (details as { cached_tokens?: unknown }).cached_tokens;
    if (cached !== undefined && cached !== null) {
      if (!isFiniteNumber(cached) || cached < 0 || cached > promptTokens) {
        return null;
      }
      cachedPromptTokens = cached;
    }
  }
  return { promptTokens, completionTokens, cachedPromptTokens };
}

function roundCost(raw: number): number {
  return Math.round(raw * 1_000_000) / 1_000_000;
}

/**
 * 全价上界估算（ai.md v0.20）：两单价齐备（非 null）→ 输入×in + 输出×out
 * （÷1e6，round 6 位）；任一单价缺失 → null（展示只出 token 段）。
 */
function estimateFlatCost(
  promptTokens: number,
  completionTokens: number,
  prices: AiUsagePrices,
): number | null {
  if (prices.input === null || prices.output === null) {
    return null;
  }
  return roundCost((promptTokens * prices.input + completionTokens * prices.output) / 1_000_000);
}

/**
 * defensive 读取 chat-completions 信封 usage（切片 26 / §7.38，全价上界路径）：
 * estimatedCost = 输入×in/1e6 + 输出×out/1e6（round 6 位，不区分缓存折扣）。
 */
export function readAiUsageSnapshot(
  envelope: unknown,
  prices: AiUsagePrices,
): AiUsageSnapshot | null {
  const shape = readUsageEnvelope(envelope);
  if (shape === null) {
    return null;
  }
  return {
    ...shape,
    estimatedCost: estimateFlatCost(shape.promptTokens, shape.completionTokens, prices),
  };
}

/**
 * DeepSeek 峰谷分层估算（阶段 2b / v0.21）：输入段拆缓存命中 + 未命中两截，
 * 各按 isPeakBeijing(now) 取价。逐段规则——非零 token 段必须有其档位单价，
 * 缺价 → estimatedCost null（只出 token 段）；cached_tokens 缺省（null）时
 * 输入段全按未命中价计（保持「上界」语义，缓存段照旧省略）。
 */
export function readAiUsageSnapshotTiered(
  envelope: unknown,
  prices: AiDeepSeekTierPrices,
  now: number,
): AiUsageSnapshot | null {
  const shape = readUsageEnvelope(envelope);
  if (shape === null) {
    return null;
  }
  const peak = isPeakBeijing(now);
  const cachedPrice = peak ? prices.cachedPeak : prices.cachedOffPeak;
  const uncachedPrice = peak ? prices.uncachedPeak : prices.uncachedOffPeak;
  const outputPrice = peak ? prices.outputPeak : prices.outputOffPeak;
  const cachedAmount = shape.cachedPromptTokens ?? 0;
  const uncachedAmount = shape.promptTokens - cachedAmount;
  let raw = 0;
  if (cachedAmount > 0) {
    if (cachedPrice === null) {
      return { ...shape, estimatedCost: null };
    }
    raw += cachedAmount * cachedPrice;
  }
  if (uncachedAmount > 0) {
    if (uncachedPrice === null) {
      return { ...shape, estimatedCost: null };
    }
    raw += uncachedAmount * uncachedPrice;
  }
  if (shape.completionTokens > 0) {
    if (outputPrice === null) {
      return { ...shape, estimatedCost: null };
    }
    raw += shape.completionTokens * outputPrice;
  }
  return { ...shape, estimatedCost: roundCost(raw / 1_000_000) };
}

/**
 * 用量行文本合成（消息尾追加形态）：`📊 用量：输入 123 tokens（缓存 45）·
 * 输出 67 · ≈0.001234`；cachedPromptTokens / estimatedCost 为 null 的段自动
 * 省略。费用恒 6 位小数显示（快照内已 round 到 6 位）。
 */
export function formatAiUsageLine(snapshot: AiUsageSnapshot): string {
  const inputSegment =
    snapshot.cachedPromptTokens === null
      ? `输入 ${snapshot.promptTokens} tokens`
      : `输入 ${snapshot.promptTokens} tokens（缓存 ${snapshot.cachedPromptTokens}）`;
  const segments = [inputSegment, `输出 ${snapshot.completionTokens}`];
  if (snapshot.estimatedCost !== null) {
    segments.push(`≈${snapshot.estimatedCost.toFixed(6)}`);
  }
  return `📊 用量：${segments.join(' · ')}`;
}
