/**
 * FlashPreviewCard 渲染单测（切片 30 阶段 3，AGENTS.md §7.41）。
 * 覆盖弃置态（dismissed）的视觉判定：降透明 0.55 +「已放弃」角标 + Pressable
 * 禁用 + 提示文案切换。默认态回归：无角标、可点击。
 * 模式沿用 FlashResultCard.test.tsx（RN jest preset 下 node.type 匹配不到
 * Pressable——按 props 形状与子树文本断言）。
 */

import TestRenderer from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import FlashPreviewCard from '../FlashPreviewCard';
import type { ParsedItemDraft } from '../../domain/ai/types';

function makeDraft(overrides: Partial<ParsedItemDraft> = {}): ParsedItemDraft {
  return {
    title: '明天下午3点开会',
    content: '',
    type: 'event',
    startAt: new Date('2026-11-18T15:00:00+08:00').getTime(),
    endAt: null,
    allDay: false,
    categoryId: null,
    tags: [],
    priority: null,
    recurrence: null,
    reminderOffsetMinutes: null,
    reminderDelayMinutes: null,
    ...overrides,
  };
}

function collectTexts(instance: ReactTestInstance): string[] {
  const texts: string[] = [];
  for (const node of instance.findAll(() => true)) {
    const children = node.props.children;
    if (typeof children === 'string' || typeof children === 'number') {
      texts.push(String(children));
    }
  }
  return texts;
}

/** 找出所有 Pressable 形状节点（props 带 onPress/disabled 的可测试实例）。 */
function collectPressables(
  instance: ReactTestInstance,
): ReactTestInstance[] {
  return instance.findAll((node) => {
    const props = node.props as { onPress?: unknown; disabled?: unknown } | null;
    return props !== null && 'onPress' in props && 'disabled' in props;
  });
}

describe('FlashPreviewCard（切片 30 阶段 3 弃置态）', () => {
  const baseProps = {
    categories: [],
    tzid: 'Asia/Shanghai',
    onPress: () => {
      /* noop */
    },
  };

  it('默认态：无「已放弃」角标，Pressable 可点击，提示为「点击卡片可修改字段」', async () => {
    let tree!: ReactTestRenderer;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <FlashPreviewCard draft={makeDraft()} {...baseProps} />,
      );
    });
    expect(collectTexts(tree.root)).not.toContain('已放弃');
    expect(collectTexts(tree.root)).toContain('点击卡片可修改字段');
    const pressables = collectPressables(tree.root);
    expect(pressables.length).toBeGreaterThan(0);
    // 最外层卡 Pressable：disabled 为 false（未禁用）。
    const cardPressable = pressables.find((p) => p.props.disabled === false);
    expect(cardPressable).toBeDefined();
  });

  it('弃置态：「已放弃」角标渲染，样式数组含 opacity 0.55，Pressable disabled，提示切换', async () => {
    let tree!: ReactTestRenderer;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <FlashPreviewCard draft={makeDraft()} {...baseProps} dismissed={true} />,
      );
    });
    expect(collectTexts(tree.root)).toContain('已放弃');
    expect(collectTexts(tree.root)).toContain('草稿已放弃，重新输入可新建条目');
    const pressables = collectPressables(tree.root);
    const cardPressable = pressables.find((p) => p.props.disabled === true);
    expect(cardPressable).toBeDefined();
    // 弃置样式判定：style 数组中存在含 opacity === 0.55 的条目（与切片 29
    // 历史卡视觉语言同款，FlashResultCard.test.tsx 同模式）。
    const flattened = cardPressable?.props.style as
      | Array<Record<string, unknown> | null>
      | Record<string, unknown>;
    const entries = Array.isArray(flattened) ? flattened : [flattened];
    const hasDim = entries.some(
      (entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        (entry as Record<string, unknown>).opacity === 0.55,
    );
    expect(hasDim).toBe(true);
  });
});
