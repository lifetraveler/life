/**
 * 切片 28 阶段 1：WebdavBackupConfigStore 的 SecureStore 实现。
 *
 * §7.42 D4：WebDAV 连接配置（baseUrl/basePath/username/password）存
 * expo-secure-store 独立键 webdav_backup_config_v1，不入 app_settings、不入
 * 快照——恢复会全列覆盖 app_settings，连接配置若在内会被旧快照回滚（自引用
 * 防护，提案 §4.3）。domain 层不 import expo-secure-store，本文件是 data 层
 * 唯一接触点。读出的 JSON 经 isWebdavConfig 校验，损坏一律返回 null（视为
 * 未配置），绝不抛错、绝不打日志输出 password（SecureAiConfigStore 同构）。
 */

import * as SecureStore from 'expo-secure-store';
import {
  WEBDAV_BACKUP_CONFIG_STORE_KEY,
  isWebdavConfig,
  type WebdavBackupConfigStore,
  type WebdavConfig,
} from '../domain/webdav/config';

export class SecureWebdavConfigStore implements WebdavBackupConfigStore {
  async load(): Promise<WebdavConfig | null> {
    const raw: string | null = await SecureStore.getItemAsync(WEBDAV_BACKUP_CONFIG_STORE_KEY);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isWebdavConfig(parsed);
    } catch {
      return null;
    }
  }

  async save(config: WebdavConfig): Promise<void> {
    await SecureStore.setItemAsync(WEBDAV_BACKUP_CONFIG_STORE_KEY, JSON.stringify(config));
  }

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(WEBDAV_BACKUP_CONFIG_STORE_KEY);
  }
}
