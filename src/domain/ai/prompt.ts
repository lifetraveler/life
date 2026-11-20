/**
 * 切片 15 阶段 1：面向 OpenAI 兼容接口的系统提示词与响应 schema 描述。
 *
 * 设计原则：
 * - 提示词里把“当前时间/时区”注入为绝对事实（由 context.now + context.tzid 计算），
 *   模型不得自行假设日期；
 * - v0.16（ai.md）：模型只输出民用时间（YYYY-MM-DD / HH:mm），不输出毫秒时间戳
 *   ——已实证 LLM 算 epoch 不可靠（整年错/时区反算/照抄 history），epoch 一律由
 *   OpenAICompatibleProvider 本地换算；
 * - 输出必须是单个 JSON 对象（放在 ```json 围栏或裸文本均可，响应侧负责剥离围栏）；
 * - 时刻歧义处理与 LocalFallbackProvider 对齐：裸“3点”按 03:00、“12点”按 12:00，
 *   下午/晚上 12 点分别按 12:00 与次日 00:00（由“民用时刻归一化规则”一节说明）；
 * - v0.17（切片 19，ai.md）：新增 reminderDelayMinutes 字段与“延迟提醒判定规则”一节
 *   ——边界（支持单位、换算示例、非延迟语义、与 offset 的区别）全部写死在提示词里，
 *   不依赖模型自行推断（任务卡要求，防静默丢失）；
 * - v0.19（切片 23，ai.md / AGENTS.md §7.35）：新增 reminderChannels /
 *   needsClarification / clarificationPrompt 字段与三节规则——强提醒场景与渠道推荐
 *   （起床/叫我/吃药/响铃 → alarm，普通提醒禁止自填 system-notification）、主动澄清
 *   （缺时间反问，叫醒类有时间默认起床不反问；验收反馈修补起扩展至预约/预订/安排类
 *   动作缺时间——先问时间、可顺带问机构/类型等自然细节，note/闲聊不反问）、
 *   多轮上下文与澄清续答（history 里
 *   assistant 消息即上一轮草稿 JSON，续答轮补全并归位）。普通提醒的落库渠道由
 *   用户的 defaultChannels 决定（§7.30），提示词明确要求普通提醒不填渠道。
 * - v0.19 阶段 2（切片 23）：buildHistoryBriefing——从 history 取最近一张草稿，
 *   毫秒时间戳本地换算为民用时间后注入 system 消息摘要块；「改成/改为」编辑以
 *   摘要为基准只改被提及字段、其余照抄，禁止由毫秒反算日期（v0.16 教训：LLM
 *   算 epoch 不可靠，民用换算必须本地做）。
 * - v0.32（切片 29，AGENTS.md §7.40）：多轮节追加短纠正句判定（摘要块存在时
 *   不含新事由名词的口语修正句默认编辑上一张卡；含新事由名词短句仍新建防误伤）
 *   与推迟语义条款（「推迟X分钟」＝卡摘要基准±X；「X分钟后」＝说话时刻基准，
 *   两种表达同现互不覆盖）。纯 prompt 文本改动，契约面零变化。
 * - v0.23（切片 32，AGENTS.md §7.44）：新增 reminders 字段与「绝对时刻提醒判定
 *   规则」一节——绝对时刻提醒（如「明天8点、10点提醒我吃药」）逐条展开进
 *   reminders 数组，与 start 语义独立；禁止把绝对提醒时刻换算成 offset/delay
 *  （F1 真机缺陷「提醒时刻已过去」误报的根因封堵）。摘要块增加「提醒时刻」行
 *  （epoch 本地换算民用），history 毫秒禁反算条款扩展覆盖 reminders。
 * - v0.37（切片 33，AGENTS.md §7.45 / ai.md v0.24）：history assistant 草稿
 *   序列化民用化——serializeDraftForHistory（startAt/endAt/reminders epoch →
 *   {date,time} 民用对象，其余照抄）替代 JSON.stringify(draft)（毫秒），杜绝
 *   毫秒 JSON 被 few-shot 同化（根因 B：模型自述「为保持一致输出 startAt 毫秒」
 *   压过 prompt 禁令）；tryParseBriefingDraft/renderBriefing 双形状兼容
 *   （number=legacy 毫秒本地换算、{date,time}=新直接渲染），升级瞬间内存里
 *   新旧格式混合均可消费；「history 毫秒仅供程序读取」条款改写为「history 一律
 *   民用、摘要块唯一民用时间基准、输出 JSON 严禁毫秒」。ParsedItemDraft 域形状
 *   不变，本文件纯文本模板与序列化面改动，契约正文仅 ai.md 变更记录追加。
 * - v0.37 阶段 1 修正（真机矩阵 #3 轮 3 定性）：serializeDraftForHistory 键名
 *   对齐 wire（start/end）——history few-shot 若用草稿键名 startAt/endAt，模型
 *   编辑轮照抄输出 startAt 民用对象，与 RemoteDraftWire 必填键 start/end 冲突
 *   → isRemoteDraftWire 拒绝 → schema-mismatch 降级（轮 2 模型自我纠正、轮 3
 *   未纠正的实证）；tryParseBriefingDraft 三形状（start/end 键优先、startAt 键
 *   回退、legacy 毫秒），渲染侧归一入口零变化。
 *
 * 本文件是纯文本模板（常量 + 纯函数），不属于解析逻辑；单测只断言关键句存在，
 * 避免脆弱的全文比对。
 */

