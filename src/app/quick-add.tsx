import { useEffect } from 'react';
import { router, useRootNavigationState } from 'expo-router';

/**
 * life://quick-add 落点（切片 10，AGENTS §7.16 快速记录入口；切片 14 阶段 5 改落点，
 * ui.md「快速记录落点 v0.14」替换 v0.12 行为）：
 * - 小组件底部「快速记录」按钮 → taskHandler Linking.openURL('life://quick-add')
 *   → expo-router 原生 scheme（life）映射到本路由；deep link URL 约定不变（AGENTS §7.18）；
 * - 阶段 5 移除主页内嵌录入框后，快速记录 = 全屏新建页 /item/new（共享编辑页表单，
 *   标题输入框自动聚焦）；
 * - 复用切片 6「导航就绪冲刷」模式：根导航就绪（useRootNavigationState.key 出现）
 *   才 replace，冷启动深链时路由栈尚未挂稳也能正确落到 /item/new；
 * - replace 而非 navigate：返回栈不残留 quick-add 空页；
 * - 本页无 UI（瞬间跳走），渲染 null。
 */
export default function QuickAddRedirect() {
  const navigationState = useRootNavigationState();

  useEffect(() => {
    if (!navigationState?.key) {
      return;
    }
    router.replace('/item/new');
  }, [navigationState?.key]);

  return null;
}
