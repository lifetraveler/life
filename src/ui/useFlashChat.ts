/**
 * 闪电添加 Chat 状态机（tasks/slice-15.md 阶段 3；AGENTS.md §7.25）。
 *
 * 职责边界：解析/合并/降级编排与落库计划都在 domain/ai 纯逻辑层
 * （chat.ts / merge.ts / savePlan.ts，可单测）；本 hook 只做接线——
 * 状态存储、SecureStore 配置加载、Repository 落库链、消息流渲染数据。
 *
 * 落库链沿用切片 14 新建页先例（§4.24 时间字段只走 updateItemTime）：
 * createItem → updateItemTime → addTagToItem×N → createReminder（重复规则，
 * tzid 白名单校验在 savePlan）→ reminderScheduler.reconcile（失败不阻断）。
 * 计划页列表由响应式订阅自动刷新（验收 9），本页无需额外通知。
 *
 * 切片 22 阶段 1（AGENTS.md §7.34）：保存成功后的 AI 回复从纯文本改为结果卡片
 * 消息（kind:'card' + cardPayload 快照，buildFlashCardPayload 组装）；
 * 提醒未自动落库的说明（reminderNotice）仍以纯文本消息补充。
 *
 * 切片 22 阶段 3（AGENTS.md §7.34）：
 * - postponeCard：快捷推迟 chips（+15分钟/+1小时）——startAt/endAt 绝对平移
 *   （endAt 同 Δ 顺延保时长），Item 关联的 once 提醒经 computePostponedOnceAt
 *   同步顺延 onceAt（重复提醒跳过），reconcile 重排通知后 cardPayload 原地
 *   刷新（提醒行 once 绝对时刻随之可见变化）；
 * - 「修改成X点」编辑窄规则（用户 2026-11-15 确认折叠，范围见
 *   editIntent.ts 头注）：有草稿改草稿（预览卡自动刷新），无草稿改最近一张
 *   结果卡（updateItemTime + once 联动 + 原地刷新）；意图命中但无法应用时
 *   给引导文案，不再落到原解析流程产生垃圾新事项。
 *
 * 切片 23 阶段 2/3（AGENTS.md §7.35，ai.md v0.19）：
 * - history 契约回正：草稿编辑成功路径的 assistant 文本回写编辑后草稿的 JSON
 *   （切片 15 格式），note 只留在消息流；
 * - 主动澄清轮（needsClarification=true）不出预览卡：清空待确认卡片状态，
 *   clarificationPrompt 作为普通 AI 文本消息追加，草稿保留在 draftRef 供
 *   下一轮续答经 merge 补全后自然出卡；澄清待补轮不被编辑窄规则劫持。
 *
 * 切片 25 阶段 2（AGENTS.md §7.37）：闪电录入认真模式——careful_mode 开启时，
 * 「编辑意图导致 title 或 content 变化」的轮次在提交前拦截：不出新卡（本轮
 * assistantNote 不进消息流）、不提交草稿与 history（缓冲进确认载荷），消息流
 * 追加 kind:'confirm' 确认消息（pendingDraft + 缓冲 historyAppend + 旧→新摘要）
 * + 「应用修改/放弃修改」本地处理（不发起 AI 轮次）；待确认期间任何新输入取消
 * 待确认状态按普通轮处理。守卫谓词在本文件内联（editDiff 只提供 diff 纯函数，
 * 「上一张卡是否存在」「是否编辑轮」归本层，见 editDiff.ts 头注分工）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { itemRepository } from '../data';
import { SecureAiConfigStore } from '../data/SecureAiConfigStore';
import {
  matchesEditIntent,
  parseEditTimeRequest,
  resolveEditStartAt,
} from '../domain/ai/editIntent';
import { buildFlashCardPayload } from '../domain/ai/cardPayload';
import { runFlashTurn } from '../domain/ai/chat';
import type { FlashTurnResult } from '../domain/ai/chat';
import { diffDraftChanges } from '../domain/ai/editDiff';
import type { DraftFieldChanges } from '../domain/ai/editDiff';
import { matchesScheduleQueryIntent } from '../domain/ai/queryIntent';
import { runScheduleQueryTurn } from '../domain/ai/scheduleQuery';
import { serializeDraftForHistory } from '../domain/ai/prompt';
import { formatAiUsageLine } from '../domain/ai/usage';
import type { AiUsageSnapshot } from '../domain/ai/usage';
import {
  DEFAULT_AI_RETRY_MAX,
  isFlashDeletedCardDisplay,
} from '../domain/settings';
import type { FlashDeletedCardDisplay } from '../domain/settings';
import type { AiConfig } from '../domain/ai/configStore';
import {
  computePostponedOnceAt,
  computePostponedStartAt,
} from '../domain/ai/postpone';
import { buildFlashSavePlan, diffItemTags, diffOnceReminderPlans } from '../domain/ai/savePlan';
import type {
  ChatMessage,
  FlashCardPayload,
  ParsedItemDraft,
} from '../domain/ai/types';
import type { Category } from '../domain/category';
import type { ChannelPreset } from '../domain/channelPreset';
import type { ItemWithRelations } from '../domain/relations/itemWithRelations';
import type { Item } from '../domain/item';
import type { OnceCivilTime, Reminder, ReminderChannel } from '../domain/reminder';
import { reminderScheduler } from '../notifications';
import { formatItemTime, getDeviceTzid } from './timeFormat';

/**
 * 认真模式确认摘要行（切片 25 阶段 2，AGENTS.md §7.37）：单个拟改字段的
 * 旧→新值。title 与 content 同轮双改时同一载荷携带两行（合并为一条确认消息）。
 */
export interface FlashConfirmChange {
  field: 'title' | 'content';
  label: string;
  from: string;
  to: string;
}

/**
 * 认真模式确认消息载荷（kind:'confirm'）：拦截轮的拟提交草稿、缓冲 history
 * 与拟改字段摘要。应用 = 提交 pendingDraft 与缓冲 history；放弃/取消 = 仅
 * resolved 原地标记，草稿与 history 均不动。
 */
export interface FlashConfirmPayload {
  confirmId: number;
  pendingDraft: ParsedItemDraft;
  /** 拦截轮的 historyAppend 缓冲（应用确认时才并入 historyRef）。 */
  bufferedHistory: [ChatMessage, ChatMessage];
  changes: FlashConfirmChange[];
  resolved: boolean;
}

/**
 * 切片 32（AGENTS.md §7.44）：AI 调试查看器载荷——本轮远端解析的请求体原文
 * （不含 HTTP headers）、响应原文（失败轮为错误响应文本）与解析草稿 JSON。
 * 内存态消息字段，不持久化、不进 history、不进 ParsedItemDraft（传输边界
 * v0.20 同款冻结）。request/response 来自 FlashTurnResult.debug 副通道。
 */
export interface FlashDebugPayload {
  request: string | null;
  response: string | null;
  /** 本轮解析草稿 JSON（远端成功轮=远端草稿；失败降级轮=本地兜底草稿）。 */
  draft: string;
}

