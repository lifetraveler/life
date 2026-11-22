/**
 * syncDevice 纯函数单测（切片 35 阶段 1，AGENTS.md §7.47）：
 * uuid v4 零依赖生成（Math.random 拼接）+ 形状守卫。
 * SecureSyncDeviceStore.test.ts 承载持久化行为（SecureStore mock）。
 */

import { generateDeviceId, isDeviceId } from '../syncDevice';

describe('generateDeviceId（uuid v4 零依赖生成）', () => {
  it('生成值匹配 uuid v4 严格形状（版本位 4 + 变体位 8/9/a/b）', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(isDeviceId(generateDeviceId())).toBe(true);
    }
  });

  it('生成值为全小写 36 字符 5 段', () => {
    const id = generateDeviceId();
    expect(id).toHaveLength(36);
    expect(id).toBe(id.toLowerCase());
    expect(id.split('-')).toHaveLength(5);
  });

  it('多次调用互不相同', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      seen.add(generateDeviceId());
    }
    expect(seen.size).toBe(100);
  });
});

describe('isDeviceId（回读合法性守卫）', () => {
  it('合法 v4 通过', () => {
    expect(isDeviceId('11111111-2222-4333-8444-555555555555')).toBe(true);
    expect(isDeviceId('aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee')).toBe(true);
  });

  it('拒绝非 v4 形状：版本位错 / 变体位错 / 非串 / 大写 / 长度错', () => {
    expect(isDeviceId('11111111-2222-5333-8444-555555555555')).toBe(false); // 版本位 5
    expect(isDeviceId('11111111-2222-4333-c444-555555555555')).toBe(false); // 变体位 c
    expect(isDeviceId(12345)).toBe(false);
    expect(isDeviceId('AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE')).toBe(false); // 大写
    expect(isDeviceId('11111111-2222-4333-8444-55555555555')).toBe(false);
    expect(isDeviceId(null)).toBe(false);
    expect(isDeviceId(undefined)).toBe(false);
  });
});
