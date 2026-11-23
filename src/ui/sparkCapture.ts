/**
 * Spark capture 编排与展示纯函数（切片 37，AGENTS.md §7.49 D4/D6/D7）：
 * - captureAttachment：录音/拍照/相册产物 → 复制落盘 → addAttachment 行 →
 *   即时上传 → markAttachmentUploaded 回填（上传失败转「未备份」，行保留）；
 * - 展示纯函数（卡片标题/相对时间/时长格式化/文件名提取）不依赖 React Native，
 *   单测直接覆盖（src/ui/__tests__/sparkCapture.test.ts）。
 *
 * 边界（提案 D8）：本模块不触碰 AI 面/提醒调度/sync 快照域；文件与远端 IO 一律
 * 经 SparkAttachmentIo 注入（UI 不直接 import expo-file-system/WebdavClient）。
 */

import {
  SPARK_ATTACHMENT_MAX_BYTES,
  type Spark,
  type SparkAttachment,
  type SparkAttachmentKind,
} from '../domain/spark';
import type {
  SparkAttachmentInput,
  SparkAttachmentIo,
  SparkRepository,
} from '../data/SparkRepository';

/** capture 编排结果：uploaded=false 表示行已落库但远端未备份（「未备份」徽标）。 */
export interface CaptureAttachmentOutcome {
  attachment: SparkAttachment;
  uploaded: boolean;
}

/** capture 输入（源文件与媒体元数据；uri/fileSize 由复制落盘后回报值组装）。 */
export interface CaptureInput {
  kind: SparkAttachmentKind;
  sourceUri: string;
  extension: string;
  durationMs?: number;
  width?: number;
  height?: number;
}

/**
 * 附件捕获编排（录音停止/拍照完成/相册选取后调用）：
 * 1. copyIntoSparksDir：源文件复制进 sparks/<uuid>.<ext>（回报真实 fileSize）；
 * 2. 超 25MB 上限：删除副本并抛错（调用方 Alert 披露，提案 D4）；
 * 3. addAttachment：kind/fileSize/uri 守卫 + 灵感存在性 + 上限 20（违反抛错，
 *    行不落库，副本保留由调用方决定清理——上限场景副本无引用，一并删除）；
 * 4. uploadSparkFile（60s 超时）→ markAttachmentUploaded 回填 remote_path+sha256；
 * 5. 上传失败：console.warn 披露 + uploaded=false（本地可用，详情页可重传）。
 */
export async function captureAttachment(
  io: SparkAttachmentIo,
  repo: SparkRepository,
  sparkId: string,
  input: CaptureInput,
): Promise<CaptureAttachmentOutcome> {
  const copied = await io.copyIntoSparksDir(input.sourceUri, input.extension);
  if (copied.fileSize > SPARK_ATTACHMENT_MAX_BYTES) {
    await io.deleteFile(copied.uri);
    throw new Error('附件超出 25MB 上限，未保存');
  }
  const rowInput: SparkAttachmentInput = {
    kind: input.kind,
    uri: copied.uri,
    fileSize: copied.fileSize,
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(input.width !== undefined ? { width: input.width } : {}),
    ...(input.height !== undefined ? { height: input.height } : {}),
  };
  let attachment: SparkAttachment;
  try {
    attachment = await repo.addAttachment(sparkId, rowInput);
  } catch (error) {
    // 行未落库（灵感不存在/上限 20）：副本无引用，删除后原样抛错给调用方披露。
    await io.deleteFile(copied.uri).catch(() => undefined);
    throw error;
  }
  try {
    const uploaded = await io.uploadSparkFile(copied.uri, fileNameFromUri(copied.uri));
    const marked = await repo.markAttachmentUploaded(attachment.id, uploaded);
    return { attachment: marked, uploaded: true };
  } catch (error) {
    console.warn('[slice-37] 附件上传失败（未备份，可在详情页重传）', error);
    return { attachment, uploaded: false };
  }
}

/** 未备份附件重传（详情页入口）：uploadSparkFile → markAttachmentUploaded。 */
export async function reuploadAttachment(
  io: SparkAttachmentIo,
  repo: SparkRepository,
  attachment: SparkAttachment,
): Promise<SparkAttachment> {
  const uploaded = await io.uploadSparkFile(attachment.uri, fileNameFromUri(attachment.uri));
  return repo.markAttachmentUploaded(attachment.id, uploaded);
}

/** file:///…/<name>.<ext> → <name>.<ext>（去 query/fragment，空段回退 'file'）。 */
export function fileNameFromUri(uri: string): string {
  const clean = uri.split('?')[0].split('#')[0];
  const segments = clean.split('/');
  const last = segments[segments.length - 1];
  return last.length > 0 ? last : 'file';
}

/** 图像资产扩展名（uri 提取 [a-z0-9]{1,5}，回退 jpg——picker 产物 jpg/png 为主）。 */
export function imageExtensionFromUri(uri: string): string {
  const name = fileNameFromUri(uri);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return 'jpg';
  const ext = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'jpg';
}

/** 卡片主行文本：title ?? content 首行 ?? 纯录音占位（提案 D6 摘要两行的第一行）。 */
export function sparkDisplayTitle(spark: Pick<Spark, 'title' | 'content'>): string {
  if (spark.title !== null && spark.title.trim().length > 0) {
    return spark.title.trim();
  }
  if (spark.content !== null && spark.content.trim().length > 0) {
    const firstLine = spark.content.split('\n')[0]?.trim() ?? '';
    return firstLine.length > 0 ? firstLine : '（纯录音灵感）';
  }
  return '（纯录音灵感）';
}

/** 次行预览：title 存在时展示 content 首行；否则 null（主行已是 content）。 */
export function sparkDisplayPreview(spark: Pick<Spark, 'title' | 'content'>): string | null {
  if (spark.title !== null && spark.title.trim().length > 0 && spark.content !== null && spark.content.trim().length > 0) {
    const firstLine = spark.content.split('\n')[0]?.trim() ?? '';
    return firstLine.length > 0 ? firstLine : null;
  }
  return null;
}

/** 相对时间（灵感卡右下角，提案 D6）：刚刚/n分钟前/n小时前/n天前/YYYY-MM-DD。 */
export function formatRelativeTime(timestamp: number, now: number): string {
  const diffMs = now - timestamp;
  if (diffMs < 0) {
    return formatDateLabel(timestamp);
  }
  const minuteMs = 60_000;
  if (diffMs < minuteMs) return '刚刚';
  if (diffMs < 60 * minuteMs) return `${Math.floor(diffMs / minuteMs)}分钟前`;
  if (diffMs < 24 * 60 * minuteMs) return `${Math.floor(diffMs / (60 * minuteMs))}小时前`;
  if (diffMs < 30 * 24 * 60 * minuteMs) return `${Math.floor(diffMs / (24 * 60 * minuteMs))}天前`;
  return formatDateLabel(timestamp);
}

function formatDateLabel(timestamp: number): string {
  const d = new Date(timestamp);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** 录音时长 'm:ss'（负数/NaN 归 0:00；≥1h 显示 'H:MM:SS'）。 */
export function formatRecordingDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

/** 附件行徽标文案：已备份 / 未备份（remote_path 非空即已上云，提案 D4）。 */
export function attachmentBackupLabel(attachment: Pick<SparkAttachment, 'remotePath'>): string {
  return attachment.remotePath !== null ? '已备份' : '未备份';
}

/** 附件 kind 标签：录音 / 图片（详情页行首）。 */
export function attachmentKindLabel(kind: SparkAttachmentKind): string {
  return kind === 'audio' ? '录音' : '图片';
}