export interface FlashChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /**
   * 呈现形态：'text' 纯文本；'card' 结果卡片（cardPayload 必有，切片 22）；
   * 'confirm' 认真模式确认卡（confirmPayload 必有，切片 25 阶段 2）。
   */
  kind: 'text' | 'card' | 'confirm';
  cardPayload?: FlashCardPayload;
  confirmPayload?: FlashConfirmPayload;
  /**
   * 切片 32（§7.44）：AI 调试入口消息携带（debugPayload 必有）；点击弹出
   * 调试弹层，三节显隐由当下设置（showAiRequest/showAiResponse）决定。
   */
  debugPayload?: FlashDebugPayload;
}

export interface ConfirmSaveResult {
  ok: boolean;
  /** 提醒未自动落库时的说明（一次性提醒/时区白名单外）。 */
  notice: string | null;
  /**
   * 保存结果的汇总文本（切片 22 起消息流呈现为结果卡片消息 + 可选纯文本
   * 说明；message 仍含完整文案供调用方/测试使用）。
   */
  message: string;
}

/** 编辑窄规则：意图命中但识别不出具体时间的引导文案。 */
const EDIT_FALLBACK_NOTE =
  '没有识别出要改成的时间，请说得更具体些（例如：改成明天下午3点半）。';

/** 编辑窄规则：目标（草稿/结果卡）无具体时间或为全天时的引导文案。 */
const EDIT_UNTIMED_NOTE =
  '该条目没有具体时间（或为全天），暂时不支持这样修改；可在详情页设置时间。';

/** 澄清轮反问兜底（远端声明澄清但未给反问文案时使用，正常解析路径不会触发）。 */
const CLARIFICATION_FALLBACK_NOTE =
  '信息还不完整，请补充缺失的内容（例如具体时间）。';

/** 认真模式确认消息正文（FlashConfirmCard 渲染结构化载荷，text 仅兜底显示）。 */
const CONFIRM_MESSAGE_TEXT = '标题/内容修改需要你确认。';

/** 认真模式放弃修改的追加文本（草稿与 history 均不动）。 */
const CONFIRM_DISMISS_NOTE = '已放弃本次修改，卡片保持原样。';

/**
 * 切片 36（AGENTS.md §7.48 / 提案 D5）：查询开关关闭时的本地提示（不发远端，
 * 无 lastDebug/lastUsage 副作用——真机矩阵 ⑦）。
 */
const QUERY_DISABLED_NOTE = '对话式查询已关闭，可在「我的」-设置开启。';

/**
 * 切片 36（§7.48 / 提案 D2）：查询轮调试弹层的草稿节占位——查询轮不走
 * parse/wire、无解析草稿；FlashDebugPayload.draft 为必填展示字段，以说明性
 * 文本占位（弹层直显文本，无 JSON.parse 依赖）。
 */
const QUERY_DEBUG_DRAFT_NOTE = '（查询轮无草稿）';

/**
 * 编辑/推迟后刷新卡片提醒快照（切片 32 / §7.44 多计划）：对载荷里**每一条**
 * once 提醒快照，若其 id 命中被顺延集合则用新 onceAt 替换（chips 快捷推迟对
 * 全部 once 提醒生效，卡片段落随之可见变化）；未命中（重复提醒/无提醒/快照
 * 与库中不一致）保持原快照。
 */
function patchReminderSnapshot(
  target: FlashCardPayload,
  updatedOnceAt: Map<string, OnceCivilTime>,
): FlashCardPayload['reminders'] {
  if (target.reminders.length === 0) return [];
  return target.reminders.map((snapshot) => {
    const nextOnceAt = updatedOnceAt.get(snapshot.id);
    return nextOnceAt === undefined ? snapshot : { ...snapshot, onceAt: nextOnceAt };
  });
}

/**
 * 认真模式确认摘要行组装（切片 25 阶段 2，AGENTS.md §7.37）：仅取 title /
 * content 两个拟改字段，按 title→content 固定顺序输出；title 与 content
 * 同轮双改合并为同一条确认消息（两行摘要）。
 */
function buildConfirmChanges(
  previousDraft: ParsedItemDraft,
  pendingDraft: ParsedItemDraft,
  diff: DraftFieldChanges,
): FlashConfirmChange[] {
  const changes: FlashConfirmChange[] = [];
  if (diff.titleChanged) {
    changes.push({
      field: 'title',
      label: '标题',
      from: previousDraft.title,
      to: pendingDraft.title,
    });
  }
  if (diff.contentChanged) {
    changes.push({
      field: 'content',
      label: '内容',
      from: previousDraft.content,
      to: pendingDraft.content,
    });
  }
  return changes;
}

