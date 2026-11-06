/**
 * 切片 12：quick-add 深链落地后的标题聚焦请求（ui.md v0.12 快速记录增强）。
 * 模块级一次性信号（与 transferResultStore.ts 同一先例：跨路由模块级单例，
 * 不引入全局状态库）：quick-add 页在 replace('/') 前置位，主页在聚焦
 * useFocusEffect 中消费并立即复位——只对紧接着的一次落地生效，不串扰
 * 用户后续手动回到主页的场景。
 */

let pendingTitleFocus = false;

export function requestTitleFocus(): void {
  pendingTitleFocus = true;
}

/** 消费聚焦请求：返回是否有未处理的请求；无论返回值如何都清空（一次性）。 */
export function consumeTitleFocusRequest(): boolean {
  const pending = pendingTitleFocus;
  pendingTitleFocus = false;
  return pending;
}
