/**
 * BatteryOptimization 本地 Expo 模块的 JS 接口（切片 20 变更 A，用户确认决策点 1）：
 * 电池优化白名单的状态检测与授权弹窗唤起，专用于网络渠道（webhook/apprise）
 * 后台送达可靠性。Kotlin 实现见
 * android/src/main/java/com/vibecoding/life/batteryoptimization/。
 *
 * 结构镜像 modules/widget-snapshot-store（切片 10 先例）：零新 npm 依赖，
 * 由 expo-modules-autolinking 经 expo-module.config.json 自动发现注册。
 */

import { requireNativeModule } from 'expo-modules-core';

/** 与 Kotlin BatteryOptimizationModule 对齐的方法签名 */
interface BatteryOptimizationNativeModule {
  /** 当前 App 是否已在电池优化白名单中（PowerManager.isIgnoringBatteryOptimizations） */
  isIgnoring(): boolean;
  /** 唤起系统授权弹窗（ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS，
   *  data=package:本应用）。true = intent 已发出（弹窗应出现）；
   *  false = 系统无此 activity（厂商 ROM 剥离该 intent），应降级 openSettings() */
  requestIgnore(): boolean;
  /** 跳转电池优化系统设置页（ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS，
   *  无需 data）。true = intent 已发出；false = 无法跳转 */
  openSettings(): boolean;
}

export default requireNativeModule<BatteryOptimizationNativeModule>(
  'BatteryOptimization',
);
