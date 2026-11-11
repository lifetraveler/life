import { WebhookChannel } from '../channels/WebhookChannel';
import { NetworkTimerRegistry } from '../channels/networkTimers';
import type { NetworkChannelDeps } from '../channels/types';
import type { ItemRepository } from '../../data/ItemRepository';
import { stubRepositoryWith, testItem, testReminder, TEST_NOW } from './channelTestSupport';

const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
let registry: NetworkTimerRegistry;

function makeDeps(repository: ItemRepository): NetworkChannelDeps {
  return {
    repository,
    registry,
    fetchImpl: fetchMock,
    now: () => TEST_NOW,
  };
}

describe('WebhookChannel（切片 16 阶段 2）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registry = new NetworkTimerRegistry({ now: () => TEST_NOW, onFire: () => undefined });
  });

  afterEach(() => {
    registry.clearTimers();
  });

  it('deliver：POST JSON payload 到 channelConfig URL，2xx 返回 ok 并记录 attempt', async () => {
    const item = testItem('iW', '标题丙');
    const repository = stubRepositoryWith(item);
    const channel = new WebhookChannel(makeDeps(repository));
    const reminder = testReminder('rW', 'iW', 'webhook', 'https://hook.example/hi');
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);

    const status = await channel.deliver(reminder, 'once:rW:123', TEST_NOW);

    expect(status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hook.example/hi');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    const payload = JSON.parse((init?.body ?? '') as string);
    expect(payload).toEqual({
      type: 'life-reminder',
      occurrenceKey: 'once:rW:123',
      reminderId: 'rW',
      itemId: 'iW',
      title: '标题丙',
      body: '测试内容',
      fireAt: TEST_NOW,
      sentAt: TEST_NOW,
    });
    expect(registry.attemptStatus('once:rW:123')).toBe('ok');
  });

  it('deliver：非 2xx 返回 failed 并记录 attempt，不抛出', async () => {
    const repository = stubRepositoryWith(testItem('iW', '标题丙'));
    const channel = new WebhookChannel(makeDeps(repository));
    const reminder = testReminder('rW', 'iW', 'webhook', 'https://hook.example/bad');
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);

    const status = await channel.deliver(reminder, 'once:rW:500', TEST_NOW);

    expect(status).toBe('failed');
    expect(registry.attemptStatus('once:rW:500')).toBe('failed');
  });

  it('deliver：fetch 抛错（网络不可达）返回 failed，不抛出', async () => {
    const repository = stubRepositoryWith(testItem('iW', '标题丙'));
    const channel = new WebhookChannel(makeDeps(repository));
    const reminder = testReminder('rW', 'iW', 'webhook', 'https://hook.example/down');
    fetchMock.mockRejectedValue(new TypeError('network down'));

    const status = await channel.deliver(reminder, 'once:rW:down', TEST_NOW);

    expect(status).toBe('failed');
    expect(registry.attemptStatus('once:rW:down')).toBe('failed');
  });

  it('deliver：channelConfig 为空白时返回 failed 且不发起 fetch', async () => {
    const repository = stubRepositoryWith(testItem('iW', '标题丙'));
    const channel = new WebhookChannel(makeDeps(repository));
    const reminder = testReminder('rW', 'iW', 'webhook', '   ');

    const status = await channel.deliver(reminder, 'once:rW:nourl', TEST_NOW);

    expect(status).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(registry.attemptStatus('once:rW:nourl')).toBe('failed');
  });

  it('deliver：item 缺失时返回 failed 且不发起 fetch', async () => {
    const repository = stubRepositoryWith(null);
    const channel = new WebhookChannel(makeDeps(repository));
    const reminder = testReminder('rW', 'iW', 'webhook', 'https://hook.example/hi');

    const status = await channel.deliver(reminder, 'once:rW:noitem', TEST_NOW);

    expect(status).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(registry.attemptStatus('once:rW:noitem')).toBe('failed');
  });

  it('schedule/cancel 只操作内存定时器，不发起 fetch', async () => {
    const repository = stubRepositoryWith(testItem('iW', '标题丙'));
    const channel = new WebhookChannel(makeDeps(repository));
    const reminder = testReminder('rW', 'iW', 'webhook', 'https://hook.example/hi');

    await channel.schedule(reminder, 'once:rW:future', TEST_NOW + 1000);
    expect(registry.armedKeys()).toEqual(['once:rW:future']);

    await channel.cancel('rW');
    expect(registry.armedKeys()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
