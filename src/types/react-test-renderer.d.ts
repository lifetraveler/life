/**
 * react-test-renderer 最小类型声明（切片 14 阶段 5c）。
 *
 * 背景：React 19 起该包不再自带类型；@types/react-test-renderer 属于新增 devDependency，
 * 任务卡未授权引入（AGENTS.md §7.3），因此仅为月历渲染回归测试
 * （src/ui/__tests__/MonthCalendarView.test.tsx）用到的 API 手写最小声明。
 * 若后续任务卡明确允许安装 @types/react-test-renderer，可删除本文件。
 */

declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';

  /** 测试树节点（仅声明测试用到的成员） */
  export interface ReactTestInstance {
    readonly props: Record<string, unknown>;
    readonly type: unknown;
    findAll(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance[];
  }

  /** 渲染树句柄（仅声明测试用到的成员） */
  export interface ReactTestRenderer {
    root: ReactTestInstance;
    unmount(): void;
  }

  export function create(nextElement: ReactElement): ReactTestRenderer;

  export function act<T>(callback: () => T | Promise<T>): Promise<T> | T;

  const TestRenderer: {
    create: typeof create;
    act: typeof act;
  };

  export default TestRenderer;
}
