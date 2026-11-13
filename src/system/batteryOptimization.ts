/**
 * 电池优化白名单调用封装（切片 20 变更 A，纯 TS helper）。
 *
 * 边界（AGENTS.md §7.31）：仅降低网络渠道（webhook/apprise）进程被系统省电策略
 * 冻结的概率，不改变「App 进程存活则保证送达」的渠道边界；不引入 WorkManager /
 * 前台服务；不触及 src/notifications/ 调度语义。
 *
 * 原生能力由本地 Expo 模块 modules/battery-optimization/ 提供（用户确认决策点 1）：
 * - 检测：PowerManager.isIgnoringBatteryOptimizations 无 Expo/RN JS API；
 * - 弹窗：ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS 的官方调用形态要求
 *   data URI（package:本应用），RN Linking.sendIntent 不支持设置 data。
 * 两者均必须走原生，本 helper 在其上做降级编排（弹窗 intent 被厂商 ROM 剥离时
 * 自动跳转电池优化设置页，提案降级路径）。
 */

import batteryModule from '../../modules/battery-optimization';

/**
 * requestIgnoreBatteryOptimizations 的结果：
 * - 'dialog'：系统「忽略电池优化」授权弹窗已唤起；
 * - 'settings-fallback'：弹窗 intent 被厂商 ROM 剥离（ActivityNotFoundException），
 *   已降级跳转电池优化设置页（用户需手动找到本应用选择「不优化」）；
 * - 'unavailable'：弹窗与设置页跳转均失败，UI 应引导用户手动前往系统设置。
 */
export type BatteryOptimizationRequestResult =
  | 'dialog'
  | 'settings-fallback'
  | 'unavailable';

/** 当前 App 是否已在电池优化白名单中（PowerManager.isIgnoringBatteryOptimizations）。 */
export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
  return batteryModule.isIgnoring();
}

/**
 * 唤起系统「忽略电池优化」授权弹窗；厂商 ROM 剥离弹窗 intent 时自动降级为
 * 跳转电池优化设置页。返回结果供 UI 文案区分呈现（阶段 2 接入）。
 */
export async function requestIgnoreBatteryOptimizations(): Promise<BatteryOptimizationRequestResult> {
  if (batteryModule.requestIgnore()) {
    return 'dialog';
  }
  if (batteryModule.openSettings()) {
    return 'settings-fallback';
  }
  return 'unavailable';
}

/**
 * 直接跳转电池优化系统设置页（AGENTS §7.31「一键跳转系统设置」）：
 * 独立入口，供用户手动复查/摘除白名单，不经过弹窗降级编排。
 */
export async function openBatteryOptimizationSettings(): Promise<boolean> {
  return batteryModule.openSettings();
}
