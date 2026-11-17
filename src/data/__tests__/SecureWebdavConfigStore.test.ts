/**
 * SecureWebdavConfigStore 单测（切片 28 阶段 1，AGENTS.md §7.42 D4）：
 * SecureStore 独立键 webdav_backup_config_v1（不入 app_settings/快照）。
 * 用例形状与 SecureAiConfigStore.test.ts 同构。
 */

import * as SecureStore from 'expo-secure-store';

import { SecureWebdavConfigStore } from '../SecureWebdavConfigStore';
import { WEBDAV_BACKUP_CONFIG_STORE_KEY } from '../../domain/webdav/config';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockGetItemAsync = jest.mocked(SecureStore.getItemAsync);
const mockSetItemAsync = jest.mocked(SecureStore.setItemAsync);
const mockDeleteItemAsync = jest.mocked(SecureStore.deleteItemAsync);

const VALID_CONFIG_JSON = JSON.stringify({
  baseUrl: 'https://dav.example.com',
  basePath: '/life-backup/',
  username: 'user',
  password: 'pass',
});

describe('SecureWebdavConfigStore（键 webdav_backup_config_v1）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('键不存在 → null', async () => {
    mockGetItemAsync.mockResolvedValue(null);
    const store = new SecureWebdavConfigStore();
    await expect(store.load()).resolves.toBeNull();
  });

  it('合法 JSON → 归一化配置', async () => {
    mockGetItemAsync.mockResolvedValue(VALID_CONFIG_JSON);
    const store = new SecureWebdavConfigStore();
    await expect(store.load()).resolves.toEqual({
      baseUrl: 'https://dav.example.com',
      basePath: '/life-backup/',
      username: 'user',
      password: 'pass',
    });
  });

  it('损坏 JSON → null 不抛错', async () => {
    mockGetItemAsync.mockResolvedValue('not json{');
    const store = new SecureWebdavConfigStore();
    await expect(store.load()).resolves.toBeNull();
  });

  it('形状非法 JSON（守卫不过）→ null', async () => {
    mockGetItemAsync.mockResolvedValue(JSON.stringify({ baseUrl: 'ftp://x' }));
    const store = new SecureWebdavConfigStore();
    await expect(store.load()).resolves.toBeNull();
  });

  it('SecureStore 底层异常向上冒泡（load）', async () => {
    mockGetItemAsync.mockRejectedValue(new Error('keychain locked'));
    const store = new SecureWebdavConfigStore();
    await expect(store.load()).rejects.toThrow('keychain locked');
  });

  it('save 序列化写入单键', async () => {
    mockSetItemAsync.mockResolvedValue(undefined);
    const store = new SecureWebdavConfigStore();
    await store.save({
      baseUrl: 'https://dav.example.com',
      basePath: '',
      username: 'u',
      password: 'p',
    });
    expect(mockSetItemAsync).toHaveBeenCalledTimes(1);
    expect(mockSetItemAsync).toHaveBeenCalledWith(
      WEBDAV_BACKUP_CONFIG_STORE_KEY,
      JSON.stringify({
        baseUrl: 'https://dav.example.com',
        basePath: '',
        username: 'u',
        password: 'p',
      }),
    );
  });

  it('save 底层异常向上冒泡', async () => {
    mockSetItemAsync.mockRejectedValue(new Error('storage full'));
    const store = new SecureWebdavConfigStore();
    await expect(
      store.save({ baseUrl: 'https://dav.example.com', basePath: '', username: '', password: '' }),
    ).rejects.toThrow('storage full');
  });

  it('clear 删除键', async () => {
    mockDeleteItemAsync.mockResolvedValue(undefined);
    const store = new SecureWebdavConfigStore();
    await store.clear();
    expect(mockDeleteItemAsync).toHaveBeenCalledTimes(1);
    expect(mockDeleteItemAsync).toHaveBeenCalledWith(WEBDAV_BACKUP_CONFIG_STORE_KEY);
  });
});
