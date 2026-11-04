package com.vibecoding.life.widgetsnapshotstore

import android.content.Context
import android.content.SharedPreferences
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 极小原生模块（切片 10 方案 A，用户开工确认）：JS 侧可用的 SharedPreferences 字符串存取，
 * 专用于「今日待办快照」桥接（键 widget_today_snapshot_v1 由 JS 侧传入，契约冻结值）。
 *
 * 背景契约（AGENTS.md §7.16）：小组件进程不直接读 WatermelonDB；App 在四个触发点把快照
 * JSON 写入 SharedPreferences。react-native-android-widget 本身不提供任何存储 API，
 * 故以本模块补上 JS → SharedPreferences 的写入通道。
 *
 * 说明：
 * - prefs 文件固定为 widget_snapshot_store.xml（App 自身 MODE_PRIVATE，无跨应用共享）；
 * - 写入用 commit() 同步落盘并返回布尔结果，保证「先写快照再渲染」的时序可依赖；
 * - 头less JS（WIDGET_UPDATE/WIDGET_CLICK task handler）与本 App 进程共用同一注册表，
 *   可直接调用本模块读写同一文件。
 */
class WidgetSnapshotStoreModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WidgetSnapshotStore")

    Function("setString") { key: String, value: String ->
      prefs().edit().putString(key, value).commit()
    }

    Function("getString") { key: String ->
      prefs().getString(key, null)
    }
  }

  private fun prefs(): SharedPreferences {
    val context = appContext.reactContext
      ?: throw RuntimeException("WidgetSnapshotStore: react context unavailable")
    return context.getSharedPreferences(PREFS_FILE_NAME, Context.MODE_PRIVATE)
  }

  companion object {
    private const val PREFS_FILE_NAME = "widget_snapshot_store"
  }
}