export function useFlashChat() {
  const [messages, setMessages] = useState<FlashChatMessage[]>([]);
  const [draft, setDraft] = useState<ParsedItemDraft | null>(null);
  const [busy, setBusy] = useState(false);
  // 切片 30（§7.41）：重试即时提示——「AI 服务异常，正在重试（n/N）…」仅在
  // 轮进行中展示（send 的 finally 清空），不进聊天历史；null = 无进行中重试。
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  // 切片 30（§7.41）阶段 3：放弃后的草稿快照——draft 已清空，此快照仅供
  // 「已放弃」置灰卡展示（内存态，新输入清空、重启消失）。
  const [dismissedDraft, setDismissedDraft] = useState<ParsedItemDraft | null>(null);
  // 切片 30（§7.41）阶段 4：已删除条目联动——reconcile 判定为「条目已不存在」的
  // card itemId 集合（mark 模式渲染置灰+角标；remove 模式消息直接移除，不进集合）。
  // 只增不减（条目删除不可撤销），useFocusEffect 触发批量查询、不轮询。
  const [deletedItemIds, setDeletedItemIds] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<Category[]>([]);

  const historyRef = useRef<ChatMessage[]>([]);
  const draftRef = useRef<ParsedItemDraft | null>(null);
  const configRef = useRef<AiConfig | null>(null);
  const storeRef = useRef<SecureAiConfigStore | null>(null);
  const nextIdRef = useRef(1);
  // 切片 22：分类列表镜像（confirmSave 组装卡片分类快照用，避免异步 setState 时机问题）。
  const categoriesRef = useRef<Category[]>([]);
  // 切片 22 阶段 3：消息镜像（postponeCard/编辑窄规则同步定位目标卡片，免异步竞态）。
  const messagesRef = useRef<FlashChatMessage[]>([]);

  useEffect(() => {
    if (storeRef.current === null) {
      storeRef.current = new SecureAiConfigStore();
    }
    let cancelled = false;
    storeRef.current
      .load()
      .then((config) => {
        if (!cancelled) configRef.current = config;
      })
      .catch((error: unknown) => {
        console.warn('[slice-15] 读取 AI 配置失败', error);
      });
    itemRepository
      .getCategories()
      .then((loaded) => {
        if (!cancelled) {
          categoriesRef.current = loaded;
          setCategories(loaded);
        }
      })
      .catch((error: unknown) => {
        console.warn('[slice-15] 读取分类失败', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const push = useCallback((role: 'user' | 'assistant', text: string): void => {
    // 切片 25 阶段 2 修补（真机缺陷，m00248）：id 必须在 updater 外捕获为常量。
    // 旧写法在 updater 内读 nextIdRef.current（自增在外）——React 18 并发重放
    // 队列时（MuMu fabric 真机已复现 FlatList 重复 key '.$2'，澄清轮两条相邻
    // push 撞 id）两条消息会读到同一 id；捕获为闭包常量后重放复用同一常量，
    // id 永不相撞。pushCard/pushConfirm 同模式。
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    setMessages((prev) => [...prev, { id, role, text, kind: 'text' }]);
  }, []);

  /** 追加结果卡片消息（切片 22 阶段 1，AGENTS.md §7.34）。 */
  const pushCard = useCallback((text: string, cardPayload: FlashCardPayload): void => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    setMessages((prev) => [
      ...prev,
      { id, role: 'assistant', text, kind: 'card', cardPayload },
    ]);
  }, []);

  /** 原地刷新指定条目的结果卡片快照（阶段 3：推迟/编辑后时间与提醒联动可见）。 */
  const updateCard = useCallback(
    (itemId: string, patch: Partial<FlashCardPayload>): void => {
      setMessages((prev) =>
        prev.map((message) => {
          if (
            message.kind !== 'card' ||
            message.cardPayload === undefined ||
            message.cardPayload.itemId !== itemId
          ) {
            return message;
          }
          return { ...message, cardPayload: { ...message.cardPayload, ...patch } };
        }),
      );
    },
    [],
  );

  /** 最近一条结果卡片快照（编辑窄规则的默认目标）。 */
  const getLastCardPayload = useCallback((): FlashCardPayload | null => {
    const list = messagesRef.current;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const message = list[i];
      if (message.kind === 'card' && message.cardPayload !== undefined) {
        return message.cardPayload;
      }
    }
    return null;
  }, []);

  /**
   * 顺延条目关联的全部 once 提醒（§7.34 联动规则；重复提醒跳过）。
   * 返回 id → 新 onceAt 映射供卡片快照刷新；gap 脏数据跳过（保留原值）。
   */
  const shiftOnceReminders = useCallback(
    async (itemId: string, deltaMinutes: number): Promise<Map<string, OnceCivilTime>> => {
      const reminders = await itemRepository.listRemindersByItem(itemId);
      const updated = new Map<string, OnceCivilTime>();
      for (const reminder of reminders) {
        if (reminder.frequency !== 'once' || reminder.onceAt === null) continue;
        const nextOnceAt = computePostponedOnceAt(reminder.onceAt, reminder.tzid, deltaMinutes);
        if (nextOnceAt === null) continue;
        await itemRepository.updateReminder(reminder.id, { onceAt: nextOnceAt });
        updated.set(reminder.id, nextOnceAt);
      }
      return updated;
    },
    [],
  );

  /**
   * 追加一轮编辑对话到 history（供远端解析上下文连贯）。
   * 切片 23 阶段 2：草稿编辑成功路径必须回写「编辑后草稿的 JSON」——切片 15
   * 约定 history 中 assistant 文本 = 草稿 JSON；纯文本 note 只留在消息流层，
   * 否则远端模型会读到与当前草稿不符的旧状态（buildHistoryBriefing 也取不到
   * 最新草稿）。
   */
  const appendEditHistory = useCallback(
    (input: string, note: string, draftJson?: string): void => {
      historyRef.current = [
        ...historyRef.current,
        { role: 'user', text: input },
        { role: 'assistant', text: draftJson ?? note },
      ];
    },
    [],
  );

  /**
   * 编辑窄规则——草稿分支：把「改成X点」落到当前草稿（预览卡自动刷新），
   * 提醒在保存时按新 startAt 重算，无需额外联动。
   * 切片 23 阶段 3：澄清待补轮（needsClarification=true）不拦截——用户续答
   *（哪怕措辞是“改成下午2点”）必须走解析 + merge 补全，否则窄规则会按
   * 今天日期错改草稿、丢失澄清上下文。
   * 返回 true 表示本轮已被编辑路径处理（send 不再走解析流程）。
   */
  const applyEditToDraft = useCallback(
    (input: string, tzid: string): boolean => {
      const current = draftRef.current;
      if (
        current === null ||
        current.allDay ||
        current.needsClarification === true ||
        !matchesEditIntent(input)
      ) {
        return false;
      }
      const request = parseEditTimeRequest(input);
      const newStart = resolveEditStartAt(request, current.startAt, Date.now(), tzid);
      if (newStart === null) {
        const note = current.startAt === null ? EDIT_UNTIMED_NOTE : EDIT_FALLBACK_NOTE;
        appendEditHistory(input, note);
        push('assistant', note);
        return true;
      }
      const deltaMs = current.startAt === null ? 0 : newStart - current.startAt;
      const next: ParsedItemDraft = {
        ...current,
        startAt: newStart,
        endAt: current.endAt !== null ? current.endAt + deltaMs : null,
      };
      draftRef.current = next;
      setDraft(next);
      const note = `已改为 ${formatItemTime(newStart, tzid)}（请核对卡片）`;
      // 切片 23 阶段 2：history 回写编辑后的草稿 JSON，note 只作消息流展示。
      // 切片 33（§7.45）：序列化经 serializeDraftForHistory——民用时刻 + 时间
      // 键名对齐 wire（start/end），与 chat.ts historyAppend 同格式；原
      // JSON.stringify 直接写毫秒草稿，是保存/编辑后轮次 few-shot 的同化源。
      appendEditHistory(input, note, serializeDraftForHistory(next, tzid));
      push('assistant', note);
      return true;
    },
    [appendEditHistory, push],
  );

  /**
   * 编辑窄规则——结果卡分支：改最近一张结果卡对应条目的时间
   * （updateItemTime + once 提醒联动 + reconcile + 卡片原地上刷新）。
   * 仓库操作失败时给出失败文案并视为已处理（不落回解析流程，避免把
   * 「修改成X点」建成垃圾新事项）。
   */
  const applyEditToCard = useCallback(
    async (input: string, tzid: string): Promise<boolean> => {
      const target = getLastCardPayload();
      if (target === null || target.allDay || !matchesEditIntent(input)) {
        return false;
      }
      const request = parseEditTimeRequest(input);
      const newStart = resolveEditStartAt(request, target.startAt, Date.now(), tzid);
      if (newStart === null) {
        const note = target.startAt === null ? EDIT_UNTIMED_NOTE : EDIT_FALLBACK_NOTE;
        appendEditHistory(input, note);
        push('assistant', note);
        return true;
      }
      setBusy(true);
      try {
        const deltaMs = target.startAt === null ? 0 : newStart - target.startAt;
        const newEnd = target.endAt !== null ? target.endAt + deltaMs : null;
        await itemRepository.updateItemTime(target.itemId, {
          startAt: newStart,
          endAt: newEnd,
        });
        const updatedOnceAt = await shiftOnceReminders(
          target.itemId,
          Math.round(deltaMs / 60_000),
        );
        try {
          await reminderScheduler.reconcile();
        } catch (error) {
          console.warn('[slice-22] 修改时间后 reconcile 失败', error);
        }
        updateCard(target.itemId, {
          startAt: newStart,
          endAt: newEnd,
          reminders: patchReminderSnapshot(target, updatedOnceAt),
        });
        const note = `已改为 ${formatItemTime(newStart, tzid)}`;
        appendEditHistory(input, note);
        push('assistant', note);
        return true;
      } catch (error) {
        console.warn('[slice-22] 修改条目时间失败', error);
        const note = `修改失败：${error instanceof Error ? error.message : String(error)}`;
        appendEditHistory(input, note);
        push('assistant', note);
        return true;
      } finally {
        setBusy(false);
      }
    },
    [appendEditHistory, getLastCardPayload, push, shiftOnceReminders, updateCard],
  );

  // ---------------------------------------------------------------------------
  // 切片 25 阶段 2（AGENTS.md §7.37）：认真模式确认流。
  // ---------------------------------------------------------------------------

  /**
   * 切片 26 阶段 2（AGENTS.md §7.38）：每轮解析后一次读取本轮生效设置——
   * carefulMode 供认真模式拦截判定、showAiUsage 供用量摘要行。开关即时生效：
   * 每轮重读（设置页改动下一轮即生效），重启保持由 app_settings 持久层保证。
   * 读取失败回退默认：carefulMode=false（不拦）、showAiUsage=false（不显示）。
   * 切片 30（§7.41）：aiRetryMax 供远端轮自动重试次数（Repository 读层已归一
   * 0–5，旧数据回退 3）；读取失败回退 DEFAULT_AI_RETRY_MAX（重试档位即时生效）。
   */
  const readTurnSettings = useCallback(async (): Promise<{
    carefulMode: boolean;
    showAiUsage: boolean;
    aiRetryMax: number;
    showAiRequest: boolean;
    showAiResponse: boolean;
    aiScheduleQueryEnabled: boolean;
  }> => {
    try {
      const settings = await itemRepository.getSettings();
      return {
        carefulMode: settings.carefulMode === true,
        showAiUsage: settings.showAiUsage === true,
        aiRetryMax: settings.aiRetryMax,
        // 切片 32（§7.44）：调试查看器两开关（读层 boolean 守卫已回退默认）。
        showAiRequest: settings.showAiRequest === true,
        showAiResponse: settings.showAiResponse === true,
        // 切片 36（§7.48）：查询轮总开关（读层归一 null→true 默认开）。
        aiScheduleQueryEnabled: settings.aiScheduleQueryEnabled === true,
      };
    } catch (error) {
      console.warn('[slice-25/26/30] 本轮设置读取失败，回退默认', error);
      return {
        carefulMode: false,
        showAiUsage: false,
        aiRetryMax: DEFAULT_AI_RETRY_MAX,
        showAiRequest: false,
        showAiResponse: false,
        aiScheduleQueryEnabled: true,
      };
    }
  }, []);

  /**
   * 切片 26 阶段 2（AGENTS.md §7.38）：用量摘要行——仅远端解析轮携带 usage
   * （本地降级/无 Key 轮恒 null，不展示）且开关开启时，在 AI 回复消息尾追加
   * 一行用量摘要（formatAiUsageLine 缺段自动省略；单价未配齐则无费用段）。
   * 认真模式拦截轮无 AI 回复消息（send 内 pushConfirm 分支提前 return），
   * 不追加用量行。
   */
  const pushUsageLine = useCallback(
    (usage: AiUsageSnapshot | null, showAiUsage: boolean): void => {
      if (usage === null || !showAiUsage) return;
      push('assistant', formatAiUsageLine(usage));
    },
    [push],
  );

  /**
   * 切片 32（AGENTS.md §7.44）：AI 调试入口消息——远端解析轮（成功或失败
   * 降级）且任一调试开关开启时，在 AI 回复/用量行之后追加一条带 debugPayload
   * 的入口消息（弹层点击入口；本地/无 Key 轮 debug 恒 null 不追加）。开关全关
   * 不采集不展示（现状）。切片 36（§7.48）：draft 参数改为已序列化字符串
   * （解析轮传 JSON.stringify(draft)；查询轮无草稿，传 QUERY_DEBUG_DRAFT_NOTE
   * 占位说明），弹层直显文本、无 JSON.parse 依赖。
   */
  const pushDebugEntry = useCallback(
    (
      debug: FlashTurnResult['debug'],
      draftJson: string,
      degraded: boolean,
      turnSettings: { showAiRequest: boolean; showAiResponse: boolean },
    ): void => {
      if (debug === null) return;
      if (!turnSettings.showAiRequest && !turnSettings.showAiResponse) return;
      const text = degraded
        ? '🔍 AI 调试：远端解析失败已降级，点击查看请求/响应'
        : '🔍 AI 调试：点击查看本轮 AI 输入/输出';
      const id = nextIdRef.current;
      nextIdRef.current += 1;
      setMessages((prev) => [
        ...prev,
        {
          id,
          role: 'assistant',
          text,
          kind: 'text',
          debugPayload: {
            request: debug.request,
            response: debug.response,
            draft: draftJson,
          },
        },
      ]);
    },
    [],
  );

  /**
   * 取消全部未决确认（resolved 原地标记，消息 id/FlatList key 稳定）。
   * send() 入口（§7.37：待确认期间任何新输入取消待确认状态，按普通轮处理——
   * pendingDraft 与缓冲 history 一并作废）、applyEdit / confirmSave（手动编辑
   * 与保存落地后 pendingDraft 已过期，防后续应用时复活旧数据）调用。
   */
  const cancelPendingConfirm = useCallback((): void => {
    setMessages((prev) => {
      let changed = false;
      const next = prev.map((message) => {
        if (
          message.kind === 'confirm' &&
          message.confirmPayload !== undefined &&
          message.confirmPayload.resolved !== true
        ) {
          changed = true;
          return {
            ...message,
            confirmPayload: { ...message.confirmPayload, resolved: true },
          };
        }
        return message;
      });
      return changed ? next : prev;
    });
  }, []);

  // 切片 30（§7.41）阶段 3：草稿放弃——第三条本地操作（与切片 25「放弃修改」
  // 同层：纯本地处理、不发起 AI 轮次）。draft 立即清空（下一轮按全新意图处理，
  // 窄规则/previousDraft 不再看见它），快照仅承载「已放弃」卡的置灰视觉呈现；
  // 不落库、不播种 history；新一轮 send 时清空（见 send 入口）。
  const dismissDraft = useCallback((): void => {
    const abandoned = draftRef.current;
    if (abandoned === null) return;
    cancelPendingConfirm();
    draftRef.current = null;
    setDraft(null);
    setDismissedDraft(abandoned);
  }, [cancelPendingConfirm]);

  // 切片 30（§7.41）阶段 4：已删除卡 reconcile——收集当前 card 消息的 itemId
  // 去重，批量存在性查询（Repository 只读扩展，useFocusEffect 触发不轮询），
  // 按 flash_deleted_card_display 分流：mark → deletedItemIds 并集（渲染置灰 +
  // 「已删除」角标 + 点击禁用 + chips 隐藏）；remove → 直接从对话移除对应 card
  // 消息。查询/设置读取失败保持原样（防御性，不阻断聊天——条目真被删了，
  // 后续 postponeCard 点击也会走 Repository 明确报错路径）。
  const reconcileDeletedCards = useCallback(async (): Promise<void> => {
    const itemIds = new Set<string>();
    for (const message of messagesRef.current) {
      if (message.kind === 'card' && message.cardPayload !== undefined) {
        itemIds.add(message.cardPayload.itemId);
      }
    }
    if (itemIds.size === 0) return;
    let displayMode: FlashDeletedCardDisplay = 'mark';
    let existing: Set<string>;
    try {
      const [settings, found] = await Promise.all([
        itemRepository.getSettings(),
        itemRepository.filterExistingItemIds([...itemIds]),
      ]);
      if (isFlashDeletedCardDisplay(settings.flashDeletedCardDisplay)) {
        displayMode = settings.flashDeletedCardDisplay;
      }
      existing = found;
    } catch (error) {
      console.warn('[slice-30] 已删除卡 reconcile 失败，保持原样', error);
      return;
    }
    const deleted = [...itemIds].filter((id) => !existing.has(id));
    if (deleted.length === 0) return;
    if (displayMode === 'remove') {
      const removedSet = new Set(deleted);
      setMessages((prev) =>
        prev.filter(
          (message) =>
            !(
              message.kind === 'card' &&
              message.cardPayload !== undefined &&
              removedSet.has(message.cardPayload.itemId)
            ),
        ),
      );
      return;
    }
    setDeletedItemIds((prev) => {
      const next = new Set(prev);
      for (const id of deleted) next.add(id);
      return next;
    });
  }, []);

  /**
   * 追加认真模式确认消息（拦截轮专用）。消息 id 在 setMessages updater 外先
   * 捕获（切片 25 阶段 2 已把 push()/pushCard() 一并改为该模式）——updater 内
   * 读 nextIdRef.current 在 React 18 并发重放下会让相邻消息撞 id（真机已复现）。
   */
  const pushConfirm = useCallback(
    (
      previousDraft: ParsedItemDraft,
      pendingDraft: ParsedItemDraft,
      bufferedHistory: [ChatMessage, ChatMessage],
      diff: DraftFieldChanges,
    ): void => {
      const confirmId = nextIdRef.current;
      nextIdRef.current += 1;
      const confirmPayload: FlashConfirmPayload = {
        confirmId,
        pendingDraft,
        bufferedHistory: [bufferedHistory[0], bufferedHistory[1]],
        changes: buildConfirmChanges(previousDraft, pendingDraft, diff),
        resolved: false,
      };
      setMessages((prev) => [
        ...prev,
        {
          id: confirmId,
          role: 'assistant',
          text: CONFIRM_MESSAGE_TEXT,
          kind: 'confirm',
          confirmPayload,
        },
      ]);
    },
    [],
  );

  const send = useCallback(
    async (raw: string): Promise<void> => {
      const input = raw.trim();
      if (input.length === 0 || busy) return;
      // 切片 25 阶段 2（§7.37）：待确认期间任何新输入取消待确认状态（作废
      // pendingDraft 与缓冲 history），按普通轮处理——包括编辑窄规则与正常解析。
      cancelPendingConfirm();
      // 切片 30（§7.41）：新输入开始新对话轮——上一张「已放弃」卡随之移除
      //（快照仅活到下一个动作，与待确认取消同语义）。
      setDismissedDraft(null);
      setBusy(true);
      push('user', input);
      const tzid = getDeviceTzid();
      try {
        // 切片 36（AGENTS.md §7.48 / 提案 D1）：查询意图预判——send 顶部，
        // 先于编辑窄规则。两分支词面互斥（查询句无编辑词、编辑句含排除词
        // 不判查询）；保守词表漏判走录入分支用户重述兜底，误判接受。
        if (matchesScheduleQueryIntent(input)) {
          // 本轮生效设置一次读取（开关/用量/重试；读取失败回退默认开）。
          const turnSettings = await readTurnSettings();
          if (!turnSettings.aiScheduleQueryEnabled) {
            // 提案 D5：关闭时本地提示，不发远端（无 lastDebug/lastUsage 副作用，
            // 真机矩阵 ⑦）。查询轮不落卡/不落库/不播种 history（§7.48 边界）。
            push('assistant', QUERY_DISABLED_NOTE);
            return;
          }
          // 每次发送前重读配置：与录入路径同理由（设置页可能改过 Key）。
          if (storeRef.current === null) {
            storeRef.current = new SecureAiConfigStore();
          }
          configRef.current = await storeRef.current.load();
          // 提案 D3：全域检索——未归档 ∪ 已归档全量读取（Repository 零新方法）。
          const [activeItems, archivedItems] = await Promise.all([
            itemRepository.listItemsWithTags(),
            itemRepository.listArchivedItemsWithTags(),
          ]);
          const queryResult = await runScheduleQueryTurn({
            config: configRef.current,
            now: Date.now(),
            tzid,
            question: input,
            items: [...activeItems, ...archivedItems],
            // 切片 30（§7.41）重试同款：即时提示直出 UI，轮结束 finally 清空。
            aiRetryMax: turnSettings.aiRetryMax,
            onRetry: (attempt, maxRetries) => {
              setRetryNotice(`AI 服务异常，正在重试（${attempt}/${maxRetries}）…`);
            },
          });
          // 查询轮消息流：纯文本回答 + 用量行（第二段 usage，show_ai_usage）
          // + 调试入口（第一段窗口轮快照，矩阵 #2；degraded 文案复用）。
          push('assistant', queryResult.answer);
          pushUsageLine(queryResult.usage, turnSettings.showAiUsage);
          pushDebugEntry(
            queryResult.debug,
            QUERY_DEBUG_DRAFT_NOTE,
            queryResult.degraded,
            turnSettings,
          );
          // §7.48「history append 照常」：查询轮 user+assistant 纯文本进
          // history（assistant 非 JSON 条目被 buildHistoryBriefing 跳过，切片
          // 33/34 编辑语义不受影响；不播种草稿 JSON）。不产卡/不落库。
          historyRef.current = [
            ...historyRef.current,
            { role: 'user', text: input },
            { role: 'assistant', text: queryResult.answer },
          ];
          return;
        }
        // 切片 22 阶段 3 注记（用户 2026-11-15 确认折叠）：「修改成X点」编辑
        // 窄规则——仅降级层语义；配置 AI Key 的远端解析不经过本规则。
        if (draftRef.current !== null) {
          if (applyEditToDraft(input, tzid)) return;
        } else if (await applyEditToCard(input, tzid)) {
          return;
        }
        // 每次发送前重读配置：设置页可能在 Tab 挂载后保存/清除了 Key，
        // 挂载时读到的 configRef 已过期（真机验收 6.33 缺陷）。
        if (storeRef.current === null) {
          storeRef.current = new SecureAiConfigStore();
        }
        configRef.current = await storeRef.current.load();
        // 切片 26 阶段 2（§7.38）：本轮生效设置一次读取（认真模式 + 用量展示 +
        // 切片 30 重试次数三项；每轮重读即时生效，读取失败回退默认不拦/不显示/
        // 重试 3 次）。原切片 25 的拦截分支内懒读取并入此处——getSettings 每轮
        // 恰一次；切片 30 起提前到 runFlashTurn 之前读（aiRetryMax 须作为入参
        // 传入远端轮）。
        const turnSettings = await readTurnSettings();
        const turnStartDraft = draftRef.current;
        const result = await runFlashTurn(input, {
          config: configRef.current,
          now: Date.now(),
          tzid,
          history: historyRef.current,
          previousDraft: draftRef.current,
          // 切片 30（§7.41）：重试次数与即时提示回调——提示经 retryNotice
          // 状态直出 UI（不进聊天历史），轮结束在 finally 清空。
          aiRetryMax: turnSettings.aiRetryMax,
          onRetry: (attempt, maxRetries) => {
            setRetryNotice(`AI 服务异常，正在重试（${attempt}/${maxRetries}）…`);
          },
        });
        // 切片 25 阶段 2（§7.37 认真模式）：仅拦「编辑意图导致 title 或 content
        // 变化」的轮次。守卫谓词——「当前有展示中的卡片」= 本轮开始 draftRef
        // 非空且非澄清待补（澄清轮无展示卡；澄清分支在下方先行处理，不受影响）；
        // 「编辑轮」用代理判定（hook 层拿不到 parsed.expressed）：matchesEditIntent
        //（编辑词轮）或本轮未表达新时刻（diff.timeChanged=false，对应 chat.ts 标题
        // 保护的补充轮分支）；带新时刻又带新主题词 = 全新建卡不拦。时间/提醒/
        // 渠道/标签等字段修改不拦。开关读取失败回退 false（默认模式行为不变）。
        if (
          turnStartDraft !== null &&
          turnStartDraft.needsClarification !== true &&
          result.draft.needsClarification !== true
        ) {
          const diff = diffDraftChanges(turnStartDraft, result.draft);
          if (diff.titleChanged || diff.contentChanged) {
            const isEditTurn = matchesEditIntent(input) || !diff.timeChanged;
            if (turnSettings.carefulMode && isEditTurn) {
              // 拦截：不出新卡（assistantNote 不进消息流）、不提交草稿与 history
              //（缓冲进确认载荷，应用确认时才提交），旧预览卡保持可见。
              pushConfirm(turnStartDraft, result.draft, result.historyAppend, diff);
              return;
            }
          }
        }
        historyRef.current = [...historyRef.current, ...result.historyAppend];
        draftRef.current = result.draft;
        if (result.draft.needsClarification === true) {
          // 切片 23 阶段 3（§7.35 主动澄清）：澄清轮不出预览卡——待确认卡片
          // 状态清空，反问文案作为普通 AI 文本消息追加；草稿保留在 draftRef，
          // 下一轮用户续答经 runFlashTurn（previousDraft）+ merge 补全后自然
          // 出卡。historyAppend 已含本轮草稿 JSON（远端续答上下文）。
          setDraft(null);
          push(
            'assistant',
            result.draft.clarificationPrompt ?? CLARIFICATION_FALLBACK_NOTE,
          );
          if (result.degraded) {
            // 降级说明不丢（§7.25 验收 5）：本地解析轮的反问也要能看出没走远端。
            push('assistant', result.assistantNote);
          }
          // 切片 26（§7.38）：远端澄清轮同样在回复尾追加用量行（降级轮 usage
          // 恒 null，不展示）。切片 32（§7.44）：调试入口消息随后（远端澄清
          // 轮同样可查看请求/响应）。
          pushUsageLine(result.usage, turnSettings.showAiUsage);
          pushDebugEntry(result.debug, JSON.stringify(result.draft), result.degraded, turnSettings);
          return;
        }
        setDraft(result.draft);
        push('assistant', result.assistantNote);
        // 切片 26（§7.38）：远端解析轮在 AI 回复消息尾追加一行用量摘要。
        // 切片 32（§7.44）：调试入口消息随后（降级轮 degraded 文案区分）。
        pushUsageLine(result.usage, turnSettings.showAiUsage);
        pushDebugEntry(result.debug, JSON.stringify(result.draft), result.degraded, turnSettings);
      } catch (error) {
        console.warn('[slice-15] 解析失败', error);
        push(
          'assistant',
          `解析失败：${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setBusy(false);
        // 切片 30（§7.41）：重试即时提示只在轮进行中存在，任何收尾路径清空
        //（不留在聊天历史）。
        setRetryNotice(null);
      }
    },
    [busy, push, applyEditToCard, applyEditToDraft, cancelPendingConfirm, readTurnSettings, pushUsageLine, pushDebugEntry, pushConfirm],
  );

  /**
   * 应用未决确认（§7.37：选项点击本地处理，不发起 AI 轮次）：提交拦截轮缓冲
   * 的 historyAppend 与拟提交草稿（setDraft 后预览卡自动刷新），确认消息原地
   * resolved 标记。已 resolved / 消息不存在时为无副作用空操作。
   */
  const applyConfirm = useCallback((confirmId: number): void => {
    const payload = messagesRef.current.find(
      (message) =>
        message.id === confirmId &&
        message.kind === 'confirm' &&
        message.confirmPayload !== undefined,
    )?.confirmPayload;
    if (payload === undefined || payload.resolved === true) return;
    historyRef.current = [
      ...historyRef.current,
      payload.bufferedHistory[0],
      payload.bufferedHistory[1],
    ];
    draftRef.current = payload.pendingDraft;
    setDraft(payload.pendingDraft);
    setMessages((prev) =>
      prev.map((message) =>
        message.id === confirmId && message.confirmPayload !== undefined
          ? { ...message, confirmPayload: { ...message.confirmPayload, resolved: true } }
          : message,
      ),
    );
  }, []);

  /**
   * 放弃未决确认（§7.37：选项点击本地处理）：追加放弃文本；草稿与 history 均
   * 不动，确认消息原地 resolved 标记。已 resolved / 消息不存在时空操作。
   */
  const dismissConfirm = useCallback((confirmId: number): void => {
    const payload = messagesRef.current.find(
      (message) =>
        message.id === confirmId &&
        message.kind === 'confirm' &&
        message.confirmPayload !== undefined,
    )?.confirmPayload;
    if (payload === undefined || payload.resolved === true) return;
    const noteId = nextIdRef.current;
    nextIdRef.current += 1;
    // 标记 resolved 与追加放弃文本合并在同一个 updater（原子：不会出现只其一）。
    setMessages((prev) => [
      ...prev.map((message) =>
        message.id === confirmId && message.confirmPayload !== undefined
          ? { ...message, confirmPayload: { ...message.confirmPayload, resolved: true } }
          : message,
      ),
      { id: noteId, role: 'assistant', text: CONFIRM_DISMISS_NOTE, kind: 'text' },
    ]);
  }, []);

  /** 编辑弹窗回写（用户手动改字段，验收 8）。手动编辑落地后未决确认一并取消。 */
  const applyEdit = useCallback(
    (next: ParsedItemDraft): void => {
      cancelPendingConfirm();
      draftRef.current = next;
      setDraft(next);
    },
    [cancelPendingConfirm],
  );

  const confirmSave = useCallback(async (): Promise<ConfirmSaveResult> => {
    const current = draftRef.current;
    if (current === null || busy) {
      return { ok: false, notice: null, message: '' };
    }
    // 切片 25 阶段 2：保存落地后未决确认已过期（pendingDraft 若复活会用旧数据
    // 覆盖用户刚保存的状态），入口一并取消。
    cancelPendingConfirm();
    setBusy(true);
    const tzid = getDeviceTzid();
    try {
      // 切片 19 验收 4 反馈：AI 落库提醒渠道跟随全局默认渠道（app_settings.defaultChannels），
      // 网络渠道参数自动取渠道预设（默认预设 → 第一条）。读取失败不阻断保存
      //（回退 savePlan 默认单系统通知 + 无预设披露）。
      let defaultChannels: ReminderChannel[] | undefined;
      let presets: ChannelPreset[] = [];
      try {
        const [settings, presetList] = await Promise.all([
          itemRepository.getSettings(),
          itemRepository.listChannelPresets(),
        ]);
        defaultChannels = settings.defaultChannels;
        presets = presetList;
      } catch (error) {
        console.warn('[slice-19] 默认渠道/渠道预设读取失败，使用回退值', error);
      }
      const plan = buildFlashSavePlan(current, tzid, Date.now(), defaultChannels, presets);
      // 切片 34（§7.46 / 提案 D4-a）：已保存条目对话式编辑——targetItemId 非空
      // 时走 update 落库链。存在性 + 只读护栏先预检（外部导入项 sourceReadOnly
      // 由 updateItem 抛错护栏，这里转为披露降级新建；预检挡在写之前——一旦
      // updateItem/updateItemTime 已执行、后续链失败无法整链回退）。
      let updateTargetId: string | null = null;
      let updateBaselineTags: ReadonlyArray<{ id: string; name: string }> = [];
      let updateDegradeNotice: string | null = null;
      if (plan.targetItemId !== undefined) {
        let baseline: ItemWithRelations | null = null;
        try {
          baseline = await itemRepository.getItemById(plan.targetItemId);
        } catch (error) {
          console.warn('[slice-34] 目标条目查询失败，降级按新建处理', error);
        }
        if (baseline === null) {
          updateDegradeNotice = '目标条目不存在或已被删除，已按新建处理';
        } else if (baseline.sourceReadOnly) {
          updateDegradeNotice = '目标条目为外部导入只读条目，已按新建处理';
        } else {
          updateTargetId = plan.targetItemId;
          updateBaselineTags = baseline.tags;
        }
      }
      const cardReminders: Reminder[] = [];
      const reminderFailureNotices: string[] = [];
      const tagFailureNotices: string[] = [];
      let savedItem: ItemWithRelations | Item;
      let seedItemId: string;
      if (updateTargetId !== null) {
        // —— update 落库链（提案 D4-b/c/d）：全量 patch —— 卡 = 编辑后完整快照。
        // 时间字段只走 updateItemTime（§4.24 纪律）。
        savedItem = await itemRepository.updateItem(updateTargetId, {
          title: plan.itemInput.title,
          content: plan.itemInput.content,
          type: plan.itemInput.type,
          categoryId: plan.itemInput.categoryId,
          priority: plan.itemInput.priority,
        });
        await itemRepository.updateItemTime(updateTargetId, plan.timePatch);
        // c once 集合差异：draft.reminders 显式数组 → 全量替换（增 create/减
        // delete/同 epoch 保留不动，渠道不漂移）；缺省 → 基线不删、本轮
        // offset/delay/锚点产物增量创建（用户确认的备案语义）。重复提醒与
        // 非 once 频率不参与差异（diffOnceReminderPlans 内过滤）。
        const baselineReminders = await itemRepository.listRemindersByItem(updateTargetId);
        const onceDiff = diffOnceReminderPlans(
          baselineReminders,
          plan.reminderPlans,
          current.reminders !== undefined ? 'replace' : 'append',
        );
        for (const reminderPlan of onceDiff.toCreate) {
          try {
            cardReminders.push(
              await itemRepository.createReminder({
                ...reminderPlan,
                itemId: updateTargetId,
              }),
            );
          } catch (error) {
            console.warn('[slice-34] 提醒创建失败（不中断保存链）', error);
            reminderFailureNotices.push(
              `一条提醒创建失败：${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        for (const stale of onceDiff.toDelete) {
          try {
            await itemRepository.deleteReminder(stale.id);
          } catch (error) {
            console.warn('[slice-34] 提醒删除失败（不中断保存链）', error);
            reminderFailureNotices.push(
              `一条提醒移除失败：${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        cardReminders.push(...onceDiff.toKeep);
        // d tags 差异（normalizeTagName 归一键比较）：目标有而基线没有逐个
        // addTagToItem；基线有而目标没有逐个 removeTagFromItem。
        const tagDiff = diffItemTags(updateBaselineTags, plan.tagNames);
        for (const name of tagDiff.toAdd) {
          try {
            await itemRepository.addTagToItem(updateTargetId, name);
          } catch (error) {
            console.warn('[slice-34] 标签添加失败（不中断保存链）', error);
            tagFailureNotices.push(
              `一个标签添加失败：${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        for (const tagId of tagDiff.toRemoveTagIds) {
          try {
            await itemRepository.removeTagFromItem(updateTargetId, tagId);
          } catch (error) {
            console.warn('[slice-34] 标签移除失败（不中断保存链）', error);
            tagFailureNotices.push(
              `一个标签移除失败：${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        seedItemId = updateTargetId;
      } else {
        // —— create 落库链（既有语义，含降级新建）。
        const created = await itemRepository.createItem(plan.itemInput);
        savedItem = created;
        seedItemId = created.id;
        await itemRepository.updateItemTime(created.id, plan.timePatch);
        for (const name of plan.tagNames) {
          await itemRepository.addTagToItem(created.id, name);
        }
        // 切片 32（§7.44）多计划执行链：逐条顺序 await，单条失败 warn + 披露、
        // 不中断不回滚（条目已落库；部分提醒未创建属可披露的部分成功，与
        // createItem 失败=整链失败的语义分开）。
        for (const reminderPlan of plan.reminderPlans) {
          try {
            cardReminders.push(
              await itemRepository.createReminder({ ...reminderPlan, itemId: created.id }),
            );
          } catch (error) {
            console.warn('[slice-32] 提醒创建失败（不中断保存链）', error);
            reminderFailureNotices.push(
              `一条提醒创建失败：${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      try {
        await reminderScheduler.reconcile();
      } catch (error) {
        console.warn('[slice-15] 保存后 reconcile 失败', error);
      }
      draftRef.current = null;
      setDraft(null);
      // 切片 29（§7.40，用户 2026-11-17 批准的范围修订）：保存后不再清空
      // history，改为播种本次保存草稿的 JSON（沿用 chat.ts historyAppend 的
      // assistant 条目格式）。下一轮 buildHistoryBriefing 因此有「上一张卡片
      // 草稿摘要」块可用，多轮节「短纠正句判定/推迟语义」条款在保存后的轮次
      // 继续生效（修复「保存后『还是30分钟后吧』被误判全新解析」缺陷）。
      // 仅播种这一条、不携带更早对话——保持「每存一张=新对话」设计，不跨条目串味。
      // 切片 33（§7.45）：播种经 serializeDraftForHistory（tzid 与落库同源）——
      // 民用时刻 + wire 键名 start/end，消除保存后 few-shot 毫秒/旧键名同化源。
      // 切片 34（§7.46 / 提案 D2）：播种显式传条目 id——create/degrade 传
      // created.id（覆盖降级场景草稿里可能残留的陈旧 targetItemId，摘要块
      // 解析 itemId 优先）、update 传基线 id（基线连续）。下一轮摘要块渲染
      // 「关联条目 id」行，模型据此回填 wire 的 targetItemId 走 update 落库链。
      historyRef.current = [
        { role: 'assistant', text: serializeDraftForHistory(current, tzid, seedItemId) },
      ];
      // 切片 22 阶段 1（AGENTS.md §7.34）：保存成功后的 AI 回复改为结果卡片消息；
      // 提醒未自动落库的说明仍追加纯文本消息，Alert 提示行为不变。
      // 切片 34：update 措辞「已更新《title》」（提案 D4-e）。
      const message =
        updateTargetId !== null
          ? `已更新《${savedItem.title}》`
          : `已添加《${savedItem.title}》`;
      // 分类快照水合：优先用挂载时镜像；镜像为空时兜底重读（失败不阻断，回退无分类）。
      let cardCategories = categoriesRef.current;
      if (cardCategories.length === 0) {
        try {
          cardCategories = await itemRepository.getCategories();
          categoriesRef.current = cardCategories;
        } catch (error) {
          console.warn('[slice-22] 卡片分类快照读取失败，回退无分类', error);
          cardCategories = [];
        }
      }
      pushCard(
        message,
        buildFlashCardPayload(savedItem, plan.timePatch, cardReminders, cardCategories),
      );
      // 切片 32（§7.44）：提醒披露从单条改多条——域层 reminderNotices（每条
      // 一消息，顺序保留）+ 执行链创建失败披露；ConfirmSaveResult.notice 聚合
      // 供调用方 Alert（换行衔接，与消息流逐条展示并存）。
      // 切片 34：update 降级披露（目标条目不存在/只读）置首；update 路径标签
      // 增删失败披露并入。
      const notices = [
        ...(updateDegradeNotice !== null ? [updateDegradeNotice] : []),
        ...plan.reminderNotices,
        ...reminderFailureNotices,
        ...tagFailureNotices,
      ];
      for (const notice of notices) {
        push('assistant', notice);
      }
      return { ok: true, notice: notices.length > 0 ? notices.join('\n') : null, message };
    } catch (error) {
      // 保存链失败维持纯文本失败提示，不出卡片（切片 22 方案确认）。
      console.warn('[slice-15] 保存失败', error);
      const message = `保存失败：${
        error instanceof Error ? error.message : String(error)
      }`;
      push('assistant', message);
      return { ok: false, notice: null, message };
    } finally {
      setBusy(false);
    }
  }, [busy, push, pushCard, cancelPendingConfirm]);

  /**
   * 快捷推迟（阶段 3，AGENTS.md §7.34）：startAt/endAt 绝对平移 Δ 分钟
   * （endAt 同 Δ 顺延保时长的自解释决定，记录于提交），once 提醒 onceAt
   * 联动顺延，reconcile 重排通知后卡片原地上刷新。
   */
  const postponeCard = useCallback(
    async (itemId: string, minutes: number): Promise<void> => {
      if (busy) return;
      const target = messagesRef.current.find(
        (message) =>
          message.kind === 'card' &&
          message.cardPayload !== undefined &&
          message.cardPayload.itemId === itemId,
      )?.cardPayload;
      if (target === undefined || target.startAt === null || target.allDay) {
        // chips 仅在有具体时间且非 allDay 时渲染（FlashResultCard），此为防御。
        return;
      }
      setBusy(true);
      try {
        const newStart = computePostponedStartAt(target.startAt, minutes);
        const newEnd =
          target.endAt !== null ? computePostponedStartAt(target.endAt, minutes) : null;
        await itemRepository.updateItemTime(itemId, { startAt: newStart, endAt: newEnd });
        const updatedOnceAt = await shiftOnceReminders(itemId, minutes);
        try {
          await reminderScheduler.reconcile();
        } catch (error) {
          console.warn('[slice-22] 推迟后 reconcile 失败', error);
        }
        updateCard(itemId, {
          startAt: newStart,
          endAt: newEnd,
          reminders: patchReminderSnapshot(target, updatedOnceAt),
        });
      } catch (error) {
        console.warn('[slice-22] 快捷推迟失败', error);
        push('assistant', `推迟失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, push, shiftOnceReminders, updateCard],
  );

  return {
    messages,
    draft,
    busy,
    // 切片 30（§7.41）：进行中重试提示（null=无；轮结束自动清空）。
    retryNotice,
    // 切片 30（§7.41）阶段 3：放弃后的草稿快照（null=无；新输入时清空）。
    dismissedDraft,
    // 切片 30（§7.41）阶段 4：已删除条目的 card itemId 集合（mark 模式渲染判定）。
    deletedItemIds,
    categories,
    send,
    applyEdit,
    confirmSave,
    postponeCard,
    applyConfirm,
    dismissConfirm,
    dismissDraft,
    reconcileDeletedCards,
  };
}
