/**
 * batteryOptimization helper 测试（切片 20 变更 A）：
 * mock 本地原生模块，覆盖状态透传与弹窗降级编排的三分支。
 */

import {
  isIgnoringBatteryOptimizations,
  requestIgnoreBatteryOptimizations,
} from '../batteryOptimization';

/** 与 modules/battery-optimization/index.ts 的接口对齐的 mock 形态 */
interface BatteryOptimizationNativeModuleMock {
  isIgnoring: jest.Mock<boolean, []>;
  requestIgnore: jest.Mock<boolean, []>;
  openSettings: jest.Mock<boolean, []>;
}

// 工厂内联创建 mock：jest.mock 工厂在测试文件 import 求值期执行，此时测试模块
// 作用域的 const 变量尚未初始化（工厂会拿到 undefined），故不得引用外层变量。
jest.mock('../../../modules/battery-optimization', () => ({
  __esModule: true,
  default: {
    isIgnoring: jest.fn<boolean, []>(),
    requestIgnore: jest.fn<boolean, []>(),
    openSettings: jest.fn<boolean, []>(),
  },
}));

// 路径相对本测试文件解析（../../../ → 仓库根），与 src/system/batteryOptimization.ts
// 内的 '../../modules/battery-optimization' 指向同一模块；requireMock 泛型取回
// 工厂创建的同一 handle，全程无 any / as。
const mockedNative = jest.requireMock<{
  default: BatteryOptimizationNativeModuleMock;
}>('../../../modules/battery-optimization').default;

describe('batteryOptimization', () => {
  beforeEach(() => {
    mockedNative.isIgnoring.mockReset();
    mockedNative.requestIgnore.mockReset();
    mockedNative.openSettings.mockReset();
  });

  describe('isIgnoringBatteryOptimizations', () => {
    it('透传原生模块的白名单状态', async () => {
      mockedNative.isIgnoring.mockReturnValue(true);
      await expect(isIgnoringBatteryOptimizations()).resolves.toBe(true);

      mockedNative.isIgnoring.mockReturnValue(false);
      await expect(isIgnoringBatteryOptimizations()).resolves.toBe(false);
    });
  });

  describe('requestIgnoreBatteryOptimizations', () => {
    it('弹窗 intent 发出成功 → dialog，不触发降级', async () => {
      mockedNative.requestIgnore.mockReturnValue(true);
      await expect(requestIgnoreBatteryOptimizations()).resolves.toBe('dialog');
      expect(mockedNative.openSettings).not.toHaveBeenCalled();
    });

    it('弹窗被 ROM 剥离（false）但设置页可跳 → settings-fallback', async () => {
      mockedNative.requestIgnore.mockReturnValue(false);
      mockedNative.openSettings.mockReturnValue(true);
      await expect(requestIgnoreBatteryOptimizations()).resolves.toBe(
        'settings-fallback',
      );
      expect(mockedNative.openSettings).toHaveBeenCalledTimes(1);
    });

    it('弹窗与设置页均失败 → unavailable', async () => {
      mockedNative.requestIgnore.mockReturnValue(false);
      mockedNative.openSettings.mockReturnValue(false);
      await expect(requestIgnoreBatteryOptimizations()).resolves.toBe(
        'unavailable',
      );
    });
  });
});
