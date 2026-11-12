import { NetworkTimerRegistry } from '../channels/networkTimers';
import type { NetworkTimerEntry, NetworkTimerRegistryDeps } from '../channels/networkTimers';
import { testReminder, TEST_NOW } from './channelTestSupport';

// setTimeout 越过 2^31-1 会被 Node/RN 截断，registry 必须续链重挂（设计约束）。
const MAX_TIMEOUT_MS = 2_147_483_647;

function entryFor(reminderId: string, fireAt: number): NetworkTimerEntry {
  return {
    reminderId,
    fireAt,
    reminder: testReminder(reminderId, 'i1', 'webhook', 'https://hook.example/x'),
  };
}

describe('NetworkTimerRegistry（切片 16 阶段 2）', () => {
  let nowMs: number;
  let fires: string[];

  function makeRegistry(onFireImpl?: (key: string) => void): NetworkTimerRegistry {
    const deps: NetworkTimerRegistryDeps = {
      now: () => nowMs,
      onFire: (key, _entry) => {
        if (onFireImpl) {
          onFireImpl(key);
          return;
        }
        fires.push(key);
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
    registry.replace('k1', entryFor('r1', TEST_NOW + 100));

    expect(registry.armedKeys()).toEqual(['k1']);

    nowMs = TEST_NOW + 100;
    jest.advanceTimersByTime(100);

    expect(fires).toEqual(['k1']);
    expect(registry.armedKeys()).toEqual([]);
  });

  it('replace 幂等重挂：同 key 不双发，配置刷新后按新时刻触发', () => {
    const registry = makeRegistry();
    registry.replace('k1', entryFor('r1', TEST_NOW + 100));
    registry.replace('k1', entryFor('r1', TEST_NOW + 200));

    nowMs = TEST_NOW + 200;
    jest.advanceTimersByTime(200);

    expect(fires).toEqual(['k1']);
    expect(registry.armedKeys()).toEqual([]);
  });

  it('cancel 与 cancelByReminder 撤销挂载', () => {
    const registry = makeRegistry();
    registry.replace('k1', entryFor('r1', TEST_NOW + 100));
    registry.replace('k2', entryFor('r1', TEST_NOW + 100));
    registry.replace('k3', entryFor('r2', TEST_NOW + 100));

    registry.cancel('k1');
    registry.cancelByReminder('r1');

    nowMs = TEST_NOW + 100;
    jest.advanceTimersByTime(100);

    expect(fires).toEqual(['k3']);
  });

  it('retainReminderKeys：仅保留列表内的本 reminder 定时器', () => {
    const registry = makeRegistry();
    registry.replace('k1', entryFor('r1', TEST_NOW + 100));
    registry.replace('k2', entryFor('r1', TEST_NOW + 100));
    registry.replace('k3', entryFor('r2', TEST_NOW + 100));

    registry.retainReminderKeys('r1', new Set(['k2']));

    nowMs = TEST_NOW + 100;
    jest.advanceTimersByTime(100);

    expect(fires).toEqual(['k2', 'k3']);
  });

  it('pruneExcept：期望集合外的全部取消', () => {
    const registry = makeRegistry();
    registry.replace('k1', entryFor('r1', TEST_NOW + 100));
    registry.replace('k2', entryFor('r1', TEST_NOW + 100));
    registry.replace('k3', entryFor('r2', TEST_NOW + 100));

    registry.pruneExcept(new Set(['k3']));

    nowMs = TEST_NOW + 100;
    jest.advanceTimersByTime(100);

    expect(fires).toEqual(['k3']);
    expect(registry.armedKeys()).toEqual([]);
  });

  it('clearTimers 清定时器但保留 attempts（进程生命周期语义）', () => {
    const registry = makeRegistry();
    registry.recordAttempt('k1', 'ok');
    registry.replace('k1', entryFor('r1', TEST_NOW + 100));

    registry.clearTimers();

    expect(registry.armedKeys()).toEqual([]);
    expect(registry.attemptStatus('k1')).toBe('ok');

    jest.advanceTimersByTime(1000);
    expect(fires).toEqual([]);
  });

  it('超过 MAX_TIMEOUT 的 fireAt 续链重挂：不提前触发，到点才触发', () => {
    const registry = makeRegistry();
    const far = TEST_NOW + MAX_TIMEOUT_MS + 5000;
    registry.replace('kFar', entryFor('r1', far));
    expect(registry.armedKeys()).toEqual(['kFar']);

    // 链上第一段 wake：fireAt 仍 > now → 续链，不触发。
    jest.advanceTimersByTime(MAX_TIMEOUT_MS);
    expect(fires).toEqual([]);
    expect(registry.armedKeys()).toEqual(['kFar']);

    // 第二段 wake：同样续链。
    jest.advanceTimersByTime(MAX_TIMEOUT_MS);
    expect(fires).toEqual([]);
    expect(registry.armedKeys()).toEqual(['kFar']);

    // 到点。
    nowMs = far;
    jest.runOnlyPendingTimers();
    expect(fires).toEqual(['kFar']);
    expect(registry.armedKeys()).toEqual([]);
  });

  it('onFire 抛错不冒泡（吞错记 warn）', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const registry = makeRegistry(() => {
      throw new Error('boom');
    });
    registry.replace('k1', entryFor('r1', TEST_NOW + 10));

    nowMs = TEST_NOW + 10;
    expect(() => jest.advanceTimersByTime(10)).not.toThrow();
    expect(registry.armedKeys()).toEqual([]);

    warnSpy.mockRestore();
  });

  it('attemptStatus：未记录返回 null，记录后返回状态', () => {
    const registry = makeRegistry();
    expect(registry.attemptStatus('kX')).toBeNull();
    registry.recordAttempt('kX', 'failed');
    expect(registry.attemptStatus('kX')).toBe('failed');
  });
});
