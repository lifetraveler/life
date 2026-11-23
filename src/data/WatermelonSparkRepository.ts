/**
 * SparkRepository 实现（切片 37，AGENTS.md §7.49 D3；WatermelonItemRepository
 * 分层同构）。纪律（repository.md 注记节 + 既有先例）：
 *
 * - 事务两遍法：多行写路径在单 db.write 内同步收集 operations → 单次
 *   db.batch（Model.update/create 逐个走 db.batch 不构成事务，见
 *   WatermelonItemRepository 内既有注释）；
 * - id 保真由数据快照恢复链负责（prepareCreateFromDirtyRaw 先例，本类不涉及）；
 * - linkSparkToItem 的 item_id 存在性校验在写路径（schema 不建外键）；
 * - 级联删除顺序：先库内行（单事务原子），后本地文件与远端 DELETE（事务外
 *   逐个执行，失败仅 console.warn 披露不阻塞——提案 D4）；
 * - 附件文件/远端 IO 经 SparkAttachmentIo 注入（默认实现在 src/data/index.ts
 *   装配，本类不含 expo-file-system/WebDAV 依赖，单测注入 stub）。
 */

import { Database, Q } from '@nozbe/watermelondb';

import type {
  Spark,
  SparkAttachment,
  SparkLinkedItemSummary,
} from '../domain/spark';
import { SPARK_ATTACHMENT_KINDS, SPARK_ATTACHMENT_MAX_COUNT, SPARK_ITEM_LINK_MAX } from '../domain/spark';
import type CategoryModel from '../db/models/CategoryModel';
import type ItemModel from '../db/models/ItemModel';
import SparkAttachmentModel from '../db/models/SparkAttachmentModel';
import SparkItemModel from '../db/models/SparkItemModel';
import SparkModel from '../db/models/SparkModel';
import { toDomainItem } from './WatermelonItemRepository';
import type {
  SparkAttachmentInput,
  SparkAttachmentUploadPatch,
  SparkAttachmentIo,
  SparkRepository,
} from './SparkRepository';

const SPARKS_TABLE = 'sparks';
const SPARK_ATTACHMENTS_TABLE = 'spark_attachments';
const SPARK_ITEMS_TABLE = 'spark_items';
const ITEMS_TABLE = 'items';
const CATEGORIES_TABLE = 'categories';

function toDomainSpark(model: SparkModel): Spark {
  return {
    id: model.id,
    title: model.title ?? null,
    content: model.content ?? null,
    createdAt: model.createdAt.getTime(),
    updatedAt: model.updatedAt.getTime(),
  };
}

/** kind 读路径防御（toDomainChannelPreset 先例：非法枚举行抛错不静默）。 */
function toDomainAttachment(model: SparkAttachmentModel): SparkAttachment {
  if (!SPARK_ATTACHMENT_KINDS.includes(model.kind)) {
    throw new Error(`spark_attachments row ${model.id} has invalid kind: ${model.kind}`);
  }
  return {
    id: model.id,
    sparkId: model.sparkId,
    kind: model.kind,
    uri: model.uri,
    remotePath: model.remotePath ?? null,
    sha256: model.sha256 ?? null,
    fileSize: model.fileSize,
    durationMs: model.durationMs ?? null,
    width: model.width ?? null,
    height: model.height ?? null,
    createdAt: model.createdAt.getTime(),
  };
}

