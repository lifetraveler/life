import { Model } from '@nozbe/watermelondb';
import { date, field, readonly, text } from '@nozbe/watermelondb/decorators';

/**
 * flash_chat_messages 表 model（切片 38 schema v20，AGENTS.md §7.50）。
 * - seq：业务序号（内存消息 id 即 seq；启动恢复按 seq 升序平铺、nextIdRef=maxSeq+1）。
 *   非主键——行 id 由 WatermelonDB 自动生成；唯一性由 ChatMessageRepository 写路径
 *   （replaceTail 全量 upsert by seq）保证，schema 层不建唯一索引。
 * - role 仅 'user' | 'assistant'、kind 仅 'text' | 'card'（schema 层不建 CHECK，
 *   Repository 写路径守卫枚举外抛错；confirm/debug 瞬态消息在 persist 过滤层排除，
 *   Q2 定案）。
 * - card_payload_json / seed_json 可空：text 行恒 null；kind='card' 时
 *   card_payload_json 为 FlashCardPayload 序列化串（恢复 parse 失败降级 text）；
 *   seed_json 为保存链 serializeDraftForHistory 产物（末卡播种恢复 historyRef）。
 * - created_at 由 @readonly @date 在 create 时自动写入（毫秒时间戳）；排序只认
 *   seq，created_at 不参与会话语义。
 * 无 associations 声明：本表无关联（§7.23 水合纪律不涉及）。
 * - role/kind 按联合类型声明（SparkAttachmentModel.kind 先例——schema 层不建
 *   CHECK，枚举约束由 Repository 写路径守卫与读路径防御保证）。
 */
export default class ChatMessageModel extends Model {
  static table = 'flash_chat_messages';

  @field('seq') seq!: number;

  @text('role') role!: 'user' | 'assistant';

  @text('text') text!: string;

  @text('kind') kind!: 'text' | 'card';

  @text('card_payload_json') cardPayloadJson!: string | null;

  @text('seed_json') seedJson!: string | null;

  @readonly @date('created_at') createdAt!: Date;
}
