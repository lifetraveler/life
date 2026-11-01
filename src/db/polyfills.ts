/**
 * WatermelonDB 已知的启动崩溃修复（必须在任何 WatermelonDB import 之前执行，
 * 由 src/db/database.ts 的首行 import 保证顺序）。
 * 来源：WatermelonDB + Expo SDK 54 验证指南——部分环境返回的 performance.now 不可 bind。
 */
if (typeof window !== 'undefined' && window.performance) {
  const originalNow = window.performance.now;
  if (typeof originalNow === 'function' && typeof originalNow.bind !== 'function') {
    window.performance.now = (): number => originalNow.call(window.performance);
  }
}

export {};
