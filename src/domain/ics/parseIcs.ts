import ICAL from 'ical.js';

import type { ImportedItemInput } from '../item';
import {
  assertValidTimeZone,
  formatLocalDate,
  formatLocalTime,
  resolveCivilTimeToInstant,
} from '../recurrence/civilTime';

/**
 * 切片 8：ICS 文本解析（repository.md v0.8 / tasks/slice-08.md 实现要求 2）。
 *
 * - 解析器 = ical.js 2.x（Mozilla 维护；折叠行 / 转义 / VTIMEZONE 成熟处理）。
 *   任务卡禁止第二套自写解析器 fallback，本模块不做 ICS 文本层的自行解析。
 * - 时区解析分工（探针实测：ical.js 对未注册的 IANA TZID 会静默按 floating
 *   处理，不能信任其转换结果）：
 *   · IANA TZID → 项目自有 civilTime（@date-fns/tz，权威 IANA 规则，与 App
 *     其余时间语义一致；gap → 失败清单，fold → 取较早瞬间，同 §4.13/§4.14）；
 *   · 非 IANA 自定义 TZID → 注册文件内 VTIMEZONE 后用 ical.js 转换；
 *     文件内无对应 VTIMEZONE → 该事件进失败清单；
 *   · Z 结尾 UTC 绝对时刻 → ical.js toUnixTime；
 *   · floating（无 TZID 且非 UTC 的 date-time）→ 按设备当前 IANA 时区解释
 *     （已确认决策 3：正常导入 + 信息性计数，不跳过）。
 * - VALUE=DATE：allDay=true；民用日期 00:00 落在「TZID（缺省设备时区）」的
 *   绝对时刻；createImportedItem 内会再按设备时区归一（data-model.md v0.8）。
 *   VALUE=DATE 不计入 floating（无时刻可「解释」，日期即语义）。
 * - 同文件重复 UID：保留第一条，其余进 sameFileDuplicates，不落库（已确认决策 5）。
 * - 单事件解析失败不向上抛：进 failures（SUMMARY + 原因），不影响其他事件；
 *   整个文件无法解析时返回单条文件级 failure。
 * - DURATION 不在 MVP 范围：DTEND 缺省 → endAt=null（handoff §4 映射规格）。
 */

export interface ParsedIcsEvent {
  input: ImportedItemInput;
  /**
   * floating date-time（无 TZID 且非 UTC）：已按 deviceTzid 解释并正常导入，
   * 供结果页信息性计数「N 条浮动时间已按设备时区解释」。
   */
  floating: boolean;
}

export interface IcsParseFailure {
  /** SUMMARY 原文；缺失或为空时为 '(无 SUMMARY)'。 */
  summary: string;
  reason: string;
}

export interface ParsedIcsResult {
  events: ParsedIcsEvent[];
  failures: IcsParseFailure[];
  /** 同文件重复 UID（保留第一条，其余计入此处）。 */
  sameFileDuplicates: Array<{ uid: string; summary: string }>;
}

/** 单个 VEVENT 的解析结果（内部用）。 */
type VeventParseResult =
  | { ok: true; input: ImportedItemInput; floating: boolean; summary: string }
  | { ok: false; summary: string; reason: string };

/** DTSTART/DTEND 属性 → 绝对毫秒的解析结果。 */
type DtResolution =
  | { ok: true; ms: number; floating: boolean; isDate: boolean }
  | { ok: false; reason: string };

interface CivilTimeFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const NO_SUMMARY = '(无 SUMMARY)';

function isIanaTzid(tzid: string): boolean {
  try {
    assertValidTimeZone(tzid);
    return true;
  } catch {
    return false;
  }
}

/** IANA 时区解析：民用字段 → 绝对毫秒（gap → 失败；秒字段直接补在解析结果上）。 */
function resolveViaIana(
  tzid: string,
  civil: CivilTimeFields,
  floating: boolean,
  isDate: boolean,
): DtResolution {
  const base = resolveCivilTimeToInstant(
    tzid,
    civil.year,
    civil.month,
    civil.day,
    civil.hour,
    civil.minute,
  );
  if (base === null) {
    return {
      ok: false,
      reason: `本地时间不存在（DST gap）: ${formatLocalDate({
        year: civil.year,
        month: civil.month,
        day: civil.day,
      })} ${formatLocalTime(civil.hour, civil.minute)} (${tzid})`,
    };
  }
  return { ok: true, ms: base + civil.second * 1000, floating, isDate };
}

