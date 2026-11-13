import { WebhookChannel } from '../channels/WebhookChannel';
import { NetworkTimerRegistry, networkTimerKey } from '../channels/networkTimers';
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
    expect(registry.attemptStatus('webhook', 'once:rW:123')).toBe('ok');
  });

  it('deliver：非 2xx 返回 failed 并记录 attempt，不抛出', async () => {
    const repository = stubRepositoryWith(testItem('iW', '标题丙'));
    const channel = new WebhookChannel(makeDeps(repository));
    const reminder = testReminder('rW', 'iW', 'webhook', 'https://hook.example/bad');
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);

    const status = await channel.deliver(reminder, 'once:rW:500', TEST_NOW);

    expect(status).toBe('failed');
    expect(registry.attemptStatus('webhook', 'once:rW:500')).toBe('failed');
  });

  it('deliver：fetch 抛错（网络不可达）返回 failed，不抛出', async () => {
    const repository = stubRepositoryWith(testItem('iW', '标题丙'));
    const channel = new WebhookChannel(makeDeps(repository));
    const reminder = testReminder('rW', 'iW', 'webhook', 'https://hook.example/down');
    fetchMock.mockRejectedValue(new TypeError('network down'));

    const status = await channel.deliver(reminder, 'once:rW:down', TEST_NOW);

    expect(status).toBe('failed');
    expect(registry.attemptStatus('webhook', 'once:rW:down')).toBe('failed');
  });

  it('deliver：channelConfig 为空白时返回 failed 且不发起 fetch', async () => {
    const repository = stubRepositoryWith(testItem('iW', '标题丙'));
    const channel = new WebhookChannel(makeDeps(repository));
    const reminder = testReminder('rW', 'iW', 'webhook', '   ');

    const status = await channel.deliver(reminder, 'once:rW:nourl', TEST_NOW);

    expect(status).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(registry.attemptStatus('webhook', 'once:rW:nourl')).toBe('failed');
  });

  it('deliver：item 缺失时返回 failed 且不发起 fetch', async () => {
    const repository = stubRepositoryWith(null);
    const channel = new WebhookChannel(makeDeps(repository));
    const reminder = testReminder('rW', 'iW', 'webhook', 'https://hook.example/hi');

    const status = await channel.deliver(reminder, 'once:rW:noitem', TEST_NOW);

    expect(status).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(registry.attemptStatus('webhook', 'once:rW:noitem')).toBe('failed');
  });

  it('schedule/cancel 只操作内存定时器，不发起 fetch', async () => {
    const repository = stubRepositoryWith(testItem('iW', '标题丙'));
    const channel = new WebhookChannel(makeDeps(repository));
    const reminder = testReminder('rW', 'iW', 'webhook', 'https://hook.example/hi');

    await channel.schedule(reminder, 'once:rW:future', TEST_NOW + 1000);
    expect(registry.armedKeys()).toEqual([networkTimerKey('webhook', 'once:rW:future')]);

    await channel.cancel('rW');
    expect(registry.armedKeys()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('WebhookChannel 载荷适配（切片 17 阶段 1，AGENTS.md §7.27）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registry = new NetworkTimerRegistry({ now: () => TEST_NOW, onFire: () => undefined });
  });

  afterEach(() => {
    registry.clearTimers();
  });

  it('json 模式自定义 payloadTemplate：string 叶子替换、结构保留、标量透传，整体 JSON.stringify', async () => {
    const repository = stubRepositoryWith(testItem('iW', '标题丙'));
    const channel = new WebhookChannel(makeDeps(repository));
    const reminder = testReminder(
      'rW',
      'iW',
      'webhook',
      JSON.stringify({
        url: 'https://hook.example/json',
        mode: 'json',
        payloadTemplate: {
          msgtype: 'text',
          text: { content: '{{title}}\n{{body}}' },
          key: '{{occurrenceKey}}',
          at: { isAtAll: false },
          count: 3,
        },
      }),
    );
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);

    const status = await channel.deliver(reminder, 'daily:rW:42', TEST_NOW);

    expect(status).toBe('ok');
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse((init?.body ?? '') as string)).toEqual({
      msgtype: 'text',
      text: { content: '标题丙\n测试内容' },
      key: 'daily:rW:42',
      at: { isAtAll: false },
      count: 3,
    });
  });

  it('form 模式（Zulip external/zulip 形态）：默认表单头、URLSearchParams 编码、headers 可覆盖', async () => {
    const repository = stubRepositoryWith(testItem('iW', '标题丙'));
    const channel = new WebhookChannel(makeDeps(repository));
    const reminder = testReminder(
      'rW',
      'iW',
      'webhook',
      JSON.stringify({
        url: 'https://zulip.example/api/v1/external/zulip',
        mode: 'form',
        payloadTemplate: { type: 'stream', topic: '{{title}}', content: '{{body}}' },
      }),
    );
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);

    const status = await channel.deliver(reminder, 'once:rW:form', TEST_NOW);

    expect(status).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://zulip.example/api/v1/external/zulip');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    const params = new URLSearchParams((init?.body ?? '') as string);
    expect(params.get('type')).toBe('stream');
    expect(params.get('topic')).toBe('标题丙');
    expect(params.get('content')).toBe('测试内容');
  });

  it('text 模式：默认纯文本头、{{var}} 渲染后作为原始 body', async () => {
    const repository = stubRepositoryWith(testItem('iW', '标题丙'));
    const channel = new WebhookChannel(makeDeps(repository));
    const reminder = testReminder(
      'rW',
      'iW',
      'webhook',
      JSON.stringify({
        url: 'https://hook.example/text',
        mode: 'text',
        payloadTemplate: '[{{title}}] {{content}}',
      }),
    );
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);

    const status = await channel.deliver(reminder, 'once:rW:text', TEST_NOW);

    expect(status).toBe('ok');
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toEqual({ 'Content-Type': 'text/plain; charset=utf-8' });
    expect(init?.body).toBe('[标题丙] 测试内容');
  });

  it('config.headers 覆盖 mode 默认头（键合并，同键以 config 为准）', async () => {
    const repository = stubRepositoryWith(testItem('iW', '标题丙'));
    const channel = new WebhookChannel(makeDeps(repository));
    const reminder = testReminder(
      'rW',
      'iW',
      'webhook',
      JSON.stringify({
        url: 'https://hook.example/headers',
        mode: 'json',
        payloadTemplate: '{{title}}',
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Token': 't1' },
      }),
    );
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);

    await channel.deliver(reminder, 'once:rW:hdr', TEST_NOW);

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toEqual({
      'Content-Type': 'application/json; charset=utf-8',
      'X-Token': 't1',
    });
  });

  it('新形态非法配置（mode 枚举外）→ failed 且不发起 fetch，不抛出', async () => {
    const repository = stubRepositoryWith(testItem('iW', '标题丙'));
    const channel = new WebhookChannel(makeDeps(repository));
    const reminder = testReminder(
      'rW',
      'iW',
      'webhook',
      JSON.stringify({ url: 'https://hook.example/x', mode: 'graphql' }),
    );

    const status = await channel.deliver(reminder, 'once:rW:badmode', TEST_NOW);

    expect(status).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(registry.attemptStatus('webhook', 'once:rW:badmode')).toBe('failed');
  });

  it('旧形态纯 URL 与新形态 JSON 配置可共存（同一存量库混用零回归）', async () => {
    const repository = stubRepositoryWith(testItem('iW', '标题丙'));
    const channel = new WebhookChannel(makeDeps(repository));
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);

    const legacy = testReminder('rL', 'iW', 'webhook', 'https://hook.example/legacy');
    const modern = testReminder(
      'rM',
      'iW',
      'webhook',
      JSON.stringify({ url: 'https://hook.example/modern', payloadTemplate: { k: '{{itemId}}' } }),
    );
    await channel.deliver(legacy, 'once:rL:1', TEST_NOW);
    await channel.deliver(modern, 'once:rM:1', TEST_NOW);

    const [legacyUrl, legacyInit] = fetchMock.mock.calls[0];
    const [modernUrl] = fetchMock.mock.calls[1];
    expect(legacyUrl).toBe('https://hook.example/legacy');
    expect(legacyInit?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse((legacyInit?.body ?? '') as string)).toMatchObject({
      type: 'life-reminder',
      occurrenceKey: 'once:rL:1',
    });
    expect(modernUrl).toBe('https://hook.example/modern');
  });
});
