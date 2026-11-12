/**
 * 切片 17 阶段 1：Webhook 渠道配置守卫（AGENTS.md §7.27 Webhook 载荷适配；
 * 结构约束同 §7.24 / appriseConfig.ts 先例——外部 JSON 必须经手写类型守卫校验，
 * 严禁直接 as 强转）。
 *
 * reminders.channel_config 存储形态（v0.17 起新增 JSON 形态，切片 16 为纯 URL 字符串）：
 *   "https://hook.example/x"                       // 旧形态（兼容读，见下）
 *   {                                              // 新形态
 *     "url": "https://…",                          // 必填，http(s)
 *     "mode": "json" | "form" | "text",            // 缺省 "json"
 *     "headers": { "Content-Type": "…" },          // 可选；覆盖 mode 默认头
 *     "payloadTemplate": …                         // 形态由 mode 决定（见下）
 *   }
 *
 * payloadTemplate 形态与渲染规则（notifications.md v0.17 / webhookTemplate.ts）：
 *   - json：任意 JSON 树，string 叶子做 {{var}} 替换；缺省 → 切片 16 固定 payload（零行为变化）
 *   - form：扁平 Record<string,string>，值替换后 URLSearchParams 编码（Zulip external/zulip 形态）
 *   - text：string 模板，渲染后作为原始 body（纯文本 POST）
 *
 * 兼容策略：整串 JSON.parse 失败、或解析结果不是对象（如裸字符串）→ 整串视为 URL，
 * 等价 {url, mode:'json'}，与切片 16 行为逐字段一致（存量提醒零变化，回归测试锁定）。
 */

export type WebhookPayloadMode = 'json' | 'form' | 'text';

/**
 * 按模式判别的配置形态：form/text 的 payloadTemplate 必填且形态锁定，
 * json 的可缺省（缺省走切片 16 固定 payload）。send 侧无需再做形态收窄。
 */
export type WebhookChannelConfig =
  | {
      mode: 'json';
      url: string;
      headers: Record<string, string>;
      payloadTemplate?: unknown;
    }
  | {
      mode: 'form';
      url: string;
      headers: Record<string, string>;
      payloadTemplate: Record<string, string>;
    }
  | {
      mode: 'text';
      url: string;
      headers: Record<string, string>;
      payloadTemplate: string;
    };

const WEBHOOK_PAYLOAD_MODES: readonly WebhookPayloadMode[] = ['json', 'form', 'text'];

function isWebhookPayloadMode(value: string): value is WebhookPayloadMode {
  return value === 'json' || value === 'form' || value === 'text';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** http(s) URL：与阶段 2 前表单校验 isValidHttpUrl 的语义一致（切片 16 存量配置均满足）。 */
function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function parseHeaders(parsed: Record<string, unknown>): Record<string, string> {
  const raw = parsed['headers'];
  if (raw === undefined || raw === null) {
    return {};
  }
  if (!isPlainRecord(raw)) {
    throw new Error('WebhookChannel: channelConfig.headers must be a JSON object of string→string');
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.trim().length === 0) {
      throw new Error('WebhookChannel: channelConfig.headers keys must be non-empty');
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error('WebhookChannel: channelConfig.headers values must be non-empty strings');
    }
    headers[key] = value;
  }
  return headers;
}

function parsePayloadTemplate(
  mode: WebhookPayloadMode,
  parsed: Record<string, unknown>,
): unknown | Record<string, string> | string | undefined {
  const raw = parsed['payloadTemplate'];
  if (mode === 'json') {
    // json 模式模板可缺省（缺省 → 切片 16 固定 payload）；存在时任意 JSON 值均可，
    // 形态合法性由渲染器递归处理（string 叶子替换、其余原样）。
    return raw;
  }
  if (raw === undefined || raw === null) {
    throw new Error(
      `WebhookChannel: channelConfig.payloadTemplate is required when mode is "${mode}"`,
    );
  }
  if (mode === 'text') {
    if (typeof raw !== 'string') {
      throw new Error('WebhookChannel: channelConfig.payloadTemplate must be a string when mode is "text"');
    }
    return raw;
  }
  // form：扁平 Record<string,string>（URLSearchParams 无嵌套语义）。
  if (!isPlainRecord(raw)) {
    throw new Error(
      'WebhookChannel: channelConfig.payloadTemplate must be a flat JSON object of string→string when mode is "form"',
    );
  }
  const template: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.trim().length === 0) {
      throw new Error('WebhookChannel: channelConfig.payloadTemplate keys must be non-empty');
    }
    if (typeof value !== 'string') {
      throw new Error(
        'WebhookChannel: channelConfig.payloadTemplate values must be strings when mode is "form"',
      );
    }
    template[key] = value;
  }
  return template;
}

/**
 * 解析并校验 webhook 渠道配置；任何形态不合格都抛明确错误（deliver 捕获记 failed）。
 *
 * 兼容规则：
 * - raw 为 null/纯空白 → 抛错（与切片 16 的空 URL 抛错一致）；
 * - JSON.parse 失败，或解析结果不是 JSON 对象（含裸字符串）→ 整串视为 URL（旧形态），
 *   等价 {url, mode:'json', headers:{}}；
 * - JSON 对象 → 新形态逐字段校验（url 必填 http(s)、mode 枚举、headers、payloadTemplate 按 mode 配套）。
 */
export function parseWebhookChannelConfig(raw: string | null): WebhookChannelConfig {
  if (raw === null || raw.trim().length === 0) {
    throw new Error('WebhookChannel: reminder.channelConfig is empty; expected a webhook URL or JSON config');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined; // 非 JSON → 旧形态纯 URL
  }

  if (!isPlainRecord(parsed)) {
    const url = raw.trim();
    if (!isHttpUrl(url)) {
      throw new Error(`WebhookChannel: channelConfig must be an http(s) URL or a JSON config object, got "${url}"`);
    }
    return { mode: 'json', url, headers: {} };
  }

  const rawUrl = parsed['url'];
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    throw new Error('WebhookChannel: channelConfig.url must be a non-empty string');
  }
  const url = rawUrl.trim();
  if (!isHttpUrl(url)) {
    throw new Error(`WebhookChannel: channelConfig.url must start with http:// or https://, got "${url}"`);
  }

  const rawMode = parsed['mode'];
  let mode: WebhookPayloadMode = 'json';
  if (rawMode !== undefined && rawMode !== null) {
    if (typeof rawMode !== 'string' || !isWebhookPayloadMode(rawMode)) {
      throw new Error(
        `WebhookChannel: channelConfig.mode must be one of ${WEBHOOK_PAYLOAD_MODES.join(' / ')}`,
      );
    }
    mode = rawMode;
  }

  const headers = parseHeaders(parsed);
  const payloadTemplate = parsePayloadTemplate(mode, parsed);

  if (mode === 'form') {
    return { mode, url, headers, payloadTemplate: payloadTemplate as Record<string, string> };
  }
  if (mode === 'text') {
    return { mode, url, headers, payloadTemplate: payloadTemplate as string };
  }
  return { mode, url, headers, payloadTemplate: payloadTemplate as unknown | undefined };
}
