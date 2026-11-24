/**
 * ChatMessageRepository 端口（切片 38，AGENTS.md §7.50 D2；ItemRepository/
 * SparkRepository 分层同构）。
 *
 * 契约外显式扩展先例（repository.md v0.44 注记节随本切片登记）：
 * - 聊天持久化数据只经本端口访问（AGENTS.md §4.2：UI/domain 不得直接 import
 *   WatermelonDB）；实现类 WatermelonChatMessageRepository。
 * - replaceTail：全量 upsert by seq——输入=当前完整消息列表（persist 侧已过滤
 *   confirm/debug 瞬态），语义为「新 seq insert / 已有 seq 覆盖 / 未入选 kept 的
 *   既有行删除（含 seq<maxSeq-199 的滚动裁剪与 remove 模式等已从内存移除的行）」；
 *   上限最近 200 条（persist 裁剪 / 快照组包 / 恢复上限三处对齐
 *   CHAT_MESSAGE_PERSIST_LIMIT）。
 * - 空输入 no-op：不写不删（保护启动恢复竞态窗口——persist effect 首跑时内存
 *   尚未恢复，若按空列表全删会清空历史）。
 * - role/kind/seq 写路径守卫：枚举外/非正整数抛错（Repository 层守卫先例，
 *   schema 层不建 CHECK）。
 */

/** 持久化行形状（UI 层 FlashChatMessage ↔ 本形状经 src/ui/chatPersistence.ts 映射）。 */
export interface PersistedChatMessage {
  /** 业务序号=内存消息 id（升序即会话顺序；恢复时回填为内存 id）。 */
  seq: number;
  role: 'user' | 'assistant';
  text: string;
  kind: 'text' | 'card';
  /** kind='card' 的 FlashCardPayload 序列化串；text 行恒 null。 */
  cardPayloadJson: string | null;
  /** 保存链播种串（serializeDraftForHistory 产物）；仅 card 行可非 null。 */
  seedJson: string | null;
}

/** 持久化上限（§7.50 Q2：最近 200 条滚动裁剪；persist/快照组包/恢复三处对齐）。 */
export const CHAT_MESSAGE_PERSIST_LIMIT = 200;

export interface ChatMessageRepository {
  /**
   * 全量落库当前消息列表尾部：kept=输入按 seq 升序取最后 CHAT_MESSAGE_PERSIST_LIMIT
   * 条；新 seq insert、已有 seq 覆盖（text/kind/role/两个 JSON 列写穿）、未入选
   * kept 的既有行删除。空输入 no-op。输入 seq 重复抛错（内存 id 唯一性契约）。
   */
  replaceTail(messages: PersistedChatMessage[]): Promise<void>;

  /**
   * 按 seq 升序返回最近 limit 条（不足 limit 全量返回）；用于启动恢复
   * （listOrdered(CHAT_MESSAGE_PERSIST_LIMIT)）。
   */
  listOrdered(limit: number): Promise<PersistedChatMessage[]>;
}
