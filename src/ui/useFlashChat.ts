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
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { itemRepository } from '../data';
import { SecureAiConfigStore } from '../data/SecureAiConfigStore';
import { buildFlashCardPayload } from '../domain/ai/cardPayload';
import { runFlashTurn } from '../domain/ai/chat';
import type { AiConfig } from '../domain/ai/configStore';
import { buildFlashSavePlan } from '../domain/ai/savePlan';
import type { ChatMessage, FlashCardPayload, ParsedItemDraft } from '../domain/ai/types';
import type { Category } from '../domain/category';
import type { ChannelPreset } from '../domain/channelPreset';
import type { Reminder, ReminderChannel } from '../domain/reminder';
import { reminderScheduler } from '../notifications';
import { getDeviceTzid } from './timeFormat';

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

  return { messages, draft, busy, categories, send, applyEdit, confirmSave };
}
