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
import { matchesEditIntent } from './editIntent';
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
  // 切片 24（§7.36 / slice-23 遗留 2）：tags 只在两种轮次从上一轮继承——
  // 1) 编辑词轮（「改成X点」，同一张卡的修改；多数被 useFlashChat 编辑窄规则
  //    拦截，此处兜底 allDay 卡等漏网路径）；
  // 2) 澄清待补轮（previousDraft.needsClarification=true，续答补全的是同一
  //    事项，§7.35 语义必须保留，否则「提醒我吃药 #健康」+「明早8点」丢标签）。
  // 其余（全新意图的新输入）不继承：tags 恒取本轮解析值，未表达即为空，
  // 避免「叫醒卡带上一条散步/心情标签」的跨条目污染。
  const inheritTags =
    matchesEditIntent(trimmed) ||
    deps.previousDraft?.needsClarification === true;
  let merged = parsed.draft;
  if (deps.previousDraft !== null) {
    merged = mergeDraftCorrection(deps.previousDraft, parsed.draft, parsed.expressed, {
      inheritTags,
    });
    // 切片 23 验收反馈修补：降级纠正轮标题不被本轮剩余原文覆盖——本地槽位解析
    // 没有 LLM 的标题提炼能力，“预约到XX医院”这类补充轮的剩余原文会被当成
    // expressed 标题，把上一轮主题词（如「预约体检」）改写掉。标题沿用上一轮，
    // 本轮原词并入 content 作补充说明（content 既有内容以「；」衔接保留）。
    // 切片 25（§7.37 域规则 + slice-24 closeout §5 遗留 1）：标题保护仅适用于
    // 纠正/补充轮，全新意图不复用上一张卡的标题（「起床」标题曾误留到
    // 「后天下午3点开会」卡）。纠正/补充轮判定（前三支与 :79 inheritTags 同源）：
    // 1) 编辑词轮（「改成X点」，matchesEditIntent）；
    // 2) 澄清续答轮（previousDraft.needsClarification=true，续答常带新时刻，
    //    时间表达不否决本支）；
    // 3) 本轮未表达新时间的补充轮（如「预约到XX医院」只补细节不带新时刻，
    //    ai.md「澄清续答轮与已有卡片后的补充轮同样 title 沿用上一轮主题词」）。
    // 反之：带新时间又带新主题词的输入按全新意图出卡（遗留 1 修复落点）。
    // 注：任务卡原文谓词仅为 1)+2)；3) 为 ai.md 补充轮契约（:197/:205）所必需，
    // 已在阶段报告披露该偏差。残余边界（本轮已披露）：不带时刻的全新意图
    // （如「记一下体检报告指标」）仍会沿用旧标题，同属遗留 1 家族、本切片收窄。
    const inheritTitle =
      inheritTags || !parsed.expressed.has('startAt');
    if (
      inheritTitle &&
      parsed.expressed.has('title') &&
      parsed.draft.title !== deps.previousDraft.title
    ) {
      merged = {
        ...merged,
        title: deps.previousDraft.title,
        content:
          merged.content && merged.content.length > 0
            ? `${merged.content}；${trimmed}`
            : trimmed,
      };
    }
  }
  const draft = deps.previousDraft !== null ? merged : parsed.draft;
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
