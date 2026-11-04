/**
 * expo-calendar 15.0.8 Android 原生 getEventsAsync 的窗口过滤为纯包含式
 * （CalendarModule.kt: `(Instances.BEGIN >= start) AND (Instances.END <= end)`），
 * 会直接丢弃「开始于窗口起点之前」或「结束于窗口终点之后」的跨范围事件。
 *
 * 任务卡要求跨范围事件（startDate < rangeStartMs 且 endDate > rangeStartMs）纳入导入，
 * 因此读取端把窗口外扩 READER_WINDOW_WIDEN_MS，让跨范围事件能从原生层返回；
 * 精确范围过滤仍由 filterEventsInRange（overlapsRange 语义）执行，契约语义不变。
 *
 * 副作用（如实披露）：外扩窗口内「不与导入范围重叠」的事件也会被读出，
 * 计入 totalRead 并落在 outOfRangeCount（结果页「范围外」），属预期行为；
 * 跨度超过外扩量且结束于窗口起点附近的长事件仍会被原生层丢弃（API 层限制）。
 */

export const READER_WINDOW_WIDEN_MS = 24 * 60 * 60 * 1000;

export interface ReaderWindow {
  startMs: number;
  endMs: number;
}

/** 外扩读取窗口：不修改调用方传入的原始范围，仅用于向系统 API 请求更宽的实例区间。 */
export function expandReaderWindow(rangeStartMs: number, rangeEndMs: number): ReaderWindow {
  return {
    startMs: rangeStartMs - READER_WINDOW_WIDEN_MS,
    endMs: rangeEndMs + READER_WINDOW_WIDEN_MS,
  };
}
