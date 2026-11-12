import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ChannelPresetType } from '../domain/channelPreset';
import { isValidHttpUrl } from './reminderForm';

/**
 * 渠道预设新建/编辑表单（切片 17 阶段 2，AGENTS.md §7.27 / §7.28）。
 *
 * - initial=null 为新建（type 可选）；编辑时 type 锁定（契约：type 创建后不可变）；
 * - webhook：URL + 载荷模式（json/form/text）+ payloadTemplate 文本 + 可选 headers(JSON)
 *   + 模板快捷 chips（Zulip / 企业微信 / 纯文本，仅为填表便捷，最终形态由 parseWebhookChannelConfig
 *   在发送侧与 Repository 守卫校验）；
 * - apprise：BaseURL + Key（stateful 简写）；
 * - onSave 回传已构建好的 configJson（纯文本模板变量：{{title}} {{body}} {{content}}
 *   {{occurrenceKey}} {{reminderId}} {{itemId}} {{fireAt}} {{sentAt}}，未知占位符保留原文）；
 * - 客户端预校验仅做表单即时反馈，Repository 仍是最终校验层。
 */

export interface ChannelPresetDraft {
  name: string;
  type: ChannelPresetType;
  configJson: string;
}

interface ChannelPresetEditorProps {
  /** null=新建；非 null=编辑（type 锁定，config 回填） */
  initial: ChannelPresetDraft | null;
  saving: boolean;
  onSave: (draft: ChannelPresetDraft) => void;
  onCancel: () => void;
}

type WebhookPayloadMode = 'json' | 'form' | 'text';

interface FormState {
  name: string;
  type: ChannelPresetType;
  webhookUrl: string;
  payloadMode: WebhookPayloadMode;
  payloadTemplateText: string;
  headersText: string;
  appriseBaseUrl: string;
  appriseKey: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  type: 'webhook',
  webhookUrl: '',
  payloadMode: 'json',
  payloadTemplateText: '',
  headersText: '',
  appriseBaseUrl: '',
  appriseKey: '',
};

const PAYLOAD_MODE_OPTIONS: ReadonlyArray<{ value: WebhookPayloadMode; label: string }> = [
  { value: 'json', label: 'JSON' },
  { value: 'form', label: 'Form 表单' },
  { value: 'text', label: '纯文本' },
];

/** 模板快捷 chips：mode + payloadTemplate 文本一起设置（契约模板变量集合） */
const TEMPLATE_PRESETS: ReadonlyArray<{
  label: string;
  mode: WebhookPayloadMode;
  template: string;
}> = [
  {
    label: 'Zulip',
    mode: 'form',
    template: '{"type":"stream","to":"general","topic":"生活提醒","content":"{{title}} - {{body}}"}',
  },
  {
    label: '企业微信',
    mode: 'json',
    template: '{"msgtype":"text","text":{"content":"{{title}} {{body}}"}}',
  },
  {
    label: '纯文本',
    mode: 'text',
    template: '{{title}} - {{body}}',
  },
];

const PLACEHOLDER_DOC =
  '模板变量：{{title}} {{body}} {{content}} {{occurrenceKey}} {{reminderId}} {{itemId}} '
  + '{{fireAt}} {{sentAt}}（fireAt/sentAt 为毫秒时间戳字符串；未知占位符保留原文）';

interface FormErrors {
  name?: string;
  webhookUrl?: string;
  payloadTemplate?: string;
  headers?: string;
  appriseBaseUrl?: string;
  appriseKey?: string;
}

/** 可选 headers 文本 → Record<string,string>（空/纯空白 → {}；形态不符 → null） */
function parseHeadersText(text: string): Record<string, string> | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key.trim().length === 0 || typeof value !== 'string') {
      return null;
    }
    headers[key] = value;
  }
  return headers;
}

