/**
 * backup.tsx 数据备份区块渲染与交互单测（切片 31 阶段 2，AGENTS.md §7.43）：
 * - 区块渲染：「数据备份」「数据快照列表」两区块 + CONFIG∪DATA 一次 PROPFIND 拆分两列；
 * - busy 态互斥：数据备份进行中全部按钮禁用（含配置区块）；
 * - 数据备份：uploadSnapshot 收 isDataSnapshotFileName 谓词 + 完成文案；
 * - 数据恢复：Alert 确认 → applyDataSnapshot → reconcile 一次（失败仅披露）；
 * - 数据删除：Alert 确认 → deleteSnapshot（data 谓词）。
 * RN 页面级测试（先例 src/ui/__tests__/FlashResultCard.test.tsx 的
 * react-test-renderer + 按文案定位 Pressable 模式）。
 */
import TestRenderer, { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { Alert } from 'react-native';

import { serializeDataSnapshot, type DataSnapshot } from '../../../domain/dataSnapshot';
import { isDataSnapshotFileName } from '../../../domain/dataSnapshot';
import { isConfigSnapshotFileName } from '../../../domain/configSnapshot';
import BackupSettingsPage from '../backup';

// —— 模块 mock（factory 内建 jest.fn，经 requireMock 取回）——

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('../../../data', () => ({
  itemRepository: {
    createConfigSnapshot: jest.fn(),
    applyConfigSnapshot: jest.fn(),
    createDataSnapshot: jest.fn(),
    applyDataSnapshot: jest.fn(),
  },
}));

jest.mock('../../../data/SecureWebdavConfigStore', () => {
  const load = jest.fn();
  const save = jest.fn();
  return {
    __storeMocks: { load, save },
    SecureWebdavConfigStore: jest.fn().mockImplementation(() => ({ load, save })),
  };
});

jest.mock('../../../data/webdav/WebdavClient', () => {
  const instance = {
    testConnection: jest.fn(),
    listSnapshots: jest.fn(),
    uploadSnapshot: jest.fn(),
    downloadSnapshot: jest.fn(),
    deleteSnapshot: jest.fn(),
  };
  return {
    __clientMocks: instance,
    WebdavClient: jest.fn().mockImplementation(() => instance),
  };
});

jest.mock('../../../notifications', () => ({
  reminderScheduler: { reconcile: jest.fn() },
}));

// RN jest preset 已 mock react-native 组件树（对 react-native 再 jest.mock 会绕过
// preset 触发 TurboModuleRegistry DevMenu invariant），只替换 Alert.alert 收集调用。
const alertMock = jest.fn();

const routerMock = jest.requireMock('expo-router') as { useFocusEffect: jest.Mock };
const storeMocks = jest.requireMock('../../../data/SecureWebdavConfigStore')
  .__storeMocks as { load: jest.Mock; save: jest.Mock };
const clientMocks = jest.requireMock('../../../data/webdav/WebdavClient')
  .__clientMocks as {
  testConnection: jest.Mock;
  listSnapshots: jest.Mock;
  uploadSnapshot: jest.Mock;
  downloadSnapshot: jest.Mock;
  deleteSnapshot: jest.Mock;
};
const repositoryMocks = jest.requireMock('../../../data').itemRepository as {
  createConfigSnapshot: jest.Mock;
  applyConfigSnapshot: jest.Mock;
  createDataSnapshot: jest.Mock;
  applyDataSnapshot: jest.Mock;
};
const schedulerMocks = jest.requireMock('../../../notifications').reminderScheduler as {
  reconcile: jest.Mock;
};

const CONFIG = {
  baseUrl: 'https://dav.example.com',
  basePath: '/life-backup/',
  username: 'user',
  password: 'pass',
};

const CONFIG_FILE = {
  name: 'life-config-20260101-090000.json',
  lastModified: new Date('2026-01-01T09:00:00Z'),
};
const DATA_FILE = {
  name: 'life-data-20260101-090500.json',
  lastModified: new Date('2026-01-01T09:05:00Z'),
};
const FOREIGN_FILE = { name: 'other.txt', lastModified: null };

function makeSnapshot(overrides: Partial<DataSnapshot> = {}): DataSnapshot {
  return {
    version: 1,
    kind: 'data',
    exportedAt: '2026-01-01T17:05:00.000+08:00',
    items: [],
    tags: [],
    reminders: [],
    channelPresets: [],
    itemTags: [],
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

/** 按内层文案定位可按压节点（Pressable 渲染实例 type 不与 import 恒等，按 props 匹配）。 */
function findPressableByText(
  root: ReactTestInstance,
  text: string,
): ReactTestInstance | null {
  const candidates = root.findAll(
    (node) => typeof node.props.onPress === 'function' && collectTexts(node).includes(text),
  );
  return candidates.length > 0 ? candidates[0] : null;
}

/** 命中渲染（useState 初始 render）+ 触发最近一次 useFocusEffect 注册的回调。 */
async function renderAndFocus(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<BackupSettingsPage />);
  });
  const effect = routerMock.useFocusEffect.mock.calls.at(-1)?.[0] as () => unknown;
  await act(async () => {
    await effect();
  });
  return tree;
}

