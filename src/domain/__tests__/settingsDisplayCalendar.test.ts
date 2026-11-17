/**
 * display_calendar_ids 三件套纯函数测试（切片 27 阶段 1，AGENTS.md §7.39）：
 * - parseDisplayCalendarIds：读层防御归一，永不抛错（null/''/坏JSON/非数组/非串/空串剔除→[]）；
 *   注意与 defaultChannels 的语义差异：[] 是合法状态（= 功能关闭），不存在「空回退默认值」分支；
 * - validateDisplayCalendarIds：写路径严格校验（非数组/非串/空串抛错；空数组合法 = 关闭）；
 * - serializeDisplayCalendarIds：恒 JSON 数组（先 validate 后 stringify）。
 * 纯函数测试不碰数据库；Repository 层行为（兜底建行/往返）见 data/__tests__。
 */

import {
  DEFAULT_APP_SETTINGS,
  parseDisplayCalendarIds,
  serializeDisplayCalendarIds,
  validateDisplayCalendarIds,
} from '../settings';

describe('parseDisplayCalendarIds（读层防御归一）', () => {
  it('null / undefined / 空串 → []（功能关闭）', () => {
    expect(parseDisplayCalendarIds(null)).toEqual([]);
    expect(parseDisplayCalendarIds(undefined)).toEqual([]);
    expect(parseDisplayCalendarIds('')).toEqual([]);
  });

  it('坏 JSON / 非数组 JSON → []（不抛错）', () => {
    expect(parseDisplayCalendarIds('not-json')).toEqual([]);
    expect(parseDisplayCalendarIds('"1"')).toEqual([]);
    expect(parseDisplayCalendarIds('{"id":"1"}')).toEqual([]);
    expect(parseDisplayCalendarIds('null')).toEqual([]);
  });

  it('[] / 数组元素全非字符串 → []（空是合法结果，不回退任何非空默认）', () => {
    expect(parseDisplayCalendarIds('[]')).toEqual([]);
    expect(parseDisplayCalendarIds('[42,null,true,{"id":"1"}]')).toEqual([]);
  });

  it('空串 / 纯空白元素剔除，合法元素保留', () => {
    expect(parseDisplayCalendarIds('["1","","  ","2"]')).toEqual(['1', '2']);
    expect(parseDisplayCalendarIds('["  ","\t"]')).toEqual([]);
  });

  it('去重：保留首次出现顺序，不重排', () => {
    expect(parseDisplayCalendarIds('["3","1","3","2","1"]')).toEqual(['3', '1', '2']);
  });

  it('永不抛错：喂任意垃圾输入都返回可用数组', () => {
    const garbage = ['{', '[', '1', 'true', '[[1]]', '""', '[[]]'] as const;
    for (const raw of garbage) {
      expect(Array.isArray(parseDisplayCalendarIds(raw))).toBe(true);
    }
  });
});

describe('validateDisplayCalendarIds（写路径严格校验）', () => {
  it('空数组合法（= 功能关闭，写 \'[]\'）——与 defaultChannels「空抛错」语义不同', () => {
    expect(validateDisplayCalendarIds([])).toEqual([]);
  });

  it('通过校验：去重的标准化拷贝，顺序保留', () => {
    expect(validateDisplayCalendarIds(['3', '1', '3', '2'])).toEqual(['3', '1', '2']);
    // 不修改入参
    const input = ['3', '1', '3'];
    const result = validateDisplayCalendarIds(input);
    expect(input).toEqual(['3', '1', '3']);
    expect(result).not.toBe(input);
  });

  it('存储保留原值（trim 仅用于判定，不改写 id——日历 id 不含空白）', () => {
    expect(validateDisplayCalendarIds(['1 '])).toEqual(['1 ']);
  });

  it('非字符串元素抛错，错误消息含该值', () => {
    const bad = ['1', 42] as unknown as string[];
    expect(() => validateDisplayCalendarIds(bad)).toThrow('displayCalendarIds 每项必须是非空字符串，收到 42');
  });

  it('空串 / 纯空白元素抛错', () => {
    expect(() => validateDisplayCalendarIds([''])).toThrow(
      'displayCalendarIds 每项必须是非空字符串，收到 ',
    );
    expect(() => validateDisplayCalendarIds(['   '])).toThrow(
      'displayCalendarIds 每项必须是非空字符串，收到    ',
    );
  });

  it('非数组抛错（运行时防御，绕过类型层喂垃圾）', () => {
    const notAnArray = '["1"]' as unknown as string[];
    expect(() => validateDisplayCalendarIds(notAnArray)).toThrow('displayCalendarIds 必须是数组');
  });
});

describe('serializeDisplayCalendarIds', () => {
  it('恒输出 JSON 数组字符串（经 validate）', () => {
    expect(serializeDisplayCalendarIds([])).toBe('[]');
    expect(serializeDisplayCalendarIds(['1'])).toBe('["1"]');
    expect(serializeDisplayCalendarIds(['1', '2'])).toBe('["1","2"]');
  });

  it('非法输入同样抛错（不静默序列化）', () => {
    expect(() => serializeDisplayCalendarIds([''])).toThrow();
    expect(() => serializeDisplayCalendarIds(['1', '1', ''])).toThrow();
  });
});

describe('DEFAULT_APP_SETTINGS.displayCalendarIds（切片 27 兜底）', () => {
  it('默认值 = []（功能关闭）；parse 回退恒为新数组，外部改动不污染默认值', () => {
    expect(DEFAULT_APP_SETTINGS.displayCalendarIds).toEqual([]);
    const fallback = parseDisplayCalendarIds(null);
    fallback.push('1');
    expect(DEFAULT_APP_SETTINGS.displayCalendarIds).toEqual([]);
    expect(parseDisplayCalendarIds(null)).toEqual([]);
  });
});
