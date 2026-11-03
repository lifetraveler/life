/**
 * 切片 6（AGENTS.md §4.24）：Item 时间字段纯校验规则。
 *
 * - startAt / endAt 为绝对毫秒时间戳；null 表示未安排 / 无结束时间。
 * - 两者同时非 null 时 endAt 必须 >= startAt，否则抛明确错误。
 * - 输入必须有限，非有限数字（NaN/Infinity）一律视为非法输入抛错，不得静默归一。
 * 纯 TypeScript，供 createItem / updateItemTime 共用，便于单测。
 */

export function assertValidItemTimestamp(value: number | null | undefined, field: string): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`updateItemTime: ${field} must be a finite number or null, got ${String(value)}`);
  }
}

/** 同时非 null 时校验 endAt >= startAt；任一为 null 则不校验（§4.24） */
export function assertValidItemTimeRange(
  startAt: number | null | undefined,
  endAt: number | null | undefined,
): void {
  if (startAt === null || startAt === undefined || endAt === null || endAt === undefined) {
    return;
  }
  if (endAt < startAt) {
    throw new Error(
      `updateItemTime: endAt (${endAt}) must be >= startAt (${startAt}) when both are set`,
    );
  }
}

/**
 * updateItemTime 输入的整体校验：逐字段验有限性，再验区间。
 * patch 内未出现的字段不参与（由调用方与既有值合并后验区间）。
 */
export function assertValidItemTimePatch(patch: {
  startAt?: number | null;
  endAt?: number | null;
}): void {
  if ('startAt' in patch) {
    assertValidItemTimestamp(patch.startAt, 'startAt');
  }
  if ('endAt' in patch) {
    assertValidItemTimestamp(patch.endAt, 'endAt');
  }
}