/**
 * DTSTART/DTEND 属性 → 绝对毫秒。
 * fallbackTzid：仅当属性无 TZID 且为 VALUE=DATE 时作为声明时区（继承 DTSTART 的
 * TZID）；date-time 无 TZID 一律按 floating（设备时区）解释。
 */
function resolveDtProperty(
  prop: ICAL.Property,
  deviceTzid: string,
  fallbackTzid: string | null,
): DtResolution {
  let value: unknown;
  try {
    value = prop.getFirstValue();
  } catch {
    return { ok: false, reason: 'DT 值无法读取' };
  }
  if (!(value instanceof ICAL.Time)) {
    return { ok: false, reason: 'DT 值类型不受支持（仅 DATE / DATE-TIME）' };
  }

  const isDate = value.isDate === true;
  const tzidParam = prop.getParameter('tzid');
  const tzidParamStr = typeof tzidParam === 'string' && tzidParam.length > 0 ? tzidParam : null;
  const civil: CivilTimeFields = {
    year: value.year,
    month: value.month,
    day: value.day,
    hour: isDate ? 0 : value.hour,
    minute: isDate ? 0 : value.minute,
    second: isDate ? 0 : value.second,
  };

  // VALUE=DATE：民用日期 00:00 在声明时区（TZID / DTSTART 继承 / 设备时区）。
  if (isDate) {
    const zoneTzid = tzidParamStr ?? fallbackTzid ?? deviceTzid;
    if (isIanaTzid(zoneTzid)) {
      return resolveViaIana(zoneTzid, civil, false, true);
    }
    // 非 IANA 声明时区（有 VTIMEZONE，已注册）：用 ical.js 以注册时区重建 00:00。
    if (tzidParamStr !== null && ICAL.TimezoneService.has(tzidParamStr)) {
      try {
        const zoned = ICAL.Time.fromData(
          { year: civil.year, month: civil.month, day: civil.day, hour: 0, minute: 0, second: 0 },
          ICAL.TimezoneService.get(tzidParamStr),
        );
        return { ok: true, ms: zoned.toUnixTime() * 1000, floating: false, isDate: true };
      } catch {
        return { ok: false, reason: `VTIMEZONE 转换失败: ${tzidParamStr}` };
      }
    }
    return { ok: false, reason: `无法识别的 TZID: ${zoneTzid}（文件内无对应 VTIMEZONE）` };
  }

  // Z 结尾 UTC 绝对时刻。
  const zoneTzid = value.zone?.tzid;
  if (tzidParamStr === null && zoneTzid === 'UTC') {
    return { ok: true, ms: value.toUnixTime() * 1000, floating: false, isDate: false };
  }

  // TZID 参数：IANA 走 civilTime；非 IANA 走 ical.js 注册时区；无 VTIMEZONE → 失败。
  if (tzidParamStr !== null) {
    if (isIanaTzid(tzidParamStr)) {
      return resolveViaIana(tzidParamStr, civil, false, false);
    }
    if (zoneTzid === tzidParamStr) {
      return { ok: true, ms: value.toUnixTime() * 1000, floating: false, isDate: false };
    }
    return { ok: false, reason: `无法识别的 TZID: ${tzidParamStr}（文件内无对应 VTIMEZONE）` };
  }

  // floating：设备当前 IANA 时区解释（已确认决策 3）。
  return resolveViaIana(deviceTzid, civil, true, false);
}

function summaryOf(vevent: ICAL.Component): string {
  try {
    const raw = vevent.getFirstPropertyValue('summary');
    return typeof raw === 'string' && raw.trim().length > 0 ? raw : NO_SUMMARY;
  } catch {
    return NO_SUMMARY;
  }
}