/** JSON 树（模板 json 模式的合法值域）；手写守卫避免 unknown 断言 */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === 'object') {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

/** payloadTemplate 文本按 mode 构建模板值（form → 扁平 string→string；json → 任意 JSON 树；text → 原字符串） */
function parseTemplateText(
  mode: WebhookPayloadMode,
  text: string,
): Record<string, string> | JsonValue | null {
  const trimmed = text.trim();
  if (mode === 'text') {
    return trimmed.length === 0 ? null : trimmed;
  }
  if (trimmed.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (mode === 'form') {
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const template: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key.trim().length === 0 || typeof value !== 'string') {
        return null;
      }
      template[key] = value;
    }
    return template;
  }
  // json：任意 JSON 树
  return isJsonValue(parsed) ? parsed : null;
}

function buildWebhookConfigJson(form: FormState): string | null {
  const headers = parseHeadersText(form.headersText);
  if (headers === null) {
    return null;
  }
  const template = parseTemplateText(form.payloadMode, form.payloadTemplateText);
  if (form.payloadTemplateText.trim().length > 0 && template === null) {
    return null;
  }
  const config: Record<string, unknown> = { url: form.webhookUrl.trim() };
  if (Object.keys(headers).length > 0) {
    config['headers'] = headers;
  }
  if (template !== null) {
    config['mode'] = form.payloadMode;
    config['payloadTemplate'] = template;
  }
  return JSON.stringify(config);
}

/** 编辑回填：configJson → 表单态（解析失败回退整串 URL 形态，交由校验拦截） */
function formFromConfigJson(type: ChannelPresetType, configJson: string): Partial<FormState> {
  if (type === 'apprise') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(configJson);
    } catch {
      return {};
    }
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const baseUrl = 'baseUrl' in parsed && typeof parsed['baseUrl'] === 'string' ? parsed['baseUrl'] : '';
      const key = 'key' in parsed && typeof parsed['key'] === 'string' ? parsed['key'] : '';
      return { appriseBaseUrl: baseUrl, appriseKey: key };
    }
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(configJson);
  } catch {
    return { webhookUrl: configJson, payloadMode: 'json' as WebhookPayloadMode };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { webhookUrl: configJson, payloadMode: 'json' as WebhookPayloadMode };
  }
  const record = parsed;
  const url = 'url' in record && typeof record['url'] === 'string' ? record['url'] : configJson;
  const mode = 'mode' in record
    && (record['mode'] === 'json' || record['mode'] === 'form' || record['mode'] === 'text')
    ? record['mode']
    : 'json';
  let templateText = '';
  if ('payloadTemplate' in record && record['payloadTemplate'] !== undefined) {
    templateText = typeof record['payloadTemplate'] === 'string'
      ? record['payloadTemplate']
      : JSON.stringify(record['payloadTemplate']);
  }
  let headersText = '';
  if ('headers' in record && typeof record['headers'] === 'object' && record['headers'] !== null
    && !Array.isArray(record['headers'])) {
    headersText = JSON.stringify(record['headers']);
  }
  return { webhookUrl: url, payloadMode: mode, payloadTemplateText: templateText, headersText };
}

function initialForm(initial: ChannelPresetDraft | null): FormState {
  if (initial === null) {
    return EMPTY_FORM;
  }
  return {
    ...EMPTY_FORM,
    name: initial.name,
    type: initial.type,
    ...formFromConfigJson(initial.type, initial.configJson),
  };
}

