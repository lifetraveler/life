import { isQuickAddDraftEmpty } from '../quickAddDraft';

/**
 * 切片 12 返回键草稿判空单测（ui.md v0.12 快速记录增强）：
 * 空 = 标题、内容、标签输入、待绑定标签全部为空；trim 语义，纯空白不算草稿。
 */
describe('isQuickAddDraftEmpty（切片 12 返回键草稿判空）', () => {
  it('全空 → true', () => {
    expect(isQuickAddDraftEmpty('', '', '', 0)).toBe(true);
  });

  it('纯空白输入（trim 语义）→ true', () => {
    expect(isQuickAddDraftEmpty('   ', ' \n\t', ' 　', 0)).toBe(true);
  });

  it('标题有字 → false', () => {
    expect(isQuickAddDraftEmpty('买牛奶', '', '', 0)).toBe(false);
    expect(isQuickAddDraftEmpty('  ', '随便', '', 0)).toBe(false);
  });

  it('内容有字 → false', () => {
    expect(isQuickAddDraftEmpty('', '备注内容', '', 0)).toBe(false);
  });

  it('标签输入有未提交文本 → false', () => {
    expect(isQuickAddDraftEmpty('', '', '生活', 0)).toBe(false);
    expect(isQuickAddDraftEmpty('', '', '生活，', 0)).toBe(false);
  });

  it('有待绑定标签 → false（草稿非空，返回键仅收键盘不丢数据）', () => {
    expect(isQuickAddDraftEmpty('', '', '', 1)).toBe(false);
    expect(isQuickAddDraftEmpty('', '', '', 3)).toBe(false);
  });
});
