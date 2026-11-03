import type { NotificationResponse } from 'expo-notifications';

const mockNavigate = jest.fn();
const mockAddListener = jest.fn();
const mockGetLast = jest.fn();

jest.mock('expo-router', () => ({
  router: { navigate: mockNavigate },
}));

jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: mockAddListener,
  getLastNotificationResponse: mockGetLast,
}));

function makeResponse(itemId: string, identifier: string): NotificationResponse {
  return {
    notification: {
      request: {
        identifier,
        content: { data: { itemId, occurrenceKey: identifier, reminderId: 'r-x' } },
      },
    },
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
  } as unknown as NotificationResponse;
}

type NotificationResponseModule = typeof import('../notificationResponse');

/** 每个用例拿一份全新模块实例：pending / navigationReady / 去重窗状态互不串扰 */
function freshModule(): NotificationResponseModule {
  let mod: NotificationResponseModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../notificationResponse') as NotificationResponseModule;
  });
  if (!mod) {
    throw new Error('freshModule: 模块加载失败');
  }
  return mod;
}

beforeEach(() => {
  // mockReset（而非 mockClear）：清除重试用例设置的 implementation，避免跨用例污染
  mockNavigate.mockReset();
  mockAddListener.mockClear();
  mockGetLast.mockReset();
});

describe('notificationResponseRouting（切片 6 §4.26）', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('冷启动 + 导航未就绪：启动响应暂存 pending，导航就绪后冲刷', () => {
    mockGetLast.mockReturnValue(makeResponse('i1', 'key-1'));
    const mod = freshModule();

    mod.registerNotificationResponseRouting();
    expect(mockNavigate).not.toHaveBeenCalled();

    mod.markNotificationNavigationReady();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/item/i1');
  });

  it('冷启动 + router 暂未 ready（真机实测时序）：冲刷失败保留 pending，重试至成功', () => {
    jest.useFakeTimers();
    mockGetLast.mockReturnValue(makeResponse('i-retry', 'key-retry'));
    const mod = freshModule();

    // 前 2 次 navigate 抛“未就绪”，之后恢复（模拟 router 就绪翻转）
    mockNavigate
      .mockImplementationOnce(() => {
        throw new Error('Attempted to navigate before mounting the Root Layout component.');
      })
      .mockImplementationOnce(() => {
        throw new Error('Attempted to navigate before mounting the Root Layout component.');
      });

    mod.registerNotificationResponseRouting();
    mod.markNotificationNavigationReady(); // 第一次冲刷：navigate 抛错 → 保留 pending + 计划重试
    expect(mockNavigate).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(100); // 第 1 次重试：仍抛错
    expect(mockNavigate).toHaveBeenCalledTimes(2);
    expect(mod).toBeDefined();

    jest.advanceTimersByTime(100); // 第 2 次重试：成功
    expect(mockNavigate).toHaveBeenCalledTimes(3);
    expect(mockNavigate).toHaveBeenLastCalledWith('/item/i-retry');
  });

  it('重试超限：放弃冲刷并告警，不再无限重试', () => {
    jest.useFakeTimers();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetLast.mockReturnValue(makeResponse('i-dead', 'key-dead'));
    const mod = freshModule();

    mockNavigate.mockImplementation(() => {
      throw new Error('Attempted to navigate before mounting the Root Layout component.');
    });

    mod.registerNotificationResponseRouting();
    mod.markNotificationNavigationReady();
    jest.advanceTimersByTime(100 * 100); // 上限 50 次 + 初次
    expect(warnSpy).toHaveBeenCalledWith('[slice-06] 通知点击导航重试超限，放弃冲刷', 'i-dead');
    warnSpy.mockRestore();
  });

  it('冷启动 + 导航已就绪：启动响应立即跳转', () => {
    mockGetLast.mockReturnValue(makeResponse('i2', 'key-2'));
    const mod = freshModule();

    mod.markNotificationNavigationReady();
    mod.registerNotificationResponseRouting();
    expect(mockNavigate).toHaveBeenCalledWith('/item/i2');
  });

  it('前台/后台 listener：就绪时直接跳转，data 无 itemId 时忽略', () => {
    mockGetLast.mockReturnValue(null);
    const mod = freshModule();
    mod.markNotificationNavigationReady();
    mod.registerNotificationResponseRouting();

    const handler = mockAddListener.mock.calls[0][0] as (response: NotificationResponse) => void;
    handler(makeResponse('i3', 'key-3'));
    expect(mockNavigate).toHaveBeenCalledWith('/item/i3');

    mockNavigate.mockClear();
    const broken = makeResponse('i4', 'key-4');
    // data 契约缺失（无 itemId）：仅模拟字段缺失
    (broken.notification.request.content.data as Record<string, unknown>) = {};
    handler(broken);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('listener 在导航未就绪时触发：暂存，就绪后冲刷', () => {
    mockGetLast.mockReturnValue(null);
    const mod = freshModule();
    mod.registerNotificationResponseRouting();

    const handler = mockAddListener.mock.calls[0][0] as (response: NotificationResponse) => void;
    handler(makeResponse('i5', 'key-5'));
    expect(mockNavigate).not.toHaveBeenCalled();

    mod.markNotificationNavigationReady();
    expect(mockNavigate).toHaveBeenCalledWith('/item/i5');
  });

  it('同一 identifier 在去重窗内重复投递只跳一次；不同 identifier 各跳一次', () => {
    mockGetLast.mockReturnValue(null);
    const mod = freshModule();
    mod.markNotificationNavigationReady();
    mod.registerNotificationResponseRouting();

    const handler = mockAddListener.mock.calls[0][0] as (response: NotificationResponse) => void;
    handler(makeResponse('i6', 'key-6'));
    handler(makeResponse('i6', 'key-6'));
    expect(mockNavigate).toHaveBeenCalledTimes(1);

    handler(makeResponse('i6', 'key-7'));
    expect(mockNavigate).toHaveBeenCalledTimes(2);
  });

  it('markNotificationNavigationReady 幂等：无 pending 时重复调用不产生多余跳转', () => {
    const mod = freshModule();
    mod.markNotificationNavigationReady();
    mod.markNotificationNavigationReady();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