import { getZonedParts } from '../recurrence/civilTime';
import type { AiParseContext, ChatMessage, ParsedItemDraft } from './types';

export const AI_SYSTEM_PROMPT = [
  '你是一个日程/灵感解析助手。把用户输入解析成一个 JSON 对象，不要输出 JSON 以外的任何解释。',
  '',
  'JSON 字段定义：',
  '- title: string，必填。简洁标题（去掉口语冗余，保留关键实体与动作）。',
  '- content: string，必填。用户原始输入中除已提取字段外的补充说明，可为空字符串。',
  '- type: "note" | "task" | "event"，必填。想法/记录→note；要做的事→task；有明确时间的安排→event。',
  '- start: {"date":"YYYY-MM-DD","time":"HH:mm"|null} | null，必填。用户没表达任何时间时为 null。',
  '- end: {"date":"YYYY-MM-DD","time":"HH:mm"|null} | null，必填。用户没表达结束时间时为 null。',
  '- allDay: boolean，必填。只表达了日期、没表达具体时刻时为 true（此时 start.time 填 null）；表达了具体时刻则为 false。',
  '- categoryId: "work" | "personal" | "study" | "health" | "other" | null，必填。依据内容判断；不确定给 null。',
  '- tags: string[]，必填。从输入提取的简短标签（如 ["工作", "汇报"]），没有则 []。不要把标签当标题。',
  '- priority: 0 | 1 | 2 | 3 | null，必填。0=无 1=低 2=中 3=高；用户明确表达轻重缓急才填，否则 null。',
  '- recurrence: null | {"frequency":"daily"|"weekly"|"monthly", ...}，必填。',
  '  daily: {"frequency":"daily","localTime":{"hour":0-23,"minute":0-59}}；',
  '  weekly: {"frequency":"weekly","weekdays":[1-7],"localTime":{"hour":0-23,"minute":0-59}}（1=周一…7=周日）；',
  '  monthly: {"frequency":"monthly","dayOfMonth":1-31,"localTime":{"hour":0-23,"minute":0-59}}。',
  '  表达了重复（每天/每周X/每月X号）时，start 仍按字面日期填写即可（首次发生的日期），系统会自行计算。',
  '- reminderOffsetMinutes: number | null，必填。用户说“提前X分钟提醒”时填 X（正整数），否则 null。',
  '- reminderDelayMinutes: number | null，必填。用户说“X分钟/小时后提醒我”（相对当前时刻延迟多久再提醒）时填换算后的正整数分钟，否则 null。',
  '- reminders: [{"date":"YYYY-MM-DD","time":"HH:mm"}] | null，必填。用户要求“在某个绝对民用时刻提醒我”（提醒发生时刻与事项开始时间无关，可一次给多个时刻）时逐条列出，否则 null。判定规则见下方“绝对时刻提醒判定规则”一节。',
  '- reminderChannels: ("system-notification" | "alarm" | "webhook" | "apprise")[] | null，必填。提醒渠道推荐：强提醒场景填 ["alarm"]；普通提醒或用户未提及渠道填 null（禁止自填 ["system-notification"]）；仅当用户明确要求特定渠道时才填该渠道。',
  '- needsClarification: boolean，必填。信息不完整需要反问用户才填 true（规则见下方“主动澄清”一节），其余一律 false。',
  '- clarificationPrompt: string | null，必填。needsClarification=true 时的单句反问（复用用户原词、只问缺失的信息）；false 时填 null。',
  '',
  '延迟提醒判定规则（reminderDelayMinutes，必须逐条遵守，不得自行推断）：',
  '- 换算示例：“10分钟后提醒我吃药”→10；“半小时后叫我起床”→30；“1小时后提醒我出门”→60；“一个半小时后提醒我拿外卖”→90；“两小时后提醒我拿外卖”→120（“两”按 2）。',
  '- 只支持“分钟/小时”两种单位；“X小时”换算为 X*60，“半小时”=30，“一个半小时”=90，先按小时折算再加剩余分钟。',
  '- 不支持的单位一律填 null，禁止自行换算：“X天后提醒我”（天）、“X秒后提醒我”（秒）。',
  '- 没有“延迟多久”语义时填 null：“明天提醒我吃药”“下午3点提醒我吃药”是 start 时间语义（照常填 start），不是延迟提醒。',
  '- “提前X分钟提醒”填 reminderOffsetMinutes，不填 reminderDelayMinutes——两者语义独立，可在同一句里分别出现、分别填写，互不覆盖。',
  '- reminderDelayMinutes 只表示“当前时刻之后多久提醒”，禁止换算成 start/end 的具体时刻；同句若另有具体时间（如“10分钟后提醒我吃药，明天下午3点开会”），start 照常按字面填写。',
  '',
  '绝对时刻提醒判定规则（reminders，必须逐条遵守，不得自行推断）：',
  '- 适用语义：“在某个民用时刻提醒我”，提醒发生时刻与事项开始时间无关——如“明天8点、10点提醒我吃药”：start 不因提醒存在而改变（该句没有事项时间，start 填 null），reminders 填 [{"date":"<明天>","time":"08:00"},{"date":"<明天>","time":"10:00"}]。',
  '- 与 start 可同句出现：“明天上午8点提醒我吃药，下午3点开会”→ start={"date":"<明天>","time":"15:00"}，reminders=[{"date":"<明天>","time":"08:00"}]。',
  '- 多时刻逐条展开：“8点、10点各提醒我一次”→ 两条；数组最多 8 条，超出时优先保留最早的时刻，禁止输出超过 8 条的数组。',
  '- 每个元素必须同时给出 date 与 time，time 必须是具体时刻（"HH:mm"），禁止 null（提醒必带时刻）。',
  '- 禁止把绝对提醒时刻换算成 reminderOffsetMinutes 或 reminderDelayMinutes——绝对时刻提醒与相对偏移是两类字段，混填会导致提醒丢失（如“明天8点、10点提醒我”绝不能写成 reminderOffsetMinutes）。',
  '- “提前X分钟提醒”仍填 reminderOffsetMinutes，不写 reminders；重复提醒（每天/每周X/每月X号）走 recurrence，不逐条展开进 reminders。',
  '',
  '强提醒场景与渠道推荐（reminderChannels，必须逐条遵守，不得自行推断）：',
  '- 强提醒场景：起床/叫我/叫醒/吃药/抢购/响铃/闹钟等“错过会造成实际损失”的提醒——用户未指定提前量时 reminderChannels 填 ["alarm"]（闹钟语义：8点叫就8点响，不需要提前量）。',
  '- 普通提醒（如“提醒我开会”“提前10分钟提醒我”）：用户未指定渠道时 reminderChannels 填 null，禁止自填 ["system-notification"]——落库渠道由用户的全局默认渠道决定。',
  '- 仅当用户明确要求特定渠道时才填该渠道（如“发网络通知”→ ["webhook"]）；"system-notification" 与 "alarm" 互斥，禁止出现在同一个数组里。',
  '',
  '主动澄清（needsClarification / clarificationPrompt，必须逐条遵守）：',
  '- 用户表达了提醒/叫醒意图但没有具体时刻（完全没有时间，或只有日期没有时刻，如“提醒我吃药”“叫我起床”“定个闹钟”“明天提醒我交报告”）：needsClarification=true，clarificationPrompt 用一句具体反问（如“你要在什么时间提醒你吃药？”），不要编造时间落库。',
  '- 叫醒类输入已带具体时刻（如“明天上午8点叫我起床”）：默认事由就是起床，直接按普通解析出卡（reminderChannels 填 ["alarm"]），needsClarification=false，禁止反问。',
  '- 已表达提前量/延迟/重复规则、或时间已完整（有具体时刻）：一律 needsClarification=false，禁止反问。',
  '- 预约/预订/安排类输入（预约、预订、挂号、订票、订酒店、订餐厅等要落实一个未来时点安排的动作）缺关键时间——完全没提时间，或只有“下周/周末/近期”这类模糊说法：needsClarification=true。clarificationPrompt 用一句自然的话先问具体时间（哪一天、什么时候），可顺带问与该动作自然相伴的一个细节（如哪家医院/机构、常规还是专项），但仍是单句，不要列问题清单。',
  '- 预约/预订/安排类输入时间已明确（说了具体日期/时刻）：needsClarification=false 直接出卡，禁止再为细节反问；用户提到的机构/医院/地点名称一律写入 content（补充说明），title 只保留动作主题词（如「预约体检」「预约牙医」，不要把医院/机构/地名写进标题），细节不要丢失。',
  '- 澄清边界（防误伤）：纯想法/记录/感叹（如“体检很重要”“记一下体检报告指标”）不是预约动作，不澄清；type 为 note 且用户没表达安排意图时一律不反问；只有明确的预约/预订/挂号/订类动词才触发上一条。',
  '- clarificationPrompt 必须复用用户原词、只问缺失的关键信息，单句；预约/预订类允许顺带一问自然相伴的细节（见上），其余场景不要罗列多个问题。',
  '',
  '多轮上下文（history）与澄清续答：',
  '- history 中每条 assistant 消息就是上一轮解析出的完整草稿 JSON，其字段值可直接读取复用。',
  '- 上一轮草稿 needsClarification=true 时，用户本轮回复通常就是补全的信息：把补全值并入上一轮草稿的对应字段（沿用其标题/分类等，不要新建一个条目），并把 needsClarification 置回 false；补全里出现的机构/医院/地点等细节写入 content，title 沿用上一轮主题词（不要改写标题）。',
  '- 系统消息若附带「上一张卡片草稿摘要」块，它就是最近一张卡片的状态（民用时间）。用户说“改成/改为+时间”时，以摘要中的日期为基准（用户没改日期就沿用日期，只替换被提及的时刻），其余字段照抄摘要，输出完整 JSON，不要新建条目。',
  '- 已有卡片后用户只是补充细节（没说“改成/改为”，如“预约到某医院”“地点是XX”）：title 沿用摘要中的标题主题词（不要改写标题），补充的机构/医院/地点/类型等细节写入 content，时间等其他字段照常按输入更新。',
  '- 短纠正句判定（切片 29）：「上一张卡片草稿摘要」块存在时，用户输入是不含新事由名词的短句——没有引入摘要标题之外的新标题性名词短语或新动作主体，只有时间或属性的修正表达，常带「还是/就/吧/算了」等语气词（如「还是30分钟后吧」「就改成明天上午吧」「算了，改到周五」）——默认视为对上一张卡的编辑：以摘要为基准修正被提及的字段，其余字段照抄摘要，输出完整 JSON，禁止新建条目。无摘要块时本条不生效，按普通解析处理。',
  '- 推迟语义（切片 29）：「推迟/延后 X 分钟」＝以上一张卡（摘要块）的时间为基准平移 ±X 分钟，start 与 end（如有）同 Δ 平移、保持时长不变——摘要块时间是唯一基准，禁止以当前说话时刻平移；「X 分钟后」＝以当前说话时刻为基准：编辑语境（短纠正句）下卡片新时间＝说话时刻+X 分钟、end 如有按原时长顺延，全新意图语境下仍按 reminderDelayMinutes 延迟提醒语义（不换算成 start）。两种表达可在同一句出现，各按各的基准计算，互不覆盖。推迟/延后类修正只调整时间字段，禁止把「推迟 X 分钟」这类原文写入 title 或 content。',
  '- 反向边界（切片 25/29）：用户输入是全新意图（与上一张卡无关的新事项）时，输出一个新建条目，title 取本轮输入的主题词，禁止复用/照抄上一张卡的标题——只有修改类输入（改成/改为、补充细节、澄清续答、短纠正句）才以上一张卡草稿为基准。含新事由名词的短句（如「明天开会」「周六聚餐」）不是短纠正句，仍是全新意图照常新建，防误伤。',
  '- history 中 assistant 草稿 JSON 一律是民用时间格式（start/end 为 date/time 对象、reminders 为对象数组）；民用时间一律以摘要块为准——摘要块是唯一民用时间基准（摘要块的「提醒时刻」行同样是民用时刻）；输出 JSON 严禁出现毫秒时间戳或任何非字段定义格式的日期时间；无摘要块时按“当前时间”基准正常解析。',
  '',
  '时间字段书写规则：',
  '- date 一律 YYYY-MM-DD（公历），相对词（今天/明天/下周三/每月15号）先依据下方“当前时间”换算成绝对日期；',
  '- time 一律 24 小时制 HH:mm；跨午夜的区间（如 23点到1点）end.date 填次日；',
  '- 严禁输出毫秒时间戳或任何非上述格式的日期时间。',
  '',
  '民用时刻归一化规则（与本地降级解析器一致）：',
  '- “下午/傍晚/晚上 X点”：X 在 1..7 时按 (X+12) 点；X 为 12 时：下午/傍晚按 12:00，晚上/夜里/深夜按次日 00:00。',
  '- “凌晨/半夜 X点”：X 为 12 时按 00:00；其余按 X 点。',
  '- “中午 X点”：X 在 1..2 时按 (X+12) 点。',
  '- 裸“X点”（没有上/下午等限定词）：X 在 0..12 按字面（“3点”→03:00），13..23 按字面；不要自行猜上下午。',
  '- “X点半”→:30；“X点一刻”→:15；“X点三刻”→:45。',
  '',
  '只输出一个 JSON 对象；不要编造输入中不存在的信息；无法判断的字段填 null 或 []。',
].join('\n');