function textProperty(vevent: ICAL.Component, name: string): string | null {
  try {
    const raw = vevent.getFirstPropertyValue(name);
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function parseVevent(vevent: ICAL.Component, deviceTzid: string): VeventParseResult {
  const summary = summaryOf(vevent);

  const dtstartProp = vevent.getFirstProperty('dtstart');
  if (!dtstartProp) {
    return { ok: false, summary, reason: '缺少 DTSTART' };
  }
  const startRes = resolveDtProperty(dtstartProp, deviceTzid, null);
  if (!startRes.ok) {
    return { ok: false, summary, reason: `DTSTART：${startRes.reason}` };
  }

  // DTEND 缺省 → null（handoff §4）；DURATION 不在 MVP 范围。
  let endAt: number | null = null;
  const dtendProp = vevent.getFirstProperty('dtend');
  if (dtendProp) {
    const dtstartTzid = dtstartProp.getParameter('tzid');
    const fallbackTzid =
      typeof dtstartTzid === 'string' && dtstartTzid.length > 0 ? dtstartTzid : null;
    const endRes = resolveDtProperty(dtendProp, deviceTzid, fallbackTzid);
    if (!endRes.ok) {
      return { ok: false, summary, reason: `DTEND：${endRes.reason}` };
    }
    endAt = endRes.ms;
  }

  const title = textProperty(vevent, 'summary');
  if (title === null || title.trim().length === 0) {
    return { ok: false, summary, reason: '缺少 SUMMARY（标题为空）' };
  }

  const uid = textProperty(vevent, 'uid');
  const description = textProperty(vevent, 'description');

  return {
    ok: true,
    summary,
    floating: startRes.floating,
    input: {
      title,
      content: description ?? undefined,
      startAt: startRes.ms,
      endAt,
      allDay: startRes.isDate,
      sourceUid: uid,
    },
  };
}

/**
 * ical.js 2.x 严格校验 date-time 值，拒绝 RFC 5545 允许的秒省略形态
 * （FORM #2：`YYYYMMDDTHHMM` / `YYYYMMDDTHHMMZ`，time-second 可选），
 * 抛 "invalid date-time value" → 该事件进失败清单（e-perf-200 实测 200/200 失败）。
 * 仅 DTSTART/DTEND 会被解析为时刻，故在送入 ical.js 前把这两个属性的
 * 秒省略形态补齐为 HHMMSS；其余行（VALUE=DATE、已带秒的完整形态、
 * 其他属性）原样保留，不做任何其他改写。
 */
function padSecondslessDtValues(text: string): string {
  return text.replace(
    /^(DTSTART|DTEND)(;[^:\r\n]*)?:(\d{8}T\d{4})(Z?)(\r?\n|$)/gim,
    (
      _match: string,
      name: string,
      params: string | undefined,
      dt: string,
      zSuffix: string,
      eol: string,
    ) => `${name}${params ?? ''}:${dt}00${zSuffix}${eol}`,
  );
}

export function parseIcs(icsText: string, deviceTzid: string): ParsedIcsResult {
  const result: ParsedIcsResult = { events: [], failures: [], sameFileDuplicates: [] };

  let comp: ICAL.Component;
  try {
    comp = new ICAL.Component(ICAL.parse(padSecondslessDtValues(icsText)));
  } catch (error) {
    result.failures.push({
      summary: '(整个文件)',
      reason: `ICS 解析失败: ${error instanceof Error ? error.message : String(error)}`,
    });
    return result;
  }

  // 注册文件内 VTIMEZONE（非 IANA 自定义 TZID 的转换依据；IANA TZID 不经 ical.js 转换）。
  for (const tzComp of comp.getAllSubcomponents('vtimezone')) {
    try {
      const tz = new ICAL.Timezone(tzComp);
      if (!ICAL.TimezoneService.has(tz.tzid)) {
        ICAL.TimezoneService.register(tz, tz.tzid);
      }
    } catch {
      // 坏 VTIMEZONE：忽略；引用它的事件会以「无法识别的 TZID」进失败清单。
    }
  }

  const seenUids = new Set<string>();
  for (const vevent of comp.getAllSubcomponents('vevent')) {
    const summary = summaryOf(vevent);
    try {
      const parsed = parseVevent(vevent, deviceTzid);
      if (!parsed.ok) {
        result.failures.push({ summary: parsed.summary, reason: parsed.reason });
        continue;
      }
      if (parsed.input.sourceUid !== null) {
        if (seenUids.has(parsed.input.sourceUid)) {
          result.sameFileDuplicates.push({ uid: parsed.input.sourceUid, summary: parsed.summary });
          continue;
        }
        seenUids.add(parsed.input.sourceUid);
      }
      result.events.push({ input: parsed.input, floating: parsed.floating });
    } catch (error) {
      result.failures.push({
        summary,
        reason: `事件解析失败: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return result;
}
