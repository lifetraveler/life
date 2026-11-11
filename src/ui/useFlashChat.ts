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
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { itemRepository } from '../data';
import { SecureAiConfigStore } from '../data/SecureAiConfigStore';
import { runFlashTurn } from '../domain/ai/chat';
import type { AiConfig } from '../domain/ai/configStore';
import { buildFlashSavePlan } from '../domain/ai/savePlan';
import type { ChatMessage, ParsedItemDraft } from '../domain/ai/types';
import type { Category } from '../domain/category';
import { reminderScheduler } from '../notifications';
import { getDeviceTzid } from './timeFormat';

export interface FlashChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}

export interface ConfirmSaveResult {
  ok: boolean;
  /** 提醒未自动落库时的说明（一次性提醒/时区白名单外）。 */
  notice: string | null;
  /** 已追加到消息流的用户可读结果文本。 */
  message: string;
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
        if (!cancelled) setCategories(loaded);
      })
      .catch((error: unknown) => {
        console.warn('[slice-15] 读取分类失败', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const push = useCallback((role: 'user' | 'assistant', text: string): void => {
    setMessages((prev) => [...prev, { id: nextIdRef.current, role, text }]);
    nextIdRef.current += 1;
  }, []);

  const send = useCallback(
    async (raw: string): Promise<void> => {
      const input = raw.trim();
      if (input.length === 0 || busy) return;
      setBusy(true);
      push('user', input);
      try {
        // 每次发送前重读配置：设置页可能在 Tab 挂载后保存/清除了 Key，
        // 挂载时读到的 configRef 已过期（真机验收 6.33 缺陷）。
        if (storeRef.current === null) {
          storeRef.current = new SecureAiConfigStore();
        }
        configRef.current = await storeRef.current.load();
        const result = await runFlashTurn(input, {
          config: configRef.current,
          now: Date.now(),
          tzid: getDeviceTzid(),
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
    [busy, push],
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
      const plan = buildFlashSavePlan(current, tzid, Date.now());
      const created = await itemRepository.createItem(plan.itemInput);
      await itemRepository.updateItemTime(created.id, plan.timePatch);
      for (const name of plan.tagNames) {
        await itemRepository.addTagToItem(created.id, name);
      }
      if (plan.reminderPlan !== null) {
        await itemRepository.createReminder({
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
      const message =
        plan.reminderNotice !== null
          ? `已添加《${created.title}》。${plan.reminderNotice}`
          : `已添加《${created.title}》`;
      push('assistant', message);
      return { ok: true, notice: plan.reminderNotice, message };
    } catch (error) {
      console.warn('[slice-15] 保存失败', error);
      const message = `保存失败：${
        error instanceof Error ? error.message : String(error)
      }`;
      push('assistant', message);
      return { ok: false, notice: null, message };
    } finally {
      setBusy(false);
    }
  }, [busy, push]);

  return { messages, draft, busy, categories, send, applyEdit, confirmSave };
}
