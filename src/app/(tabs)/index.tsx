import { Redirect } from 'expo-router';

/**
 * 根路由落点（切片 14 阶段 5c 补）：
 * 桌面图标 / dev launcher 默认打开根 URL（life://），(tabs) 组此前无 index
 * 路由导致根路径 Unmatched Route。
 * 用 Redirect 而非重导出 plan：根 URL 挂载后立即重定向到 /plan，
 * 底部 Tab 的高亮落在「计划」上（隐藏 index 自身不是任何 Tab 的选中项）。
 * 该 screen 在 (tabs)/_layout.tsx 中以 href: null 隐藏，不产生第 5 个 Tab。
 */
export default function TabIndex() {
  return <Redirect href="/plan" />;
}
