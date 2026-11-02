import { escapeLikePattern, normalizeSearchKeyword } from '../search';

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
