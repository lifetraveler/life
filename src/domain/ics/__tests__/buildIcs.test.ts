import { buildIcs, escapeIcsText, foldIcsLine } from '../buildIcs';
import { parseIcs } from '../parseIcs';
import type { Item } from '../../item';

/**
 * 切片 8：buildIcs 单元测试（tasks/slice-08.md 验收 2 导出生成 + 验收 103 导出映射 round-trip）。
 * 纯函数；tzid/now 显式传入，不依赖宿主时区与当前时间。
 */

const NOW = Date.UTC(2026, 10, 10, 2, 30, 0); // DTSTAMP 固定导出时刻

let nextId = 1;
function makeItem(overrides: Partial<Item> = {}): Item {
  const id = overrides.id ?? `item-${nextId++}`;
  return {
    id,
    type: 'event',
    title: `事件${id}`,
    content: '',
    status: 'active',
    startAt: Date.UTC(2026, 10, 10, 2, 30), // 2026-11-10 10:30 +08:00
    endAt: null,
    allDay: false,
    sourceType: 'local',
    sourceUid: null,
    sourceReadOnly: false,
    // 切片 14 编译必需夹具补字段（§7.13）：ICS 导出不读分类/优先级，固定默认值。
    categoryId: 'other',
    priority: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('escapeIcsText', () => {
  it('转义反斜杠/分号/逗号/换行', () => {
    expect(escapeIcsText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
    expect(escapeIcsText('第一行\n第二行')).toBe('第一行\\n第二行');
    expect(escapeIcsText('CRLF\r\n行')).toBe('CRLF\\n行');
  });
});

describe('foldIcsLine', () => {
  it('≤75 八位字节不折叠', () => {
    expect(foldIcsLine('SUMMARY:' + 'a'.repeat(67))).toHaveLength(1);
  });
  it('超长 ASCII 按字节折叠，续行以空格开头', () => {
    const lines = foldIcsLine('SUMMARY:' + 'a'.repeat(200));
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      const octets = Buffer.byteLength(line, 'utf8');
      expect(octets).toBeLessThanOrEqual(75);
    }
    for (const cont of lines.slice(1)) {
      expect(cont.startsWith(' ')).toBe(true);
    }
    // 折叠行去掉续行前导空格后拼回原文
    expect(lines.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe('SUMMARY:' + 'a'.repeat(200));
  });
  it('CJK 多字节字符不在码点中间折断', () => {
    const lines = foldIcsLine('SUMMARY:' + '汉'.repeat(60)); // 60*3=180 字节
    for (const line of lines) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
      // 不出现半个字符：每行均可无损往返
      expect(Buffer.byteLength(line, 'utf8')).toBeGreaterThan(0);
    }
    expect(lines.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe('SUMMARY:' + '汉'.repeat(60));
  });
});

describe('buildIcs（切片 8）', () => {
  it('非 allDay 写 TZID 本地时间；DTSTAMP 为 UTC；UID=Item.id', () => {
    const item = makeItem();
    const ics = buildIcs([item], { tzid: 'Asia/Shanghai', now: NOW });
    expect(ics).toContain('DTSTART;TZID=Asia/Shanghai:20261110T103000');
    expect(ics).toContain(`UID:${item.id}`);
    expect(ics).toContain('DTSTAMP:20261110T023000Z');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).not.toContain('X-LIFE-STATUS');
  });

  it('allDay 写 VALUE=DATE（DTSTART/DTEND）', () => {
    // allDay 起点已归一为设备时区当天 00:00：2026-11-10T00:00+08:00 = 2026-11-09T16:00Z
    const item = makeItem({
      allDay: true,
      startAt: Date.UTC(2026, 10, 9, 16, 0),
      endAt: Date.UTC(2026, 10, 10, 16, 0),
    });
    const ics = buildIcs([item], { tzid: 'Asia/Shanghai', now: NOW });
    expect(ics).toContain('DTSTART;VALUE=DATE:20261110');
    expect(ics).toContain('DTEND;VALUE=DATE:20261111');
    expect(ics).not.toContain('TZID=');
  });

  it('endAt=null 省略 DTEND；startAt=null 省略 DTSTART/DTEND（披露：未安排项不伪造时刻）', () => {
    const ics = buildIcs([makeItem({ id: 'u1', endAt: null }), makeItem({ id: 'u2', startAt: null, endAt: null })], {
      tzid: 'Asia/Shanghai',
      now: NOW,
    });
    expect(ics).not.toContain('DTEND');
    expect(ics.match(/DTSTART/g) ?? []).toHaveLength(1); // 仅第二条事件无 DTSTART
    expect(ics).toContain('SUMMARY:事件u2');
  });

  it('done 项写 X-LIFE-STATUS:DONE（STATUS 仍为 CONFIRMED）', () => {
    const ics = buildIcs([makeItem({ status: 'done' })], { tzid: 'Asia/Shanghai', now: NOW });
    expect(ics).toContain('X-LIFE-STATUS:DONE');
    expect(ics).toContain('STATUS:CONFIRMED');
  });

  it('SUMMARY/DESCRIPTION 转义与多行内容', () => {
    const item = makeItem({
      title: '标题;含,特殊\\字符',
      content: '第一行\n第二行',
    });
    const ics = buildIcs([item], { tzid: 'Asia/Shanghai', now: NOW });
    expect(ics).toContain('SUMMARY:标题\\;含\\,特殊\\\\字符');
    expect(ics).toContain('DESCRIPTION:第一行\\n第二行');
  });

  it('空 content 不写 DESCRIPTION；行结束符为 CRLF 且文件以 CRLF 结尾', () => {
    const ics = buildIcs([makeItem()], { tzid: 'Asia/Shanghai', now: NOW });
    expect(ics).not.toContain('DESCRIPTION');
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.includes('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '').includes('\n')).toBe(false); // 无裸 LF
  });

  it('round-trip：本地项/导入只读项/done 项各一条，经 parseIcs 解析回等价 Item 字段', () => {
    const items: Item[] = [
      makeItem({ id: 'local-1', title: '本地事项', content: '备注内容' }),
      makeItem({
        id: 'ics-1',
        title: '导入事件;含,特殊',
        content: '描述\n多行',
        sourceType: 'ics',
        sourceUid: 'uid-from-google',
        sourceReadOnly: true,
        endAt: Date.UTC(2026, 10, 10, 3, 30),
      }),
      makeItem({ id: 'done-1', title: '已完成', status: 'done' }),
    ];
    const ics = buildIcs(items, { tzid: 'Asia/Shanghai', now: NOW });
    const result = parseIcs(ics, 'Asia/Shanghai');
    expect(result.failures).toEqual([]);
    expect(result.events).toHaveLength(3);

    const byUid = new Map(result.events.map((e) => [e.input.sourceUid, e.input]));
    expect(byUid.get('local-1')).toMatchObject({
      title: '本地事项',
      content: '备注内容',
      allDay: false,
      startAt: Date.UTC(2026, 10, 10, 2, 30),
      endAt: null,
    });
    expect(byUid.get('ics-1')).toMatchObject({
      title: '导入事件;含,特殊',
      content: '描述\n多行',
      startAt: Date.UTC(2026, 10, 10, 2, 30),
      endAt: Date.UTC(2026, 10, 10, 3, 30),
      allDay: false,
    });
    expect(byUid.get('done-1')).toMatchObject({
      title: '已完成',
      startAt: Date.UTC(2026, 10, 10, 2, 30),
    });
  });

  it('round-trip：allDay 项经解析回到同一绝对时刻（当天 00:00 本地）', () => {
    const item = makeItem({
      id: 'allday-1',
      title: '全天事项',
      allDay: true,
      startAt: Date.UTC(2026, 10, 9, 16, 0),
      endAt: Date.UTC(2026, 10, 10, 16, 0),
    });
    const ics = buildIcs([item], { tzid: 'Asia/Shanghai', now: NOW });
    const result = parseIcs(ics, 'Asia/Shanghai');
    expect(result.failures).toEqual([]);
    const parsed = result.events[0]!.input;
    expect(parsed.allDay).toBe(true);
    expect(parsed.startAt).toBe(Date.UTC(2026, 10, 9, 16, 0));
    expect(parsed.endAt).toBe(Date.UTC(2026, 10, 10, 16, 0));
  });

  it('round-trip：超长 CJK 标题折叠后解析无损', () => {
    const longTitle = '灵感'.repeat(80); // 320 字节
    const item = makeItem({ id: 'long-1', title: longTitle });
    const ics = buildIcs([item], { tzid: 'Asia/Shanghai', now: NOW });
    // 折叠生效（行数 > 1）
    expect(ics.split('\r\n').some((l) => l.startsWith(' '))).toBe(true);
    const result = parseIcs(ics, 'Asia/Shanghai');
    expect(result.failures).toEqual([]);
    expect(result.events[0]!.input.title).toBe(longTitle);
  });

  it('非法 tzid 抛错（assertValidTimeZone）', () => {
    expect(() => buildIcs([makeItem()], { tzid: 'Not A Zone', now: NOW })).toThrow();
  });
});
