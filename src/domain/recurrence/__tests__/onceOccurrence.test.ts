import { buildOnceOccurrence, resolveOnceFireAt } from '..';

// onceAt 民用五元组（月份 1-12，与 OnceCivilTime 一致）。
function civil(year: number, month: number, day: number, hour: number, minute: number) {
  return { year, month, day, hour, minute };
}

describe('resolveOnceFireAt / buildOnceOccurrence（切片 16 阶段 2）', () => {
  it('Asia/Shanghai 2026-01-15 09:30 → UTC+8 换算为 01:30Z', () => {
    const onceAt = civil(2026, 1, 15, 9, 30);
    expect(resolveOnceFireAt(onceAt, 'Asia/Shanghai')).toBe(Date.UTC(2026, 0, 15, 1, 30));
  });

  it('America/New_York 秋季 fold 2026-11-01 01:30 → 取较早瞬间（EDT, -04:00）', () => {
    const onceAt = civil(2026, 11, 1, 1, 30);
    expect(resolveOnceFireAt(onceAt, 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });

  it('America/New_York 春季 gap 2026-03-08 02:30 → null（该时刻不存在）', () => {
    const onceAt = civil(2026, 3, 8, 2, 30);
    expect(resolveOnceFireAt(onceAt, 'America/New_York')).toBeNull();
    expect(buildOnceOccurrence({ scheduleId: 'r9', onceAt, tzid: 'America/New_York' })).toBeNull();
  });

  it('buildOnceOccurrence：occurrenceKey 为 `once:<scheduleId>:<epoch ms>` 确定性串', () => {
    const onceAt = civil(2026, 1, 15, 9, 30);
    const occurrence = buildOnceOccurrence({ scheduleId: 'r9', onceAt, tzid: 'Asia/Shanghai' });

    if (!occurrence) throw new Error('expected occurrence for valid civil time');
    expect(occurrence.occurrenceKey).toBe(`once:r9:${Date.UTC(2026, 0, 15, 1, 30)}`);
    // 民字段取 onceAt 本身（tzid 下的民用时间）。
    expect(occurrence.localDate).toBe('2026-01-15');
    expect(occurrence.localTime).toBe('09:30');
    expect(occurrence.tzid).toBe('Asia/Shanghai');
    expect(occurrence.instant).toBe(Date.UTC(2026, 0, 15, 1, 30));
  });

  it('buildOnceOccurrence：确定性——重复展开得到同一 occurrenceKey', () => {
    const onceAt = civil(2026, 11, 1, 1, 30);
    const a = buildOnceOccurrence({ scheduleId: 'rFold', onceAt, tzid: 'America/New_York' });
    const b = buildOnceOccurrence({ scheduleId: 'rFold', onceAt, tzid: 'America/New_York' });

    if (!a || !b) throw new Error('expected occurrences for fold time');
    expect(a.occurrenceKey).toBe(b.occurrenceKey);
    expect(a.instant).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });
});
