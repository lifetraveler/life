/**
 * FlashResultCard 渲染单测（切片 29 / AGENTS.md §7.40，tasks/slice-29.md 阶段 2）：
 * 历史卡视觉区分——historical=true 时右上角「历史」角标出现、整卡样式带
 * opacity 0.55、快捷推迟 chips 保留可用（文案渲染 + 点击回调仍触发）；
 * 默认（当前卡）无角标、无 dim（§7.40 当前卡不额外标识）。
 */
import TestRenderer from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import FlashResultCard from '../FlashResultCard';
import type { FlashCardPayload } from '../../domain/ai/types';

/** 2026-11-09 06:00 Asia/Shanghai（= UTC 2026-11-08 22:00） */
const START = Date.UTC(2026, 10, 8, 22, 0, 0);
const TZID = 'Asia/Shanghai';

function makePayload(overrides: Partial<FlashCardPayload> = {}): FlashCardPayload {
  return {
    itemId: 'item-1',
    title: '牙医复诊',
    content: '',
    type: 'event',
    startAt: START,
    endAt: START + 3_600_000,
    allDay: false,
    category: { id: 'health', name: '健康', color: '#4C7A5C', emoji: '💊' },
    reminder: null,
    ...overrides,
  };
}

function collectTexts(root: ReactTestInstance): string[] {
  const texts: string[] = [];
  for (const node of root.findAll(() => true)) {
    const children = node.props.children;
    if (typeof children === 'string' || typeof children === 'number') {
      texts.push(String(children));
    }
  }
  return texts;
}

/**
 * 是否存在带历史 dim 的节点（样式数组含 opacity 0.55）。
 * 注：RN jest preset 下 Pressable 渲染实例的 type 不与 import 的组件恒等，
 * 故不按组件类型匹配，按传入的样式 prop 形状匹配（chipDisabled 是 0.5 不误中）。
 */
function hasHistoricalDimNode(tree: ReactTestRenderer): boolean {
  const dimmed = tree.root.findAll((node: ReactTestInstance) => {
    const style = node.props.style as unknown;
    if (!Array.isArray(style)) return false;
    return style.some(
      (entry) => entry !== null && entry !== undefined && entry.opacity === 0.55,
    );
  });
  return dimmed.length > 0;
}

/**
 * 从带 onPress 回调的节点里选含指定文案的内层节点（chip）并触发其回调。
 * findAll 是先序 DFS：外层卡片节点在前、chip 在后——倒查取最内层含该文案的
 * 节点（外层卡片子树同样包含 chip 文案，不能先命中）。
 */
function pressChipByLabel(root: ReactTestInstance, label: string): void {
  const pressables = root.findAll(
    (node: ReactTestInstance) => typeof node.props.onPress === 'function',
  );
  const target = [...pressables].reverse().find((node) => collectTexts(node).includes(label));
  expect(target).toBeDefined();
  (target?.props.onPress as () => void)();
}

describe('FlashResultCard 历史卡视觉区分（切片 29 §7.40）', () => {
  it('默认（当前卡）：无「历史」角标、样式不带 opacity dim', async () => {
    let tree!: ReactTestRenderer;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <FlashResultCard payload={makePayload()} tzid={TZID} onPress={() => undefined} />,
      );
    });
    expect(collectTexts(tree.root)).not.toContain('历史');
    expect(hasHistoricalDimNode(tree)).toBe(false);
    expect(collectTexts(tree.root)).toContain('牙医复诊');
  });

  it('historical=true：渲染「历史」角标、整卡样式带 opacity 0.55', async () => {
    let tree!: ReactTestRenderer;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <FlashResultCard
          payload={makePayload()}
          tzid={TZID}
          historical
          onPress={() => undefined}
        />,
      );
    });
    expect(collectTexts(tree.root)).toContain('历史');
    expect(hasHistoricalDimNode(tree)).toBe(true);
  });

  it('historical=true：快捷推迟 chips 保留可用（文案仍在、点击回调触发）', async () => {
    const onPostpone = jest.fn();
    let tree!: ReactTestRenderer;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <FlashResultCard
          payload={makePayload()}
          tzid={TZID}
          historical
          onPress={() => undefined}
          onPostpone={onPostpone}
        />,
      );
    });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('+15分钟');
    expect(texts).toContain('+1小时');
    pressChipByLabel(tree.root, '+15分钟');
    expect(onPostpone).toHaveBeenCalledTimes(1);
    expect(onPostpone).toHaveBeenCalledWith(15);
  });
});
