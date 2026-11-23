/**
 * SparkRepository 端口（切片 37，AGENTS.md §7.49 D3；ItemRepository 分层同构）。
 *
 * 契约外显式扩展先例（repository.md 注记节随本切片登记）：
 * - Spark 数据只经本端口访问（AGENTS.md §4.2：UI/domain 不得直接 import
 *   WatermelonDB）；实现类 WatermelonSparkRepository（两遍法事务纪律同款）。
 * - linkSparkToItem 前做 item_id 存在性校验（不命中抛错，updateItem 的
 *   categoryId 校验同构；schema 层不建外键）。
 * - deleteSpark/deleteAttachment 级联：附件行同删 + 本地文件删除 + 远端 DELETE
 *   （远端/本地失败仅披露不阻塞——提案 D4「失败仅披露」）。
 * - 附件远端与本地文件 IO 经 SparkAttachmentIo 注入端口：默认实现
 *   sparkAttachmentIo.ts（expo-file-system + WebdavClient 60s 超时），
 *   单测注入 stub 不触网不触盘。
 */

import type {
  Spark,
  SparkAttachment,
  SparkAttachmentKind,
  SparkLinkedItemSummary,
} from '../domain/spark';

/** 附件落库输入（uri 必填：本地文件先落盘再调 addAttachment，提案 D4）。 */
export interface SparkAttachmentInput {
  kind: SparkAttachmentKind;
  uri: string;
  fileSize: number;
  durationMs?: number;
  width?: number;
  height?: number;
}

/** 附件上云回填（即时上传成功后 markAttachmentUploaded 用）。 */
export interface SparkAttachmentUploadPatch {
  remotePath: string;
  sha256: string;
}

/** 上传结果（uploadSparkFile 内部计算 hash 命名，回填 markAttachmentUploaded 用）。 */
export interface SparkUploadResult {
  /** 远端文件名（life-attachments 内，不含目录前缀——buildAttachmentRemoteName 产物）。 */
  remotePath: string;
  /** 文件字节 SHA-256 HEX（expo-crypto digest）。 */
  sha256: string;
}

/** 复制结果（copyIntoSparksDir：文件落 sparks/ 后回报 uri 与文件大小）。 */
export interface SparkCopiedFile {
  uri: string;
  fileSize: number;
}

/**
 * 附件文件与远端 IO 端口（切片 37）：Repository 数据行与文件系统/WebDAV 解耦。
 * - copyIntoSparksDir：录音/拍照/相册产物复制进 sparks/<uuid>.<ext> 并回报
 *   文件大小（capture 编排用；copy 失败抛错）；
 * - deleteFile：文件不存在视为成功（幂等）；
 * - deleteRemoteFile：远端 404 视为成功（幂等）；其余失败抛错由调用方披露；
 * - uploadSparkFile：读本地文件 → 字节 SHA-256 → buildAttachmentRemoteName hash 命名
 *   → PUT（60s 超时）；单次文件读取；缺 WebDAV 配置抛错（调用方转「未备份」披露）；
 * - downloadToSparksDir：下载远端附件写入 sparks/ 本地目录并返回新 uri
 *   （数据恢复附件文件补链路，事务外执行）。
 */
export interface SparkAttachmentIo {
  copyIntoSparksDir(sourceUri: string, extension: string): Promise<SparkCopiedFile>;
  fileExists(uri: string): Promise<boolean>;
  deleteFile(uri: string): Promise<void>;
  downloadToSparksDir(remoteName: string): Promise<string>;
  deleteRemoteFile(remoteName: string): Promise<void>;
  uploadSparkFile(localUri: string, originalFileName: string): Promise<SparkUploadResult>;
}

export interface SparkRepository {
  /** 创建灵感；title/content 可同时缺省（录音流程先建行，提案 D3）。 */
  createSpark(input: { title?: string; content?: string }): Promise<Spark>;

  /** 编辑灵感（trim 后空串归 null，保持双可空语义）；灵感不存在抛错。 */
  updateSpark(id: string, patch: { title?: string; content?: string }): Promise<Spark>;

  /** 删除灵感：级联附件行 + 本地文件 + 远端 DELETE（失败仅披露）；关联行同删。 */
  deleteSpark(id: string): Promise<void>;

  /** 灵感流：created_at 倒序（新在前，提案 D6）。 */
  listSparks(): Promise<Spark[]>;

  /** 单条灵感；不存在返回 null（详情页容错）。 */
  getSparkById(id: string): Promise<Spark | null>;

  /** 灵感附件（created_at 升序）；灵感不存在抛错。 */
  listAttachments(sparkId: string): Promise<SparkAttachment[]>;

  /** 追加附件行（kind 守卫 + 上限 20 + 灵感存在性校验，违反抛错）。 */
  addAttachment(sparkId: string, input: SparkAttachmentInput): Promise<SparkAttachment>;

  /** 删除单个附件：行 + 本地文件 + 远端 DELETE（失败仅披露）。 */
  deleteAttachment(attachmentId: string): Promise<void>;

  /** 即时上传成功回填 remote_path + sha256；附件不存在抛错。 */
  markAttachmentUploaded(
    attachmentId: string,
    patch: SparkAttachmentUploadPatch,
  ): Promise<SparkAttachment>;

  /** 单个附件；不存在返回 null（重传入口容错）。 */
  getAttachmentById(attachmentId: string): Promise<SparkAttachment | null>;

  /** 关联计划（item_id 存在性校验 + 上限 50 + 幂等，违反/重复处理见实现）。 */
  linkSparkToItem(sparkId: string, itemId: string): Promise<void>;

  /** 解除关联（幂等：不存在的 join 行静默成功）。 */
  unlinkSparkFromItem(sparkId: string, itemId: string): Promise<void>;

  /** 灵感关联的条目摘要水合（join created_at 升序）；灵感不存在抛错。 */
  listItemsForSpark(sparkId: string): Promise<SparkLinkedItemSummary[]>;
}
