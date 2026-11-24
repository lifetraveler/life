/**
 * 闪电对话持久化映射层（切片 38 阶段 1，AGENTS.md §7.50 D2/D3；纯函数，
 * useFlashChat 接线在阶段 2）。
 *
 * - toPersistedChatMessages：过滤瞬态交互态（Q2 定案）——kind='confirm' 的确认
 *   拦截轮与挂 debugPayload 的调试入口消息不落库；映射 seq=内存消息 id、
 *   cardPayload 序列化为 JSON 串、seedJson 直传（保存链播种产物）。
 * - fromPersistedChatRows：启动恢复——seq 升序原序平铺（内存 id=seq 延续）；
 *   kind='card' 行的 cardPayloadJson 经严格形状守卫解析，任一失败降级
 *   kind:'text'（不炸列表）；末卡播种=最后一条带 seedJson 的 card 行
 *   （payload 降级不影响 seed 可用性），返回 seedText 供 useFlashChat 恢复
 *   historyRef（Q3「改一下刚才那个」跨重启可用）。
 * - 200 条裁剪不在此层：replaceTail/listOrdered/快照组包三处按
 *   CHAT_MESSAGE_PERSIST_LIMIT 对齐（端口与快照层裁剪）。
 */

import type { PersistedChatMessage } from '../data/ChatMessageRepository';
import type { FlashCardPayload } from '../domain/ai/types';
import type { FlashChatMessage } from './useFlashChat';

const ITEM_TYPES: readonly string[] = ['note', 'task', 'event'];
const REMINDER_FREQUENCIES: readonly string[] = ['daily', 'weekly', 'monthly', 'once'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** OnceCivilTime 形状守卫：五个整数字段（月历有效性由落库层 CivilTime 换算判定）。 */
function isOnceCivilTimeLike(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    Number.isInteger(value.year) &&
    Number.isInteger(value.month) &&
    Number.isInteger(value.day) &&
    Number.isInteger(value.hour) &&
    Number.isInteger(value.minute)
  );
}

function isCategorySnapshotLike(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    typeof value.name === 'string' &&
    isStringOrNull(value.color) &&
    isStringOrNull(value.emoji)
  );
}

function isReminderSnapshotLike(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    REMINDER_FREQUENCIES.includes(value.frequency as string) &&
    isInteger(value.localTimeHour) &&
    value.localTimeHour >= 0 &&
    value.localTimeHour <= 23 &&
    isInteger(value.localTimeMinute) &&
    value.localTimeMinute >= 0 &&
    value.localTimeMinute <= 59 &&
    Array.isArray(value.weekdays) &&
    value.weekdays.every((weekday) => isInteger(weekday)) &&
    isFiniteNumber(value.dayOfMonth) &&
    Number.isInteger(value.dayOfMonth) &&
    (value.onceAt === null || isOnceCivilTimeLike(value.onceAt)) &&
    typeof value.tzid === 'string' &&
    Array.isArray(value.channels) &&
    value.channels.every((channel) => typeof channel === 'string')
  );
}

/**
 * card_payload_json 恢复守卫（严格顶层形状；任一失败返回 null → 调用方降级
 * kind:'text'）。FlashCardPayload 恒携带全部键（切片 22 起 pushCard 全量构造），
 * 这里不提供键缺省宽容。
 */
export function parseCardPayload(json: string): FlashCardPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (!isNonEmptyString(parsed.itemId)) return null;
  if (typeof parsed.title !== 'string' || typeof parsed.content !== 'string') return null;
  if (!ITEM_TYPES.includes(parsed.type as string)) return null;
  if (parsed.startAt !== null && !isFiniteNumber(parsed.startAt)) return null;
  if (parsed.endAt !== null && !isFiniteNumber(parsed.endAt)) return null;
  if (typeof parsed.allDay !== 'boolean') return null;
  if (!isCategorySnapshotLike(parsed.category)) return null;
  if (!Array.isArray(parsed.reminders)) return null;
  if (!parsed.reminders.every((reminder) => isReminderSnapshotLike(reminder))) return null;
  return parsed as unknown as FlashCardPayload;
}

/** 恢复结果：平铺消息 + 末卡播种串（无带 seed 的卡为 null）。 */
export interface RestoredChatState {
  messages: FlashChatMessage[];
  seedText: string | null;
}

/**
 * persist 过滤映射（useFlashChat persist effect 输入 → 端口形状）：
 * 瞬态交互态（confirm / 调试入口消息）排除，其余全量落库（Q2 粒度）。
 */
export function toPersistedChatMessages(messages: FlashChatMessage[]): PersistedChatMessage[] {
  const persisted: PersistedChatMessage[] = [];
  for (const message of messages) {
    if (message.kind === 'confirm') continue;
    if (message.debugPayload !== undefined) continue;
    persisted.push({
      seq: message.id,
      role: message.role,
      text: message.text,
      kind: message.kind,
      cardPayloadJson:
        message.cardPayload !== undefined ? JSON.stringify(message.cardPayload) : null,
      seedJson: message.seedJson ?? null,
    });
  }
  return persisted;
}

/**
 * 启动恢复（listOrdered 输出 → 内存消息 + 末卡播种）：
 * - id=seq 平铺（nextIdRef 由调用方置 maxSeq+1 延续）；
 * - card 行 payload 解析失败降级 text（text 仍展示，不炸列表）；
 * - 末卡播种取最后一条带 seedJson 的 card 行（升序遍历末值覆盖=从尾向前第一条）。
 */
export function fromPersistedChatRows(rows: PersistedChatMessage[]): RestoredChatState {
  const messages: FlashChatMessage[] = [];
  let seedText: string | null = null;
  for (const row of rows) {
    let kind: FlashChatMessage['kind'] = row.kind;
    let cardPayload: FlashCardPayload | undefined;
    if (row.kind === 'card') {
      const parsed =
        row.cardPayloadJson !== null ? parseCardPayload(row.cardPayloadJson) : null;
      if (parsed === null) {
        kind = 'text';
      } else {
        cardPayload = parsed;
      }
      if (row.seedJson !== null) {
        seedText = row.seedJson;
      }
    }
    messages.push({
      id: row.seq,
      role: row.role,
      text: row.text,
      kind,
      cardPayload,
      seedJson: row.seedJson ?? undefined,
    });
  }
  return { messages, seedText };
}
