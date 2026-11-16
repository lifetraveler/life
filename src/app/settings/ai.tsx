import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { AI_PLATFORM_IDS, AI_PLATFORM_PRESETS, createEmptyAiSlots } from '../../domain/ai/configStore';
import type { AiPlatform, AiProviderConfig } from '../../domain/ai/configStore';
import { useTheme } from '../../ui/theme';
import type { ThemeColors } from '../../ui/theme';

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

/**
 * DeepSeek 官方分层单价（元/百万 tokens，阶段 2b / v0.21，来源：官方价格页
 * 2026-11 口径）——选平台 deepseek 且点选预设 Model 时预填六价输入框。
 * deepseek-flash：缓存命中 0.02（空闲）/0.04（高峰）、未命中 1/2、输出 4/8；
 * deepseek-v4-pro：0.15/0.30、4.5/9.0、13.5/27.0。
 */
const DEEPSEEK_MODEL_TIER_PRICES: Record<string, Record<string, string>> = {
  'deepseek-flash': {
    priceCachedPeak: '0.04',
    priceCachedOffPeak: '0.02',
    priceUncachedPeak: '2',
    priceUncachedOffPeak: '1',
    priceOutputPeak: '8',
    priceOutputOffPeak: '4',
  },
  'deepseek-v4-pro': {
    priceCachedPeak: '0.3',
    priceCachedOffPeak: '0.15',
    priceUncachedPeak: '9',
    priceUncachedOffPeak: '4.5',
    priceOutputPeak: '27',
    priceOutputOffPeak: '13.5',
  },
};

/** 峰谷分层六价输入框的文本状态（保存时逐项经 parsePriceInput 归一）。 */
type TierPriceInputs = {
  priceCachedPeak: string;
  priceCachedOffPeak: string;
  priceUncachedPeak: string;
  priceUncachedOffPeak: string;
  priceOutputPeak: string;
  priceOutputOffPeak: string;
};

const EMPTY_TIER_PRICES: TierPriceInputs = {
  priceCachedPeak: '',
  priceCachedOffPeak: '',
  priceUncachedPeak: '',
  priceUncachedOffPeak: '',
  priceOutputPeak: '',
  priceOutputOffPeak: '',
};

type TestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'done'; result: TestConnectionResult };

/**
 * 用量单价输入归一（切片 26 阶段 2，§7.38）：空串 → undefined（留空不估算）；
 * 非法/非正数 → undefined（静默丢弃，与 configStore isAiProviderConfig 的
 * 归一口径一致，不整包拒绝）；正数 → 原值。
 */
function parsePriceInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

