/**
 * sparks.tsx 主屏渲染与交互单测（切片 37 阶段 2，AGENTS.md §7.49 D6）：
 * - 空态卡「随手记一条灵感」；
 * - 灵感卡渲染：主行标题 + 相对时间 + preview + 录音×n 徽标 + 关联计划数；
 * - 点击卡片导航 /spark/<id>；长按触发删除 Alert 确认 → deleteSpark；
 * - 文字速存：输入 → 发送 → createSpark({content})；
 * - 权限拒绝：录音权限拒绝 → Alert 引导（不调 recorder）。
 * 页面级测试（先例 src/app/settings/__tests__/backup.test.tsx：
 * react-test-renderer + collectTexts + 按文案定位 Pressable）。
 */
import TestRenderer, { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { Alert } from 'react-native';

import type { Spark, SparkAttachment, SparkLinkedItemSummary } from '../../../domain/spark';
import SparksScreen from '../sparks';

// —— 模块 mock（factory 内建 jest.fn，经 requireMock 取回）——

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useFocusEffect: jest.fn(),
}));

jest.mock('expo-audio', () => {
  const recorder = {
    prepareToRecordAsync: jest.fn(),
    record: jest.fn(),
    stop: jest.fn(),
    uri: null,
    currentTime: 0,
  };
  return {
    __recorderMocks: recorder,
    RecordingPresets: { HIGH_QUALITY: {} },
    useAudioRecorder: jest.fn(() => recorder),
    requestRecordingPermissionsAsync: jest.fn(),
    setAudioModeAsync: jest.fn(),
    createAudioPlayer: jest.fn(),
  };
});

jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
}));

// Ionicons 拖入 expo-asset/expo-font 原生模块链（jest-expo preset 不自动 mock）——图标仅视觉装饰，stub 为 null 组件。
jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../data', () => ({
  sparkRepository: {
    createSpark: jest.fn(),
    deleteSpark: jest.fn(),
    listSparks: jest.fn(),
    listAttachments: jest.fn(),
    listItemsForSpark: jest.fn(),
  },
  sparkAttachmentIo: {
    copyIntoSparksDir: jest.fn(),
    fileExists: jest.fn(),
    deleteFile: jest.fn(),
    downloadToSparksDir: jest.fn(),
    deleteRemoteFile: jest.fn(),
    uploadSparkFile: jest.fn(),
  },
  itemRepository: {},
}));

// RN jest preset 已 mock react-native 组件树（勿再 jest.mock react-native）。
const alertMock = jest.fn();
const pushMock = jest.fn();

const routerMocks = jest.requireMock('expo-router') as {
  useRouter: jest.Mock;
  useFocusEffect: jest.Mock;
};
const recorderMocks = jest.requireMock('expo-audio').__recorderMocks as {
  prepareToRecordAsync: jest.Mock;
  record: jest.Mock;
  stop: jest.Mock;
  uri: string | null;
  currentTime: number;
};
const permissionMocks = jest.requireMock('expo-audio') as {
  requestRecordingPermissionsAsync: jest.Mock;
  setAudioModeAsync: jest.Mock;
};
const repositoryMocks = jest.requireMock('../../../data').sparkRepository as {
  createSpark: jest.Mock;
  deleteSpark: jest.Mock;
  listSparks: jest.Mock;
  listAttachments: jest.Mock;
  listItemsForSpark: jest.Mock;
};

const NOW = 1700000000000;

function makeSpark(overrides: Partial<Spark> = {}): Spark {
  // 相对时间以真实 Date.now() 为基准（formatRelativeTime(x, Date.now())），
  // fixture 必须挂在「1 分钟前」而非固定 2023 纪元。
  const now = Date.now();
  return {
    id: 'spark-1',
    title: '录音想法',
    content: '内容首行\n内容次行',
    createdAt: now - 60_000,
    updatedAt: now - 60_000,
    ...overrides,
  };
}