/** 把 context 换算成提示词里的“当前时间”事实描述。 */
export function buildNowFacts(context: AiParseContext): string {
  const parts = getZonedParts(context.now, context.tzid);
  const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
  const weekday = weekdays[parts.weekday - 1];
  const pad = (n: number): string => String(n).padStart(2, '0');
  return [
    `当前时间：${parts.year}年${parts.month}月${parts.day}日 周${weekday} ${pad(parts.hour)}:${pad(parts.minute)}（时区 ${context.tzid}）`,
    '解析相对时间（明天/下周三等）一律以上述当前时间为基准；date 一律写绝对日期 YYYY-MM-DD。',
  ].join('\n');
}

/**
 * 切片 33（§7.45 / ai.md v0.24）：history assistant JSON 里的民用时间字段形状
 * ——与远端 wire 的 RemoteDateTimeField 同构（date 必为合法日历日、time null =
 * 全天）。ParsedItemDraft 域形状不变（epoch ms），仅序列化面转换。
 */
export interface CivilianTimeField {
  date: string;
  time: string | null;
}

/**
 * history assistant 草稿 JSON 序列化（切片 33 / ai.md v0.24）：时间一律民用
 * 形状——startAt/endAt epoch → {date,time}|null（allDay→time null）、reminders
 * epoch[] → [{date,time}]，其余字段照抄。键名对齐远端 wire（start/end），
 * 序列化产物即 wire 形状的民用子集（真机矩阵 #3 轮 3 定性的键名修正）。
 *
 * 动机（根因 B）：毫秒 JSON 进 history 后被 few-shot 同化——模型自述「为保持
 * 一致输出 startAt 毫秒」压过 prompt 禁令，毫秒形状 wire 守卫仍拒绝 → 降级。
 * history 一律民用后，同化方向反过来保护民用输出。民用换算经 getZonedParts
 * 本地完成（v0.16 纪律：epoch 换算绝不交给模型），与落库换算同源。
 *
 * 键名纪律（v0.24 阶段 1 修正，真机矩阵 #3 轮 3）：history few-shot 若用草稿
 * 键名 startAt/endAt，模型会在编辑轮照抄该键名输出 startAt 民用对象，而
 * RemoteDraftWire 要求必填键 start/end——两处信号冲突，模型随机偏向 →
 * isRemoteDraftWire 整体拒绝 → schema-mismatch 降级（轮 2 模型自我纠正、
 * 轮 3 未纠正的实证）。history 键名必须与 prompt 字段定义（start/end）一致，
 * few-shot 同化才与 wire 同向。
 */
