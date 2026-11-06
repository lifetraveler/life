/**
 * 切片 12：新建记录草稿判空纯函数（ui.md v0.12 快速记录增强——返回键行为
 * 按「输入框为空 / 有内容」区分；空 = 标题、内容、标签输入、待绑定标签
 * 全部为空）。抽成纯函数以便单测（tasks/slice-12.md 验收 10）。
 * 空判定用 trim 语义：纯空白输入不算草稿。
 */

export function isQuickAddDraftEmpty(
  title: string,
  content: string,
  tagInput: string,
  pendingTagCount: number,
): boolean {
  return (
    title.trim().length === 0 &&
    content.trim().length === 0 &&
    tagInput.trim().length === 0 &&
    pendingTagCount === 0
  );
}
