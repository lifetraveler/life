import type { ImportedItemInput } from '../domain/item';

/**
 * 切片 17 阶段 2：导入预览数据的模块级单例（先例：transferResultStore 的
 * setLastImportResult/getLastImportResult 同一模式——预览页与选择页之间
 * 通过路由跳转传递大体量结构化数据，不走 URL 参数）。
 *
 * source='ics'：entries 来自 generateIcsPreview（同文件重复 UID 等信息在
 * sameFileDuplicates / duplicateCount）。
 * source='system-calendar'：entries 来自 generateSystemCalendarPreview
 * （范围说明在 meta；sameFileDuplicates 恒空、duplicateCount 恒 0）。
 */
export type ImportPreviewSource = 'ics' | 'system-calendar';

export interface ImportPreviewFailureView {
  summary: string;
  reason: string;
}

export interface ImportPreviewEntryView {
  /** 预览方法原样透传的映射结果（确认导入时直接喂对应批量方法）。 */
  input: ImportedItemInput;
  /** ICS floating date-time 标记；系统日历恒 false。 */
  floating: boolean;
  /** 本地库已存在同来源同 UID；预览页置灰且默认不勾选。 */
  isDuplicate: boolean;
  existingItemId: string | null;
}

export interface ImportPreviewData {
  source: ImportPreviewSource;
  /** ICS 文件名；系统日历为 null（说明文字走 meta）。 */
  fileName: string | null;
  entries: ImportPreviewEntryView[];
  failures: ImportPreviewFailureView[];
  /** 仅 ICS：同文件重复 UID（保留第一条，其余计入此处，默认不勾选）。 */
  sameFileDuplicates: Array<{ uid: string; summary: string }>;
  /** entries 中 isDuplicate=true 的条数（信息性计数）。 */
  duplicateCount: number;
  /** 系统日历的范围/总数说明等附加信息；ICS 为 null。 */
  meta: string | null;
}

let lastImportPreview: ImportPreviewData | null = null;

export function setLastImportPreview(data: ImportPreviewData | null): void {
  lastImportPreview = data;
}

export function getLastImportPreview(): ImportPreviewData | null {
  return lastImportPreview;
}