export default function ChannelPresetEditor({
  initial,
  saving,
  onSave,
  onCancel,
}: ChannelPresetEditorProps) {
  const [form, setForm] = useState<FormState>(() => initialForm(initial));
  const [errors, setErrors] = useState<FormErrors>({});
  const isEditing = initial !== null;

  const patch = (next: Partial<FormState>): void => {
    setForm((current) => ({ ...current, ...next }));
  };

  const validate = (): FormErrors => {
    const nextErrors: FormErrors = {};
    if (form.name.trim().length === 0) {
      nextErrors.name = '名称不能为空';
    }
    if (form.type === 'webhook') {
      const url = form.webhookUrl.trim();
      if (url.length === 0) {
        nextErrors.webhookUrl = 'Webhook URL 不能为空';
      } else if (!isValidHttpUrl(url)) {
        nextErrors.webhookUrl = 'URL 格式无效（需以 http:// 或 https:// 开头）';
      }
      if (form.payloadTemplateText.trim().length > 0) {
        const template = parseTemplateText(form.payloadMode, form.payloadTemplateText);
        if (template === null) {
          nextErrors.payloadTemplate = form.payloadMode === 'text'
            ? '纯文本模板不能为空'
            : 'payloadTemplate 需为合法 JSON（form 模式须为扁平 string→string 对象）';
        }
      }
      if (form.headersText.trim().length > 0 && parseHeadersText(form.headersText) === null) {
        nextErrors.headers = 'headers 需为合法 JSON 对象（string→string）';
      }
    } else {
      const baseUrl = form.appriseBaseUrl.trim();
      if (baseUrl.length === 0) {
        nextErrors.appriseBaseUrl = 'Apprise BaseURL 不能为空';
      } else if (!isValidHttpUrl(baseUrl)) {
        nextErrors.appriseBaseUrl = 'BaseURL 格式无效（需以 http:// 或 https:// 开头）';
      }
      if (form.appriseKey.trim().length === 0) {
        nextErrors.appriseKey = 'Apprise Key 不能为空';
      }
    }
    return nextErrors;
  };

  const handleSave = (): void => {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    if (form.type === 'webhook') {
      const configJson = buildWebhookConfigJson(form);
      if (configJson === null) {
        setErrors({ ...nextErrors, payloadTemplate: '配置构建失败（headers 或模板形态不符）' });
        return;
      }
      onSave({ name: form.name.trim(), type: 'webhook', configJson });
      return;
    }
    const configJson = JSON.stringify({
      baseUrl: form.appriseBaseUrl.trim(),
      key: form.appriseKey.trim(),
    });
    onSave({ name: form.name.trim(), type: 'apprise', configJson });
  };

  return (
    <View style={styles.editor}>
      <Text style={styles.fieldLabel}>名称</Text>
      <TextInput
        style={[styles.input, errors.name && styles.inputError]}
        value={form.name}
        onChangeText={(name) => patch({ name })}
        placeholder="如：Zulip 工作群"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {errors.name ? <Text style={styles.errorText}>{errors.name}</Text> : null}

      {isEditing ? (
        <Text style={styles.typeLocked}>
          {`类型：${form.type === 'webhook' ? 'Webhook' : 'Apprise'}（创建后不可变更）`}
        </Text>
      ) : (
        <View style={styles.typeRow}>
          <Text style={styles.fieldLabel}>类型</Text>
          <Pressable
            style={[styles.typeChip, form.type === 'webhook' && styles.typeChipSelected]}
            onPress={() => patch({ type: 'webhook' })}
          >
            <Text style={[styles.typeChipText, form.type === 'webhook' && styles.typeChipTextSelected]}>
              Webhook
            </Text>
          </Pressable>
          <Pressable
            style={[styles.typeChip, form.type === 'apprise' && styles.typeChipSelected]}
            onPress={() => patch({ type: 'apprise' })}
          >
            <Text style={[styles.typeChipText, form.type === 'apprise' && styles.typeChipTextSelected]}>
              Apprise
            </Text>
          </Pressable>
        </View>
      )}

      {form.type === 'webhook' ? (
        <View>
          <Text style={styles.fieldLabel}>Webhook URL</Text>
          <TextInput
            style={[styles.input, errors.webhookUrl && styles.inputError]}
            value={form.webhookUrl}
            onChangeText={(webhookUrl) => patch({ webhookUrl })}
            placeholder="https://…"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {errors.webhookUrl ? <Text style={styles.errorText}>{errors.webhookUrl}</Text> : null}

          <Text style={styles.fieldLabel}>载荷模式</Text>
          <View style={styles.modeRow}>
            {PAYLOAD_MODE_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                style={[styles.typeChip, form.payloadMode === option.value && styles.typeChipSelected]}
                onPress={() => patch({ payloadMode: option.value })}
              >
                <Text
                  style={[
                    styles.typeChipText,
                    form.payloadMode === option.value && styles.typeChipTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>载荷模板（可选）</Text>
          <View style={styles.modeRow}>
            {TEMPLATE_PRESETS.map((preset) => (
              <Pressable
                key={preset.label}
                style={styles.typeChip}
                onPress={() => patch({ payloadMode: preset.mode, payloadTemplateText: preset.template })}
              >
                <Text style={styles.typeChipText}>{`用「${preset.label}」模板`}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={[styles.input, styles.multiline, errors.payloadTemplate && styles.inputError]}
            value={form.payloadTemplateText}
            onChangeText={(payloadTemplateText) => patch({ payloadTemplateText })}
            placeholder='如 {"msgtype":"text","text":{"content":"{{title}}"}}'
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />
          <Text style={styles.hint}>{PLACEHOLDER_DOC}</Text>
          {errors.payloadTemplate ? (
            <Text style={styles.errorText}>{errors.payloadTemplate}</Text>
          ) : null}

          <Text style={styles.fieldLabel}>Headers（可选，JSON 对象）</Text>
          <TextInput
            style={[styles.input, styles.multiline, errors.headers && styles.inputError]}
            value={form.headersText}
            onChangeText={(headersText) => patch({ headersText })}
            placeholder='{"Content-Type":"application/json"}'
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />
          {errors.headers ? <Text style={styles.errorText}>{errors.headers}</Text> : null}
        </View>
      ) : (
        <View>
          <Text style={styles.fieldLabel}>Apprise BaseURL</Text>
          <TextInput
            style={[styles.input, errors.appriseBaseUrl && styles.inputError]}
            value={form.appriseBaseUrl}
            onChangeText={(appriseBaseUrl) => patch({ appriseBaseUrl })}
            placeholder="http://apprise:8000"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {errors.appriseBaseUrl ? (
            <Text style={styles.errorText}>{errors.appriseBaseUrl}</Text>
          ) : null}
          <Text style={styles.fieldLabel}>Apprise Key</Text>
          <TextInput
            style={[styles.input, errors.appriseKey && styles.inputError]}
            value={form.appriseKey}
            onChangeText={(appriseKey) => patch({ appriseKey })}
            placeholder="通知配置 Key"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {errors.appriseKey ? <Text style={styles.errorText}>{errors.appriseKey}</Text> : null}
        </View>
      )}

      <View style={styles.buttonRow}>
        <Pressable style={[styles.button, styles.secondaryButton]} onPress={onCancel}>
          <Text style={styles.secondaryText}>取消</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.primaryButton, saving && styles.buttonDisabled]}
          onPress={handleSave}
        >
          <Text style={styles.primaryText}>{saving ? '保存中…' : '保存预设'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editor: {
    gap: 2,
  },
  fieldLabel: {
    fontSize: 13,
    color: '#666',
    marginTop: 6,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 15,
    backgroundColor: '#fff',
  },
  multiline: {
    minHeight: 56,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: '#c62828',
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeLocked: {
    fontSize: 13,
    color: '#888',
    marginTop: 6,
  },
  typeChip: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
  },
  typeChipSelected: {
    borderColor: '#1976d2',
    backgroundColor: '#e3f2fd',
  },
  typeChipText: {
    fontSize: 13,
    color: '#555',
  },
  typeChipTextSelected: {
    color: '#1976d2',
    fontWeight: '600',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  hint: {
    fontSize: 11,
    color: '#9e9e9e',
    lineHeight: 16,
    marginTop: 4,
  },
  errorText: {
    fontSize: 12,
    color: '#c62828',
    marginTop: 2,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  button: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 9,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  secondaryButton: {
    borderColor: '#d0d0d0',
    backgroundColor: '#fff',
  },
  secondaryText: {
    fontSize: 14,
    color: '#555',
  },
  primaryButton: {
    borderColor: '#1e6f5c',
    backgroundColor: '#1e6f5c',
  },
  primaryText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
});
