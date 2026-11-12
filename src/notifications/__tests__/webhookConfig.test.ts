import { parseWebhookChannelConfig, type WebhookChannelConfig } from '../channels/webhookConfig';

/**
 * 切片 17 阶段 1：Webhook 渠道配置守卫单测（AGENTS.md §7.27 Webhook 载荷适配）。
 * 覆盖：旧形态兼容读（非 JSON / 非 JSON 对象 → 整串当 URL）、新形态逐字段校验、
 * mode 枚举、headers 校验、payloadTemplate 按 mode 配套、空配置抛错。
 */

function expectWebhookError(raw: string | null, contains: string): void {
  expect(() => parseWebhookChannelConfig(raw)).toThrow(contains);
}

describe('parseWebhookChannelConfig（切片 17 阶段 1）', () => {
  describe('旧形态兼容读（切片 16 存量配置零行为变化）', () => {
    it('非 JSON 整串 → 视为 URL，mode json，无自定义 headers', () => {
      const config = parseWebhookChannelConfig('https://hook.example/hi');
      expect(config).toEqual({
        mode: 'json',
        url: 'https://hook.example/hi',
        headers: {},
        payloadTemplate: undefined,
      });
    });

    it('URL 两侧空白 → trim 后作为 URL', () => {
      const config = parseWebhookChannelConfig('  https://hook.example/trim  ');
      expect(config.mode).toBe('json');
      expect((config as Extract<WebhookChannelConfig, { mode: 'json' }>).url).toBe(
        'https://hook.example/trim',
      );
    });

    it('JSON.parse 失败但长得像 JSON（残缺 JSON）→ 仍按 URL 处理', () => {
      const config = parseWebhookChannelConfig('https://hook.example/?x={"a":1');
      expect(config.mode).toBe('json');
      expect((config as Extract<WebhookChannelConfig, { mode: 'json' }>).url).toBe(
        'https://hook.example/?x={"a":1',
      );
    });

    it('合法 JSON 但不是对象（裸字符串/数组/数字）→ 整串文本不是 http URL → 抛明确错误', () => {
      // JSON.parse('"https://x"') 的「解析值」是合法 URL，但兼容规则以整串原文为准，
      // 原文含引号不是 http URL → 抛错；JSON 形态只认对象（url 必填字段走新形态校验）。
      expectWebhookError('"https://hook.example/quoted"', 'must be an http(s) URL or a JSON config object');
      expectWebhookError('["https://hook.example/arr"]', 'must be an http(s) URL or a JSON config object');
      expectWebhookError('123', 'must be an http(s) URL or a JSON config object');
    });

    it('旧形态非 http(s) 串 → 抛错（与切片 16 空 URL 语义一致：URL 可解析但不可用）', () => {
      expectWebhookError('ftp://hook.example/x', 'must be an http(s) URL or a JSON config object');
      expectWebhookError('not a url at all', 'must be an http(s) URL or a JSON config object');
    });
  });

  describe('空/空白配置', () => {
    it('null 与纯空白 → 抛错', () => {
      expectWebhookError(null, 'reminder.channelConfig is empty');
      expectWebhookError('   ', 'reminder.channelConfig is empty');
    });
  });

  describe('新形态：url 校验', () => {
    it('url 必填且 http(s)', () => {
      expectWebhookError(JSON.stringify({ mode: 'json' }), 'channelConfig.url must be a non-empty string');
      expectWebhookError(JSON.stringify({ url: '' }), 'channelConfig.url must be a non-empty string');
      expectWebhookError(JSON.stringify({ url: 'ftp://x' }), 'must start with http:// or https://');
    });

    it('url 两侧空白 trim', () => {
      const config = parseWebhookChannelConfig(JSON.stringify({ url: '  https://hook.example/u  ' }));
      expect((config as Extract<WebhookChannelConfig, { mode: 'json' }>).url).toBe(
        'https://hook.example/u',
      );
    });
  });

  describe('新形态：mode 校验', () => {
    it('mode 缺省 → json', () => {
      const config = parseWebhookChannelConfig(JSON.stringify({ url: 'https://hook.example/m' }));
      expect(config.mode).toBe('json');
    });

    it('mode 枚举外 → 抛错', () => {
      expectWebhookError(
        JSON.stringify({ url: 'https://hook.example/m', mode: 'graphql' }),
        'channelConfig.mode must be one of json / form / text',
      );
      expectWebhookError(
        JSON.stringify({ url: 'https://hook.example/m', mode: 3 }),
        'channelConfig.mode must be one of json / form / text',
      );
    });
  });

  describe('新形态：headers 校验', () => {
    it('headers 缺省 → 空对象；键值保留原文（不 trim 落库值）', () => {
      const config = parseWebhookChannelConfig(
        JSON.stringify({
          url: 'https://hook.example/h',
          headers: { 'X-Token': ' abc ' },
        }),
      );
      expect(config.headers).toEqual({ 'X-Token': ' abc ' });
    });

    it('headers 非对象 / 空 key / 非字符串或空白 value → 抛错', () => {
      expectWebhookError(
        JSON.stringify({ url: 'https://hook.example/h', headers: ['X'] }),
        'headers must be a JSON object of string→string',
      );
      expectWebhookError(
        JSON.stringify({ url: 'https://hook.example/h', headers: { '  ': 'v' } }),
        'headers keys must be non-empty',
      );
      expectWebhookError(
        JSON.stringify({ url: 'https://hook.example/h', headers: { 'X-Token': 42 } }),
        'headers values must be non-empty strings',
      );
      expectWebhookError(
        JSON.stringify({ url: 'https://hook.example/h', headers: { 'X-Token': '   ' } }),
        'headers values must be non-empty strings',
      );
    });
  });

  describe('新形态：payloadTemplate 按 mode 配套', () => {
    it('json 模式 payloadTemplate 可缺省（切片 16 固定 payload 语义）', () => {
      const config = parseWebhookChannelConfig(JSON.stringify({ url: 'https://hook.example/j' }));
      expect(
        (config as Extract<WebhookChannelConfig, { mode: 'json' }>).payloadTemplate,
      ).toBeUndefined();
    });

    it('json 模式 payloadTemplate 任意 JSON 值（数组/数字/嵌套对象）均放行', () => {
      const template = { a: [1, 'x'], b: null, c: true };
      const config = parseWebhookChannelConfig(
        JSON.stringify({ url: 'https://hook.example/j', payloadTemplate: template }),
      );
      expect(
        (config as Extract<WebhookChannelConfig, { mode: 'json' }>).payloadTemplate,
      ).toEqual(template);
    });

    it('form 模式 payloadTemplate 必填且为扁平 string→string', () => {
      expectWebhookError(
        JSON.stringify({ url: 'https://hook.example/f', mode: 'form' }),
        'payloadTemplate is required when mode is "form"',
      );
      expectWebhookError(
        JSON.stringify({ url: 'https://hook.example/f', mode: 'form', payloadTemplate: 'text' }),
        'must be a flat JSON object of string→string when mode is "form"',
      );
      expectWebhookError(
        JSON.stringify({ url: 'https://hook.example/f', mode: 'form', payloadTemplate: { a: 1 } }),
        'values must be strings when mode is "form"',
      );
    });

    it('text 模式 payloadTemplate 必填且为字符串', () => {
      expectWebhookError(
        JSON.stringify({ url: 'https://hook.example/t', mode: 'text' }),
        'payloadTemplate is required when mode is "text"',
      );
      expectWebhookError(
        JSON.stringify({ url: 'https://hook.example/t', mode: 'text', payloadTemplate: { a: 'b' } }),
        'payloadTemplate must be a string when mode is "text"',
      );
    });
  });

  describe('新形态：完整 Zulip 形态（阶段 2 预设常用样例）', () => {
    it('zulip form 模板解析通过且形态判别正确', () => {
      const raw = JSON.stringify({
        url: 'https://zulip.example/api/v1/external/zulip',
        mode: 'form',
        payloadTemplate: {
          type: 'stream',
          to: '{{occurrenceKey}}',
          topic: '{{title}}',
          content: '{{body}}',
        },
      });
      const config = parseWebhookChannelConfig(raw);
      expect(config.mode).toBe('form');
      const form = config as Extract<WebhookChannelConfig, { mode: 'form' }>;
      expect(form.url).toBe('https://zulip.example/api/v1/external/zulip');
      expect(form.payloadTemplate).toEqual({
        type: 'stream',
        to: '{{occurrenceKey}}',
        topic: '{{title}}',
        content: '{{body}}',
      });
      expect(form.headers).toEqual({});
    });
  });
});
