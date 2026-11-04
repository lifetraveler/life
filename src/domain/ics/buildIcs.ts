/**
 * ICS 导出生成器（切片 8，tasks/slice-08.md「导出流程」实现要求）：
 * 纯函数，不依赖 React Native / WatermelonDB。
 *
 * 规格（任务卡 §5）：
 * - VCALENDAR 头 + 每个 Item 一个 VEVENT；
 * - VEVENT 字段：UID（用 Item.id）、DTSTAMP（导出时刻）、DTSTART、DTEND、SUMMARY、
 *   DESCRIPTION、STATUS（done 项写 CONFIRMED 加 X-LIFE-STATUS:DONE）；
 * - allDay=true 用 VALUE=DATE 写 DTSTART/DTEND；endAt 为 null 时省略 DTEND；
 * - 非 allDay 写本地时间并带 TZID=设备当前 IANA 时区（IANA 名由外部日历自行解析，
 *   文件内不再生成 VTIMEZONE——任务卡字段清单未要求，见切片报告披露）；
 * - 行折叠遵循 RFC 5545：单行内容超过 75 八位字节时折叠，续行以单个空格开头；
 * - 行结束符统一 CRLF（RFC 5545 要求）。
 */

import type { Item } from '../item';
import { getZonedParts, assertValidTimeZone } from '../recurrence/civilTime';

/** ICS 文本转义（RFC 5545 3.3.11 TEXT）：反斜杠、分号、逗号、换行。 */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** 计算字符串的 UTF-8 八位字节数（按码点；代理对整体计 4 字节）。 */
function utf8OctetLength(text: string): number {
  let octets = 0;
  for (let i = 0; i < text.length; ) {
    const codePoint = text.codePointAt(i)!;
    if (codePoint > 0xffff) {
      octets += 4;
      i += 2;
    } else if (codePoint > 0x7ff) {
      octets += 3;
      i += 1;
    } else if (codePoint > 0x7f) {
      octets += 2;
      i += 1;
    } else {
      octets += 1;
      i += 1;
    }
  }
  return octets;
}

/** 单个字符的 UTF-8 八位字节数（按码点读取，返回 consumed units 与 octets）。 */
function codePointOctets(text: string, index: number): { units: number; octets: number } {
  const codePoint = text.codePointAt(index)!;
  if (codePoint > 0xffff) {
    return { units: 2, octets: 4 };
  }
  if (codePoint > 0x7ff) {
    return { units: 1, octets: 3 };
  }
  if (codePoint > 0x7f) {
    return { units: 1, octets: 2 };
  }
  return { units: 1, octets: 1 };
}

/**
 * RFC 5545 3.1 行折叠：内容超过 75 八位字节时折断为多行，
 * 续行以单个空格开头（续行连同前导空格仍不得超过 75 八位字节）。
 */
export function foldIcsLine(line: string): string[] {
  const MAX_OCTETS = 75;
  if (utf8OctetLength(line) <= MAX_OCTETS) {
    return [line];
  }
  const lines: string[] = [];
  let current = line;
  let isFirst = true;
  while (utf8OctetLength(current) > MAX_OCTETS) {
    let octets = 0;
    let cut = 0;
    while (cut < current.length) {
      const { units, octets: cpOctets } = codePointOctets(current, cut);
      // 续行的前导空格计入 75 八位字节预算。
      const budget = isFirst ? MAX_OCTETS : MAX_OCTETS - 1;
      if (octets + cpOctets > budget) {
        break;
      }
      octets += cpOctets;
      cut += units;
    }
    lines.push(current.slice(0, cut));
    current = ` ${current.slice(cut)}`;
    isFirst = false;
  }
  lines.push(current);
  return lines;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** YYYYMMDD（本地民用日期，VALUE=DATE 用） */
function formatDateParts(year: number, month: number, day: number): string {
  return `${year}${pad2(month)}${pad2(day)}`;
}

/** YYYYMMDDTHHMMSSZ（DTSTAMP 用，UTC） */
function formatUtcStamp(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(
    d.getUTCHours(),
  )}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
}

/**
 * 瞬时值的「分钟内秒数」（0–59）。IANA 时区偏移均为整分钟，
 * 因此本地时间秒位等于 UTC 秒位；负时间戳同样按取模安全处理。
 */
function secondsOfMinute(instant: number): number {
  return Math.floor((((instant % 60000) + 60000) % 60000) / 1000);
}

/** 单个 VEVENT 内容行（已折叠，不含行结束符）。 */
function veventLines(item: Item, tzid: string, now: number): string[] {
  const lines: string[] = [];
  const push = (line: string): void => {
    lines.push(...foldIcsLine(line));
  };

  push(`UID:${item.id}`);
  push(`DTSTAMP:${formatUtcStamp(now)}`);

  if (item.startAt === null) {
    // 未安排项（startAt=null）：不写 DTSTART/DTEND。
    // RFC 5545 对 VEVENT 要求 DTSTART，但伪造时刻（如 1970 占位）会造成数据污染；
    // 选择诚实省略并在切片报告披露，外部日历对该事件的表现由导入方决定。
  } else {
    const parts = getZonedParts(item.startAt, tzid);
    if (item.allDay) {
      push(`DTSTART;VALUE=DATE:${formatDateParts(parts.year, parts.month, parts.day)}`);
      if (item.endAt !== null) {
        const endParts = getZonedParts(item.endAt, tzid);
        push(`DTEND;VALUE=DATE:${formatDateParts(endParts.year, endParts.month, endParts.day)}`);
      }
    } else {
      const seconds = secondsOfMinute(item.startAt);
      push(
        `DTSTART;TZID=${tzid}:${formatDateParts(parts.year, parts.month, parts.day)}T${pad2(
          parts.hour,
        )}${pad2(parts.minute)}${pad2(seconds)}`,
      );
      if (item.endAt !== null) {
        const endParts = getZonedParts(item.endAt, tzid);
        const endSeconds = secondsOfMinute(item.endAt);
        push(
          `DTEND;TZID=${tzid}:${formatDateParts(endParts.year, endParts.month, endParts.day)}T${pad2(
            endParts.hour,
          )}${pad2(endParts.minute)}${pad2(endSeconds)}`,
        );
      }
    }
  }

  push(`SUMMARY:${escapeIcsText(item.title)}`);
  if (item.content.trim().length > 0) {
    push(`DESCRIPTION:${escapeIcsText(item.content)}`);
  }
  push('STATUS:CONFIRMED');
  if (item.status === 'done') {
    push('X-LIFE-STATUS:DONE');
  }
  return lines;
}

export interface IcsExportOptions {
  /** 设备当前 IANA 时区（TZID 参数取值） */
  tzid: string;
  /** 导出时刻（DTSTAMP 取值，毫秒时间戳）——显式传入保持纯函数可测 */
  now: number;
}

/**
 * 将 Items 生成 ICS 文本（tasks/slice-08.md 导出规格）。
 * 传入列表由调用方经 listItemsForExport 过滤（未归档 active/done），本函数不做状态过滤。
 */
export function buildIcs(items: readonly Item[], options: IcsExportOptions): string {
  assertValidTimeZone(options.tzid);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//life-app//slice-08//CN',
    'CALSCALE:GREGORIAN',
  ];
  for (const item of items) {
    lines.push('BEGIN:VEVENT');
    lines.push(...veventLines(item, options.tzid, options.now));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