function makeAttachment(overrides: Partial<SparkAttachment> = {}): SparkAttachment {
  return {
    id: 'att-1',
    sparkId: 'spark-1',
    kind: 'audio',
    uri: '/sparks/a.m4a',
    remotePath: 'h-a.m4a',
    sha256: 'h',
    fileSize: 1024,
    durationMs: 1500,
    width: null,
    height: null,
    createdAt: NOW - 60_000,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<SparkLinkedItemSummary> = {}): SparkLinkedItemSummary {
  return {
    itemId: 'item-1',
    title: '已关联计划',
    status: 'active',
    startAt: null,
    allDay: false,
    categoryColor: null,
    categoryEmoji: null,
    linkedAt: NOW - 60_000,
    ...overrides,
  };
}

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

function findByTestId(root: ReactTestInstance, testId: string): ReactTestInstance | null {
  const candidates = root.findAll((node) => node.props.testID === testId);
  return candidates.length > 0 ? candidates[0] : null;
}

async function renderAndFocus(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<SparksScreen />);
  });
  const effect = routerMocks.useFocusEffect.mock.calls.at(-1)?.[0] as () => unknown;
  await act(async () => {
    await effect();
  });
  return tree;
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
  routerMocks.useRouter.mockReturnValue({ push: pushMock, back: jest.fn() });
  routerMocks.useFocusEffect.mockClear();
  pushMock.mockClear();
  for (const fn of Object.values(recorderMocks)) {
    if (typeof fn === 'function' && 'mockReset' in fn) {
      (fn as jest.Mock).mockReset();
    }
  }
  recorderMocks.uri = null;
  recorderMocks.currentTime = 0;
  permissionMocks.requestRecordingPermissionsAsync.mockReset();
  permissionMocks.setAudioModeAsync.mockReset();
  for (const fn of Object.values(repositoryMocks)) {
    fn.mockReset();
  }
  alertMock.mockClear();
  repositoryMocks.listSparks.mockResolvedValue([]);
  repositoryMocks.listAttachments.mockResolvedValue([]);
  repositoryMocks.listItemsForSpark.mockResolvedValue([]);
});

describe('灵感主屏（§7.49 D6）', () => {
  it('空态：渲染「随手记一条灵感」占位', async () => {
    const tree = await renderAndFocus();
    expect(collectTexts(tree.root)).toContain('随手记一条灵感');
  });

  it('灵感卡：标题/相对时间/preview/录音徽标/关联计划数，点击导航详情', async () => {
    repositoryMocks.listSparks.mockResolvedValue([makeSpark()]);
    repositoryMocks.listAttachments.mockResolvedValue([makeAttachment()]);
    repositoryMocks.listItemsForSpark.mockResolvedValue([makeSummary()]);
    const tree = await renderAndFocus();
    const texts = collectTexts(tree.root);
    expect(texts).toContain('录音想法');
    expect(texts).toContain('1分钟前');
    expect(texts).toContain('内容首行');
    // '录音×{n}' 与 '关联 {n} 条计划' 是多文本子节点，合并后断言。
    expect(texts.join('')).toContain('录音×1');
    expect(texts.join('')).toContain('关联 1 条计划');
    const card = findPressableByText(tree.root, '录音想法');
    expect(card).not.toBeNull();
    await act(async () => {
      (card?.props.onPress as (() => void) | undefined)?.();
    });
    expect(pushMock).toHaveBeenCalledWith('/spark/spark-1');
  });

  it('长按卡片：删除确认 Alert → 确认后 deleteSpark', async () => {
    repositoryMocks.listSparks.mockResolvedValue([makeSpark()]);
    const tree = await renderAndFocus();
    const card = findPressableByText(tree.root, '录音想法');
    await act(async () => {
      (card?.props.onLongPress as (() => void) | undefined)?.();
    });
    expect(alertMock).toHaveBeenCalledWith('删除灵感', '删除后附件与本地文件一并清除，且不可恢复。', expect.anything());
    const confirm = (alertMock.mock.calls[0]?.[2] as Array<{ text: string; onPress?: () => void }>).find(
      (button) => button.text === '删除',
    );
    repositoryMocks.deleteSpark.mockResolvedValue(undefined);
    await act(async () => {
      confirm?.onPress?.();
    });
    await flush();
    expect(repositoryMocks.deleteSpark).toHaveBeenCalledWith('spark-1');
  });

  it('文字速存：TextInput 输入 → 发送 → createSpark({content}) → 刷新', async () => {
    repositoryMocks.createSpark.mockResolvedValue(makeSpark({ id: 'spark-2', content: '灵感文字', title: null }));
    const tree = await renderAndFocus();
    const input = tree.root.findAll((node) => node.type === 'TextInput')[0];
    expect(input).not.toBeNull();
    await act(async () => {
      (input.props.onChangeText as (v: string) => void)('灵感文字');
    });
    const send = findByTestId(tree.root, 'spark-send');
    expect(send).not.toBeNull();
    await act(async () => {
      (send?.props.onPress as (() => void) | undefined)?.();
    });
    await flush();
    expect(repositoryMocks.createSpark).toHaveBeenCalledWith({ content: '灵感文字' });
    // 刷新后列表含新灵感。
    expect(repositoryMocks.listSparks).toHaveBeenCalledTimes(2);
  });

  it('录音权限拒绝：Alert 引导，不调用 recorder.record', async () => {
    permissionMocks.requestRecordingPermissionsAsync.mockResolvedValue({ granted: false });
    const tree = await renderAndFocus();
    const mic = findByTestId(tree.root, 'spark-record-start');
    await act(async () => {
      (mic?.props.onPress as (() => void) | undefined)?.();
    });
    await flush();
    expect(alertMock).toHaveBeenCalledWith('麦克风权限未授予', expect.anything(), expect.anything());
    expect(recorderMocks.record).not.toHaveBeenCalled();
  });
});
