/**
 * 切片 36（§7.48 / 提案 D2/D6）：查询轮编排。
 *
 * 开关读取在调用方（useFlashChat 每轮 getSettings）；本层负责：
 * 两段远端调用（窗口解析 → 全域检索注入 → 回答生成）与降级组包。
 * 查询轮不走 AiParser.parse / RemoteDraftWire（ai.md 契约零改动）；
 * 复用 OpenAICompatibleProvider 传输层（重试/超时/lastDebug/lastUsage
 * 副通道经公开 completeRaw 方法，解析链零 diff）。
 *
 * 降级（D6）：无 Key / 第二段失败 → 本地行式列表回答 + degraded 披露，
 * 降级轮不计 usage；第一段失败不降级（回退默认窗口后第二段仍尝试）。
 */

import {
  OpenAICompatibleProvider,
  extractLastBalancedJson,
  stripCodeFence,
} from './openAiCompatible';
import type { AiTurnDebugSnapshot } from './openAiCompatible';
import { AiParseError } from './errors';
import type { AiConfig } from './configStore';
import type { ItemWithRelations } from '../relations/itemWithRelations';
import { buildQueryAnswerPrompt, buildQueryWindowResolutionPrompt } from './queryPrompt';
import { isQueryWindowWire, resolveQueryWindow } from './queryGuard';
import type { QueryWindowWire } from './queryGuard';
import type { ResolvedQueryWindow } from './queryGuard';
import { buildScheduleRetrievalContext } from './retrieval';
import type { ScheduleRetrievalResult } from './retrieval';
import type { ScheduleQueryTurnResult } from './types';

export interface ScheduleQueryTurnDeps {
  /** 每轮重读的 AI 配置（SecureAiConfigStore）；active 为 null 即无 Key 降级。 */
  config: AiConfig | null;
  now: number;
  tzid: string;
  question: string;
  /** 调用方组包 listItemsWithTags() ∪ listArchivedItemsWithTags() 全量列表。 */
  items: readonly ItemWithRelations[];
  fetchImpl?: typeof fetch;
  aiRetryMax?: number;
  onRetry?: (attempt: number, maxRetries: number) => void;
}

/** 窗口回退披露（D2：回退默认今天起 7 天并在回答披露）。 */
export const QUERY_WINDOW_FALLBACK_NOTICE = '（无法精确解析时间窗口，已按未来 7 天检索。）';

/** 与 chat.ts KIND_LABELS 同文案（该常量未导出，查询轮独立复制避免扩大解析域改动面）。 */
const QUERY_KIND_LABELS: Record<AiParseError['kind'], string> = {
  network: '网络错误',
  'http-status': '服务异常',
  'invalid-json': '返回格式异常',
  'schema-mismatch': '返回结构异常',
  timeout: '请求超时',
  'empty-input': '输入为空',
};

const RETRY_DISCLOSURE_PATTERN = /（已重试 \d+ 次）$/u;

function retryDisclosureOf(message: string): string {
  const match = RETRY_DISCLOSURE_PATTERN.exec(message);
  return match === null ? '' : match[0];
}

/**
 * 第一段原始输出 → 轻 JSON 守卫。解析链（剥围栏 → 尾部配平 → JSON.parse）
 * 与解析轮同构但独立调用（不触碰解析链内部）；任何失败返回 null →
 * resolveQueryWindow 回退默认窗口。
 */
function parseQueryWindowResponse(raw: string): QueryWindowWire | null {
  const candidate = extractLastBalancedJson(stripCodeFence(raw));
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  return isQueryWindowWire(parsed);
}

function toQueryMessages(prompt: { system: string; user: string }): Array<{
  role: 'system' | 'user';
  content: string;
}> {
  return [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];
}

/**
 * D6 本地行式列表回答：retrieval 组包直拼（不调用模型总结）；
 * 降级轮不计 usage（与解析轮「usage 只报成功轮」纪律一致）。
 */
