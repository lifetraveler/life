import {
  escapeLikePattern,
  extractDateFragment,
  matchesDateFragment,
  normalizeSearchKeyword,
} from '../search';

describe('normalizeSearchKeyword', () => {
  it('去除首尾空白', () => {
    expect(normalizeSearchKeyword('  周会  ')).toBe('周会');
  });

  it('空字符串返回空串', () => {
    expect(normalizeSearchKeyword('')).toBe('');
  });

  it('纯空白（空格/制表符/换行）返回空串', () => {
    expect(normalizeSearchKeyword('   ')).toBe('');
    expect(normalizeSearchKeyword(' \t\n ')).toBe('');
  });

  it('中间空白保留', () => {
    expect(normalizeSearchKeyword(' 周会 纪要 ')).toBe('周会 纪要');
  });
});

describe('escapeLikePattern', () => {
  it('转义 %', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
  });

  it('转义 _', () => {
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
  });

  it('转义反斜杠本身', () => {
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });

  it('连续特殊字符逐一转义', () => {
    expect(escapeLikePattern('%_\\')).toBe('\\%\\_\\\\');
  });

  it('已转义序列不会被二次转义破坏（\\% → \\\\%）', () => {
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%');
  });

  it('普通字符与中文原样保留', () => {
    expect(escapeLikePattern('周会 abc 123')).toBe('周会 abc 123');
  });

  it('空字符串返回空串', () => {
    expect(escapeLikePattern('')).toBe('');
  });
});

describe('searchItems 使用的完整拼接约定（trim → 转义 → % 包裹）', () => {
  it('普通关键词', () => {
    const keyword = normalizeSearchKeyword('  周会  ');
    expect(`%${escapeLikePattern(keyword)}%`).toBe('%周会%');
  });

  it('搜索 % 时：转义后包裹，不会退化成通配全部', () => {
    const keyword = normalizeSearchKeyword(' % ');
    expect(`%${escapeLikePattern(keyword)}%`).toBe('%\\%%');
  });

  it('搜索 _ 时同理', () => {
    const keyword = normalizeSearchKeyword('_');
    expect(`%${escapeLikePattern(keyword)}%`).toBe('%\\_%');
  });

  it('搜索反斜杠时同理', () => {
    const keyword = normalizeSearchKeyword('\\');
    expect(`%${escapeLikePattern(keyword)}%`).toBe('%\\\\%');
  });
});

describe('extractDateFragment（v0.12 日期片段识别）', () => {
  it.each([
    ['2026', '2026'],
    ['2026-11', '2026-11'],
    ['2026-11-05', '2026-11-05'],
    ['11-05', '11-05'],
  ])('合法片段 %s → %s', (raw, expected) => {
    expect(extractDateFragment(raw)).toBe(expected);
  });

  it('trim 后识别（调用方传 trim 前后关键词结果一致）', () => {
    expect(extractDateFragment('  2026-11  ')).toBe('2026-11');
  });

  it.each([
    '周会',
    'abc',
    '202611',
    '2026/11',
    '2026-11-5',
    '26-11',
    '2026-11-05-06',
    '周会 2026-11',
    '13-01',
    '2026-00',
    '2026-13',
    '2026-11-00',
    '2026-11-32',
    '00-05',
  ])('非片段或非法片段 %j → null', (raw) => {
    expect(extractDateFragment(raw)).toBe(null);
  });

  it('空串 → null', () => {
    expect(extractDateFragment('')).toBe(null);
    expect(extractDateFragment('   ')).toBe(null);
  });
});

describe('matchesDateFragment（v0.12 格式化日期子串匹配）', () => {
  // Asia/Shanghai 2026-11-05 00:30：用 Date.UTC 显式构造（-08:00 固定偏移，
  // 上海无 DST），预期值不依赖 process.env.TZ。
  const SH_NOV5_0030 = Date.UTC(2026, 10, 5, 0, 30) - 8 * 60 * 60 * 1000;

  it('年 / 年月 / 年月日 / 月日 片段均命中同一时刻', () => {
    expect(matchesDateFragment(SH_NOV5_0030, '2026-11-05', 'Asia/Shanghai')).toBe(true);
    expect(matchesDateFragment(SH_NOV5_0030, '2026-11', 'Asia/Shanghai')).toBe(true);
    expect(matchesDateFragment(SH_NOV5_0030, '2026', 'Asia/Shanghai')).toBe(true);
    expect(matchesDateFragment(SH_NOV5_0030, '11-05', 'Asia/Shanghai')).toBe(true);
  });

  it('不同日期 / 不同年份不命中', () => {
    expect(matchesDateFragment(SH_NOV5_0030, '2026-11-06', 'Asia/Shanghai')).toBe(false);
    expect(matchesDateFragment(SH_NOV5_0030, '2025', 'Asia/Shanghai')).toBe(false);
    expect(matchesDateFragment(SH_NOV5_0030, '11-06', 'Asia/Shanghai')).toBe(false);
    expect(matchesDateFragment(SH_NOV5_0030, '10-05', 'Asia/Shanghai')).toBe(false);
  });

  it('同一时刻在 UTC 下是 11-04：tzid 显式生效，不读系统本地时区', () => {
    expect(matchesDateFragment(SH_NOV5_0030, '11-04', 'UTC')).toBe(true);
    expect(matchesDateFragment(SH_NOV5_0030, '2026-11-04', 'UTC')).toBe(true);
    expect(matchesDateFragment(SH_NOV5_0030, '11-05', 'UTC')).toBe(false);
  });

  it('instant 为 null（未安排 / 无结束时间）不命中', () => {
    expect(matchesDateFragment(null, '2026', 'Asia/Shanghai')).toBe(false);
    expect(matchesDateFragment(null, '2026-11-05', 'Asia/Shanghai')).toBe(false);
  });
});
