/**
 * 切片 36（§7.48 / 提案 D2）：查询轮两段式 prompt。
 *
 * 独立常量域——不修改 AI_SYSTEM_PROMPT（闪电解析域隔离，ai.md 契约
 * 零改动，ai-prompt 只读页不变）。两段共用 AI_QUERY_SYSTEM_PROMPT
 * 作为角色与纪律基座，阶段专属输出要求由各 builder 追加。
 */

import { buildNowFacts } from './prompt';

/** 查询轮时间事实上下文（now/tzid 由调用方每轮提供）。 */
export interface QueryNowContext {
  now: number;
  tzid: string;
}

/** 两段 prompt 的组包结果（scheduleQuery 组装成 messages 数组发往 provider）。 */
export interface QueryPromptMessages {
  system: string;
  user: string;
}

/**
 * 查询轮系统基座：角色限定 + 不编造纪律 + 民用格式约定。
 * 与 AI_SYSTEM_PROMPT 完全独立（查询轮不走 parse/wire）。
 */
export const AI_QUERY_SYSTEM_PROMPT = [
  '你是本地日程应用的对话式查询助手，只负责回答与用户日程、待办、记录相关的问题。',
  '回答只依据提供的日程数据与时间事实，不要编造数据中不存在的日程。',
  '日期一律用绝对日期 YYYY-MM-DD 表达；时间用 24 小时制 HH:mm。',
].join('\n');

/** 第一段（窗口解析）阶段指令：独立轻 JSON，键固定。 */
const QUERY_WINDOW_STAGE_INSTRUCTIONS = [
  '任务：判断用户问题涉及的时间窗口。',
  '只输出一个 JSON 对象，不要输出任何其他文字、解释或代码围栏：',
  '{"start":{"date":"YYYY-MM-DD"},"end":{"date":"YYYY-MM-DD"}}',
  '窗口为闭区间（start 与 end 两日均包含）；end 不得早于 start。',
  '无法精确判断时，输出当前日期起未来 7 天的窗口，不要输出 null。',
].join('\n');

/** 第二段（回答生成）阶段指令：纯文本摘要，Q3 否决结构化卡片。 */
const QUERY_ANSWER_STAGE_INSTRUCTIONS = [
  '任务：基于下方给出的窗口内日程数据，用自然语言回答用户问题。',
  '只输出纯文本回答：不要输出 JSON，不要使用 Markdown 标题、表格或列表符号。',
  '数据中没有的日程不要编造；窗口内没有安排时如实说明这段时间没有安排。',
  '回答保持简短（一般不超过 150 字），重要条目可逐条点名。',
].join('\n');

function buildQueryNowFacts(context: QueryNowContext): string {
  return buildNowFacts({ now: context.now, tzid: context.tzid, history: [] });
}

/**
 * 第一段·窗口解析 prompt（提案 D2）。
 * 输出轻 JSON {start:{date},end:{date}}（民用绝对日期，含当日）；
 * 解析与守卫在 queryGuard.ts，模型只产民用日期、epoch 换算一律本地。
 */
export function buildQueryWindowResolutionPrompt(
  input: string,
  context: QueryNowContext,
): QueryPromptMessages {
  return {
    system: `${AI_QUERY_SYSTEM_PROMPT}\n\n${QUERY_WINDOW_STAGE_INSTRUCTIONS}`,
    user: [
      buildQueryNowFacts(context),
      `用户问题：${input}`,
      '请解析该问题涉及的时间窗口，只输出窗口 JSON。',
    ].join('\n\n'),
  };
}

/**
 * 第二段·回答生成 prompt（提案 D2/D3）。
 * retrievalContext 为 retrieval.ts 行式组包（含截断披露行）；
 * 回答为自然语言摘要纯文本。
 */
export function buildQueryAnswerPrompt(
  question: string,
  retrievalContext: string,
  windowText: string,
  context: QueryNowContext,
): QueryPromptMessages {
  return {
    system: `${AI_QUERY_SYSTEM_PROMPT}\n\n${QUERY_ANSWER_STAGE_INSTRUCTIONS}`,
    user: [
      buildQueryNowFacts(context),
      `查询窗口：${windowText}`,
      '窗口内日程数据：',
      retrievalContext,
      `用户问题：${question}`,
      '请基于以上日程数据回答。',
    ].join('\n\n'),
  };
}