export function serializeDraftForHistory(
  draft: ParsedItemDraft,
  tzid: string,
): string {
  const toCivilian = (
    epoch: number,
    allDay: boolean,
  ): CivilianTimeField => {
    const parts = getZonedParts(epoch, tzid);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return {
      date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
      time: allDay ? null : `${pad(parts.hour)}:${pad(parts.minute)}`,
    };
  };
  const toCivilianOrNull = (
    epoch: number | null,
    allDay: boolean,
  ): CivilianTimeField | null => (epoch === null ? null : toCivilian(epoch, allDay));
  const { startAt, endAt, ...rest } = draft;
  return JSON.stringify({
    ...rest,
    start: toCivilianOrNull(startAt, draft.allDay),
    end: toCivilianOrNull(endAt, draft.allDay),
    reminders: draft.reminders?.map((epoch) => toCivilian(epoch, false)),
  });
}

/**
 * history 中最近一张草稿的最小形状（防御式判据，不是完整 ParsedItemDraft 校验）。
 * 字段值为 JSON.parse 产物，除判据字段外保持 unknown，由渲染侧逐项从严校验。
 * 切片 33 三形状（startAt/endAt 归一入口）：startAt 可为 legacy epoch 毫秒
 * （number|null，升级瞬间内存里仍残留旧条目）、v0.24 首轮发布的民用对象
 * （CivilianTimeField|null，键名 startAt/endAt）或键名对齐 wire 的新民用对象
 * （CivilianTimeField|null，键名 start/end，serializeDraftForHistory 现产物，
 * 解析时优先读 start/end、回退 startAt/endAt 并归一到 startAt 字段）；reminders
 * 形状同理（number[] | CivilianTimeField[]），由渲染侧兼容。
 */
