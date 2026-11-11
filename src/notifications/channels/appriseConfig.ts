/**
 * 切片 16 阶段 2：Apprise 渠道配置守卫（提案 §2.5；结构约束同 §7.24——
 * 外部 JSON 必须经手写类型守卫校验，严禁直接 as 强转）。
 *
 * channel_config 存储形态（用户在 UI 填写，阶段 3 落地；本阶段先定契约）：
 *   { "baseUrl": "http://apprise.local:8000", "key": "cfg-xxx" }       // Apprise API stateful 简写
 *   { "baseUrl": "http://apprise.local:8000", "urls": "mailto://.." }  // stateless 直发
 * urls 接受单个字符串或字符串数组，统一归一为 string[]。
 */
export type AppriseChannelConfig = {
  baseUrl: string;
  /** Apprise API 配置 key；与 urls 二选一 */
  key: string | null;
  /** stateless 直发目标列表；与 key 二选一 */
  urls: string[] | null;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 解析并校验 apprise 渠道配置；任何形态不合格都抛明确错误（deliver 捕获记 failed）。 */
export function parseAppriseChannelConfig(raw: string | null): AppriseChannelConfig {
  if (raw === null) {
    throw new Error('AppriseChannel: reminder.channelConfig is empty; expected JSON {baseUrl, key|urls}');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('AppriseChannel: channelConfig is not valid JSON; expected {baseUrl, key|urls}');
  }
  if (!isPlainRecord(parsed)) {
    throw new Error('AppriseChannel: channelConfig must be a JSON object {baseUrl, key|urls}');
  }

  const { baseUrl } = parsed;
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    throw new Error('AppriseChannel: channelConfig.baseUrl must be a non-empty string');
  }

  let key: string | null = null;
  const rawKey = parsed['key'];
  if (rawKey !== undefined && rawKey !== null) {
    if (typeof rawKey !== 'string' || rawKey.trim().length === 0) {
      throw new Error('AppriseChannel: channelConfig.key must be a non-empty string when present');
    }
    key = rawKey.trim();
  }

  let urls: string[] | null = null;
  const rawUrls = parsed['urls'];
  if (rawUrls !== undefined && rawUrls !== null) {
    const list = typeof rawUrls === 'string' ? [rawUrls] : rawUrls;
    if (!Array.isArray(list) || list.length === 0 || list.some((u) => typeof u !== 'string' || u.trim().length === 0)) {
      throw new Error('AppriseChannel: channelConfig.urls must be a non-empty string or array of non-empty strings');
    }
    urls = list.map((u) => u.trim());
  }

  if (key === null && urls === null) {
    throw new Error('AppriseChannel: channelConfig requires either key or urls');
  }
  if (key !== null && urls !== null) {
    throw new Error('AppriseChannel: channelConfig accepts only one of key / urls');
  }

  // baseUrl 去尾斜杠，拼接路径时统一形态。
  return { baseUrl: baseUrl.trim().replace(/\/+$/, ''), key, urls };
}
