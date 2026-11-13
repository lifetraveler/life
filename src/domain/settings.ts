/**
 * 领域类型定义：AppSettings（纯 TypeScript，不依赖 React Native / WatermelonDB）。
 *
 * AGENTS.md §7.22（v0.14，schema v6）：app_settings 为单行表（id 固定 'global'）。
 */

/** 标签展示模式（§7.22）：text=纯文字、emoji=仅图标、both=文字+图标 */
export type TagDisplayMode = 'text' | 'emoji' | 'both';

/** TagDisplayMode 全部合法值（用于防御性校验） */
export const TAG_DISPLAY_MODES: readonly TagDisplayMode[] = ['text', 'emoji', 'both'];

/** 类型守卫：库中读到非法枚举值时由 Repository 防御性回退默认值 */
export function isTagDisplayMode(value: unknown): value is TagDisplayMode {
  return typeof value === 'string' && (TAG_DISPLAY_MODES as readonly string[]).includes(value);
}

/**
 * 数据模型：AppSettings（§7.22；后续切片新增全局设置字段时在此扩展）。
 *
 * 小组件显示开关（切片 14 阶段 7a，docs/proposals/slice-14-widget-phase7.md，
 * app_settings schema v6→v7 新增 4 列）：仅控制「今日小组件」的展示口径，
 * 不影响 App 内任何视图。widgetShowCategoryEmoji / widgetShowTags 的渲染消费
 * 在阶段 7c 落地（本阶段只落存储与默认值）。
 */
export interface AppSettings {
  tagDisplayMode: TagDisplayMode;
  /** 小组件今日视图是否展示过期项（默认 true，保持升级前行为） */
  widgetShowOverdue: boolean;
  /** 小组件今日视图是否展示待办项（无时间纯待办，置底展示；默认 false） */
  widgetShowTodos: boolean;
  /** 小组件条目是否展示分类 emoji（阶段 7c 渲染；默认 false） */
  widgetShowCategoryEmoji: boolean;
  /** 小组件条目是否展示标签（阶段 7c 渲染，跟随 app tagDisplayMode；默认 false） */
  widgetShowTags: boolean;
  /**
   * once 快捷 Chips 增量（分钟，切片 18，AGENTS.md §7.29）：详情页「+10 分钟/+1 小时」
   * 一排快捷按钮的取值。默认 [10,60]；读取层防御归一（parseChipsIncrements），
   * 写路径校验（validateChipsIncrements）：1–4 项、每项 1–10080 整数（提案 §7，已确认）。
   */
  chipsIncrements: number[];
}

/** chips_increments 约束（提案 §7，已确认）：最少 1 项、最多 4 项、每项 1–10080 分钟（7 天） */
export const CHIPS_MIN_ITEMS = 1;
export const CHIPS_MAX_ITEMS = 4;
export const CHIPS_MIN_MINUTES = 1;
export const CHIPS_MAX_MINUTES = 10080;

/**
 * 默认设置（§7.22：tagDisplayMode 默认 'text'；阶段 7a：过期组默认展示、
 * 待办/分类 emoji/标签默认不展示；切片 18：chips 默认 [10,60] 与切片 16 硬编码一致；
 * getSettings 无记录时的兜底返回值）。
 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  tagDisplayMode: 'text',
  widgetShowOverdue: true,
  widgetShowTodos: false,
  widgetShowCategoryEmoji: false,
  widgetShowTags: false,
  chipsIncrements: [10, 60],
};

/** app_settings 单行主键（§7.22） */
export const APP_SETTINGS_ROW_ID = 'global';

/**
 * chips_increments 读层防御归一（切片 18，提案 §7）：
 * - null/''/非 JSON 数组 → 整体回退默认 [10, 60]；
 * - 元素非 1–10080 的有限整数 → 丢弃该项（读层防御回退纪律，坏值不用）；
 * - 有效项超过 CHIPS_MAX_ITEMS 截断；结果为空 → 默认 [10, 60]。
 * 不抛错：读层永远返回可用数组。
 */
export function parseChipsIncrements(raw: string | null | undefined): number[] {
  const fallback = [...DEFAULT_APP_SETTINGS.chipsIncrements];
  if (raw === null || raw === undefined || raw === '') {
    return fallback;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!Array.isArray(parsed)) {
    return fallback;
  }
  const valid = parsed.filter(
    (item): item is number =>
      typeof item === 'number' && Number.isInteger(item) &&
      item >= CHIPS_MIN_MINUTES && item <= CHIPS_MAX_MINUTES,
  );
  if (valid.length === 0) {
    return fallback;
  }
  return valid.slice(0, CHIPS_MAX_ITEMS);
}

/**
 * chips_increments 写路径校验（切片 18）：违反约束抛错（写路径严格纪律，
 * 与 normalizeReminderChannelFields 同风格）；通过后返回 trim 后的标准化拷贝
 * （整数数组，顺序保留）。
 */
export function validateChipsIncrements(values: number[]): number[] {
  if (!Array.isArray(values)) {
    throw new Error('chipsIncrements 必须是数组');
  }
  if (values.length < CHIPS_MIN_ITEMS || values.length > CHIPS_MAX_ITEMS) {
    throw new Error(
      `chipsIncrements 需要 ${CHIPS_MIN_ITEMS}–${CHIPS_MAX_ITEMS} 项，收到 ${values.length} 项`,
    );
  }
  return values.map((item) => {
    if (typeof item !== 'number' || !Number.isInteger(item) ||
        item < CHIPS_MIN_MINUTES || item > CHIPS_MAX_MINUTES) {
      throw new Error(
        `chipsIncrements 每项必须是 ${CHIPS_MIN_MINUTES}–${CHIPS_MAX_MINUTES} 的整数分钟，收到 ${String(item)}`,
      );
    }
    return item;
  });
}

/** chips_increments → 存储字符串（切片 18）：写路径恒 JSON 数组；读层见 parseChipsIncrements。 */
export function serializeChipsIncrements(values: number[]): string {
  return JSON.stringify(validateChipsIncrements(values));
}
