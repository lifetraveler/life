import { AppriseChannel } from '../channels/AppriseChannel';
import { NetworkTimerRegistry, networkTimerKey } from '../channels/networkTimers';
import type { NetworkChannelDeps } from '../channels/types';
import { stubRepositoryWith, testItem, testReminder, TEST_NOW } from './channelTestSupport';

const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
let registry: NetworkTimerRegistry;

function makeDeps(): NetworkChannelDeps {
  return {
    repository: stubRepositoryWith(testItem('iA', '标题丙')),
    registry,
    fetchImpl: fetchMock,
    now: () => TEST_NOW,
  };
}

function reminderWithConfig(configJson: string | null) {
  return testReminder('rA', 'iA', 'apprise', configJson);
}

describe('AppriseChannel（切片 16 阶段 2）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registry = new NetworkTimerRegistry({ now: () => TEST_NOW, onFire: () => undefined });
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
  });

  afterEach(() => {
    registry.clearTimers();
  });

  it('deliver：key 配置 → POST {base}/notify/{key}，body 含 title/body/type', async () => {
    const channel = new AppriseChannel(makeDeps());
    const reminder = reminderWithConfig(
      JSON.stringify({ baseUrl: 'http://apprise.local:8000/', key: 'secret-key' }),
    );

    const status = await channel.deliver(reminder, 'once:rA:key', TEST_NOW);

    expect(status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://apprise.local:8000/notify/secret-key');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    const payload = JSON.parse((init?.body ?? '') as string);
    expect(payload).toEqual({ title: '标题丙', body: '测试内容', type: 'info' });
  });

  it('deliver：urls 配置 → POST {base}/notify，body 附 urls 数组', async () => {
    const channel = new AppriseChannel(makeDeps());
    const reminder = reminderWithConfig(
      JSON.stringify({
        baseUrl: 'http://apprise.local',
        urls: ['mailto://user@host', 'tgram://token/chat'],
      }),
    );

    const status = await channel.deliver(reminder, 'once:rA:urls', TEST_NOW);

    expect(status).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://apprise.local/notify');
    const payload = JSON.parse((init?.body ?? '') as string);
    expect(payload).toEqual({
      title: '标题丙',
      body: '测试内容',
      type: 'info',
      urls: ['mailto://user@host', 'tgram://token/chat'],
    });
  });

  it('deliver：urls 为单个字符串时归一为数组', async () => {
    const channel = new AppriseChannel(makeDeps());
    const reminder = reminderWithConfig(
      JSON.stringify({ baseUrl: 'http://apprise.local', urls: 'mailto://user@host' }),
    );

    const status = await channel.deliver(reminder, 'once:rA:url1', TEST_NOW);

    expect(status).toBe('ok');
    const payload = JSON.parse((fetchMock.mock.calls[0][1]?.body ?? '') as string);
    expect(payload.urls).toEqual(['mailto://user@host']);
  });

  it('deliver：非法 JSON 配置返回 failed 且不发起 fetch', async () => {
    const channel = new AppriseChannel(makeDeps());
    const reminder = reminderWithConfig('not-json');

    const status = await channel.deliver(reminder, 'once:rA:bad', TEST_NOW);

    expect(status).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(registry.attemptStatus('apprise', 'once:rA:bad')).toBe('failed');
  });

  it('deliver：channelConfig 缺失返回 failed 且不发起 fetch', async () => {
    const channel = new AppriseChannel(makeDeps());
    const reminder = reminderWithConfig(null);

    const status = await channel.deliver(reminder, 'once:rA:none', TEST_NOW);

    expect(status).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deliver：非 2xx 返回 failed', async () => {
    const channel = new AppriseChannel(makeDeps());
    const reminder = reminderWithConfig(JSON.stringify({ baseUrl: 'http://apprise.local', key: 'k' }));
    fetchMock.mockResolvedValue({ ok: false, status: 502 } as Response);

    const status = await channel.deliver(reminder, 'once:rA:502', TEST_NOW);

    expect(status).toBe('failed');
    expect(registry.attemptStatus('apprise', 'once:rA:502')).toBe('failed');
  });

  it('schedule/cancel 只操作内存定时器，不发起 fetch', async () => {
    const channel = new AppriseChannel(makeDeps());
    const reminder = reminderWithConfig(JSON.stringify({ baseUrl: 'http://apprise.local', key: 'k' }));

    await channel.schedule(reminder, 'once:rA:future', TEST_NOW + 1000);
    expect(registry.armedKeys()).toEqual([networkTimerKey('apprise', 'once:rA:future')]);

    await channel.cancel('rA');
    expect(registry.armedKeys()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
