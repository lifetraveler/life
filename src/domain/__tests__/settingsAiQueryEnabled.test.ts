/**
 * ai_schedule_query_enabled 纯函数测试（切片 36 阶段 1，AGENTS.md §7.48）：
 * - parseAiScheduleQueryEnabled：读层防御归一，永不抛错（null/undefined/非 boolean
 *   → 回退默认 true 默认开——isOptional boolean 列既有行回填 null，非可选 boolean
 *   会回填 false 与「默认开」定案冲突，切片 30 ai_retry_max 教训同构）；
 * - validateAiScheduleQueryEnabled：写路径严格校验（非 boolean 抛错）；
 * - DEFAULT_APP_SETTINGS：aiScheduleQueryEnabled 默认 true。
 * 纯函数测试不碰数据库；Repository 归一/校验行为见 data/__tests__（同切片先例）。
 */

import {
  DEFAULT_APP_SETTINGS,
  parseAiScheduleQueryEnabled,
  validateAiScheduleQueryEnabled,
} from '../settings';

describe('parseAiScheduleQueryEnabled（读层防御归一，切片 36）', () => {
  it('null / undefined → 回退默认 true（既有行 schema 迁移 isOptional 回填 null）', () => {
    expect(parseAiScheduleQueryEnabled(null)).toBe(true);
    expect(parseAiScheduleQueryEnabled(undefined)).toBe(true);
  });

  it('运行时垃圾（绕过类型层喂非 boolean）→ 回退默认 true，永不抛错', () => {
    const garbage = [1, 0, 'true', 'false', {}, []] as unknown as Array<boolean | null>;
    for (const raw of garbage) {
      expect(parseAiScheduleQueryEnabled(raw)).toBe(true);
    }
  });

  it('boolean 原样返回：true / false（显式关闭合法保留）', () => {
    expect(parseAiScheduleQueryEnabled(true)).toBe(true);
    expect(parseAiScheduleQueryEnabled(false)).toBe(false);
  });
});

describe('validateAiScheduleQueryEnabled（写路径严格校验，切片 36）', () => {
  it('合法值（boolean）原样返回', () => {
    expect(validateAiScheduleQueryEnabled(true)).toBe(true);
    expect(validateAiScheduleQueryEnabled(false)).toBe(false);
  });

  it('非 boolean 抛错，错误消息含该值', () => {
    expect(() => validateAiScheduleQueryEnabled('true' as unknown as boolean)).toThrow(
      'aiScheduleQueryEnabled 必须是 boolean，收到 true',
    );
    expect(() => validateAiScheduleQueryEnabled(1 as unknown as boolean)).toThrow(
      'aiScheduleQueryEnabled 必须是 boolean，收到 1',
    );
    expect(() => validateAiScheduleQueryEnabled(null as unknown as boolean)).toThrow(
      'aiScheduleQueryEnabled 必须是 boolean，收到 null',
    );
  });
});

describe('DEFAULT_APP_SETTINGS（切片 36 兜底）', () => {
  it('aiScheduleQueryEnabled 默认 true（默认开，Q4 定案；读层回退语义一致）', () => {
    expect(DEFAULT_APP_SETTINGS.aiScheduleQueryEnabled).toBe(true);
  });
});