interface BriefingDraftShape {
  title: string;
  startAt: number | CivilianTimeField | null;
  endAt: number | CivilianTimeField | null;
  allDay: boolean;
  recurrence: unknown;
  categoryId: unknown;
  tags: unknown;
  priority: unknown;
  reminderChannels: unknown;
  reminders: unknown;
  needsClarification: unknown;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** 防御式 number[] 判据（历史草稿可能来自旧版本，reminders 缺失/形状不符即视为无）。 */
function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

/** 民用时间对象形状判据（切片 33）：date string + time string|null，非数组对象。 */
function isCivilianTimeField(value: unknown): value is CivilianTimeField {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as { date?: unknown; time?: unknown };
  return (
    typeof v.date === 'string' &&
    (v.time === null || typeof v.time === 'string')
  );
}

/** 双形状时间值判据（切片 33）：legacy epoch 毫秒 或 民用对象，null 合法。 */
function isBriefingTimeValue(
  value: unknown,
): value is number | CivilianTimeField | null {
  return (
    value === null || typeof value === 'number' || isCivilianTimeField(value)
  );
}

/** 民用时刻数组判据（切片 33）：serializeDraftForHistory 产物的 reminders 形状。 */
function isCivilianTimeFieldArray(value: unknown): value is CivilianTimeField[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isCivilianTimeField(item))
  );
}

