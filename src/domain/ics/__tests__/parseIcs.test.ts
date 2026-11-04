import { parseIcs } from '../parseIcs';

/**
 * 切片 8：parseIcs 单元测试（tasks/slice-08.md 验收 7：纯函数、显式 deviceTzid、
 * 不依赖宿主时区；handoff §4 映射规格）。
 * 期望值全部用显式 UTC 表达；deviceTzid 一律作为参数传入。
 */

/** Asia/Shanghai: 2026-11-10 10:30 +08:00 → 02:30Z（IANA 规则，非 DST） */
const SH_1030_EXPECTED = Date.UTC(2026, 10, 10, 2, 30);

const EVT = (body: string): string =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//test//EN', body, 'END:VCALENDAR'].join('\r\n');

const VEVENT = (inner: string[]): string =>
  ['BEGIN:VEVENT', ...inner, 'END:VEVENT'].join('\r\n');

describe('parseIcs（切片 8）', () => {
  it('带 IANA TZID 的 DTSTART/DTEND 按该时区解析（不经宿主时区）', () => {
    const text = EVT(
      VEVENT([
        'UID:evt-tzid',
        'SUMMARY:带时区',
        'DTSTART;TZID=Asia/Shanghai:20261110T103000',
        'DTEND;TZID=Asia/Shanghai:20261110T113000',
      ]),
    );
    const result = parseIcs(text, 'UTC');
    expect(result.failures).toEqual([]);
    expect(result.sameFileDuplicates).toEqual([]);
    expect(result.events).toHaveLength(1);
    const e = result.events[0]!;
    expect(e.input.title).toBe('带时区');
    expect(e.input.allDay).toBe(false);
    expect(e.floating).toBe(false);
    expect(e.input.startAt).toBe(SH_1030_EXPECTED);
    expect(e.input.endAt).toBe(Date.UTC(2026, 10, 10, 3, 30));
  });

  it('floating（无 TZID 非 UTC）按 deviceTzid 解释（America/New_York，冬令）', () => {
    const text = EVT(
      VEVENT(['UID:evt-floating', 'SUMMARY:浮动时间', 'DTSTART:20261110T103000']),
    );
    const result = parseIcs(text, 'America/New_York');
    expect(result.failures).toEqual([]);
    expect(result.events).toHaveLength(1);
    const e = result.events[0]!;
    // 2026-11-10 已回 EST（UTC-5）→ 10:30 EST = 15:30Z
    expect(e.floating).toBe(true);
    expect(e.input.startAt).toBe(Date.UTC(2026, 10, 10, 15, 30));
  });

  it('floating 按 deviceTzid=Asia/Shanghai 解释为 +08:00', () => {
    const text = EVT(
      VEVENT(['UID:evt-floating-sh', 'SUMMARY:浮动SH', 'DTSTART:20261110T103000']),
    );
    const result = parseIcs(text, 'Asia/Shanghai');
    expect(result.events[0]!.floating).toBe(true);
    expect(result.events[0]!.input.startAt).toBe(SH_1030_EXPECTED);
  });

  it('VALUE=DATE → allDay=true，民用 00:00 按声明时区（设备时区归一在 Repository）', () => {
    const text = EVT(
      VEVENT([
        'UID:evt-allday',
        'SUMMARY:全天',
        'DTSTART;VALUE=DATE:20261110',
        'DTEND;VALUE=DATE:20261111',
      ]),
    );
    const result = parseIcs(text, 'Asia/Shanghai');
    expect(result.failures).toEqual([]);
    const e = result.events[0]!;
    expect(e.input.allDay).toBe(true);
    expect(e.floating).toBe(false); // VALUE=DATE 不计 floating
    // 2026-11-10T00:00+08:00 = 2026-11-09T16:00Z；DTEND 同理（exclusive 语义保留原值）
    expect(e.input.startAt).toBe(Date.UTC(2026, 10, 9, 16, 0));
    expect(e.input.endAt).toBe(Date.UTC(2026, 10, 10, 16, 0));
  });

  it('UTC（Z 结尾）直接解析为绝对时刻，不查时区库', () => {
    const text = EVT(
      VEVENT(['UID:evt-utc', 'SUMMARY:绝对时刻', 'DTSTART:20261110T103000Z']),
    );
    const result = parseIcs(text, 'America/New_York');
    expect(result.events[0]!.input.startAt).toBe(Date.UTC(2026, 10, 10, 10, 30));
    expect(result.events[0]!.floating).toBe(false);
  });

  it('缺 UID → sourceUid=null（无去重键，每次导入作新项）', () => {
    const text = EVT(VEVENT(['SUMMARY:无UID', 'DTSTART:20261110T103000Z']));
    const result = parseIcs(text, 'UTC');
    expect(result.events[0]!.input.sourceUid).toBeNull();
  });

  it('同文件重复 UID：保留第一条，后续进 sameFileDuplicates', () => {
    const text = EVT(
      [
        VEVENT(['UID:dup-1', 'SUMMARY:第一条', 'DTSTART:20261110T103000Z']),
        VEVENT(['UID:dup-1', 'SUMMARY:第二条', 'DTSTART:20261111T103000Z']),
      ].join('\r\n'),
    );
    const result = parseIcs(text, 'UTC');
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.input.title).toBe('第一条');
    expect(result.sameFileDuplicates).toEqual([{ uid: 'dup-1', summary: '第二条' }]);
  });

  it('折叠行（RFC 5545 续行）正确还原为单行', () => {
    const text = EVT(
      VEVENT([
        'UID:evt-fold',
        'SUMMARY:这是一个很长的\r\n  折叠标题',
        'DTSTART:20261110T103000Z',
      ]),
    );
    const result = parseIcs(text, 'UTC');
    expect(result.events[0]!.input.title).toBe('这是一个很长的 折叠标题');
  });

  it('DESCRIPTION 转义还原：\\, → ,、\\n → 换行', () => {
    const text = EVT(
      VEVENT([
        'UID:evt-esc',
        'SUMMARY:转义',
        'DESCRIPTION:第一行\\n第二行\\, 逗号',
        'DTSTART:20261110T103000Z',
      ]),
    );
    const result = parseIcs(text, 'UTC');
    expect(result.events[0]!.input.content).toBe('第一行\n第二行, 逗号');
  });

  it('缺 SUMMARY / SUMMARY 为空 → 单条 failure，不影响其他事件', () => {
    const text = EVT(
      [
        VEVENT(['UID:bad-1', 'DTSTART:20261110T103000Z']),
        VEVENT(['UID:good-1', 'SUMMARY:正常事件', 'DTSTART:20261110T103000Z']),
        VEVENT(['UID:bad-2', 'SUMMARY:   ', 'DTSTART:20261110T103000Z']),
      ].join('\r\n'),
    );
    const result = parseIcs(text, 'UTC');
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.input.title).toBe('正常事件');
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toEqual({ summary: '(无 SUMMARY)', reason: '缺少 SUMMARY（标题为空）' });
    expect(result.failures[1]!.summary).toBe('(无 SUMMARY)'); // 纯空白 SUMMARY 显示为占位
  });

  it('缺 DTSTART → failure', () => {
    const text = EVT(VEVENT(['UID:bad-dt', 'SUMMARY:无起始时间']));
    const result = parseIcs(text, 'UTC');
    expect(result.events).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.reason).toBe('缺少 DTSTART');
  });

  it('非 IANA TZID 且无对应 VTIMEZONE → failure（不静默按 floating）', () => {
    const text = EVT(
      VEVENT([
        'UID:bad-tz',
        'SUMMARY:坏时区',
        'DTSTART;TZID=Custom-Zone/Nowhere:20261110T103000',
      ]),
    );
    const result = parseIcs(text, 'UTC');
    expect(result.events).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.reason).toContain('无法识别的 TZID: Custom-Zone/Nowhere');
  });

  it('非 IANA TZID + 文件内 VTIMEZONE → 用 ical.js 转换', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//test//EN',
      'BEGIN:VTIMEZONE',
      'TZID:Test/Plus8',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0800',
      'TZOFFSETTO:+0800',
      'TZNAME:TEST+8',
      'END:STANDARD',
      'END:VTIMEZONE',
      VEVENT([
        'UID:evt-custom',
        'SUMMARY:自定义时区',
        'DTSTART;TZID=Test/Plus8:20261110T103000',
      ]),
      'END:VCALENDAR',
    ].join('\r\n');
    const result = parseIcs(text, 'UTC');
    expect(result.failures).toEqual([]);
    expect(result.events).toHaveLength(1);
    // 固定 +08:00 → 02:30Z
    expect(result.events[0]!.input.startAt).toBe(SH_1030_EXPECTED);
  });

  it('整个文件非法 → 单条文件级 failure', () => {
    const result = parseIcs('这不是 ICS 文本', 'UTC');
    expect(result.events).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.summary).toBe('(整个文件)');
    expect(result.failures[0]!.reason).toContain('ICS 解析失败');
  });

  it('无 DESCRIPTION → content=undefined；缺 DTEND → endAt=null', () => {
    const text = EVT(VEVENT(['UID:evt-min', 'SUMMARY:最小事件', 'DTSTART:20261110T103000Z']));
    const result = parseIcs(text, 'UTC');
    const e = result.events[0]!;
    expect(e.input.content).toBeUndefined();
    expect(e.input.endAt).toBeNull();
  });

  it('DTSTART/DTEND 秒省略形态（RFC 5545 FORM #2，HHMM）补秒后正常解析', () => {
    const text = EVT(
      VEVENT([
        'UID:evt-hhmm',
        'SUMMARY:无秒形态',
        'DTSTART;TZID=Asia/Shanghai:20261110T1030',
        'DTEND;TZID=Asia/Shanghai:20261110T1130',
      ]),
    );
    const result = parseIcs(text, 'UTC');
    expect(result.failures).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.input.allDay).toBe(false);
    expect(result.events[0]!.input.startAt).toBe(SH_1030_EXPECTED);
    expect(result.events[0]!.input.endAt).toBe(Date.UTC(2026, 10, 10, 3, 30));
  });

  it('秒省略形态：Z 结尾 UTC 与 floating 均支持；VALUE=DATE 不受改写影响', () => {
    const utcText = EVT(VEVENT(['UID:evt-hhmm-z', 'SUMMARY:UTC无秒', 'DTSTART:20261110T0230Z']));
    const utcResult = parseIcs(utcText, 'UTC');
    expect(utcResult.failures).toEqual([]);
    expect(utcResult.events[0]!.input.startAt).toBe(Date.UTC(2026, 10, 10, 2, 30));

    const floatingText = EVT(
      VEVENT(['UID:evt-hhmm-fl', 'SUMMARY:浮动无秒', 'DTSTART:20261110T1030']),
    );
    const floatingResult = parseIcs(floatingText, 'Asia/Shanghai');
    expect(floatingResult.failures).toEqual([]);
    expect(floatingResult.events[0]!.floating).toBe(true);
    expect(floatingResult.events[0]!.input.startAt).toBe(SH_1030_EXPECTED);

    const dateText = EVT(
      VEVENT(['UID:evt-date', 'SUMMARY:全天', 'DTSTART;VALUE=DATE:20261110']),
    );
    const dateResult = parseIcs(dateText, 'UTC');
    expect(dateResult.failures).toEqual([]);
    expect(dateResult.events[0]!.input.allDay).toBe(true);
  });
});
