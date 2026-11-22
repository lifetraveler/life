/**
 * 双向同步设备标识（切片 35 阶段 1，AGENTS.md §7.47，提案 D5/§deviceId）。
 *
 * - deviceId 为 uuid v4 小写：同步快照固定文件名 `life-sync-<deviceId>.json`
 *   与快照内 deviceId 字段共用；设备间通过文件名互认。
 * - 零新依赖（提案边界）：Math.random 拼接 uuid v4（8-4-4-4-12，版本位 4 +
 *   变体位 8/9/a/b）——deviceId 只承担「同设备稳定 + 不同设备不同」标识语义，
 *   非安全凭证，无需 CSPRNG。
 * - 持久化：expo-secure-store 独立键 SYNC_DEVICE_ID_STORE_KEY（SecureStore
 *   实现在 src/data/SecureSyncDeviceStore.ts，WebDAV 连接配置存取同构先例）；
 *   严禁明文写入 WatermelonDB（AGENTS.md §7.24 API Key 存储纪律同构）。
 */

export const SYNC_DEVICE_ID_STORE_KEY = 'sync_device_id_v1';

/**
 * uuid v4 严格形状（版本位 4 + 变体位 8/9/a/b）。
 * 仅用于本端持久化值回读校验（本应用只写 v4）；对端 deviceId 在 wire 守卫层
 * 只要求非空串（提案 D4 原文），文件名形状由 SYNC_SNAPSHOT_FILE_PATTERN 承载。
 */
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function randomHex(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

/** 变体位取 8/9/a/b 四值之一（uuid v4 第三段首位）。 */
function randomVariantNibble(): string {
  const variants = ['8', '9', 'a', 'b'];
  return variants[Math.floor(Math.random() * variants.length)] as '8' | '9' | 'a' | 'b';
}

/** 生成 uuid v4 小写 deviceId（每次调用全新值；幂等复用由 SecureSyncDeviceStore 负责）。 */
export function generateDeviceId(): string {
  return [
    randomHex(8),
    randomHex(4),
    `4${randomHex(3)}`, // 版本位 4 在第 3 段
    `${randomVariantNibble()}${randomHex(3)}`, // 变体位 8/9/a/b 在第 4 段
    randomHex(12),
  ].join('-');
}

/** deviceId 形状守卫（读出旧值合法性校验；不合法一律重新生成覆盖写）。 */
export function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value);
}

/** SyncDeviceStore 端口（Repository 不触碰 SecureStore；编排层解析后传参）。 */
export interface SyncDeviceStore {
  /** 读出已持久化 deviceId；不存在或不合法时生成并写回（首次调用后稳定复用）。 */
  getOrCreate(): Promise<string>;
}
