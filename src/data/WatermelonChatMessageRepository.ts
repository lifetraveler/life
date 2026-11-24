/**
 * ChatMessageRepository 实现（切片 38，AGENTS.md §7.50 D2；WatermelonSparkRepository
 * 分层同构）。纪律（repository.md v0.44 注记节 + 既有先例）：
 *
 * - replaceTail 多行写路径在单 db.write 内同步收集 operations → 单次 db.batch
 *   （两遍法；Model.update/create 逐个走 db.batch 不构成事务）；
 * - upsert by seq：新 seq insert（行 id/created_at 由 WatermelonDB 自动生成）/
 *   已有 seq 覆盖（text/kind/role/card_payload_json/seed_json 五字段写穿，字段
 *   无变化跳过 prepareUpdate）/未入选 kept 的既有行 prepareDestroyPermanently
 *   （严格覆盖任务卡「裁剪 seq<maxSeq-199」并连带 remove 模式等已从内存移除的
 *   行——persist 输入恒为当前完整消息列表）；created_at 为只读列不写穿；
 * - 空输入 no-op（保护启动恢复竞态窗口：persist effect 首跑时内存尚未恢复，
 *   若按空列表全删会清空历史）；
 * - seq 唯一性：输入重复 seq 抛错；写路径不建 SQLite 唯一索引（upsert 顺序内
 *   「先改后删」跨行无键冲突；数据快照恢复按 seq upsert 同口径）；
 * - 读路径 role/kind 非法枚举行抛错不静默（toDomainAttachment 先例）；
 * - created_at 不参与会话语义（排序只认 seq）；本类不做文件 IO、无注入端口。
 */

import { Database, Q } from '@nozbe/watermelondb';
import type { Model } from '@nozbe/watermelondb';
import ChatMessageModel from '../db/models/ChatMessageModel';
import { CHAT_MESSAGE_PERSIST_LIMIT } from './ChatMessageRepository';
import type { ChatMessageRepository, PersistedChatMessage } from './ChatMessageRepository';

const FLASH_CHAT_TABLE = 'flash_chat_messages';

const CHAT_ROLES: readonly string[] = ['user', 'assistant'];
const CHAT_KINDS: readonly string[] = ['text', 'card'];

/** seq/role/kind/text 写路径守卫（枚举外/非正整数 seq 抛错，schema 层不建 CHECK）。 */
function assertValidMessage(message: PersistedChatMessage, index: number): void {
  const where = `messages[${index}] (seq=${message.seq})`;
  if (!Number.isInteger(message.seq) || message.seq <= 0) {
    throw new Error(`chat message ${where}: seq must be a positive integer`);
  }
  if (!CHAT_ROLES.includes(message.role)) {
    throw new Error(`chat message ${where}: invalid role ${String(message.role)}`);
  }
  if (typeof message.text !== 'string') {
    throw new Error(`chat message ${where}: text must be a string`);
  }
  if (!CHAT_KINDS.includes(message.kind)) {
    throw new Error(`chat message ${where}: invalid kind ${String(message.kind)}`);
  }
}

/** 读路径防御：非法枚举 role/kind 抛错不静默（model 字段按联合类型声明，腐败行防御）。 */
function toPersistedMessage(model: ChatMessageModel): PersistedChatMessage {
  if (!CHAT_ROLES.includes(model.role)) {
    throw new Error(`flash_chat_messages row ${model.id} has invalid role: ${model.role}`);
  }
  if (!CHAT_KINDS.includes(model.kind)) {
    throw new Error(`flash_chat_messages row ${model.id} has invalid kind: ${model.kind}`);
  }
  return {
    seq: model.seq,
    role: model.role,
    text: model.text,
    kind: model.kind,
    cardPayloadJson: model.cardPayloadJson ?? null,
    seedJson: model.seedJson ?? null,
  };
}

export class WatermelonChatMessageRepository implements ChatMessageRepository {
  private database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  async replaceTail(messages: PersistedChatMessage[]): Promise<void> {
    // 空输入 no-op：不写不删（§7.50 启动恢复竞态防护——persist 首跑在恢复完成前
    // 触发时内存为空，不得据此清库）。
    if (messages.length === 0) {
      return;
    }

    // 输入 seq 唯一性契约（内存消息 id 恒唯一，重复=调用方 bug，显式抛错）。
    const seenSeqs = new Set<number>();
    for (let index = 0; index < messages.length; index += 1) {
      assertValidMessage(messages[index], index);
      if (seenSeqs.has(messages[index].seq)) {
        throw new Error(`chat message duplicate seq: ${messages[index].seq}`);
      }
      seenSeqs.add(messages[index].seq);
    }

    // kept=按 seq 升序取最后 CHAT_MESSAGE_PERSIST_LIMIT 条（§7.50 Q2 三处上限
    // 对齐之一：persist 侧裁剪）。
    const sorted = [...messages].sort((a, b) => a.seq - b.seq);
    const kept = sorted.slice(Math.max(sorted.length - CHAT_MESSAGE_PERSIST_LIMIT, 0));
    const keptBySeq = new Map(kept.map((message) => [message.seq, message]));

    await this.database.write(async () => {
      // 全表读（表规模有界：每次 persist 裁剪至 ≤200 行；快照恢复亦 ≤200），
      // upsert by seq 命中表 / 未命中建 / 不在 kept 全删。
      const table = this.database.get<ChatMessageModel>(FLASH_CHAT_TABLE);
      const existing = await table.query().fetch();
      const existingBySeq = new Map(existing.map((row) => [row.seq, row]));

      const operations: Model[] = [];
      for (const message of kept) {
        const row = existingBySeq.get(message.seq);
        if (row) {
          const nextCardPayloadJson = message.cardPayloadJson ?? null;
          const nextSeedJson = message.seedJson ?? null;
          if (
            row.text !== message.text ||
            row.kind !== message.kind ||
            row.role !== message.role ||
            row.cardPayloadJson !== nextCardPayloadJson ||
            row.seedJson !== nextSeedJson
          ) {
            operations.push(
              row.prepareUpdate((record) => {
                record.role = message.role;
                record.text = message.text;
                record.kind = message.kind;
                record.cardPayloadJson = nextCardPayloadJson;
                record.seedJson = nextSeedJson;
              }),
            );
          }
        } else {
          operations.push(
            table.prepareCreate((record) => {
              record.seq = message.seq;
              record.role = message.role;
              record.text = message.text;
              record.kind = message.kind;
              record.cardPayloadJson = message.cardPayloadJson ?? null;
              record.seedJson = message.seedJson ?? null;
            }),
          );
        }
      }
      // 未入选 kept 的既有行删除：滚动裁剪（seq 超出最近 200 窗口）与
      // remove/放弃等已从内存移除的消息一并落此分支。
      for (const row of existing) {
        if (!keptBySeq.has(row.seq)) {
          operations.push(row.prepareDestroyPermanently());
        }
      }
      await this.database.batch(...operations);
    });
  }

  async listOrdered(limit: number): Promise<PersistedChatMessage[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(`listOrdered: limit must be a positive integer, got ${limit}`);
    }
    // seq 升序全读（表规模有界）后取末尾 limit 条=最近 limit 条。
    const rows = await this.database
      .get<ChatMessageModel>(FLASH_CHAT_TABLE)
      .query(Q.sortBy('seq', Q.asc))
      .fetch();
    const selected = rows.slice(Math.max(rows.length - limit, 0));
    return selected.map(toPersistedMessage);
  }
}
