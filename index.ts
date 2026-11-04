/**
 * 应用 JS 入口（切片 10：package.json main 从 'expo-router/entry' 改为本文件）：
 * - 第一行必须仍是 expo-router/entry（把主 App 组件注册到 AppRegistry，行为与原入口完全一致）；
 * - registerWidgetTaskHandler 必须晚于 App 组件注册（库官方要求的注册顺序），
 *   把小组件 Headless 任务（RNWidgetBackgroundTask）挂到 AppRegistry：
 *   桌面小组件的 ADDED/UPDATE/RESIZED/DELETED/CLICK 全部经它进入 src/widget/taskHandler；
 * - 除此之外不得在此入口加任何业务逻辑（保持与 expo-router/entry 等价的启动行为）。
 */
import 'expo-router/entry';

import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { widgetTaskHandler } from './src/widget';

registerWidgetTaskHandler(widgetTaskHandler);
