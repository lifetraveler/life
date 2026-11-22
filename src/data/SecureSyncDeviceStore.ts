/**
 * 切片 35 阶段 1：SyncDeviceStore 的 SecureStore 实现。
 *
 * §7.47：deviceId 存 expo-secure-store 独立键 SYNC_DEVICE_ID_STORE_KEY
 * （sync_device_id_v1），不入 app_settings、不入快照明文以外的任何持久层
 * （快照 deviceId 字段与文件名本身即其对外形态）。domain 层不 import
 * expo-secure-store，本文件是 data 层唯一接触点（SecureWebdavConfigStore
 * 同构）：读出值经 isDeviceId 校验，不合法一律重新生成并写回（首次调用后
 * 稳定复用）；底层 SecureStore 异常原样冒泡，由编排层决定披露。
 */

import * as SecureStore from 'expo-secure-store';
import {
  SYNC_DEVICE_ID_STORE_KEY,
  generateDeviceId,
  isDeviceId,
  type SyncDeviceStore,
} from '../domain/syncDevice';

export class SecureSyncDeviceStore implements SyncDeviceStore {
  async getOrCreate(): Promise<string> {
    const raw: string | null = await SecureStore.getItemAsync(SYNC_DEVICE_ID_STORE_KEY);
    if (raw !== null && isDeviceId(raw)) {
      return raw;
    }
    const deviceId = generateDeviceId();
    await SecureStore.setItemAsync(SYNC_DEVICE_ID_STORE_KEY, deviceId);
    return deviceId;
  }
}