export default function AiSettingsPage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [loaded, setLoaded] = useState<boolean>(false);
  const [baseUrl, setBaseUrl] = useState<string>(DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState<string>('');
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  // 切片 26 阶段 2（AGENTS.md §7.38）：用量单价（每百万 tokens，可选）。
  // 输入框持有原始文本，保存时经 parsePriceInput 归一；留空 = 不估算费用。
  const [priceInput, setPriceInput] = useState<string>('');
  const [priceOutput, setPriceOutput] = useState<string>('');
  // 阶段 2c（v0.22）：每平台独立槽——editingPlatform=当前编辑平台（点 chip 切
  // 编辑视图），activePlatform=正在使用平台（保存即激活），slots=五槽镜像。
  const [editingPlatform, setEditingPlatform] = useState<AiPlatform>('custom');
  const [activePlatform, setActivePlatform] = useState<AiPlatform | null>(null);
  const [slots, setSlots] = useState<Record<AiPlatform, AiProviderConfig | null> | null>(null);
  const [tierPrices, setTierPrices] = useState<TierPriceInputs>(EMPTY_TIER_PRICES);
  const [showKey, setShowKey] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedTick, setSavedTick] = useState<number>(0);
  const [testState, setTestState] = useState<TestState>({ phase: 'idle' });

  // 阶段 2c（v0.22）：槽 → 表单回填单点（load 与切平台 chip 共用）。空槽按
  // 平台预设初始化（BaseURL 取预设，无预设回落 DEFAULT；Model 取预设第一个）；
  // 非空槽全字段回显（含单价六/两价）。
  const applySlotToForm = useCallback(
    (cfg: AiProviderConfig | null, platform: AiPlatform): void => {
      if (cfg === null) {
        const preset = AI_PLATFORM_PRESETS[platform];
        setBaseUrl(preset.baseURL.length > 0 ? preset.baseURL : DEFAULT_BASE_URL);
        setApiKey('');
        setModel(preset.models.length > 0 ? preset.models[0] : DEFAULT_MODEL);
        setPriceInput('');
        setPriceOutput('');
        setTierPrices(EMPTY_TIER_PRICES);
        return;
      }
      setBaseUrl(cfg.baseUrl);
      setApiKey(cfg.apiKey);
      setModel(cfg.model);
      setPriceInput(
        cfg.priceInputPerMillion !== undefined ? String(cfg.priceInputPerMillion) : '',
      );
      setPriceOutput(
        cfg.priceOutputPerMillion !== undefined ? String(cfg.priceOutputPerMillion) : '',
      );
      setTierPrices({
        priceCachedPeak:
          cfg.priceCachedPeak !== undefined ? String(cfg.priceCachedPeak) : '',
        priceCachedOffPeak:
          cfg.priceCachedOffPeak !== undefined ? String(cfg.priceCachedOffPeak) : '',
        priceUncachedPeak:
          cfg.priceUncachedPeak !== undefined ? String(cfg.priceUncachedPeak) : '',
        priceUncachedOffPeak:
          cfg.priceUncachedOffPeak !== undefined ? String(cfg.priceUncachedOffPeak) : '',
        priceOutputPeak:
          cfg.priceOutputPeak !== undefined ? String(cfg.priceOutputPeak) : '',
        priceOutputOffPeak:
          cfg.priceOutputOffPeak !== undefined ? String(cfg.priceOutputOffPeak) : '',
      });
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const config = await store.load();
      if (!alive) return;
      if (config !== null) {
        // 阶段 2c（v0.22）：isAiConfig 归一化保证 slots/activePlatform 恒存在
        //（v1 旧格式已迁移归槽）；防御性 ?? 仅兜类型可选。
        const nextSlots = config.slots ?? createEmptyAiSlots();
        const initial = config.activePlatform ?? 'custom';
        setSlots(nextSlots);
        setActivePlatform(config.activePlatform ?? null);
        setEditingPlatform(initial);
        applySlotToForm(nextSlots[initial] ?? null, initial);
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [applySlotToForm]);

  const buildConfig = useCallback(
    (): AiProviderConfig | null => {
      const url = baseUrl.trim();
      const key = apiKey.trim();
      const name = model.trim();
      if (url.length === 0 || key.length === 0 || name.length === 0) return null;
      // 切片 26 阶段 2（§7.38）：单价可选，正数才写入；留空/非法不估算。
      //（已知 quirk 维持现状：本函数原本就丢 timeoutMs，切片 26 不修。）
      const parsedPriceInput = parsePriceInput(priceInput);
      const parsedPriceOutput = parsePriceInput(priceOutput);
      // 阶段 2b（v0.21）：deepseek 平台写分层六价；其余平台写全价两价。
      //（未配置的档位不写入该键——估算时段缺价只出 token 段。）
      const tier = {
        priceCachedPeak: parsePriceInput(tierPrices.priceCachedPeak),
        priceCachedOffPeak: parsePriceInput(tierPrices.priceCachedOffPeak),
        priceUncachedPeak: parsePriceInput(tierPrices.priceUncachedPeak),
        priceUncachedOffPeak: parsePriceInput(tierPrices.priceUncachedOffPeak),
        priceOutputPeak: parsePriceInput(tierPrices.priceOutputPeak),
        priceOutputOffPeak: parsePriceInput(tierPrices.priceOutputOffPeak),
      };
      return {
        provider: 'openai-compatible',
        baseUrl: url,
        apiKey: key,
        model: name,
        ...(editingPlatform === 'deepseek'
          ? {
              ...(tier.priceCachedPeak !== undefined ? { priceCachedPeak: tier.priceCachedPeak } : {}),
              ...(tier.priceCachedOffPeak !== undefined
                ? { priceCachedOffPeak: tier.priceCachedOffPeak }
                : {}),
              ...(tier.priceUncachedPeak !== undefined
                ? { priceUncachedPeak: tier.priceUncachedPeak }
                : {}),
              ...(tier.priceUncachedOffPeak !== undefined
                ? { priceUncachedOffPeak: tier.priceUncachedOffPeak }
                : {}),
              ...(tier.priceOutputPeak !== undefined ? { priceOutputPeak: tier.priceOutputPeak } : {}),
              ...(tier.priceOutputOffPeak !== undefined
                ? { priceOutputOffPeak: tier.priceOutputOffPeak }
                : {}),
            }
          : {
              ...(parsedPriceInput !== undefined
                ? { priceInputPerMillion: parsedPriceInput }
                : {}),
              ...(parsedPriceOutput !== undefined
                ? { priceOutputPerMillion: parsedPriceOutput }
                : {}),
            }),
        ...(editingPlatform !== 'custom' ? { platform: editingPlatform } : {}),
      };
    },
    [baseUrl, apiKey, model, priceInput, priceOutput, editingPlatform, tierPrices],
  );

  const handleSave = useCallback(async (): Promise<void> => {
    const config = buildConfig();
    if (config === null) {
      Alert.alert('无法保存', 'BaseURL、API Key、Model 均不能为空');
      return;
    }
    setSaving(true);
    try {
      // 阶段 2c（v0.22）：写入当前编辑平台槽并激活（保存即激活——用户确认）。
      // active 恒等于 slots[activePlatform]（不变式，isAiConfig 归一口径）。
      const nextSlots = { ...(slots ?? createEmptyAiSlots()), [editingPlatform]: config };
      await store.save({ active: config, slots: nextSlots, activePlatform: editingPlatform });
      setSlots(nextSlots);
      setActivePlatform(editingPlatform);
      setSavedTick((n) => n + 1);
    } catch {
      Alert.alert('保存失败', '写入安全存储失败，请重试');
    } finally {
      setSaving(false);
    }
  }, [buildConfig, slots, editingPlatform]);

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
            // 阶段 2c（v0.22）：清除全部平台槽，表单回到 custom 空槽默认。
            setSlots(null);
            setActivePlatform(null);
            setEditingPlatform('custom');
            applySlotToForm(null, 'custom');
            setTestState({ phase: 'idle' });
            setSavedTick((n) => n + 1);
          })();
        },
      },
    ]);
  }, [applySlotToForm]);

  // 阶段 2c（v0.22）：点平台 chip = 切换编辑视图——从该平台槽回填表单
  //（空槽按预设默认值初始化；未保存的编辑直接丢弃，不提示——MVP 口径）。
  // 「使用中」平台只在保存时切换（保存即激活，用户已确认）。
  // 按钮保存态一并重置：避免上一平台的「已保存」残态误导当前编辑。
  const handlePlatformPress = useCallback(
    (id: AiPlatform): void => {
      setEditingPlatform(id);
      applySlotToForm(slots?.[id] ?? null, id);
      setSavedTick(0);
    },
    [slots, applySlotToForm],
  );

  // 阶段 2b（v0.21）：点 Model 预设 chip 填入输入框；deepseek 平台的官方
  // 预设模型顺手预填六价输入框（覆盖当前分层价文本——显式点选才触发）。
  const handleModelPresetPress = useCallback(
    (name: string): void => {
      setModel(name);
      const presetPrices = editingPlatform === 'deepseek' ? DEEPSEEK_MODEL_TIER_PRICES[name] : undefined;
      if (presetPrices !== undefined) {
        setTierPrices({
          priceCachedPeak: presetPrices.priceCachedPeak,
          priceCachedOffPeak: presetPrices.priceCachedOffPeak,
          priceUncachedPeak: presetPrices.priceUncachedPeak,
          priceUncachedOffPeak: presetPrices.priceUncachedOffPeak,
          priceOutputPeak: presetPrices.priceOutputPeak,
          priceOutputOffPeak: presetPrices.priceOutputOffPeak,
        });
      }
    },
    [editingPlatform],
  );

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>连接配置</Text>
      <Text style={styles.hint}>
        兼容 OpenAI / DeepSeek 等 OpenAI 兼容端点。各平台配置（含 Key）独立保存，切换平台仅切换编辑视图；「保存配置」写入当前编辑平台并将其设为使用中。Key 仅存于系统安全存储。
      </Text>

      {/* 阶段 2c（v0.22）：平台 chips——点选切换编辑视图（从该平台槽回填），
          「使用中」徽标仅在保存时跟随 activePlatform。零新依赖。 */}
      <Text style={styles.label}>平台</Text>
      <View style={styles.chipRow}>
        {AI_PLATFORM_IDS.map((id) => (
          <Pressable
            key={id}
            style={({ pressed }) => [
              styles.chip,
              editingPlatform === id && styles.chipActive,
              pressed && styles.pressed,
            ]}
            onPress={() => handlePlatformPress(id)}
          >
            <Text style={[styles.chipText, editingPlatform === id && styles.chipTextActive]}>
              {AI_PLATFORM_PRESETS[id].label}
              {activePlatform === id ? ' · 使用中' : ''}
            </Text>
          </Pressable>
        ))}
      </View>

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
      {AI_PLATFORM_PRESETS[editingPlatform].models.length > 0 ? (
        <View style={styles.chipRow}>
          {AI_PLATFORM_PRESETS[editingPlatform].models.map((name) => (
            <Pressable
              key={name}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
              onPress={() => handleModelPresetPress(name)}
            >
              <Text style={styles.chipText}>{name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <TextInput
        style={styles.input}
        value={model}
        onChangeText={setModel}
        placeholder={DEFAULT_MODEL}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {/* 用量单价（可选）。阶段 2b（v0.21）：按平台切换计价形态——
          deepseek 走峰谷分层六价（缓存命中/未命中/输出 × 高峰/空闲），
          其余平台维持全价上界两价（v0.20 口径）。非法/非正数保存时静默丢弃。 */}
      {editingPlatform === 'deepseek' ? (
        <>
          <Text style={styles.label}>用量单价（每百万 tokens，可选，DeepSeek 分层）</Text>
          <Text style={styles.hint}>
            高峰=北京时间周一至周五 9:00–12:00、14:00–18:00（法定节假日按空闲计）；其余时段空闲。费用按缓存命中/未命中/输出三段分别计价；某段未填价则该轮只显示 tokens。
          </Text>
          <Text style={styles.priceGroupLabel}>缓存命中（高峰 / 空闲）</Text>
          <View style={styles.pricePairRow}>
            <TextInput
              style={styles.input}
              value={tierPrices.priceCachedPeak}
              onChangeText={(t) => setTierPrices((p) => ({ ...p, priceCachedPeak: t }))}
              placeholder="高峰，如 0.04"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={styles.input}
              value={tierPrices.priceCachedOffPeak}
              onChangeText={(t) => setTierPrices((p) => ({ ...p, priceCachedOffPeak: t }))}
              placeholder="空闲，如 0.02"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="decimal-pad"
            />
          </View>
          <Text style={styles.priceGroupLabel}>缓存未命中（高峰 / 空闲）</Text>
          <View style={styles.pricePairRow}>
            <TextInput
              style={styles.input}
              value={tierPrices.priceUncachedPeak}
              onChangeText={(t) => setTierPrices((p) => ({ ...p, priceUncachedPeak: t }))}
              placeholder="高峰，如 2"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={styles.input}
              value={tierPrices.priceUncachedOffPeak}
              onChangeText={(t) => setTierPrices((p) => ({ ...p, priceUncachedOffPeak: t }))}
              placeholder="空闲，如 1"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="decimal-pad"
            />
          </View>
          <Text style={styles.priceGroupLabel}>输出（高峰 / 空闲）</Text>
          <View style={styles.pricePairRow}>
            <TextInput
              style={styles.input}
              value={tierPrices.priceOutputPeak}
              onChangeText={(t) => setTierPrices((p) => ({ ...p, priceOutputPeak: t }))}
              placeholder="高峰，如 8"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={styles.input}
              value={tierPrices.priceOutputOffPeak}
              onChangeText={(t) => setTierPrices((p) => ({ ...p, priceOutputOffPeak: t }))}
              placeholder="空闲，如 4"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="decimal-pad"
            />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.label}>用量单价（每百万 tokens，可选）</Text>
          <Text style={styles.hint}>
            用于 AI 回复的用量费用估算（按全价上界计，不区分缓存折扣，不做币种换算）。两项都填才估算费用；留空则不显示费用段。
          </Text>
          <TextInput
            style={styles.input}
            value={priceInput}
            onChangeText={setPriceInput}
            placeholder="输入单价，如 2"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="decimal-pad"
          />
          <TextInput
            style={styles.input}
            value={priceOutput}
            onChangeText={setPriceOutput}
            placeholder="输出单价，如 8"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="decimal-pad"
          />
        </>
      )}

      <Pressable
        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        onPress={() => void handleSave()}
        disabled={saving || !loaded}
      >
        {saving ? (
          <ActivityIndicator color={colors.textOnPrimary} />
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
          <ActivityIndicator color={colors.text} />
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

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: c.background,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: c.text,
    marginBottom: 6,
  },
  hint: {
    fontSize: 13,
    color: c.textMuted,
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
    color: c.textMuted,
  },
  label: {
    fontSize: 13,
    color: c.textMuted,
    marginTop: 14,
    marginBottom: 6,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    borderRadius: 10,
    backgroundColor: c.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: c.text,
  },
  // 阶段 2b（v0.21）：平台/Model 预设 chips（flexWrap 防挤爆，§7.32）。
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.card,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  chipActive: {
    borderColor: c.primary,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    color: c.text,
  },
  chipTextActive: {
    color: c.primary,
    fontWeight: '600',
  },
  priceGroupLabel: {
    fontSize: 12,
    color: c.textMuted,
    marginTop: 8,
    marginBottom: 4,
  },
  pricePairRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  primaryButton: {
    marginTop: 24,
    backgroundColor: c.primary,
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 13,
  },
  primaryText: {
    color: c.textOnPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    marginTop: 12,
    backgroundColor: c.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 13,
  },
  secondaryText: {
    color: c.text,
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
    backgroundColor: c.card,
  },
  resultFail: {
    backgroundColor: c.card,
  },
  resultText: {
    fontSize: 13,
    color: c.text,
    lineHeight: 18,
  },
  dangerButton: {
    marginTop: 24,
    alignItems: 'center',
    paddingVertical: 12,
  },
  dangerText: {
    fontSize: 14,
    color: c.danger,
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
}
