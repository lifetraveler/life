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
  /** 按配置单价估算的费用（全价上界，不区分缓存折扣）；单价未配齐 → null。 */
  estimatedCost: number | null;
}

/** 每百万 tokens 单价；null = 未配置（或非正数被丢弃）。 */
export interface AiUsagePrices {
  input: number | null;
  output: number | null;
}

/** 有限正数 → 原值；否则 null（「非正数丢弃」守卫语义的单一实现）。 */
export function positivePriceOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * defensive 读取 chat-completions 信封 usage（切片 26 / §7.38）：
 * - usage 缺失（非对象）→ null；
 * - prompt_tokens / completion_tokens 非有限数值或为负 → null；
 * - prompt_tokens_details 存在但非对象 → null；cached_tokens 非有限数值、
 *   为负或越界（> prompt_tokens）→ null；details/cached 缺省或 null → 该段省略；
 * - prices 两个单价齐备（非 null）时估算 estimatedCost =
 *   输入×in/1e6 + 输出×out/1e6，round 到 6 位小数（全价上界，不区分缓存
 *   折扣，ai.md v0.20）；任一单价缺失 → null（展示只出 token 段）。
 */
export function readAiUsageSnapshot(
  envelope: unknown,
  prices: AiUsagePrices,
): AiUsageSnapshot | null {
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
  let estimatedCost: number | null = null;
  if (prices.input !== null && prices.output !== null) {
    const raw = (promptTokens * prices.input + completionTokens * prices.output) / 1_000_000;
    estimatedCost = Math.round(raw * 1_000_000) / 1_000_000;
  }
  return { promptTokens, completionTokens, cachedPromptTokens, estimatedCost };
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
