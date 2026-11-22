/**
 * SecureSyncDeviceStore 单测（切片 35 阶段 1，AGENTS.md §7.47）：
 * SecureStore 独立键 sync_device_id_v1（不入 app_settings/快照持久层以外）。
 * SecureWebdavConfigStore.test.ts（切片 28）同构 mock 模板。
 */

import * as SecureStore from 'expo-secure-store';

import { SecureSyncDeviceStore } from '../SecureSyncDeviceStore';
import { SYNC_DEVICE_ID_STORE_KEY, isDeviceId } from '../../domain/syncDevice';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockGetItemAsync = jest.mocked(SecureStore.getItemAsync);
const mockSetItemAsync = jest.mocked(SecureStore.setItemAsync);

const VALID_DEVICE_ID = '11111111-2222-4333-8444-555555555555';

describe('SecureSyncDeviceStore（键 sync_device_id_v1）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetItemAsync.mockResolvedValue(undefined);
  });

  it('键存合法 v4 deviceId → 原样复用，不写回', async () => {
    mockGetItemAsync.mockResolvedValue(VALID_DEVICE_ID);
    const store = new SecureSyncDeviceStore();
    await expect(store.getOrCreate()).resolves.toBe(VALID_DEVICE_ID);
    expect(mockSetItemAsync).not.toHaveBeenCalled();
  });

  it('键不存在 → 生成 v4 并写回单键', async () => {
    mockGetItemAsync.mockResolvedValue(null);
    const store = new SecureSyncDeviceStore();
    const deviceId = await store.getOrCreate();
    expect(isDeviceId(deviceId)).toBe(true);
    expect(mockSetItemAsync).toHaveBeenCalledTimes(1);
    expect(mockSetItemAsync).toHaveBeenCalledWith(SYNC_DEVICE_ID_STORE_KEY, deviceId);
  });

  it('键存非法值（非 v4 形状）→ 重新生成覆盖写回', async () => {
    mockGetItemAsync.mockResolvedValue('not-a-uuid');
    const store = new SecureSyncDeviceStore();
    const deviceId = await store.getOrCreate();
    expect(isDeviceId(deviceId)).toBe(true);
    expect(mockSetItemAsync).toHaveBeenCalledTimes(1);
    expect(mockSetItemAsync).toHaveBeenCalledWith(SYNC_DEVICE_ID_STORE_KEY, deviceId);
    expect(deviceId).not.toBe('not-a-uuid');
  });

  it('首次生成后再次调用读回同一值（幂等复用）', async () => {
    const stored: Record<string, string> = {};
    mockGetItemAsync.mockImplementation(async (key: string) => stored[key] ?? null);
    mockSetItemAsync.mockImplementation(async (key: string, value: string) => {
      stored[key] = value;
    });
    const store = new SecureSyncDeviceStore();
    const first = await store.getOrCreate();
    const second = await store.getOrCreate();
    expect(first).toBe(second);
    expect(mockSetItemAsync).toHaveBeenCalledTimes(1);
  });

  it('SecureStore 底层异常向上冒泡（读）', async () => {
    mockGetItemAsync.mockRejectedValue(new Error('keychain locked'));
    const store = new SecureSyncDeviceStore();
    await expect(store.getOrCreate()).rejects.toThrow('keychain locked');
  });

  it('SecureStore 底层异常向上冒泡（写回）', async () => {
    mockGetItemAsync.mockResolvedValue(null);
    mockSetItemAsync.mockRejectedValue(new Error('storage full'));
    const store = new SecureSyncDeviceStore();
    await expect(store.getOrCreate()).rejects.toThrow('storage full');
  });
});
