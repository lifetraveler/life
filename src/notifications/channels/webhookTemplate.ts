/**
 * 切片 17 阶段 1：Webhook 载荷模板渲染（AGENTS.md §7.27 Webhook 载荷适配）。
 *
 * 纯函数，不依赖 React Native / WatermelonDB / expo-notifications（AGENTS.md §4.3），
 * 阶段 2 的预设配置 UI 可复用（webhookConfig 同落点先例 appriseConfig.ts）。
 *
 * 变量集（v1，notifications.md「Webhook 载荷模板」节）：
 *   {{title}} {{body}} {{content}} {{occurrenceKey}} {{reminderId}} {{itemId}} {{fireAt}} {{sentAt}}
 *
 * 替换规则（计划决策点，已确认）：
 * 1. 命中上表 → 替换；未知占位符保留原文（不静默清空——配置写错时在消息里可见，便于排障）；
 * 2. 不支持转义语法：字面 `{{` 原样输出；
 * 3. json 模式递归渲染：仅 string 叶子替换，对象/数组结构保留，number/boolean/null 原样，
 *    产出后整体 JSON.stringify（引号/换行等特殊字符由 stringify 统一转义，模板内无需手工处理）；
 * 4. fireAt / sentAt 按文本渲染（epoch 毫秒字符串；json 模式缺省 payload 保持数字形态不变）。
 */

/** 模板变量集；fireAt / sentAt 为毫秒时间戳的字符串形态 */
export type WebhookTemplateVars = {
  title: string;
  body: string;
  content: string;
  occurrenceKey: string;
  reminderId: string;
  itemId: string;
  fireAt: string;
  sentAt: string;
};

export const WEBHOOK_TEMPLATE_VAR_NAMES: readonly (keyof WebhookTemplateVars)[] = [
  'title',
  'body',
  'content',
  'occurrenceKey',
  'reminderId',
  'itemId',
  'fireAt',
  'sentAt',
];

/** 占位符语法：{{varName}}，变量名两侧允许空白（{{ title }} 等价 {{title}}） */
const TEMPLATE_PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * 单值渲染：把 template 中所有已知 {{var}} 替换为 vars[varName]；
 * 未知占位符整段保留原文（含花括号与空白）。
 */
export function renderWebhookTemplateValue(template: string, vars: WebhookTemplateVars): string {
  return template.replace(TEMPLATE_PLACEHOLDER, (match: string, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return vars[name as keyof WebhookTemplateVars];
    }
    return match;
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * json 模式模板递归渲染：string 叶子做变量替换，对象/数组结构保留，
 * number/boolean/null 原样透传。产出值可直接 JSON.stringify。
 */
export function renderWebhookJsonTemplate(template: unknown, vars: WebhookTemplateVars): unknown {
  if (typeof template === 'string') {
    return renderWebhookTemplateValue(template, vars);
  }
  if (Array.isArray(template)) {
    return template.map((element) => renderWebhookJsonTemplate(element, vars));
  }
  if (isPlainRecord(template)) {
    const rendered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      rendered[key] = renderWebhookJsonTemplate(value, vars);
    }
    return rendered;
  }
  return template;
}

/**
 * form 模板渲染：扁平 Record<string,string> 逐值渲染后经 URLSearchParams 编码
 * （键不渲染：键是收件端协议参数名，不是内容；键的合法性由 webhookConfig 守卫把关）。
 */
export function renderWebhookFormTemplate(
  template: Record<string, string>,
  vars: WebhookTemplateVars,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(template)) {
    params.append(key, renderWebhookTemplateValue(value, vars));
  }
  return params.toString();
}