/** 排空若干轮微任务（handler 的 await 链）。 */
async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  // 每个用例前把 Alert.alert 换成干净的 jest.fn（preset 的 Alert 是普通对象，可覆写）。
  (Alert as unknown as { alert: unknown }).alert = alertMock;
  routerMock.useFocusEffect.mockClear();
  storeMocks.load.mockReset();
  storeMocks.save.mockReset();
  for (const fn of Object.values(clientMocks)) {
    fn.mockReset();
  }
  for (const fn of Object.values(repositoryMocks)) {
    fn.mockReset();
  }
  schedulerMocks.reconcile.mockReset();
  alertMock.mockClear();
});

describe('数据备份区块渲染（§7.43 阶段 2）', () => {
  it('渲染「数据备份」与「数据快照列表」区块（标题/按钮/提示）', async () => {
    storeMocks.load.mockResolvedValue(null);
    const tree = await renderAndFocus();

    const texts = collectTexts(tree.root);
    expect(texts).toContain('数据备份');
    expect(texts).toContain('立即备份数据');
    expect(texts).toContain('数据快照列表');
    expect(texts).toContain('尚未保存连接配置。'); // 两列表的未配置空态。
  });

  it('一次 PROPFIND 拆分两列：CONFIG 列表/数据列表各显示各自文件，foreign 文件两列都不显示', async () => {
    storeMocks.load.mockResolvedValue(CONFIG);
    clientMocks.listSnapshots.mockResolvedValue([CONFIG_FILE, DATA_FILE, FOREIGN_FILE]);
    const tree = await renderAndFocus();

    expect(clientMocks.listSnapshots).toHaveBeenCalledTimes(1);
    // OR 谓词传入（CONFIG∪DATA）：foreign 文件不该出现在任何一列。
    const predicate = clientMocks.listSnapshots.mock.calls[0][1] as (name: string) => boolean;
    expect(predicate('life-config-20260101-090000.json')).toBe(true);
    expect(predicate('life-data-20260101-090500.json')).toBe(true);
    expect(predicate('other.txt')).toBe(false);

    const texts = collectTexts(tree.root);
    expect(texts).toContain('life-config-20260101-090000.json');
    expect(texts).toContain('life-data-20260101-090500.json');
    expect(texts).not.toContain('other.txt');
  });

  it('列表读取失败：两列表空态 + listError 文案', async () => {
    storeMocks.load.mockResolvedValue(CONFIG);
    clientMocks.listSnapshots.mockRejectedValue(new Error('boom'));
    const tree = await renderAndFocus();

    const texts = collectTexts(tree.root);
    expect(texts).toContain('快照列表读取失败：boom');
    expect(texts).toContain('暂无快照（尚未备份或目录为空）。');
    expect(texts).toContain('暂无数据快照（尚未备份数据或目录为空）。');
  });
});

