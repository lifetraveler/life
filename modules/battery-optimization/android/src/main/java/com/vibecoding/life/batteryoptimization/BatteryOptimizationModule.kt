package com.vibecoding.life.batteryoptimization

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 极小原生模块（切片 20 变更 A，用户确认决策点 1）：电池优化白名单的 JS 桥接。
 *
 * 背景（AGENTS.md §7.31 / docs/proposals/slice-20-network-channel-reliability.md）：
 * 网络渠道（webhook/apprise）投递由进程内定时器驱动，进程被 Doze/厂商省电策略冻结后
 * 到点投递丢失；加入电池优化白名单可降低被冻结概率。本模块只读写系统状态，
 * 不触及 src/notifications/ 调度语义。
 *
 * 说明：
 * - isIgnoring：PowerManager.isIgnoringBatteryOptimizations，Expo/RN 无 JS API，由本模块提供；
 * - requestIgnore：官方模式 ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS +
 *   data=package:<本应用>（Android Doze 文档规定的调用形态）。调用方上下文非 Activity，
 *   必须 FLAG_ACTIVITY_NEW_TASK；厂商 ROM 剥离该 intent 时抛 ActivityNotFoundException，
 *   返回 false 由 JS 侧降级 openSettings（提案降级路径）；
 * - openSettings：降级跳转 ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS（无需 data）。
 * - 结构镜像 modules/widget-snapshot-store/WidgetSnapshotStoreModule（切片 10 先例）。
 */
class BatteryOptimizationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BatteryOptimization")

    Function("isIgnoring") { ->
      powerManager().isIgnoringBatteryOptimizations(packageName())
    }

    Function("requestIgnore") { ->
      startActivity(
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = Uri.parse("package:" + packageName())
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      )
    }

    Function("openSettings") { ->
      startActivity(
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      )
    }
  }

  private fun packageName(): String {
    val context = appContext.reactContext
      ?: throw RuntimeException("BatteryOptimization: react context unavailable")
    return context.packageName
  }

  private fun powerManager(): PowerManager {
    val context = appContext.reactContext
      ?: throw RuntimeException("BatteryOptimization: react context unavailable")
    return context.getSystemService(PowerManager::class.java)
      ?: throw RuntimeException("BatteryOptimization: PowerManager unavailable")
  }

  /** 启动系统 activity；厂商 ROM 剥离目标 intent（ActivityNotFoundException）返回 false，
   *  由 JS 侧决定降级路径。其余异常不吞（如实暴露）。 */
  private fun startActivity(intent: Intent): Boolean {
    val context = appContext.reactContext
      ?: throw RuntimeException("BatteryOptimization: react context unavailable")
    return try {
      context.startActivity(intent)
      true
    } catch (e: ActivityNotFoundException) {
      false
    }
  }
}
