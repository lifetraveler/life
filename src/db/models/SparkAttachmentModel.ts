import { Model } from '@nozbe/watermelondb';
import { date, field, readonly, text } from '@nozbe/watermelondb/decorators';

import type { SparkAttachmentKind } from '../../domain/spark';

/**
 * spark_attachments 表 model（切片 37 schema v19，AGENTS.md §7.49）。
 * - kind 仅 'audio' | 'image'（schema 层不建 CHECK，Repository 写路径守卫枚举外抛错）；
 * - uri 为本地文件绝对路径（documentDirectory/sparks/<uuid>.<ext>，提案 D4）；
 * - remote_path 存 life-attachments 内的远端文件名（不含目录前缀，跨设备 basePath
 *   可迁移）；即时上传失败为 null（「未备份」徽标 + 详情页重传）；
 * - file_size 非可选（写路径必带）；duration_ms 仅录音、width/height 仅图片（isOptional）。
 */
export default class SparkAttachmentModel extends Model {
  static table = 'spark_attachments';

  @text('spark_id') sparkId!: string;

  @text('kind') kind!: SparkAttachmentKind;

  @text('uri') uri!: string;

  @text('remote_path') remotePath!: string | null;

  @text('sha256') sha256!: string | null;

  @field('file_size') fileSize!: number;

  @field('duration_ms') durationMs!: number | null;

  @field('width') width!: number | null;

  @field('height') height!: number | null;

  @readonly @date('created_at') createdAt!: Date;
}
