/**
 * 切片 28 阶段 1（AGENTS.md §7.42）：WebDAV 连接配置的领域形状、守卫与存储端口。
 *
 * 分层同 src/domain/ai/configStore.ts（AiConfigStore 先例）：domain 只放形状/
 * 守卫/端口常量；SecureStore 实现在 src/data/SecureWebdavConfigStore.ts（domain
 * 不 import expo-secure-store）。
 *
 * 自引用防护（提案 §4.3）：连接配置存独立键 webdav_backup_config_v1，不入
 * app_settings、不入快照——恢复会全列覆盖 app_settings，连接配置若在内会被
 * 旧快照回滚。
 */

export interface WebdavConfig {
  /** 服务器根地址，如 https://dav.example.com（守卫归一：trim + 去尾斜杠）。 */
  baseUrl: string;
  /** 快照目录路径，如 /life-backup/（守卫归一：trim）；'' = 服务器根目录。 */
  basePath: string;
  /** Basic Auth 用户名/密码（原样保留，不 trim——密码可能含首尾空格）；两者均空 = 匿名。 */
  username: string;
  password: string;
}

/** SecureStore 键（§7.42 D4；独立于 ai_provider_config_v1）。 */
export const WEBDAV_BACKUP_CONFIG_STORE_KEY = 'webdav_backup_config_v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 运行时守卫（isAiConfig 同构）：SecureStore 读出的 JSON 必须通过校验才可信，
 * 损坏一律返回 null（视为未配置），绝不抛错、绝不打日志输出 password。
 * - baseUrl 必须 trim 去尾斜杠后以 http(s):// 开头；
 * - basePath / username / password 任意字符串（basePath/baseUrl 归一为 trim
 *   拷贝；username/password 原样保留）。
 */
export function isWebdavConfig(value: unknown): WebdavConfig | null {
  if (!isRecord(value)) return null;
  if (typeof value.baseUrl !== 'string') return null;
  if (typeof value.basePath !== 'string') return null;
  if (typeof value.username !== 'string') return null;
  if (typeof value.password !== 'string') return null;
  const baseUrl = value.baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(baseUrl)) return null;
  return {
    baseUrl,
    basePath: value.basePath.trim(),
    username: value.username,
    password: value.password,
  };
}

/**
 * 连接配置存储端口（AiConfigStore 同构）。实现不得打日志输出 password。
 */
export interface WebdavBackupConfigStore {
  /** 读取连接配置；键不存在 / 损坏 / 形状不符返回 null。 */
  load(): Promise<WebdavConfig | null>;
  save(config: WebdavConfig): Promise<void>;
  clear(): Promise<void>;
}
