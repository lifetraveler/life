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
import type { AiConfig } from '../domain/ai/configStore';
import {
  computePostponedOnceAt,
  computePostponedStartAt,
} from '../domain/ai/postpone';
import { buildFlashSavePlan } from '../domain/ai/savePlan';
import type {
  ChatMessage,
  FlashCardPayload,
  ParsedItemDraft,
} from '../domain/ai/types';
import type { Category } from '../domain/category';
import type { ChannelPreset } from '../domain/channelPreset';
import type { OnceCivilTime, Reminder, ReminderChannel } from '../domain/reminder';
import { reminderScheduler } from '../notifications';
import { formatItemTime, getDeviceTzid } from './timeFormat';

export interface FlashChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /** 呈现形态（切片 22）：'text' 纯文本；'card' 结果卡片（cardPayload 必有）。 */
  kind: 'text' | 'card';
  cardPayload?: FlashCardPayload;
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

/**
 * 编辑/推迟后刷新卡片提醒快照：被顺延的 once 提醒若正是卡片快照里那条，
 * 用新 onceAt 替换（卡片提醒行 once 显示绝对触发时刻，随之可见变化）；
 * 未被顺延（重复提醒/无提醒/快照与库中不一致）保持原快照。
 */
function patchReminderSnapshot(
  target: FlashCardPayload,
  updatedOnceAt: Map<string, OnceCivilTime>,
): FlashCardPayload['reminder'] {
  if (target.reminder === null) return null;
  const nextOnceAt = updatedOnceAt.get(target.reminder.id);
  return nextOnceAt === undefined
    ? target.reminder
    : { ...target.reminder, onceAt: nextOnceAt };
}

export function useFlashChat() {
  const [messages, setMessages] = useState<FlashChatMessage[]>([]);
  const [draft, setDraft] = useState<ParsedItemDraft | null>(null);
  const [busy, setBusy] = useState(false);
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
    setMessages((prev) => [...prev, { id: nextIdRef.current, role, text, kind: 'text' }]);
    nextIdRef.current += 1;
  }, []);

  /** 追加结果卡片消息（切片 22 阶段 1，AGENTS.md §7.34）。 */
  const pushCard = useCallback((text: string, cardPayload: FlashCardPayload): void => {
    setMessages((prev) => [
      ...prev,
      { id: nextIdRef.current, role: 'assistant', text, kind: 'card', cardPayload },
    ]);
    nextIdRef.current += 1;
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

  /** 追加一轮编辑对话到 history（供远端解析上下文连贯）。 */
  const appendEditHistory = useCallback((input: string, note: string): void => {
    historyRef.current = [
      ...historyRef.current,
      { role: 'user', text: input },
      { role: 'assistant', text: note },
    ];
  }, []);

  /**
   * 编辑窄规则——草稿分支：把「改成X点」落到当前草稿（预览卡自动刷新），
   * 提醒在保存时按新 startAt 重算，无需额外联动。
   * 返回 true 表示本轮已被编辑路径处理（send 不再走解析流程）。
   */
  const applyEditToDraft = useCallback(
    (input: string, tzid: string): boolean => {
      const current = draftRef.current;
      if (current === null || current.allDay || !matchesEditIntent(input)) {
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
      appendEditHistory(input, note);
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
          reminder: patchReminderSnapshot(target, updatedOnceAt),
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

  const send = useCallback(
    async (raw: string): Promise<void> => {
      const input = raw.trim();
      if (input.length === 0 || busy) return;
      setBusy(true);
      push('user', input);
      const tzid = getDeviceTzid();
      try {
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
        const result = await runFlashTurn(input, {
          config: configRef.current,
          now: Date.now(),
          tzid,
          history: historyRef.current,
          previousDraft: draftRef.current,
        });
        historyRef.current = [...historyRef.current, ...result.historyAppend];
        draftRef.current = result.draft;
        setDraft(result.draft);
        push('assistant', result.assistantNote);
      } catch (error) {
        console.warn('[slice-15] 解析失败', error);
        push(
          'assistant',
          `解析失败：${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, push, applyEditToCard, applyEditToDraft],
  );

  /** 编辑弹窗回写（用户手动改字段，验收 8）。 */
  const applyEdit = useCallback((next: ParsedItemDraft): void => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const confirmSave = useCallback(async (): Promise<ConfirmSaveResult> => {
    const current = draftRef.current;
    if (current === null || busy) {
      return { ok: false, notice: null, message: '' };
    }
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
      const created = await itemRepository.createItem(plan.itemInput);
      await itemRepository.updateItemTime(created.id, plan.timePatch);
      for (const name of plan.tagNames) {
        await itemRepository.addTagToItem(created.id, name);
      }
      let createdReminder: Reminder | null = null;
      if (plan.reminderPlan !== null) {
        createdReminder = await itemRepository.createReminder({
          ...plan.reminderPlan,
          itemId: created.id,
        });
      }
      try {
        await reminderScheduler.reconcile();
      } catch (error) {
        console.warn('[slice-15] 保存后 reconcile 失败', error);
      }
      draftRef.current = null;
      setDraft(null);
      historyRef.current = [];
      // 切片 22 阶段 1（AGENTS.md §7.34）：保存成功后的 AI 回复改为结果卡片消息
      //（替代原「已添加《xx》」纯文本）；提醒未自动落库的说明（reminderNotice）
      // 仍追加一条纯文本消息，Alert 提示行为不变。
      const message = `已添加《${created.title}》`;
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
        buildFlashCardPayload(created, plan.timePatch, createdReminder, cardCategories),
      );
      if (plan.reminderNotice !== null) {
        push('assistant', plan.reminderNotice);
      }
      return { ok: true, notice: plan.reminderNotice, message };
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
  }, [busy, push, pushCard]);

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
          reminder: patchReminderSnapshot(target, updatedOnceAt),
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

  return { messages, draft, busy, categories, send, applyEdit, confirmSave, postponeCard };
}
