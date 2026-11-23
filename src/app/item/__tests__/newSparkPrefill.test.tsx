/**
 * item/new 灵感转计划预填与保存链 Probe 单测（切片 37 阶段 2，AGENTS.md §7.49 D7）：
 * - fromSpark 参数存在：title/content 预填表单，保存链 createItem → updateItemTime →
 *   tags → reconcile → linkSparkToItem(fromSpark, created.id) → router.back()；
 * - 关联失败仅披露（Alert「已保存」+ 提示），不回滚条目、back 照常返回灵感详情；
 * - 无 fromSpark（普通新建入口）：保存链零改动，linkSparkToItem 不调用。
 * 页面级测试（先例 src/app/settings/__tests__/backup.test.tsx）。
 */
import TestRenderer, { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { Alert } from 'react-native';

import ItemNewPage from '../new';

// —— 模块 mock（factory 内建 jest.fn，经 requireMock 取回）——

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
  useFocusEffect: jest.fn(),
}));

jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../../../data', () => ({
  itemRepository: {
    getCategories: jest.fn(),
    getSettings: jest.fn(),
    createItem: jest.fn(),
    updateItemTime: jest.fn(),
    addTagToItem: jest.fn(),
  },
  sparkRepository: {
    linkSparkToItem: jest.fn(),
  },
}));

jest.mock('../../../notifications', () => ({
  reminderScheduler: { reconcile: jest.fn() },
}));

// RN jest preset 已 mock react-native 组件树（勿再 jest.mock react-native）。
const alertMock = jest.fn();
const backMock = jest.fn();

const routerMocks = jest.requireMock('expo-router') as {
  useRouter: jest.Mock;
  useLocalSearchParams: jest.Mock;
  useFocusEffect: jest.Mock;
};
const dataMocks = jest.requireMock('../../../data') as {
  itemRepository: {
    getCategories: jest.Mock;
    getSettings: jest.Mock;
    createItem: jest.Mock;
    updateItemTime: jest.Mock;
    addTagToItem: jest.Mock;
  };
  sparkRepository: {
    linkSparkToItem: jest.Mock;
  };
};
const schedulerMocks = jest.requireMock('../../../notifications').reminderScheduler as {
  reconcile: jest.Mock;
};

function collectTexts(root: ReactTestInstance): string[] {
  const texts: string[] = [];
  const pushChildren = (children: unknown): void => {
    if (typeof children === 'string' || typeof children === 'number') {
      texts.push(String(children));
      return;
    }
    if (Array.isArray(children)) {
      for (const child of children) {
        pushChildren(child);
      }
    }
  };
  for (const node of root.findAll(() => true)) {
    pushChildren(node.props.children);
  }
  return texts;
}

/** 按内层文案定位可按压节点（Pressable 渲染实例 type 不与 import 恒等，按 props 匹配）。 */
function findPressableByText(root: ReactTestInstance, text: string): ReactTestInstance | null {
  const candidates = root.findAll(
    (node) => typeof node.props.onPress === 'function' && collectTexts(node).includes(text),
  );
  return candidates.length > 0 ? candidates[0] : null;
}

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  (Alert as unknown as { alert: unknown }).alert = alertMock;
  routerMocks.useRouter.mockReturnValue({ back: backMock });
  routerMocks.useFocusEffect.mockClear();
  backMock.mockClear();
  dataMocks.itemRepository.getCategories.mockReset().mockResolvedValue([]);
  dataMocks.itemRepository.getSettings.mockReset().mockResolvedValue({ tagDisplayMode: 'text' });
  dataMocks.itemRepository.createItem.mockReset().mockResolvedValue({
    id: 'item-1',
    type: 'note',
    title: '灵感标题',
    content: '灵感内容',
    status: 'todo',
    startAt: null,
    endAt: null,
    allDay: false,
    categoryId: null,
    priority: 0,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  });
  dataMocks.itemRepository.updateItemTime.mockReset().mockResolvedValue(undefined);
  dataMocks.itemRepository.addTagToItem.mockReset().mockResolvedValue(undefined);
  dataMocks.sparkRepository.linkSparkToItem.mockReset().mockResolvedValue(undefined);
  schedulerMocks.reconcile.mockReset().mockResolvedValue(undefined);
  alertMock.mockClear();
});

describe('灵感转计划预填与保存链（§7.49 D7）', () => {
  it('fromSpark 存在：预填 title/content，保存后 linkSparkToItem + back 返回灵感详情', async () => {
    routerMocks.useLocalSearchParams.mockReturnValue({
      fromSpark: 'spark-1',
      title: '灵感标题',
      content: '灵感内容',
    });
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ItemNewPage />);
    });
    await flush();
    const save = findPressableByText(tree.root, '保存');
    expect(save).not.toBeNull();
    await act(async () => {
      (save?.props.onPress as (() => void) | undefined)?.();
    });
    await flush();
    expect(dataMocks.itemRepository.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ title: '灵感标题', content: '灵感内容' }),
    );
    expect(dataMocks.itemRepository.updateItemTime).toHaveBeenCalledWith('item-1', {
      startAt: null,
      endAt: null,
      allDay: false,
    });
    expect(schedulerMocks.reconcile).toHaveBeenCalledTimes(1);
    expect(dataMocks.sparkRepository.linkSparkToItem).toHaveBeenCalledWith('spark-1', 'item-1');
    expect(backMock).toHaveBeenCalledTimes(1);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('关联失败仅披露：Alert「已保存」+ back 照常（不回滚条目）', async () => {
    routerMocks.useLocalSearchParams.mockReturnValue({
      fromSpark: 'spark-1',
      title: '灵感标题',
    });
    dataMocks.sparkRepository.linkSparkToItem.mockRejectedValue(
      new Error('linkSparkToItem: 条目不存在（item-1）'),
    );
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ItemNewPage />);
    });
    await flush();
    const save = findPressableByText(tree.root, '保存');
    await act(async () => {
      (save?.props.onPress as (() => void) | undefined)?.();
    });
    await flush();
    expect(dataMocks.itemRepository.createItem).toHaveBeenCalled();
    expect(dataMocks.sparkRepository.linkSparkToItem).toHaveBeenCalledWith('spark-1', 'item-1');
    expect(alertMock).toHaveBeenCalledWith('已保存', '灵感关联失败，可在灵感详情页手动关联。');
    expect(backMock).toHaveBeenCalledTimes(1);
  });

  it('无 fromSpark（普通新建）：保存链零改动，linkSparkToItem 不调用', async () => {
    routerMocks.useLocalSearchParams.mockReturnValue({});
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ItemNewPage />);
    });
    await flush();
    // 无预填时表单为空，validate 会拦截——先手输标题再保存（模拟普通入口）。
    const titleInput = tree.root.findAll((node) => node.type === 'TextInput')[0];
    await act(async () => {
      (titleInput.props.onChangeText as (v: string) => void)('普通条目');
    });
    const save = findPressableByText(tree.root, '保存');
    await act(async () => {
      (save?.props.onPress as (() => void) | undefined)?.();
    });
    await flush();
    expect(dataMocks.itemRepository.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ title: '普通条目' }),
    );
    expect(dataMocks.sparkRepository.linkSparkToItem).not.toHaveBeenCalled();
    expect(backMock).toHaveBeenCalledTimes(1);
  });
});