/** trim 后空串归 null（title/content 双可空语义，提案 D3）。 */
function normalizeNullableText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export class WatermelonSparkRepository implements SparkRepository {
  private readonly db: Database;

  private readonly io: SparkAttachmentIo;

  constructor(db: Database, io: SparkAttachmentIo) {
    this.db = db;
    this.io = io;
  }

  async createSpark(input: { title?: string; content?: string }): Promise<Spark> {
    return this.db.write(async () => {
      const record = await this.db
        .get<SparkModel>(SPARKS_TABLE)
        .create((row) => {
          row.title = normalizeNullableText(input.title);
          row.content = normalizeNullableText(input.content);
        });
      return toDomainSpark(record);
    });
  }

  async updateSpark(id: string, patch: { title?: string; content?: string }): Promise<Spark> {
    return this.db.write(async () => {
      const models = await this.db
        .get<SparkModel>(SPARKS_TABLE)
        .query(Q.where('id', id))
        .fetch();
      if (models.length === 0) {
        throw new Error(`updateSpark: 灵感不存在（${id}）`);
      }
      const model = models[0];
      await model.update((row) => {
        if (patch.title !== undefined) {
          row.title = normalizeNullableText(patch.title);
        }
        if (patch.content !== undefined) {
          row.content = normalizeNullableText(patch.content);
        }
      });
      return toDomainSpark(model);
    });
  }

  async deleteSpark(id: string): Promise<void> {
    // 先收集待清理的本地文件与远端名（事务外逐个清理，失败仅披露）。
    const attachmentUris: string[] = [];
    const remoteNames: string[] = [];
    await this.db.write(async () => {
      const sparkModels = await this.db
        .get<SparkModel>(SPARKS_TABLE)
        .query(Q.where('id', id))
        .fetch();
      // 幂等：不存在的灵感删除静默成功（并发删除场景，与 unlink 幂等同口径）。
      if (sparkModels.length === 0) return;
      const spark = sparkModels[0];
      const attachmentModels = await this.db
        .get<SparkAttachmentModel>(SPARK_ATTACHMENTS_TABLE)
        .query(Q.where('spark_id', id))
        .fetch();
      const linkModels = await this.db
        .get<SparkItemModel>(SPARK_ITEMS_TABLE)
        .query(Q.where('spark_id', id))
        .fetch();
      for (const attachment of attachmentModels) {
        attachmentUris.push(attachment.uri);
        if (attachment.remotePath !== null && attachment.remotePath !== undefined) {
          remoteNames.push(attachment.remotePath);
        }
      }
      // 两遍法：单事务单 batch 原子级联（附件行 + 关联行 + 灵感行）。
      await this.db.batch(
        ...attachmentModels.map((model) => model.prepareDestroyPermanently()),
        ...linkModels.map((model) => model.prepareDestroyPermanently()),
        spark.prepareDestroyPermanently(),
      );
    });
    // 事务外清理：本地文件 + 远端 DELETE；失败仅披露（提案 D4），不影响删除语义。
    for (const uri of attachmentUris) {
      try {
        await this.io.deleteFile(uri);
      } catch (e) {
        console.warn(`deleteSpark: 删除附件本地文件失败（${uri}）：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    for (const remoteName of remoteNames) {
      try {
        await this.io.deleteRemoteFile(remoteName);
      } catch (e) {
        console.warn(`deleteSpark: 删除远端附件失败（${remoteName}）：${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  async listSparks(): Promise<Spark[]> {
    const models = await this.db
      .get<SparkModel>(SPARKS_TABLE)
      .query(Q.sortBy('created_at', 'desc'))
      .fetch();
    return models.map(toDomainSpark);
  }

  async getSparkById(id: string): Promise<Spark | null> {
    const models = await this.db
      .get<SparkModel>(SPARKS_TABLE)
      .query(Q.where('id', id))
      .fetch();
    return models.length > 0 ? toDomainSpark(models[0]) : null;
  }

  async listAttachments(sparkId: string): Promise<SparkAttachment[]> {
    await this.assertSparkExists(sparkId, 'listAttachments');
    const models = await this.db
      .get<SparkAttachmentModel>(SPARK_ATTACHMENTS_TABLE)
      .query(Q.where('spark_id', sparkId), Q.sortBy('created_at', 'asc'))
      .fetch();
    return models.map(toDomainAttachment);
  }

  async addAttachment(sparkId: string, input: SparkAttachmentInput): Promise<SparkAttachment> {
    if (!SPARK_ATTACHMENT_KINDS.includes(input.kind)) {
      throw new Error(`addAttachment: 非法附件类型（${input.kind}）`);
    }
    if (!Number.isFinite(input.fileSize) || input.fileSize < 0) {
      throw new Error(`addAttachment: 非法文件大小（${input.fileSize}）`);
    }
    if (input.uri.trim().length === 0) {
      throw new Error('addAttachment: 附件本地路径不能为空');
    }
    return this.db.write(async () => {
      await this.assertSparkExists(sparkId, 'addAttachment');
      const attachmentCollection = this.db.get<SparkAttachmentModel>(SPARK_ATTACHMENTS_TABLE);
      const existingCount = await attachmentCollection
        .query(Q.where('spark_id', sparkId))
        .fetchCount();
      if (existingCount >= SPARK_ATTACHMENT_MAX_COUNT) {
        throw new Error(`addAttachment: 附件数已达上限（${SPARK_ATTACHMENT_MAX_COUNT}）`);
      }
      const record = await attachmentCollection.create((row) => {
        row.sparkId = sparkId;
        row.kind = input.kind;
        row.uri = input.uri;
        row.remotePath = null;
        row.sha256 = null;
        row.fileSize = input.fileSize;
        row.durationMs = input.durationMs ?? null;
        row.width = input.width ?? null;
        row.height = input.height ?? null;
      });
      return toDomainAttachment(record);
    });
  }

  async deleteAttachment(attachmentId: string): Promise<void> {
    let localUri: string | null = null;
    let remoteName: string | null = null;
    await this.db.write(async () => {
      const models = await this.db
        .get<SparkAttachmentModel>(SPARK_ATTACHMENTS_TABLE)
        .query(Q.where('id', attachmentId))
        .fetch();
      // 幂等：不存在的附件静默成功（与 deleteSpark 同口径）。
      if (models.length === 0) return;
      const model = models[0];
      localUri = model.uri;
      if (model.remotePath !== null && model.remotePath !== undefined) {
        remoteName = model.remotePath;
      }
      await this.db.batch(model.prepareDestroyPermanently());
    });
    // 事务外清理（失败仅披露，提案 D4）。
    if (localUri !== null) {
      try {
        await this.io.deleteFile(localUri);
      } catch (e) {
        console.warn(`deleteAttachment: 删除本地文件失败（${localUri}）：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (remoteName !== null) {
      try {
        await this.io.deleteRemoteFile(remoteName);
      } catch (e) {
        console.warn(`deleteAttachment: 删除远端附件失败（${remoteName}）：${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  async markAttachmentUploaded(
    attachmentId: string,
    patch: SparkAttachmentUploadPatch,
  ): Promise<SparkAttachment> {
    return this.db.write(async () => {
      const models = await this.db
        .get<SparkAttachmentModel>(SPARK_ATTACHMENTS_TABLE)
        .query(Q.where('id', attachmentId))
        .fetch();
      if (models.length === 0) {
        throw new Error(`markAttachmentUploaded: 附件不存在（${attachmentId}）`);
      }
      const model = models[0];
      await model.update((row) => {
        row.remotePath = patch.remotePath;
        row.sha256 = patch.sha256;
      });
      return toDomainAttachment(model);
    });
  }

  async getAttachmentById(attachmentId: string): Promise<SparkAttachment | null> {
    const models = await this.db
      .get<SparkAttachmentModel>(SPARK_ATTACHMENTS_TABLE)
      .query(Q.where('id', attachmentId))
      .fetch();
    return models.length > 0 ? toDomainAttachment(models[0]) : null;
  }

  async linkSparkToItem(sparkId: string, itemId: string): Promise<void> {
    await this.db.write(async () => {
      await this.assertSparkExists(sparkId, 'linkSparkToItem');
      const itemModels = await this.db
        .get<ItemModel>(ITEMS_TABLE)
        .query(Q.where('id', itemId))
        .fetch();
      if (itemModels.length === 0) {
        throw new Error(`linkSparkToItem: 条目不存在（${itemId}）`);
      }
      const linkCollection = this.db.get<SparkItemModel>(SPARK_ITEMS_TABLE);
      const existing = await linkCollection
        .query(Q.where('spark_id', sparkId), Q.where('item_id', itemId))
        .fetch();
      // 幂等：重复关联静默成功（addTagToItem 同款纪律）。
      if (existing.length > 0) return;
      const count = await linkCollection.query(Q.where('spark_id', sparkId)).fetchCount();
      if (count >= SPARK_ITEM_LINK_MAX) {
        throw new Error(`linkSparkToItem: 关联计划数已达上限（${SPARK_ITEM_LINK_MAX}）`);
      }
      await linkCollection.create((row) => {
        row.sparkId = sparkId;
        row.itemId = itemId;
      });
    });
  }

  async unlinkSparkFromItem(sparkId: string, itemId: string): Promise<void> {
    await this.db.write(async () => {
      const models = await this.db
        .get<SparkItemModel>(SPARK_ITEMS_TABLE)
        .query(Q.where('spark_id', sparkId), Q.where('item_id', itemId))
        .fetch();
      // 幂等：不存在的 join 行静默成功（提案 D7 行内解除并发场景）。
      if (models.length === 0) return;
      await this.db.batch(models[0].prepareDestroyPermanently());
    });
  }

  async listItemsForSpark(sparkId: string): Promise<SparkLinkedItemSummary[]> {
    await this.assertSparkExists(sparkId, 'listItemsForSpark');
    const linkModels = await this.db
      .get<SparkItemModel>(SPARK_ITEMS_TABLE)
      .query(Q.where('spark_id', sparkId), Q.sortBy('created_at', 'asc'))
      .fetch();
    if (linkModels.length === 0) return [];
    const itemIds = linkModels.map((link) => link.itemId);
    const itemModels = await this.db
      .get<ItemModel>(ITEMS_TABLE)
      .query(Q.where('id', Q.oneOf(itemIds)))
      .fetch();
    const itemById = new Map(itemModels.map((model) => [model.id, toDomainItem(model)]));
    const categoryModels = await this.db
      .get<CategoryModel>(CATEGORIES_TABLE)
      .query()
      .fetch();
    const categoryById = new Map(categoryModels.map((model) => [model.id, model]));
    const summaries: SparkLinkedItemSummary[] = [];
    for (const link of linkModels) {
      const item = itemById.get(link.itemId);
      // 悬挂关联（item 已删而 join 未清）跳过：删除条目不级联清 join 行，
      // 渲染面静默忽略（数据快照恢复 spark_items 对 resolved sparks 重建）。
      if (item === undefined) continue;
      const category = categoryById.get(item.categoryId);
      summaries.push({
        itemId: item.id,
        title: item.title,
        status: item.status,
        startAt: item.startAt,
        allDay: item.allDay,
        categoryColor: category !== undefined ? category.color : null,
        categoryEmoji: category !== undefined ? category.emoji : null,
        linkedAt: link.createdAt.getTime(),
      });
    }
    return summaries;
  }

  /** 灵感存在性校验（事务内可复用；不命中抛错，updateItem categoryId 校验同构）。 */
  private async assertSparkExists(sparkId: string, action: string): Promise<void> {
    const models = await this.db
      .get<SparkModel>(SPARKS_TABLE)
      .query(Q.where('id', sparkId))
      .fetch();
    if (models.length === 0) {
      throw new Error(`${action}: 灵感不存在（${sparkId}）`);
    }
  }
}