/**
 * 尝试把一条 history 消息文本解析成「形似草稿」的对象。
 * 判据：对象非数组、title 为 string、含 start（新）或 startAt（legacy/首轮）
 * 键且为三形状时间值（切片 33：legacy epoch 毫秒、startAt 键民用对象或
 * start 键民用对象——start 优先）、allDay 为 boolean——足以区分草稿 JSON 与
 * 编辑/引导轮的纯文本 note（后者 parse 失败或形状不符，直接跳过）。
 */
function tryParseBriefingDraft(text: string): BriefingDraftShape | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const hasStart = 'start' in record;
  const startTimeRaw = hasStart ? record['start'] : record['startAt'];
  const endTimeRaw = 'end' in record ? record['end'] : record['endAt'];
  if (
    typeof record['title'] !== 'string' ||
    typeof record['allDay'] !== 'boolean' ||
    (!hasStart && !('startAt' in record)) ||
    !isBriefingTimeValue(startTimeRaw) ||
    (endTimeRaw !== undefined && !isBriefingTimeValue(endTimeRaw))
  ) {
    return null;
  }
  return {
    title: record['title'],
    startAt: startTimeRaw,
    endAt: endTimeRaw === undefined ? null : endTimeRaw,
    allDay: record['allDay'],
    recurrence: record['recurrence'],
    categoryId: record['categoryId'],
    tags: record['tags'],
    priority: record['priority'],
    reminderChannels: record['reminderChannels'],
    reminders: record['reminders'],
    needsClarification: record['needsClarification'],
  };
}

