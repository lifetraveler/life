/**
 * Spark 灵感火花域类型与纯函数（切片 37，AGENTS.md §7.49）。
 * 纯 TypeScript 域层：不依赖 React Native / WatermelonDB / expo-*。
 * 依据 docs/proposals/slice-37-spark-inspiration.md D3/D4/D7。
 */

import type { ItemStatus } from './item';

/** spark_attachments.kind 取值（schema v19；Repository 写路径守卫，枚举外抛错）。 */
export type SparkAttachmentKind = 'audio' | 'image';

export const SPARK_ATTACHMENT_KINDS: readonly SparkAttachmentKind[] = ['audio', 'image'];

/**
 * 灵感本体（sparks 表域投影）。
 * title / content 双可空：纯录音灵感（Q2 仅存+回放，无转写）先建行后挂附件，
 * 两列可能同时为 null（录音流程合法状态，提案 D3）。
 */
export interface Spark {
  id: string;
  title: string | null;
  content: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 灵感附件（spark_attachments 表域投影；uri 为本地文件路径）。 */
export interface SparkAttachment {
  id: string;
  sparkId: string;
  kind: SparkAttachmentKind;
  uri: string;
  /** life-attachments 内的远端文件名（不含目录前缀）；即时上传失败为 null。 */
  remotePath: string | null;
  /** 上传时计算的文件 SHA-256（hex 小写）；未上传为 null。 */
  sha256: string | null;
  fileSize: number;
  /** 仅录音附件携带；图片附件为 null。 */
  durationMs: number | null;
  /** 仅图片附件携带；录音附件为 null。 */
  width: number | null;
  height: number | null;
  createdAt: number;
}

/** 灵感↔计划关联行（spark_items join 表域投影）。 */
export interface SparkItemLink {
  sparkId: string;
  itemId: string;
  createdAt: number;
}

/** 灵感关联计划摘要（listItemsForSpark 详情页行渲染面：分类色点+标题+状态+时间）。 */
export interface SparkLinkedItemSummary {
  itemId: string;
  title: string;
  status: ItemStatus;
  startAt: number | null;
  allDay: boolean;
  categoryColor: string | null;
  categoryEmoji: string | null;
  /** 关联建立时间（spark_items.created_at，供按关联顺序排序）。 */
  linkedAt: number;
}

/** 单灵感附件数量上限（提案 D4；超出拒绝+披露）。 */
export const SPARK_ATTACHMENT_MAX_COUNT = 20;

/** 单附件文件大小上限 25MB（提案 D4；超出拒绝+披露）。 */
export const SPARK_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** 单灵感关联计划上限（提案 D7；超出拒绝披露，转计划保存链同理）。 */
export const SPARK_ITEM_LINK_MAX = 50;

/**
 * 附件远端文件名（hash 命名，提案 D4）：<sha256 前 16 位>-<原名.ext>。
 * 纯函数：sha256 为 hex 小写摘要（≥16 位），originalFileName 非空。
 * remote_path 列存本函数返回值；远端 URL 由 WebdavClient 拼 WEBDAV_ATTACHMENTS_DIR 前缀。
 */
export function buildAttachmentRemoteName(sha256: string, originalFileName: string): string {
  if (!sha256 || sha256.length < 16) {
    throw new Error('buildAttachmentRemoteName: sha256 必须为至少 16 位的 hex 摘要');
  }
  const name = originalFileName.trim();
  if (!name) {
    throw new Error('buildAttachmentRemoteName: originalFileName 不能为空');
  }
  return `${sha256.slice(0, 16)}-${name}`;
}

/**
 * 灵感 title/content 归一：trim 后空串（或 nullish）归 null（双可空语义，提案 D3）。
 * 写路径（createSpark/updateSpark）与数据快照恢复（applyDataSnapshot 命中覆盖）
 * 共用同一不变式，单一实现防两处漂移。
 */
export function normalizeSparkNullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
