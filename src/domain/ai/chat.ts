/**
 * 闪电添加单轮编排（tasks/slice-15.md 阶段 3；ai.md v0.15）。
 *
 * Provider 选择（ai.md / AGENTS.md §7.24 降级机制）：
 * - 无 Key（config.active === null）→ LocalFallbackProvider，返回降级提示；
 * - 有 Key → OpenAICompatibleProvider；任何 AiParseError（断网/超时/HTTP/
 *   返回残缺）→ 降级 LocalFallbackProvider 并在会话中注明原因（错误消息
 *   不含 apiKey）；非 AiParseError 的意外异常向上抛给调用方。
 *
 * 合并语义：
 * - Remote 路径：模型拿到完整 history（含此前每轮草稿 JSON），每轮重写
 *   完整草稿，不做本地合并；
 * - Fallback 路径：无状态槽位解析 + parseSlots 的 expressed 掩码，与上一轮
 *   卡片做字段级合并（merge.ts），实现"改成后天"只动时间不动标题。
 *
 * historyAppend 的 assistant 文本统一为合并后草稿的 JSON：远程模型下一轮
 * 可读，本地路径不需要（无状态），且便于调试回放。
 */

import { AiParseError } from './errors';
import { LocalFallbackProvider } from './localFallback';
import { mergeDraftCorrection } from './merge';
import { OpenAICompatibleProvider } from './openAiCompatible';
import type { AiConfig } from './configStore';
import type { AiParseContext, ChatMessage, ParsedItemDraft } from './types';

export interface FlashTurnDeps {
  /** 当前 AI 配置（SecureAiConfigStore.load() 的结果；null = 未加载/无配置）。 */
  config: AiConfig | null;
  now: number;
  tzid: string;
  history: ReadonlyArray<ChatMessage>;
  previousDraft: ParsedItemDraft | null;
  /** 测试注入；生产用全局 fetch。 */
  fetchImpl?: typeof fetch;
}

export interface FlashTurnResult {
  /** 本轮结束后预览卡片应显示的草稿。 */
  draft: ParsedItemDraft;
  /** 展示给用户的 AI 侧文字（降级原因 / 更新确认）。 */
  assistantNote: string;
  /** true = 本轮实际用的是本地降级解析。 */
  degraded: boolean;
  /** 追加到会话 history 的一对消息（user 原文 + assistant 草稿 JSON）。 */
  historyAppend: [ChatMessage, ChatMessage];
}

const KIND_LABELS: Record<AiParseError['kind'], string> = {
  network: '网络错误',
  'http-status': '服务异常',
  'invalid-json': '返回格式异常',
  'schema-mismatch': '返回结构异常',
  timeout: '请求超时',
  'empty-input': '输入为空',
};

const localFallback = new LocalFallbackProvider();

function fallbackTurn(
  trimmed: string,
  note: string,
  deps: FlashTurnDeps,
): FlashTurnResult {
  const context: AiParseContext = {
    now: deps.now,
    tzid: deps.tzid,
    history: [...deps.history],
  };
  const parsed = localFallback.parseSlots(trimmed, context);
  const draft =
    deps.previousDraft !== null
      ? mergeDraftCorrection(deps.previousDraft, parsed.draft, parsed.expressed)
      : parsed.draft;
  return {
    draft,
    assistantNote: note,
    degraded: true,
    historyAppend: [
      { role: 'user', text: trimmed },
      { role: 'assistant', text: JSON.stringify(draft) },
    ],
  };
}

export async function runFlashTurn(
  input: string,
  deps: FlashTurnDeps,
): Promise<FlashTurnResult> {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error('runFlashTurn: input is empty');
  }

  const remoteConfig = deps.config?.active ?? null;
  if (remoteConfig !== null) {
    try {
      const provider = new OpenAICompatibleProvider(remoteConfig, deps.fetchImpl);
      const draft = await provider.parse(trimmed, {
        now: deps.now,
        tzid: deps.tzid,
        history: [...deps.history],
      });
      return {
        draft,
        assistantNote: deps.previousDraft === null ? '已解析，请核对卡片' : '已更新卡片',
        degraded: false,
        historyAppend: [
          { role: 'user', text: trimmed },
          { role: 'assistant', text: JSON.stringify(draft) },
        ],
      };
    } catch (e) {
      if (!(e instanceof AiParseError)) throw e;
      // 断网/超时/HTTP 异常/返回残缺 → 降级（ai.md / §7.24），原因注明在会话里。
      return fallbackTurn(
        trimmed,
        `AI 服务暂不可用（${KIND_LABELS[e.kind]}），已用本地解析`,
        deps,
      );
    }
  }

  return fallbackTurn(trimmed, '未配置 AI Key，已用本地解析', deps);
}
