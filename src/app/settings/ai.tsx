import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';

import { SecureAiConfigStore } from '../../data/SecureAiConfigStore';
import { OpenAICompatibleProvider } from '../../domain/ai/openAiCompatible';
import type { TestConnectionResult } from '../../domain/ai/openAiCompatible';
import type { AiProviderConfig } from '../../domain/ai/configStore';

/**
 * AI 配置页（tasks/slice-15.md 阶段 2 / AGENTS.md §7.24）：
 * - API Key / BaseURL / Model 三要素表单，保存经 SecureAiConfigStore 写
 *   expo-secure-store（Android Keystore 加密），严禁明文入库；
 * - 「测试连接」用当前表单值发最小 chat completion（max_tokens=1），
 *   结果行内展示，成功带往返耗时，失败带可读原因；
 * - 「清除配置」清空 secure-store（Alert 确认后执行）。
 */

const store = new SecureAiConfigStore();

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';

type TestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'done'; result: TestConnectionResult };

export default function AiSettingsPage() {
  const [loaded, setLoaded] = useState<boolean>(false);
  const [baseUrl, setBaseUrl] = useState<string>(DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState<string>('');
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [showKey, setShowKey] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedTick, setSavedTick] = useState<number>(0);
  const [testState, setTestState] = useState<TestState>({ phase: 'idle' });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const config = await store.load();
      if (!alive) return;
      if (config !== null && config.active !== null) {
        setBaseUrl(config.active.baseUrl);
        setApiKey(config.active.apiKey);
        setModel(config.active.model);
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const buildConfig = useCallback(
    (): AiProviderConfig | null => {
      const url = baseUrl.trim();
      const key = apiKey.trim();
      const name = model.trim();
      if (url.length === 0 || key.length === 0 || name.length === 0) return null;
      return { provider: 'openai-compatible', baseUrl: url, apiKey: key, model: name };
    },
    [baseUrl, apiKey, model],
  );

  const handleSave = useCallback(async (): Promise<void> => {
    const config = buildConfig();
    if (config === null) {
      Alert.alert('无法保存', 'BaseURL、API Key、Model 均不能为空');
      return;
    }
    setSaving(true);
    try {
      await store.save({ active: config });
      setSavedTick((n) => n + 1);
    } catch {
      Alert.alert('保存失败', '写入安全存储失败，请重试');
    } finally {
      setSaving(false);
    }
  }, [buildConfig]);

  const handleTest = useCallback(async (): Promise<void> => {
    const config = buildConfig();
    if (config === null) {
      Alert.alert('无法测试', 'BaseURL、API Key、Model 均不能为空');
      return;
    }
    setTestState({ phase: 'testing' });
    try {
      const provider = new OpenAICompatibleProvider(config);
      const result = await provider.testConnection();
      setTestState({ phase: 'done', result });
    } catch (err) {
      setTestState({
        phase: 'done',
        result: { ok: false, reason: `初始化失败：${err instanceof Error ? err.message : String(err)}` },
      });
    }
  }, [buildConfig]);

  const handleClear = useCallback((): void => {
    Alert.alert('清除 AI 配置', '将删除已保存的 API Key 与连接配置', [
      { text: '取消', style: 'cancel' },
      {
        text: '清除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await store.clear();
            setApiKey('');
            setBaseUrl(DEFAULT_BASE_URL);
            setModel(DEFAULT_MODEL);
            setTestState({ phase: 'idle' });
            setSavedTick((n) => n + 1);
          })();
        },
      },
    ]);
  }, []);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>连接配置</Text>
      <Text style={styles.hint}>兼容 OpenAI / DeepSeek 等 OpenAI 兼容端点。Key 仅存于系统安全存储。</Text>

      <Text style={styles.label}>BaseURL</Text>
      <TextInput
        style={styles.input}
        value={baseUrl}
        onChangeText={setBaseUrl}
        placeholder={DEFAULT_BASE_URL}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />

      <View style={styles.labelRow}>
        <Text style={styles.label}>API Key</Text>
        <View style={styles.showKeyRow}>
          <Text style={styles.showKeyText}>显示</Text>
          <Switch value={showKey} onValueChange={setShowKey} />
        </View>
      </View>
      <TextInput
        style={styles.input}
        value={apiKey}
        onChangeText={setApiKey}
        placeholder="sk-..."
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={!showKey}
      />

      <Text style={styles.label}>Model</Text>
      <TextInput
        style={styles.input}
        value={model}
        onChangeText={setModel}
        placeholder={DEFAULT_MODEL}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Pressable
        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        onPress={() => void handleSave()}
        disabled={saving || !loaded}
      >
        {saving ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.primaryText}>{savedTick > 0 ? '已保存' : '保存配置'}</Text>
        )}
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        onPress={() => void handleTest()}
        disabled={testState.phase === 'testing'}
      >
        {testState.phase === 'testing' ? (
          <ActivityIndicator color="#111111" />
        ) : (
          <Text style={styles.secondaryText}>测试连接</Text>
        )}
      </Pressable>

      {testState.phase === 'done' ? (
        <View
          style={[
            styles.resultBox,
            testState.result.ok ? styles.resultOk : styles.resultFail,
          ]}
        >
          <Text style={styles.resultText}>
            {testState.result.ok
              ? `连接成功（${testState.result.latencyMs}ms）`
              : `连接失败：${testState.result.reason}`}
          </Text>
        </View>
      ) : null}

      <Pressable
        style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed]}
        onPress={handleClear}
      >
        <Text style={styles.dangerText}>清除 AI 配置</Text>
      </Pressable>

      <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={() => router.back()}>
        <Text style={styles.secondaryText}>返回</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 6,
  },
  hint: {
    fontSize: 13,
    color: '#888888',
    lineHeight: 19,
    marginBottom: 20,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  showKeyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  showKeyText: {
    fontSize: 12,
    color: '#888888',
  },
  label: {
    fontSize: 13,
    color: '#555555',
    marginTop: 14,
    marginBottom: 6,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#DDDDDD',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111111',
  },
  primaryButton: {
    marginTop: 24,
    backgroundColor: '#1E6F5C',
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 13,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    marginTop: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#DDDDDD',
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 13,
  },
  secondaryText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
  resultBox: {
    marginTop: 12,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  resultOk: {
    backgroundColor: '#E6F4EF',
  },
  resultFail: {
    backgroundColor: '#FBEAEA',
  },
  resultText: {
    fontSize: 13,
    color: '#111111',
    lineHeight: 18,
  },
  dangerButton: {
    marginTop: 24,
    alignItems: 'center',
    paddingVertical: 12,
  },
  dangerText: {
    fontSize: 14,
    color: '#C0392B',
  },
  backButton: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 12,
  },
  pressed: {
    opacity: 0.6,
  },
});
