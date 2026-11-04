/**
 * WidgetSnapshotStore 本地 Expo 模块的 JS 接口（切片 10 方案 A）：
 * 极小 SharedPreferences 字符串存取，专用于今日待办小组件快照桥接。
 * Kotlin 实现见 android/src/main/java/com/vibecoding/life/widgetsnapshotstore/。
 */

import { requireNativeModule } from 'expo-modules-core';

/** 与 Kotlin WidgetSnapshotStoreModule 对齐的方法签名 */
interface WidgetSnapshotStoreNativeModule {
  /** 同步写入并落盘（commit()），返回是否成功 */
  setString(key: string, value: string): boolean;
  /** 同步读取；键不存在返回 null */
  getString(key: string): string | null;
}

export default requireNativeModule<WidgetSnapshotStoreNativeModule>(
  'WidgetSnapshotStore',
);