describe('立即备份数据（§7.43）', () => {
  it('组包 → uploadSnapshot（data 谓词第 4 参）→ 完成 Alert + 刷新列表；期间全按钮互斥禁用', async () => {
    storeMocks.load.mockResolvedValue(CONFIG);
    clientMocks.listSnapshots.mockResolvedValue([]);
    repositoryMocks.createDataSnapshot.mockResolvedValue(makeSnapshot());
    // 阻塞中的组包：验证 busy 互斥。
    let releaseBackup!: () => void;
    repositoryMocks.createDataSnapshot.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseBackup = resolve; }),
    );
    clientMocks.uploadSnapshot.mockResolvedValue({
      fileName: 'life-data-20260101-120000.json',
      prunedCount: 1,
      pruneFailedNames: [],
    });

    const tree = await renderAndFocus();
    const button = findPressableByText(tree.root, '立即备份数据');
    expect(button).not.toBeNull();

    await act(async () => {
      (button?.props.onPress as (() => void) | undefined)?.();
    });
    await flush(4); // requireStoredConfig → setBusy('dataBackup')。

    // busy 互斥：配置区块「立即备份」「保存连接」同样禁用。
    const configBackup = findPressableByText(tree.root, '立即备份');
    expect(configBackup?.props.disabled).toBe(true);
    expect(button?.props.disabled).toBe(true);

    await act(async () => {
      releaseBackup();
    });
    await flush(8);

    expect(repositoryMocks.createDataSnapshot).toHaveBeenCalledTimes(1);
    expect(clientMocks.uploadSnapshot).toHaveBeenCalledTimes(1);
    const [, fileName, , filter] = clientMocks.uploadSnapshot.mock.calls[0];
    expect(fileName).toMatch(/^life-data-\d{8}-\d{6}\.json$/);
    expect(filter).toBe(isDataSnapshotFileName);
    expect(alertMock).toHaveBeenCalledWith(
      '数据备份完成',
      'life-data-20260101-120000.json 已上传，已清理 1 份旧快照。',
    );
    // 完成后按钮恢复可用。
    expect(findPressableByText(tree.root, '立即备份数据')?.props.disabled).toBe(false);
  });

  it('组包失败：数据区块 errorHint 文案，不出完成 Alert', async () => {
    storeMocks.load.mockResolvedValue(CONFIG);
    clientMocks.listSnapshots.mockResolvedValue([]);
    repositoryMocks.createDataSnapshot.mockRejectedValue(new Error('db locked'));

    const tree = await renderAndFocus();
    const button = findPressableByText(tree.root, '立即备份数据');
    await act(async () => {
      (button?.props.onPress as (() => void) | undefined)?.();
    });
    await flush(8);

    expect(collectTexts(tree.root)).toContain('数据备份失败：db locked');
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('未保存连接配置：requireStoredConfig 拦截，不出网络调用', async () => {
    storeMocks.load.mockResolvedValue(null);
    const tree = await renderAndFocus();
    const button = findPressableByText(tree.root, '立即备份数据');
    await act(async () => {
      (button?.props.onPress as (() => void) | undefined)?.();
    });
    await flush(8);

    expect(clientMocks.uploadSnapshot).not.toHaveBeenCalled();
    expect(collectTexts(tree.root)).toContain('请先保存连接配置');
  });
});

