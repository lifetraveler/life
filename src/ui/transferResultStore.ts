/**
 * 切片 8：导入/导出结果在页面间的传递（settings → import-result / export-success）。
 * 模块级单例（沿 notifications recordAutoReconcileResult 先例，不引入全局状态库）：
 * 仅保存最近一次结果，用于结果页展示；App 进程结束后即失（MVP 可接受）。
 */

export interface ImportFailureItem {
  /** VEVENT SUMMARY 原文；缺失为 '(无 SUMMARY)'；文件级失败为 '(整个文件)'。 */
  summary: string;
  reason: string;
}

export interface ImportResultData {
  createdCount: number;
  skippedDuplicateCount: number;
  /** floating date-time 条数（已按设备时区解释并正常导入）。 */
  floatingCount: number;
  /** 解析失败 + 批量写入失败合并清单。 */
  failures: ImportFailureItem[];
  /** 来源文件名（DocumentPicker 提供；取不到为 null）。 */
  fileName: string | null;
}

export interface ExportResultData {
  count: number;
  fileName: string;
  /** 文件完整路径（cache 目录）。 */
  fileUri: string;
  /** 是否已唤起系统分享面板。 */
  shared: boolean;
}

let lastImport: ImportResultData | null = null;
let lastExport: ExportResultData | null = null;

export function setLastImportResult(data: ImportResultData): void {
  lastImport = data;
}

export function getLastImportResult(): ImportResultData | null {
  return lastImport;
}

export function setLastExportResult(data: ExportResultData): void {
  lastExport = data;
}

export function getLastExportResult(): ExportResultData | null {
  return lastExport;
}
