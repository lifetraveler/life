import { useEffect } from 'react';
import { router, useRootNavigationState } from 'expo-router';

import { requestTitleFocus } from '../ui/focusRequestStore';

/**
 * life://quick-add 落点（切片 10，AGENTS §7.16 快速记录入口）：
 * - 小组件底部「快速记录」按钮 → taskHandler Linking.openURL('life://quick-add')
 *   → expo-router 原生 scheme（life）映射到本路由；
 * - 快速记录 = 导航到根记录页 '/'（today.tsx「去记录」同一入口，不新增输入页）；
 * - 复用切片 6「导航就绪冲刷」模式：根导航就绪（useRootNavigationState.key 出现）
 *   才 replace，冷启动深链时路由栈尚未挂稳也能正确落到 '/'；
 * - 切片 12（ui.md v0.12 快速记录增强）：replace 前置位标题聚焦请求，主页落地后
 *   聚焦标题输入；deep link 约定不变（AGENTS §7.18），路由行为仍为 replace('/')；
 * - replace 而非 navigate：返回栈不残留 quick-add 空页；
 * - 本页无 UI（瞬间跳走），渲染 null。
 */
export default function QuickAddRedirect() {
  const navigationState = useRootNavigationState();

  useEffect(() => {
    if (!navigationState?.key) {
      return;
    }
    requestTitleFocus();
    router.replace('/');
  }, [navigationState?.key]);

  return null;
}
