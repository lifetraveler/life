/**
 * queryGuard 纯函数单测（切片 36 阶段 1，AGENTS.md §7.48 提案 D2）：
 * parseCivilDateString（YYYY-MM-DD + 日历校验）/ isQueryWindowWire（形状
 * 从严守卫）/ resolveQueryWindow（民用窗口 → 本地 epoch；非法回退今天起
 * 7 天 usedFallback=true）。时区固定 Asia/Shanghai（无 DST，午夜即日起点）。
 */

import { parseCivilDateString, isQueryWindowWire, resolveQueryWindow } from '../queryGuard';
import type { QueryWindowWire } from '../queryGuard';

const TZ = 'Asia/Shanghai';
// 2026-11-23 10:00 上海时间 = Date.UTC(2026, 10, 23, 2, 0)
const NOW = Date.UTC(2026, 10, 23, 2, 0);
// 上海 = UTC+8：民用日起点 epoch = UTC 0 点 - 8h
const dayStart = (y: number, m1: number, d: number): number => Date.UTC(y, m1 - 1, d) - 8 * 3600_000;

describe('parseCivilDateString（切片 36）', () => {
  it('合法日期 → CivilDate（含闰年 02-29）', () => {
    expect(parseCivilDateString('2026-11-23')).toEqual({ year: 2026, month: 11, day: 23 });
    expect(parseCivilDateString('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
  });

  it('非字符串 / 格式偏差 → null', () => {
    expect(parseCivilDateString(null)).toBeNull();
    expect(parseCivilDateString(42)).toBeNull();
    expect(parseCivilDateString('2026/11/23')).toBeNull();
    expect(parseCivilDateString('2026-1-1')).toBeNull();
    expect(parseCivilDateString('2026-11-23 ')).toBeNull();
    expect(parseCivilDateString('')).toBeNull();
  });

  it('日历无效（月份越界 / 日越界 / 平年 02-29）→ null', () => {
    expect(parseCivilDateString('2026-00-10')).toBeNull();
    expect(parseCivilDateString('2026-13-01')).toBeNull();
    expect(parseCivilDateString('2026-11-00')).toBeNull();
    expect(parseCivilDateString('2026-11-31')).toBeNull();
    expect(parseCivilDateString('2026-02-29')).toBeNull(); // 平年
    expect(parseCivilDateString('2027-02-29')).toBeNull();
  });
});

describe('isQueryWindowWire（第一段形状守卫，切片 36）', () => {
  it('合法轻 JSON 通过，返回归一形状', () => {
    expect(isQueryWindowWire({ start: { date: '2026-12-01' }, end: { date: '2026-12-07' } })).toEqual({
      start: { date: '2026-12-01' },
      end: { date: '2026-12-07' },
    });
  });

  it('非对象 / 缺键 / 类型不符 / 日期串非法 → null（任一不符整体拒绝）', () => {
    expect(isQueryWindowWire(null)).toBeNull();
    expect(isQueryWindowWire('json')).toBeNull();
    expect(isQueryWindowWire([])).toBeNull();
    expect(isQueryWindowWire({ start: { date: '2026-12-01' } })).toBeNull();
    expect(isQueryWindowWire({ end: { date: '2026-12-07' } })).toBeNull();
    expect(isQueryWindowWire({ start: { date: '2026-12-01' }, end: '2026-12-07' })).toBeNull();
    expect(isQueryWindowWire({ start: '2026-12-01', end: { date: '2026-12-07' } })).toBeNull();
    expect(isQueryWindowWire({ start: { date: 42 }, end: { date: '2026-12-07' } })).toBeNull();
    expect(isQueryWindowWire({ start: { date: '2026-13-01' }, end: { date: '2026-12-07' } })).toBeNull();
    expect(isQueryWindowWire({ start: { date: '2026-12-01' }, end: { date: 'bad-date' } })).toBeNull();
  });
});

describe('resolveQueryWindow（窗口解析与回退，切片 36）', () => {
  const wire = (start: string, end: string): QueryWindowWire => ({ start: { date: start }, end: { date: end } });

  it('合法窗口：本地日起点/次日起点-1ms，windowText 归一，usedFallback=false', () => {
    const resolved = resolveQueryWindow(wire('2026-12-01', '2026-12-07'), NOW, TZ);
    expect(resolved.startMs).toBe(dayStart(2026, 12, 1));
    expect(resolved.endMs).toBe(dayStart(2026, 12, 8) - 1);
    expect(resolved.windowText).toBe('2026-12-01 至 2026-12-07');
    expect(resolved.usedFallback).toBe(false);
  });

  it('单日窗口（start === end）：当日 [00:00.000, 23:59.999]', () => {
    const resolved = resolveQueryWindow(wire('2026-11-25', '2026-11-25'), NOW, TZ);
    expect(resolved.startMs).toBe(dayStart(2026, 11, 25));
    expect(resolved.endMs).toBe(dayStart(2026, 11, 26) - 1);
    expect(resolved.usedFallback).toBe(false);
  });

  it('wire null（第一段失败/守卫拒绝）→ 回退今天起 7 天（含今天），usedFallback=true', () => {
    const resolved = resolveQueryWindow(null, NOW, TZ);
    expect(resolved.startMs).toBe(dayStart(2026, 11, 23));
    expect(resolved.endMs).toBe(dayStart(2026, 11, 30) - 1);
    expect(resolved.windowText).toBe('2026-11-23 至 2026-11-29');
    expect(resolved.usedFallback).toBe(true);
  });

  it('end < start → 回退默认窗口（不交换，保守回退）', () => {
    const resolved = resolveQueryWindow(wire('2026-12-07', '2026-12-01'), NOW, TZ);
    expect(resolved.windowText).toBe('2026-11-23 至 2026-11-29');
    expect(resolved.usedFallback).toBe(true);
  });

  it('守卫放行但日历非法（绕过守卫直调）→ 回退默认窗口', () => {
    const resolved = resolveQueryWindow(wire('2026-02-30', '2026-03-01'), NOW, TZ);
    expect(resolved.windowText).toBe('2026-11-23 至 2026-11-29');
    expect(resolved.usedFallback).toBe(true);
  });

  it('合法窗口与默认窗口逐字段一致可复算（确定性）', () => {
    const a = resolveQueryWindow(wire('2026-11-23', '2026-11-29'), NOW, TZ);
    const b = resolveQueryWindow(null, NOW, TZ);
    expect(a.startMs).toBe(b.startMs);
    expect(a.endMs).toBe(b.endMs);
    expect(a.windowText).toBe(b.windowText);
    expect(a.usedFallback).toBe(false);
    expect(b.usedFallback).toBe(true);
  });
});
