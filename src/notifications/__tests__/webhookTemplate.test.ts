import {
  renderWebhookFormTemplate,
  renderWebhookJsonTemplate,
  renderWebhookTemplateValue,
  WEBHOOK_TEMPLATE_VAR_NAMES,
  type WebhookTemplateVars,
} from '../channels/webhookTemplate';

/**
 * 切片 17 阶段 1：Webhook 载荷模板渲染单测（AGENTS.md §7.27）。
 * 覆盖：已知变量替换、未知占位符保留原文（已确认决策点）、字面 {{ 原样、
 * json 递归渲染（string 叶子替换/结构保留/标量透传）、form URLSearchParams 编码。
 */

const VARS: WebhookTemplateVars = {
  title: '会议提醒',
  body: '下午 3 点开会',
  content: '带上周报数据',
  occurrenceKey: 'daily:r1:20250610',
  reminderId: 'r1',
  itemId: 'i1',
  fireAt: '1749542400000',
  sentAt: '1749542400500',
};

describe('renderWebhookTemplateValue（切片 17 阶段 1）', () => {
  it('已知变量全部替换（8 个变量名逐个锁定）', () => {
    for (const name of WEBHOOK_TEMPLATE_VAR_NAMES) {
      const rendered = renderWebhookTemplateValue(`x={{${name}}}`, VARS);
      expect(rendered).toBe(`x=${VARS[name]}`);
    }
  });

  it('同一模板混合多变量一次替换', () => {
    expect(renderWebhookTemplateValue('{{title}}：{{body}}', VARS)).toBe(
      '会议提醒：下午 3 点开会',
    );
  });

  it('变量名两侧空白等价（{{ title }} == {{title}}）', () => {
    expect(renderWebhookTemplateValue('{{ title }}', VARS)).toBe('会议提醒');
  });

  it('未知占位符保留原文（含花括号与空白），不静默清空', () => {
    expect(renderWebhookTemplateValue('{{unknownVar}}', VARS)).toBe('{{unknownVar}}');
    expect(renderWebhookTemplateValue('前 {{ not_a_var }} 后', VARS)).toBe(
      '前 {{ not_a_var }} 后',
    );
    expect(renderWebhookTemplateValue('{{1abc}}', VARS)).toBe('{{1abc}}');
  });

  it('字面 {{ 原样输出（无转义语法）；杂散 { 后接合法占位符时占位符仍渲染', () => {
    expect(renderWebhookTemplateValue('{{', VARS)).toBe('{{');
    expect(renderWebhookTemplateValue('{{{title}}}', VARS)).toBe('{会议提醒}');
    expect(renderWebhookTemplateValue('{{ title', VARS)).toBe('{{ title');
  });

  it('无占位符的模板原样返回', () => {
    expect(renderWebhookTemplateValue('plain text', VARS)).toBe('plain text');
  });
});

describe('renderWebhookJsonTemplate（切片 17 阶段 1）', () => {
  it('string 叶子替换、对象结构保留、number/boolean/null 透传', () => {
    const template = {
      msgtype: 'text',
      text: { content: '{{title}}\n{{body}}' },
      at: { isAtAll: false },
      count: 3,
      extra: null,
      tags: ['{{itemId}}', 42],
    };
    expect(renderWebhookJsonTemplate(template, VARS)).toEqual({
      msgtype: 'text',
      text: { content: '会议提醒\n下午 3 点开会' },
      at: { isAtAll: false },
      count: 3,
      extra: null,
      tags: ['i1', 42],
    });
  });

  it('顶层为 string / 数组的模板同样处理', () => {
    expect(renderWebhookJsonTemplate('{{title}}', VARS)).toBe('会议提醒');
    expect(renderWebhookJsonTemplate(['{{title}}', { k: '{{itemId}}' }], VARS)).toEqual([
      '会议提醒',
      { k: 'i1' },
    ]);
  });

  it('嵌套对象里的未知占位符保留原文', () => {
    expect(renderWebhookJsonTemplate({ a: { b: '{{nope}}' } }, VARS)).toEqual({
      a: { b: '{{nope}}' },
    });
  });
});

describe('renderWebhookFormTemplate（切片 17 阶段 1）', () => {
  it('逐值渲染并按 application/x-www-form-urlencoded 编码', () => {
    const body = renderWebhookFormTemplate(
      { type: 'stream', to: '{{occurrenceKey}}', content: '{{title}} {{body}}' },
      VARS,
    );
    const params = new URLSearchParams(body);
    expect(params.get('type')).toBe('stream');
    expect(params.get('to')).toBe('daily:r1:20250610');
    expect(params.get('content')).toBe('会议提醒 下午 3 点开会');
    // 编码形态锁定：URLSearchParams 语义（中文 percent-encode、空格编码为 + 而非 %20）
    expect(body).toBe(
      'type=stream&to=daily%3Ar1%3A20250610&content=' +
        encodeURIComponent('会议提醒 下午 3 点开会').replaceAll('%20', '+'),
    );
  });

  it('值中的未知占位符保留原文后编码（不破坏收件端可读性）', () => {
    const body = renderWebhookFormTemplate({ content: '{{unknown}}' }, VARS);
    expect(new URLSearchParams(body).get('content')).toBe('{{unknown}}');
  });
});