function degradedLocalAnswer(
  deps: ScheduleQueryTurnDeps,
  stage1Debug: AiTurnDebugSnapshot | null,
  notice: string,
  window: ResolvedQueryWindow,
  retrieval: ScheduleRetrievalResult,
): ScheduleQueryTurnResult {
  const listLines =
    retrieval.included === 0 ? '窗口内没有安排。' : retrieval.context;
  const answer = `${window.windowText}日程：\n${listLines}\n\n${notice}`;
  return {
    answer,
    windowText: window.windowText,
    degraded: true,
    usage: null,
    debug: stage1Debug,
    degradedNotice: notice,
  };
}

/** 默认窗口（无 Key 降级路径用：今天起 7 天，不追加窗口披露）。 */
function defaultWindow(deps: ScheduleQueryTurnDeps): ResolvedQueryWindow {
  return resolveQueryWindow(null, deps.now, deps.tzid);
}

/**
 * 查询轮编排入口。question 空（调用方已 trim 拦空）向上抛；
 * 窗口解析失败/守卫拒绝 → 默认今天起 7 天 + 确定性披露（不降级）；
 * 第二段失败 → degraded 本地行式回答 + 披露（含重试计数后缀，如有）。
 */
export async function runScheduleQueryTurn(
  deps: ScheduleQueryTurnDeps,
): Promise<ScheduleQueryTurnResult> {
  const question = deps.question.trim();
  if (question.length === 0) {
    throw new Error('runScheduleQueryTurn: question is empty');
  }

  const remoteConfig = deps.config?.active ?? null;
  if (remoteConfig === null) {
    const window = defaultWindow(deps);
    const retrieval = buildScheduleRetrievalContext(deps.items, window, deps.tzid);
    return degradedLocalAnswer(deps, null, '未配置 AI Key，已用本地日程列表回答。', window, retrieval);
  }

  // provider 声明提出 try 外——第二段失败降级路径也要读取副通道
  //（runFlashTurn 切片 32 先例同构）。
  const provider = new OpenAICompatibleProvider(
    {
      ...remoteConfig,
      retryMax: deps.aiRetryMax,
      onRetry:
        deps.onRetry !== undefined
          ? (attempt, maxRetries) => deps.onRetry?.(attempt, maxRetries)
          : undefined,
    },
    deps.fetchImpl,
  );

  // 第一段：窗口解析（失败不降级——保留默认窗口，第二段仍尝试；
  // debug 快照在此捕获，成功/失败轮均保留，供调试弹层核验轻 JSON）。
  let window = defaultWindow(deps);
  let windowNotice: string | null = QUERY_WINDOW_FALLBACK_NOTICE;
  let stage1Debug: AiTurnDebugSnapshot | null = null;
  try {
    const prompt1 = buildQueryWindowResolutionPrompt(question, deps);
    const raw1 = await provider.completeRaw(toQueryMessages(prompt1));
    stage1Debug = provider.lastDebug;
    window = resolveQueryWindow(parseQueryWindowResponse(raw1), deps.now, deps.tzid);
    windowNotice = window.usedFallback ? QUERY_WINDOW_FALLBACK_NOTICE : null;
  } catch {
    stage1Debug = provider.lastDebug;
  }

  const retrieval = buildScheduleRetrievalContext(deps.items, window, deps.tzid);

  // 第二段：回答生成（失败 → D6 降级；usage 取第二段=终态，D2）。
  try {
    const prompt2 = buildQueryAnswerPrompt(question, retrieval.context, window.windowText, deps);
    const raw2 = await provider.completeRaw(toQueryMessages(prompt2));
    const answer = raw2.trim();
    if (answer.length === 0) {
      return degradedLocalAnswer(
        deps,
        stage1Debug,
        'AI 摘要生成失败（返回为空），已用本地日程列表回答。',
        window,
        retrieval,
      );
    }
    return {
      answer: windowNotice === null ? answer : `${answer}\n\n${windowNotice}`,
      windowText: window.windowText,
      degraded: false,
      usage: provider.lastUsage,
      debug: stage1Debug,
    };
  } catch (e) {
    if (!(e instanceof AiParseError)) {
      throw e;
    }
    const label = QUERY_KIND_LABELS[e.kind];
    const disclosure = retryDisclosureOf(e.message);
    return degradedLocalAnswer(
      deps,
      stage1Debug,
      `AI 摘要生成失败（${label}${disclosure}），已用本地日程列表回答。`,
      window,
      retrieval,
    );
  }
}