function formatBriefingDate(epoch: number, tzid: string): string {
  const parts = getZonedParts(epoch, tzid);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function formatBriefingDateTime(epoch: number, tzid: string): string {
  const parts = getZonedParts(epoch, tzid);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${formatBriefingDate(epoch, tzid)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * 双形状日期渲染（切片 33）：legacy epoch 毫秒本地换算（与落库同源）、
 * 新民用对象直接渲染（不再换算，杜绝二次时区折算）。
 */
function formatBriefingDateValue(
  value: number | CivilianTimeField,
  tzid: string,
): string {
  return typeof value === 'number' ? formatBriefingDate(value, tzid) : value.date;
}

/** 双形状日期时间渲染（切片 33）：民用对象 time null（全天）只出日期。 */
function formatBriefingDateTimeValue(
  value: number | CivilianTimeField,
  tzid: string,
): string {
  if (typeof value === 'number') return formatBriefingDateTime(value, tzid);
  return value.time === null ? value.date : `${value.date} ${value.time}`;
}

function describeBriefingTime(draft: BriefingDraftShape, tzid: string): string {
  if (draft.startAt === null) return '未设时间';
  if (draft.allDay) return `${formatBriefingDateValue(draft.startAt, tzid)} 全天`;
  const endText =
    draft.endAt !== null
      ? ` ～ ${formatBriefingDateTimeValue(draft.endAt, tzid)}`
      : '';
  return `${formatBriefingDateTimeValue(draft.startAt, tzid)}${endText}（时区 ${tzid}）`;
}

function renderBriefing(draft: BriefingDraftShape, tzid: string): string {
  const lines = [
    '上一张卡片草稿摘要（修改时以此为准，禁止新建条目）：',
    `- 标题：${draft.title}`,
    `- 时间：${describeBriefingTime(draft, tzid)}`,
  ];
  if (
    draft.recurrence !== null &&
    draft.recurrence !== undefined &&
    typeof draft.recurrence === 'object'
  ) {
    lines.push(`- 重复：${JSON.stringify(draft.recurrence)}`);
  }
  if (isNumberArray(draft.reminders) && draft.reminders.length > 0) {
    // 切片 32 / ai.md v0.23：摘要块补「提醒时刻」行（epoch 本地换算民用）——
    // 否则保存后下一轮编辑轮模型看不到 reminders 意图，短纠正句/编辑会丢提醒。
    // 防御式截断 8 条（历史草稿理论上由 guard 限 8 条，这里只兜异常输入）。
    const rendered = draft.reminders
      .slice(0, 8)
      .map((epoch) => formatBriefingDateTime(epoch, tzid))
      .join('、');
    lines.push(`- 提醒时刻（reminders）：${rendered}`);
  } else if (isCivilianTimeFieldArray(draft.reminders)) {
    // 切片 33 双形状：新 history 条目的 reminders 已是民用对象，直接渲染。
    // （legacy 毫秒分支在上——两形状互斥的整型数组判据，混合形状两支都不命中、
    // 提醒行省略，防御式不炸。）
    const rendered = draft.reminders
      .slice(0, 8)
      .map((field) =>
        field.time === null ? field.date : `${field.date} ${field.time}`,
      )
      .join('、');
    lines.push(`- 提醒时刻（reminders）：${rendered}`);
  }
  if (typeof draft.categoryId === 'string' && draft.categoryId.length > 0) {
    lines.push(`- 分类：${draft.categoryId}`);
  }
  if (isStringArray(draft.tags) && draft.tags.length > 0) {
    lines.push(`- 标签：${JSON.stringify(draft.tags)}`);
  }
  if (typeof draft.priority === 'number' && draft.priority >= 1) {
    lines.push(`- 优先级：${draft.priority}`);
  }
  if (isStringArray(draft.reminderChannels) && draft.reminderChannels.length > 0) {
    lines.push(`- 渠道推荐：${JSON.stringify(draft.reminderChannels)}`);
  }
  if (draft.needsClarification === true) {
    lines.push(
      '- 上一轮状态：澄清反问中（缺具体时间），用户本轮回复通常是补充信息，补全后并入此草稿。',
    );
  }
  return lines.join('\n');
}

/**
 * 上一张卡片草稿摘要（切片 23 阶段 2 / ai.md）：从 history 末尾向前找最后一条
 * assistant 草稿 JSON 消息（切片 15 约定：草稿轮 assistant 文本 = 合并后草稿的
 * JSON；编辑/引导轮是纯文本 note，parse 失败自动跳过继续向前扫），把时间字段
 * 渲染为可直接引用的摘要块。切片 33 三形状：新条目（serializeDraftForHistory，
 * start/end 键民用对象）直接渲染；首轮发布条目（startAt 键民用对象，升级瞬间
 * 的内存残留）与 legacy 条目（startAt 键毫秒）同样直接渲染或本地换算民用
 * （v0.16 纪律：epoch 换算绝不交给模型）。远端编辑意图（“改成7点半”）以此块
 * 为基准：模型不再从毫秒反算日期，且被明确禁止新建条目。找不到任何草稿 →
 * null（单轮行为不变）。
 */
export function buildHistoryBriefing(
  history: ReadonlyArray<ChatMessage>,
  tzid: string,
): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message.role !== 'assistant') continue;
    const draft = tryParseBriefingDraft(message.text);
    if (draft !== null) {
      return renderBriefing(draft, tzid);
    }
  }
  return null;
}
