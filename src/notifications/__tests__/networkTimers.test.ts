import {
  NetworkTimerRegistry,
  networkTimerKey,
} from '../channels/networkTimers';
import type { NetworkTimerEntry, NetworkTimerRegistryDeps } from '../channels/networkTimers';
import { testReminder, TEST_NOW } from './channelTestSupport';

// setTimeout 越过 2^31-1 会被 Node/RN 截断，registry 必须续链重挂（设计约束）。
const MAX_TIMEOUT_MS = 2_147_483_647;

function entryFor(
  channelId: 'webhook' | 'apprise',
  reminderId: string,
  fireAt: number,
): NetworkTimerEntry {
  return {
    reminderId,
    fireAt,
    reminder: testReminder(reminderId, 'i1', channelId, 'https://hook.example/x'),
    channelId,
  };
}

describe('NetworkTimerRegistry（切片 16 阶段 2 / 切片 18 复合键）', () => {
  let nowMs: number;
  let fires: string[];

  function makeRegistry(
    onFireImpl?: (channelId: string, occurrenceKey: string) => void,
  ): NetworkTimerRegistry {
    const deps: NetworkTimerRegistryDeps = {
      now: () => nowMs,
      onFire: (channelId, occurrenceKey, _entry) => {
        if (onFireImpl) {
          onFireImpl(channelId, occurrenceKey);
          return;
        }
        fires.push(networkTimerKey(channelId, occurrenceKey));
      },
    };
    return new NetworkTimerRegistry(deps);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    nowMs = TEST_NOW;
    fires = [];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('到点触发 onFire 并移除挂载', () => {
    const registry = makeRegistry();
    registry.replace('webhook', 'k1', entryFor('webhook', 'r1', TEST_NOW + 100));

    expect(registry.armedKeys()).toEqual([networkTimerKey('webhook', 'k1')]);

    nowMs = TEST_NOW + 100;
    jest.advanceTimersByTime(100);

    expect(fires).toEqual([networkTimerKey('webhook', 'k1')]);
    expect(registry.armedKeys()).toEqual([]);
  });

  it('replace 幂等重挂：同复合键不双发，配置刷新后按新时刻触发', () => {
    const registry = makeRegistry();
    registry.replace('webhook', 'k1', entryFor('webhook', 'r1', TEST_NOW + 100));
    registry.replace('webhook', 'k1', entryFor('webhook', 'r1', TEST_NOW + 200));

    nowMs = TEST_NOW + 200;
    jest.advanceTimersByTime(200);

    expect(fires).toEqual([networkTimerKey('webhook', 'k1')]);
    expect(registry.armedKeys()).toEqual([]);
  });

  it('切片 18：同 occurrenceKey 在两个渠道下并存（复合键根治 slice-16 单键覆盖缺陷）', () => {
    const registry = makeRegistry();
    registry.replace('webhook', 'k1', entryFor('webhook', 'r1', TEST_NOW + 100));
    registry.replace('apprise', 'k1', entryFor('apprise', 'r1', TEST_NOW + 100));

    // 两次 replace 各自保留：armedKeys 同时含 webhook|k1 与 apprise|k1。
    expect(registry.armedKeys()).toEqual([
      networkTimerKey('webhook', 'k1'),
      networkTimerKey('apprise', 'k1'),
    ]);

    nowMs = TEST_NOW + 100;
    jest.advanceTimersByTime(100);

    expect(fires).toEqual([networkTimerKey('webhook', 'k1'), networkTimerKey('apprise', 'k1')]);
  });

  it('cancel 与 cancelByReminder 撤销挂载', () => {
    const registry = makeRegistry();
    registry.replace('webhook', 'k1', entryFor('webhook', 'r1', TEST_NOW + 100));
    registry.replace('webhook', 'k2', entryFor('webhook', 'r1', TEST_NOW + 100));
    registry.replace('webhook', 'k3', entryFor('webhook', 'r2', TEST_NOW + 100));

    registry.cancel('webhook', 'k1');
    registry.cancelByReminder('r1');

    nowMs = TEST_NOW + 100;
    jest.advanceTimersByTime(100);

    expect(fires).toEqual([networkTimerKey('webhook', 'k3')]);
  });

  it('retainReminderKeys：仅保留期望复合键集合内的本 reminder 定时器', () => {
    const registry = makeRegistry();
    registry.replace('webhook', 'k1', entryFor('webhook', 'r1', TEST_NOW + 100));
    registry.replace('webhook', 'k2', entryFor('webhook', 'r1', TEST_NOW + 100));
    registry.replace('apprise', 'k2', entryFor('apprise', 'r1', TEST_NOW + 100));

    // 期望集合按复合键给出：webhook|k2 与 apprise|k2 保留，webhook|k1 清除。
    registry.retainReminderKeys(
      'r1',
      new Set([networkTimerKey('webhook', 'k2'), networkTimerKey('apprise', 'k2')]),
    );

    nowMs = TEST_NOW + 100;
    jest.advanceTimersByTime(100);

    expect(fires).toEqual([networkTimerKey('webhook', 'k2'), networkTimerKey('apprise', 'k2')]);
  });

  it('retainReminderKeys 不影响其他 reminder 的定时器', () => {
    const registry = makeRegistry();
    registry.replace('webhook', 'k1', entryFor('webhook', 'r1', TEST_NOW + 100));
    registry.replace('webhook', 'k3', entryFor('webhook', 'r2', TEST_NOW + 100));

    registry.retainReminderKeys('r1', new Set([networkTimerKey('webhook', 'k1')]));

    nowMs = TEST_NOW + 100;
    jest.advanceTimersByTime(100);

    expect(fires).toEqual([networkTimerKey('webhook', 'k1'), networkTimerKey('webhook', 'k3')]);
  });

  it('pruneExcept：期望复合键集合外的全部取消', () => {
    const registry = makeRegistry();
    registry.replace('webhook', 'k1', entryFor('webhook', 'r1', TEST_NOW + 100));
    registry.replace('webhook', 'k2', entryFor('webhook', 'r1', TEST_NOW + 100));
    registry.replace('apprise', 'k3', entryFor('apprise', 'r2', TEST_NOW + 100));

    registry.pruneExcept(new Set([networkTimerKey('apprise', 'k3')]));

    nowMs = TEST_NOW + 100;
    jest.advanceTimersByTime(100);

    expect(fires).toEqual([networkTimerKey('apprise', 'k3')]);
    expect(registry.armedKeys()).toEqual([]);
  });

  it('clearTimers 清定时器但保留 attempts（进程生命周期语义）', () => {
    const registry = makeRegistry();
    registry.recordAttempt('webhook', 'k1', 'ok');
    registry.replace('webhook', 'k1', entryFor('webhook', 'r1', TEST_NOW + 100));

    registry.clearTimers();

    expect(registry.armedKeys()).toEqual([]);
    expect(registry.attemptStatus('webhook', 'k1')).toBe('ok');

    jest.advanceTimersByTime(1000);
    expect(fires).toEqual([]);
  });

  it('超过 MAX_TIMEOUT 的 fireAt 续链重挂：不提前触发，到点才触发', () => {
    const registry = makeRegistry();
    const far = TEST_NOW + MAX_TIMEOUT_MS + 5000;
    registry.replace('webhook', 'kFar', entryFor('webhook', 'r1', far));
    expect(registry.armedKeys()).toEqual([networkTimerKey('webhook', 'kFar')]);

    // 链上第一段 wake：fireAt 仍 > now → 续链，不触发。
    jest.advanceTimersByTime(MAX_TIMEOUT_MS);
    expect(fires).toEqual([]);
    expect(registry.armedKeys()).toEqual([networkTimerKey('webhook', 'kFar')]);

    // 第二段 wake：同样续链。
    jest.advanceTimersByTime(MAX_TIMEOUT_MS);
    expect(fires).toEqual([]);
    expect(registry.armedKeys()).toEqual([networkTimerKey('webhook', 'kFar')]);

    // 到点。
    nowMs = far;
    jest.runOnlyPendingTimers();
    expect(fires).toEqual([networkTimerKey('webhook', 'kFar')]);
    expect(registry.armedKeys()).toEqual([]);
  });

  it('onFire 抛错不冒泡（吞错记 warn）', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const registry = makeRegistry(() => {
      throw new Error('boom');
    });
    registry.replace('webhook', 'k1', entryFor('webhook', 'r1', TEST_NOW + 10));

    nowMs = TEST_NOW + 10;
    expect(() => jest.advanceTimersByTime(10)).not.toThrow();
    expect(registry.armedKeys()).toEqual([]);

    warnSpy.mockRestore();
  });

  it('attemptStatus 按渠道独立：未记录返回 null，记录后返回状态，渠道间互不串扰', () => {
    const registry = makeRegistry();
    expect(registry.attemptStatus('webhook', 'kX')).toBeNull();
    expect(registry.attemptStatus('apprise', 'kX')).toBeNull();
    registry.recordAttempt('webhook', 'kX', 'ok');
    registry.recordAttempt('apprise', 'kX', 'failed');
    expect(registry.attemptStatus('webhook', 'kX')).toBe('ok');
    expect(registry.attemptStatus('apprise', 'kX')).toBe('failed');
  });
});
