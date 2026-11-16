/**
 * 切片 24（AGENTS.md §7.36）：全局颜色 Token——夜间模式的唯一颜色来源。
 *
 * 契约：
 * - 所有 src/app/ 与 src/ui/ 的背景、卡片、文字、边框、危险色必须从
 *   useTheme() 取 Token，禁止再写硬编码十六进制颜色（数据驱动的动态色
 *   ——分类/标签色（visualOptions PALETTE）、条纹色等——不受此约束）；
 * - 深浅色跟随系统 useColorScheme()，本切片不提供 App 内手动切换；
 * - 纯色值表（LIGHT_COLORS / DARK_COLORS）与 hook 分离，便于单测与
 *   非组件层（如 StatusBar 包装）引用。
 */

import { useColorScheme } from 'react-native';

/** 颜色 Token 集（键集冻结：阶段 2 全部页面按此消费，新增键需走任务卡） */
export interface ThemeColors {
  /** 页面背景 */
  background: string;
  /** 卡片 / 输入框 / 弹窗底色 */
  card: string;
  /** 主文字 */
  text: string;
  /** 次要文字（时间戳、占位符、说明文案） */
  textMuted: string;
  /** 主操作色（按钮、选中态、链接） */
  primary: string;
  /** 分隔线 / 描边 */
  border: string;
  /** 危险操作（删除、过期警示） */
  danger: string;
}

/** 浅色 token（任务卡 tasks/slice-24.md 阶段 1 规定值） */
export const LIGHT_COLORS: ThemeColors = {
  background: '#F5F0E6',
  card: '#FFFFFF',
  text: '#3D3A34',
  textMuted: '#8A8377',
  primary: '#4C7A5C',
  border: '#E0E0E0',
  danger: '#D32F2F',
};

/** 深色 token（任务卡 tasks/slice-24.md 阶段 1 规定值） */
export const DARK_COLORS: ThemeColors = {
  background: '#201D18',
  card: '#2D2924',
  text: '#E8E2D6',
  textMuted: '#9C948A',
  primary: '#5D9471',
  border: '#423E38',
  danger: '#F87171',
};

/** colorScheme → Token 集映射（'light' | 'dark'；null/undefined 跟随浅色） */
export function colorsForScheme(scheme: 'light' | 'dark' | null | undefined): ThemeColors {
  return scheme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
}

export interface Theme {
  /** 当前系统的 colorScheme（'light' | 'dark'；判定不出时为 null → 浅色） */
  colorScheme: 'light' | 'dark' | null;
  /** 对应的 Token 集 */
  colors: ThemeColors;
}

/**
 * 主题 hook：每个页面/组件顶部 `const { colors } = useTheme()` 后取用。
 * 跟随系统深浅色，无独立状态、无持久化（本切片不做 App 内手动切换）。
 */
export function useTheme(): Theme {
  // useColorScheme 在旧平台上可返回 undefined → 归一为 null（跟随浅色）
  const colorScheme = useColorScheme() ?? null;
  return { colorScheme, colors: colorsForScheme(colorScheme) };
}
