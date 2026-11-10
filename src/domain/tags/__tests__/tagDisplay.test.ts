import { formatTagDisplay } from '../tagDisplay';
import type { TagDisplayMode } from '../../settings';
import type { Tag } from '../../tag';

const WITH_EMOJI: Pick<Tag, 'name' | 'emoji'> = { name: '工作', emoji: '💼' };
const WITHOUT_EMOJI: Pick<Tag, 'name' | 'emoji'> = { name: '生活', emoji: null };
const EMPTY_EMOJI: Pick<Tag, 'name' | 'emoji'> = { name: '灵感', emoji: '' };

describe('formatTagDisplay', () => {
  it("text 模式 → name（有 emoji 时也是 name）", () => {
    expect(formatTagDisplay(WITH_EMOJI, 'text')).toBe('工作');
  });

  it("text 模式 → name（emoji 为 null）", () => {
    expect(formatTagDisplay(WITHOUT_EMOJI, 'text')).toBe('生活');
  });

  it("emoji 模式 → tag.emoji", () => {
    expect(formatTagDisplay(WITH_EMOJI, 'emoji')).toBe('💼');
  });

  it("emoji 模式：emoji 为 null 回退 name", () => {
    expect(formatTagDisplay(WITHOUT_EMOJI, 'emoji')).toBe('生活');
  });

  it('both 模式 → "emoji name"', () => {
    expect(formatTagDisplay(WITH_EMOJI, 'both')).toBe('💼 工作');
  });

  it('both 模式：emoji 为 null 回退 name', () => {
    expect(formatTagDisplay(WITHOUT_EMOJI, 'both')).toBe('生活');
  });

  it('emoji 为空串同样回退 name（text/emoji/both 全模式）', () => {
    expect(formatTagDisplay(EMPTY_EMOJI, 'text')).toBe('灵感');
    expect(formatTagDisplay(EMPTY_EMOJI, 'emoji')).toBe('灵感');
    expect(formatTagDisplay(EMPTY_EMOJI, 'both')).toBe('灵感');
  });
});