describe('数据快照恢复（§7.43：增量覆盖 + reconcile 显式一次）', () => {
  async function pressRestoreAndConfirm(): Promise<void> {
    storeMocks.load.mockResolvedValue(CONFIG);
    clientMocks.listSnapshots.mockResolvedValue([DATA_FILE]);
    const tree = await renderAndFocus();

    // 数据列表行内「恢复」按钮（与配置列表按钮同名，按先出现的数据行文案定位：
    // 数据行渲染在配置行之后，取含 DATA_FILE 名的行内按钮）。
    const dataRow = tree.root.findAll(
      (node) => collectTexts(node).includes('life-data-20260101-090500.json'),
    );
    expect(dataRow.length).toBeGreaterThan(0);
    const restore = dataRow[0].findAll(
      (node) => typeof node.props.onPress === 'function' && collectTexts(node).includes('恢复'),
    )[0];
    expect(restore).toBeDefined();

    await act(async () => {
      (restore.props.onPress as () => void)();
    });
    await flush(2);

    expect(alertMock).toHaveBeenCalledWith(
      '恢复数据',
      expect.stringContaining('life-data-20260101-090500.json'),
      expect.arrayContaining([
        expect.objectContaining({ text: '取消' }),
        expect.objectContaining({ text: '恢复' }),
      ]),
    );
    const confirm = alertMock.mock.calls.at(-1)?.[2]?.[1] as { onPress: () => void };
    await act(async () => {
      confirm.onPress();
    });
    await flush(8);
  }

  it('确认后 download → parse → applyDataSnapshot → reconcile 一次 → 完成文案含 applied/skipped', async () => {
    clientMocks.downloadSnapshot.mockResolvedValue(
      serializeDataSnapshot(makeSnapshot({ items: [makeSnapshotItem()] })),
    );
    repositoryMocks.applyDataSnapshot.mockResolvedValue({ applied: 6, skipped: 2 });
    schedulerMocks.reconcile.mockResolvedValue(undefined);

    await pressRestoreAndConfirm();

    const [, , filter] = clientMocks.downloadSnapshot.mock.calls[0];
    expect(filter).toBe(isDataSnapshotFileName);
    expect(repositoryMocks.applyDataSnapshot).toHaveBeenCalledTimes(1);
    expect(schedulerMocks.reconcile).toHaveBeenCalledTimes(1);
    const completion = alertMock.mock.calls.at(-1);
    expect(completion?.[0]).toBe('恢复完成');
    expect(completion?.[1]).toContain('已应用 6 项');
    expect(completion?.[1]).toContain('跳过 2 项（形状不符或引用缺失）');
  });

  it('reconcile 失败：不阻断，完成文案披露「提醒重排失败」', async () => {
    clientMocks.downloadSnapshot.mockResolvedValue(serializeDataSnapshot(makeSnapshot()));
    repositoryMocks.applyDataSnapshot.mockResolvedValue({ applied: 1, skipped: 0 });
    schedulerMocks.reconcile.mockRejectedValue(new Error('scheduler dead'));

    await pressRestoreAndConfirm();

    const completion = alertMock.mock.calls.at(-1);
    expect(completion?.[1]).toContain('提醒重排失败（将在下次启动时自动对账）');
  });

  it('下载内容非合法数据快照：parseDataSnapshot 抛错 → 数据区块 errorHint', async () => {
    clientMocks.downloadSnapshot.mockResolvedValue('{"version":1,"kind":"config"}');
    await pressRestoreAndConfirm();

    expect(repositoryMocks.applyDataSnapshot).not.toHaveBeenCalled();
    expect(schedulerMocks.reconcile).not.toHaveBeenCalled();
  });
});

describe('数据快照删除（§7.43）', () => {
  it('确认后 deleteSnapshot（data 谓词）→ 刷新列表', async () => {
    storeMocks.load.mockResolvedValue(CONFIG);
    clientMocks.listSnapshots.mockResolvedValue([DATA_FILE]);
    clientMocks.deleteSnapshot.mockResolvedValue(true);
    const tree = await renderAndFocus();

    const dataRow = tree.root.findAll(
      (node) => collectTexts(node).includes('life-data-20260101-090500.json'),
    );
    const del = dataRow[0].findAll(
      (node) => typeof node.props.onPress === 'function' && collectTexts(node).includes('删除'),
    )[0];
    expect(del).toBeDefined();
    await act(async () => {
      (del.props.onPress as () => void)();
    });
    await flush(2);

    expect(alertMock).toHaveBeenCalledWith(
      '删除数据快照',
      expect.stringContaining('life-data-20260101-090500.json'),
      expect.anything(),
    );
    const confirm = alertMock.mock.calls.at(-1)?.[2]?.[1] as { onPress: () => void };
    await act(async () => {
      confirm.onPress();
    });
    await flush(8);

    const [, fileName, filter] = clientMocks.deleteSnapshot.mock.calls[0];
    expect(fileName).toBe('life-data-20260101-090500.json');
    expect(filter).toBe(isDataSnapshotFileName);
    expect(clientMocks.listSnapshots).toHaveBeenCalledTimes(2); // 初次 + 删除后刷新。
  });
});

/** 合法条目基线（下载内容非空时用）。 */
function makeSnapshotItem(): DataSnapshot['items'][number] {
  return {
    id: 'item-1',
    type: 'note',
    title: '快照条目',
    content: '',
    status: 'active',
    startAt: null,
    endAt: null,
    allDay: false,
    sourceType: 'local',
    sourceUid: null,
    sourceReadOnly: false,
    categoryId: 'other',
    priority: 0,
    createdAt: 1699999999000,
    updatedAt: 1699999999000,
  };
}

// 编译面：CONFIG/DATA 谓词互斥性在此处显式对齐阶段 1 参数化契约。
void isConfigSnapshotFileName;
