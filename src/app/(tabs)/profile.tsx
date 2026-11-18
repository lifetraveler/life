import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

import { itemRepository } from '../../data';
import { serializeExportData } from '../../domain/export';
import { buildIcs } from '../../domain/ics/buildIcs';
import type { AppSettings, FlashDeletedCardDisplay, TagDisplayMode } from '../../domain/settings';
import TagChip from '../../ui/TagChip';
import { getDeviceTzid } from '../../ui/timeFormat';
import { useTheme } from '../../ui/theme';
import type { ThemeColors } from '../../ui/theme';
import { refreshWidgetDataNow } from '../../widget';
import {
  setLastExportResult,
  setLastImportResult,
} from '../../ui/transferResultStore';
import { setLastImportPreview } from '../../ui/importPreviewStore';

/**
 * 「我的」Tab（切片 14 阶段 5：原 src/app/settings.tsx 移入 (tabs)/profile.tsx，
 * 去导航头、顶部加大标题「我的」，toki_1.webp 底部第 4 入口）。
 * 设置页正文（切片 8/9，tasks/slice-08.md 实现要求 4/5、tasks/slice-09.md 实现要求 3）：
 * - 导入 ICS：DocumentPicker 选文件 → generateIcsPreview → /import-preview 预览页
 *   （切片 17 阶段 2，§7.28：先预览勾选，确认后才 importItemsInBatches 落库 → 结果页）；
 *   导入完成后 fire-and-forget 触发一次 reconcile()（失败不阻断结果页）；
 * - 导出 ICS：listItemsForExport → buildIcs → 写入 cache 目录 → Sharing 分享 → 成功页；
 * - 导出 JSON（切片 12，tasks/slice-12.md 实现要求 3）：默认列表 ∪ 归档列表 + 全库
 *   Reminder → serializeExportData → 写入 cache 目录 → Sharing 分享；成功/失败
 *   页内提示（不用 Alert），导出路径纯只读、不触发 reconcile；
 * - 系统日历（切片 9）：纯导航入口 → /system-calendar-import（权限/选择/结果都在该页内）；
 * - 主页不放导入/导出入口（任务卡明确要求入口只在设置页）。
 */

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 导出文件名时间戳（设备本地时间）：YYYYMMDD-HHmmss */
function exportFileStamp(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(
    d.getHours(),
  )}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

/** 标签展示样式选项（§7.22 tagDisplayMode；切片 14 阶段 3 验收 7） */
const TAG_DISPLAY_OPTIONS: ReadonlyArray<{ value: TagDisplayMode; label: string }> = [
  { value: 'text', label: '纯文字' },
  { value: 'emoji', label: '仅表情' },
  { value: 'both', label: '表情 + 文字' },
];

/** 单选行的效果示例标签（固定样例数据，非数据库记录） */
const SAMPLE_TAG = { name: '示例', color: '#64B5F6', emoji: '💼' };

/**
 * 小组件显示开关定义（阶段 7a 建过期/待办两项；阶段 7c 补分类 emoji/标签两项——
 * 渲染消费随 7c 落地，存储列 schema v7 早已建好）。
 */
type WidgetShowFlagKey =
  | 'widgetShowOverdue'
  | 'widgetShowTodos'
  | 'widgetShowCategoryEmoji'
  | 'widgetShowTags';

const WIDGET_TOGGLE_OPTIONS: ReadonlyArray<{
  key: WidgetShowFlagKey;
  label: string;
  hint: string;
}> = [
  {
    key: 'widgetShowOverdue',
    label: '展示过期项',
    hint: '已过期任务显示在小组件今日列表底部（可滚动查看全部）。',
  },
  {
    key: 'widgetShowTodos',
    label: '展示待办项',
    hint: '没有时间的待办显示在小组件今日列表底部。',
  },
  {
    key: 'widgetShowCategoryEmoji',
    label: '显示分类图标',
    hint: '小组件条目在色点旁显示分类 emoji。',
  },
  {
    key: 'widgetShowTags',
    label: '显示标签',
    hint: '小组件条目显示标签，文案跟随上方「标签展示样式」。',
  },
];

/** AI 服务重试档位选项（切片 30，AGENTS.md §7.41 aiRetryMax：0–5 整数，0=关闭） */
const AI_RETRY_TIER_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: '0 次（关闭）' },
  { value: 1, label: '1 次' },
  { value: 3, label: '3 次（默认）' },
  { value: 5, label: '5 次' },
];

/** 已删除条目卡片显示选项（切片 30，AGENTS.md §7.41 flashDeletedCardDisplay） */
const FLASH_DELETED_DISPLAY_OPTIONS: ReadonlyArray<{
  value: FlashDeletedCardDisplay;
  label: string;
  hint: string;
}> = [
  {
    value: 'mark',
    label: '标记已删除',
    hint: '卡片置灰并加「已删除」角标，不可点进、快捷操作隐藏（默认）。',
  },
  {
    value: 'remove',
    label: '从对话移除',
    hint: '该结果卡直接从聊天列表消失（本次会话内）。',
  },
];

export default function SettingsPage() {
  // 切片 24（§7.36）：颜色走全局 Token（夜间模式），深浅色跟随系统。
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [busy, setBusy] = useState<'import' | 'export' | null>(null);
  // 切片 12：JSON 导出的页内结果提示（成功/失败都不用 Alert，任务卡实现要求 3）。
  const [exportJsonResult, setExportJsonResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // 切片 14 阶段 3：全局标签展示样式（app_settings.tagDisplayMode）。
  // null = 尚未加载完成；切换为乐观更新，失败回滚并页内提示（不用 Alert）。
  const [displayMode, setDisplayMode] = useState<TagDisplayMode | null>(null);
  const [modeSaving, setModeSaving] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);

  // 阶段 7a：小组件显示开关（app_settings schema v7）。与 displayMode 同一次 getSettings
  // 读取；乐观更新 + 失败回滚 + 页内提示；保存成功后手动触发一次小组件快照刷新
  // （桥不订阅 app_settings，见 docs/proposals/slice-14-widget-phase7.md）。
  const [widgetFlags, setWidgetFlags] = useState<Pick<
    AppSettings,
    WidgetShowFlagKey
  > | null>(null);
  // 切片 25 阶段 2（AGENTS.md §7.37）：认真模式开关（app_settings schema v12，
  // carefulMode 默认 false）。保存互斥键扩为 settingsSavingKey——本页全部写开关
  // 共用（app_settings 为单行读改写，跨区块并发写会丢字段）。
  const [carefulMode, setCarefulMode] = useState<boolean | null>(null);
  const [settingsSavingKey, setSettingsSavingKey] = useState<string | null>(null);
  const [carefulError, setCarefulError] = useState<string | null>(null);
  // 切片 26 阶段 2（AGENTS.md §7.38）：AI 用量展示开关（app_settings schema v13，
  // showAiUsage 默认 false = 不显示）。与认真模式开关共用互斥键 settingsSavingKey。
  const [showAiUsage, setShowAiUsage] = useState<boolean | null>(null);
  const [showAiUsageError, setShowAiUsageError] = useState<string | null>(null);
  // 切片 30 阶段 1（AGENTS.md §7.41）：AI 重试档位与已删除卡显示配置
  // （app_settings schema v15）。与上述开关共用互斥键 settingsSavingKey。
  const [aiRetryMax, setAiRetryMax] = useState<number | null>(null);
  const [aiRetryError, setAiRetryError] = useState<string | null>(null);
  const [flashDeletedDisplay, setFlashDeletedDisplay] = useState<FlashDeletedCardDisplay | null>(
    null,
  );
  const [flashDeletedError, setFlashDeletedError] = useState<string | null>(null);
  const [widgetError, setWidgetError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      itemRepository
        .getSettings()
        .then((settings) => {
          if (!cancelled) {
            setDisplayMode(settings.tagDisplayMode);
            setWidgetFlags({
              widgetShowOverdue: settings.widgetShowOverdue,
              widgetShowTodos: settings.widgetShowTodos,
              widgetShowCategoryEmoji: settings.widgetShowCategoryEmoji,
              widgetShowTags: settings.widgetShowTags,
            });
            // 切片 25 阶段 2（§7.37）：认真模式开关随同一次 getSettings 读取
            //（读层已防御归一，旧数据回退 false）。
            setCarefulMode(settings.carefulMode === true);
            // 切片 26 阶段 2（§7.38）：用量展示开关随同一次 getSettings 读取
            //（读层已防御归一，旧数据回退 false）。
            setShowAiUsage(settings.showAiUsage === true);
            // 切片 30 阶段 1（§7.41）：重试档位/已删除卡显示随同一次 getSettings 读取
            //（读层已防御归一，旧数据回退 3 / 'mark'）。
            setAiRetryMax(settings.aiRetryMax);
            setFlashDeletedDisplay(settings.flashDeletedCardDisplay);
          }
        })
        .catch((error: unknown) => {
          console.warn('[slice-14] 读取标签展示样式失败', error);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const handleModeChange = useCallback(
    async (mode: TagDisplayMode): Promise<void> => {
      if (modeSaving || displayMode === null || mode === displayMode) {
        return;
      }
      const previous = displayMode;
      setDisplayMode(mode);
      setModeSaving(true);
      try {
        await itemRepository.updateSettings({ tagDisplayMode: mode });
        setModeError(null);
      } catch (error) {
        console.warn('[slice-14] 标签展示样式保存失败', error);
        setDisplayMode(previous);
        setModeError('保存失败，请重试');
      } finally {
        setModeSaving(false);
      }
    },
    [modeSaving, displayMode],
  );

  /**
   * 阶段 7a：小组件显示开关切换。乐观更新 → updateSettings → 成功后手动触发一次
   * 小组件快照重写 + requestWidgetUpdate（fire-and-forget，失败仅 warn——快照刷新
   * 失败不影响设置保存本身）。阶段 7b 起改走 refreshWidgetDataNow 统一管线：
   * 今日+周两张快照都重写并按页状态渲染（开关只影响今日页，但渲染必须保持在
   * 用户当前停留的页上，不能让开关把周页顶回今日页）。
   */
  const handleWidgetFlagChange = useCallback(
    async (
      key: WidgetShowFlagKey,
      value: boolean,
    ): Promise<void> => {
      if (widgetFlags === null || settingsSavingKey !== null || widgetFlags[key] === value) {
        return;
      }
      const previous = widgetFlags;
      setWidgetFlags({ ...widgetFlags, [key]: value });
      setSettingsSavingKey(key);
      try {
        await itemRepository.updateSettings({ [key]: value });
        setWidgetError(null);
        await refreshWidgetDataNow('settings-toggle');
      } catch (error) {
        console.warn('[slice-14] 小组件显示开关保存失败', error);
        setWidgetFlags(previous);
        setWidgetError('保存失败，请重试');
      } finally {
        setSettingsSavingKey(null);
      }
    },
    [widgetFlags, settingsSavingKey],
  );

  /**
   * 切片 25 阶段 2（AGENTS.md §7.37）：认真模式开关切换。与小组件开关同模式：
   * 乐观更新 → updateSettings({ carefulMode }) → 失败回滚；即时生效（闪电录入
   * 每轮解析前经 getSettings 重读）且写入 app_settings 持久层，重启保持。
   */
  const handleCarefulModeChange = useCallback(
    async (value: boolean): Promise<void> => {
      if (carefulMode === null || settingsSavingKey !== null || carefulMode === value) {
        return;
      }
      const previous = carefulMode;
      setCarefulMode(value);
      setSettingsSavingKey('carefulMode');
      try {
        await itemRepository.updateSettings({ carefulMode: value });
        setCarefulError(null);
      } catch (error) {
        console.warn('[slice-25] 认真模式开关保存失败', error);
        setCarefulMode(previous);
        setCarefulError('保存失败，请重试');
      } finally {
        setSettingsSavingKey(null);
      }
    },
    [carefulMode, settingsSavingKey],
  );

  /**
   * 切片 26 阶段 2（AGENTS.md §7.38）：AI 用量展示开关切换。与认真模式同模式：
   * 乐观更新 → updateSettings({ showAiUsage }) → 失败回滚；即时生效（闪电录入
   * 每轮解析后经 getSettings 重读）且写入 app_settings 持久层，重启保持。
   */
  const handleShowAiUsageChange = useCallback(
    async (value: boolean): Promise<void> => {
      if (showAiUsage === null || settingsSavingKey !== null || showAiUsage === value) {
        return;
      }
      const previous = showAiUsage;
      setShowAiUsage(value);
      setSettingsSavingKey('showAiUsage');
      try {
        await itemRepository.updateSettings({ showAiUsage: value });
        setShowAiUsageError(null);
      } catch (error) {
        console.warn('[slice-26] 用量展示开关保存失败', error);
        setShowAiUsage(previous);
        setShowAiUsageError('保存失败，请重试');
      } finally {
        setSettingsSavingKey(null);
      }
    },
    [showAiUsage, settingsSavingKey],
  );

  /**
   * 切片 30 阶段 1（AGENTS.md §7.41）：AI 重试档位切换。与用量展示同模式：
   * 乐观更新 → updateSettings({ aiRetryMax }) → 失败回滚；即时生效（重试包装
   * 每轮解析前经 getSettings 重读）且写入 app_settings 持久层，重启保持。
   */
  const handleAiRetryMaxChange = useCallback(
    async (value: number): Promise<void> => {
      if (aiRetryMax === null || settingsSavingKey !== null || aiRetryMax === value) {
        return;
      }
      const previous = aiRetryMax;
      setAiRetryMax(value);
      setSettingsSavingKey('aiRetryMax');
      try {
        await itemRepository.updateSettings({ aiRetryMax: value });
        setAiRetryError(null);
      } catch (error) {
        console.warn('[slice-30] AI 重试档位保存失败', error);
        setAiRetryMax(previous);
        setAiRetryError('保存失败，请重试');
      } finally {
        setSettingsSavingKey(null);
      }
    },
    [aiRetryMax, settingsSavingKey],
  );

  /**
   * 切片 30 阶段 1（AGENTS.md §7.41）：已删除卡显示方式切换。与重试档位同模式：
   * 乐观更新 → updateSettings({ flashDeletedCardDisplay }) → 失败回滚；
   * 即时生效（存在性查询/渲染每轮 focus 重读）且重启保持。
   */
  const handleFlashDeletedDisplayChange = useCallback(
    async (value: FlashDeletedCardDisplay): Promise<void> => {
      if (
        flashDeletedDisplay === null ||
        settingsSavingKey !== null ||
        flashDeletedDisplay === value
      ) {
        return;
      }
      const previous = flashDeletedDisplay;
      setFlashDeletedDisplay(value);
      setSettingsSavingKey('flashDeletedCardDisplay');
      try {
        await itemRepository.updateSettings({ flashDeletedCardDisplay: value });
        setFlashDeletedError(null);
      } catch (error) {
        console.warn('[slice-30] 已删除卡显示保存失败', error);
        setFlashDeletedDisplay(previous);
        setFlashDeletedError('保存失败，请重试');
      } finally {
        setSettingsSavingKey(null);
      }
    },
    [flashDeletedDisplay, settingsSavingKey],
  );

  const handleImport = useCallback(async (): Promise<void> => {
    if (busy !== null) {
      return;
    }
    setBusy('import');
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        // .ics 在不同设备上可能映射为 text/calendar 或 application/octet-stream，放宽为任意类型
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (picked.canceled) {
        return;
      }
      const asset = picked.assets[0];
      if (!asset) {
        return;
      }
      const text = await FileSystem.readAsStringAsync(asset.uri);
      // 切片 17 阶段 2（AGENTS.md §7.28）：导入先预览——解析 + 本地去重标记，
      // 纯读不落库；勾选确认后由 /import-preview 页调用 importItemsInBatches 落库。
      const result = await itemRepository.generateIcsPreview(text, getDeviceTzid());
      setLastImportPreview({
        source: 'ics',
        fileName: asset.name ?? null,
        entries: result.entries.map((entry) => ({
          input: entry.input,
          floating: entry.floating,
          isDuplicate: entry.isDuplicate,
          existingItemId: entry.existingItemId,
        })),
        failures: result.failures.map((failure) => ({
          summary: failure.summary,
          reason: failure.reason,
        })),
        sameFileDuplicates: result.sameFileDuplicates,
        duplicateCount: result.duplicateCount,
        meta: null,
      });
      router.push('/import-preview');
    } catch (error) {
      console.warn('[slice-08] 导入失败', error);
      Alert.alert('导入失败', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [busy, router]);

  const handleExport = useCallback(async (): Promise<void> => {
    if (busy !== null) {
      return;
    }
    setBusy('export');
    try {
      const items = await itemRepository.listItemsForExport({
        includeArchived: false,
        includeDone: true,
      });
      const now = Date.now();
      const ics = buildIcs(items, { tzid: getDeviceTzid(), now });
      const fileName = `life-export-${exportFileStamp(now)}.ics`;
      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(fileUri, ics, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      let shared = false;
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/calendar',
          dialogTitle: '分享 ICS 导出文件',
        });
        shared = true;
      }
      setLastExportResult({ count: items.length, fileName, fileUri, shared });
      router.push('/export-success');
    } catch (error) {
      console.warn('[slice-08] 导出失败', error);
      Alert.alert('导出失败', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [busy, router]);

  // 切片 12 JSON 导出（tasks/slice-12.md 实现要求 3）：范围=默认列表 ∪ 归档列表
  // （决策 B，含 archived/done），提醒=全库（决策 A-1）；序列化纯函数在
  // src/domain/export.ts。与 ICS 导出共用 busy='export'；不触发 reconcile。
  const handleExportJson = useCallback(async (): Promise<void> => {
    if (busy !== null) {
      return;
    }
    setBusy('export');
    setExportJsonResult(null);
    try {
      const [defaultItems, archivedItems, allReminders] = await Promise.all([
        itemRepository.listItemsWithTags(),
        itemRepository.listArchivedItemsWithTags(),
        itemRepository.listAllReminders(),
      ]);
      const json = serializeExportData(
        [...defaultItems, ...archivedItems],
        allReminders,
      );
      const now = Date.now();
      const fileName = `life-export-${exportFileStamp(now)}.json`;
      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(fileUri, json, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const count = defaultItems.length + archivedItems.length;
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/json',
          dialogTitle: '分享 JSON 导出文件',
        });
        setExportJsonResult({
          ok: true,
          text: `导出成功：${fileName}（${count} 条，已打开分享面板）`,
        });
      } else {
        setExportJsonResult({
          ok: true,
          text: `导出成功：${fileName}（${count} 条，文件位于 ${fileUri}）`,
        });
      }
    } catch (error) {
      console.warn('[slice-12] JSON 导出失败', error);
      setExportJsonResult({ ok: false, text: '导出失败，请重试' });
    } finally {
      setBusy(null);
    }
  }, [busy]);

  return (
    // 阶段 5：外层包一列，「我的」大标题替代导航头（(tabs) 布局 headerShown:false）
    <View style={styles.page}>
      {/* 「我的」大标题（阶段 5，toki_1.webp：我的页顶部标题） */}
      <Text style={styles.pageTitle}>我的</Text>
      {/* 阶段 3 新增两节后内容超出屏幕高度（用户反馈「设置页无法下滑」）：
          原为固定 View 列，四个节恰好满屏；改 ScrollView 使全部节可达。 */}
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>分类与标签</Text>
        <Text style={styles.hint}>自定义预置分类与标签的颜色、图标。</Text>
        <Pressable style={styles.navRow} onPress={() => router.push('/settings/categories')}>
          <Text style={styles.navLabel}>分类管理</Text>
          <Text style={styles.navChevron}>›</Text>
        </Pressable>
        <Pressable style={styles.navRow} onPress={() => router.push('/settings/tags')}>
          <Text style={styles.navLabel}>标签管理</Text>
          <Text style={styles.navChevron}>›</Text>
        </Pressable>
        <Pressable style={styles.navRow} onPress={() => router.push('/settings/ai')}>
          <Text style={styles.navLabel}>AI 配置</Text>
          <Text style={styles.navChevron}>›</Text>
        </Pressable>
        {/* 切片 26 阶段 2（AGENTS.md §7.38）：提示词只读查看页入口。 */}
        <Pressable style={styles.navRow} onPress={() => router.push('/settings/ai-prompt')}>
          <Text style={styles.navLabel}>AI 提示词</Text>
          <Text style={styles.navChevron}>›</Text>
        </Pressable>
        {/* 切片 25 阶段 2（AGENTS.md §7.37）：认真模式开关。carefulMode 读取失败
            保持 null（行仍渲染、Switch 关着），保存互斥走 settingsSavingKey。 */}
        <View style={styles.widgetToggleRow}>
          <View style={styles.widgetToggleText}>
            <Text style={styles.radioLabel}>认真模式</Text>
            <Text style={styles.widgetToggleHint}>修改标题/内容前先向我确认。</Text>
          </View>
          <Switch
            value={carefulMode === true}
            onValueChange={(value) => {
              void handleCarefulModeChange(value);
            }}
            disabled={carefulMode === null || settingsSavingKey !== null}
          />
        </View>
        {carefulError !== null ? (
          <Text style={styles.errorHint}>{carefulError}</Text>
        ) : null}
        {/* 切片 26 阶段 2（AGENTS.md §7.38）：AI 用量展示开关。showAiUsage 读取
            失败保持 null（行仍渲染、Switch 关着），保存互斥走 settingsSavingKey。 */}
        <View style={styles.widgetToggleRow}>
          <View style={styles.widgetToggleText}>
            <Text style={styles.radioLabel}>AI 用量展示</Text>
            <Text style={styles.widgetToggleHint}>
              AI 回复后追加一行 tokens 与估算费用。
            </Text>
          </View>
          <Switch
            value={showAiUsage === true}
            onValueChange={(value) => {
              void handleShowAiUsageChange(value);
            }}
            disabled={showAiUsage === null || settingsSavingKey !== null}
          />
        </View>
        {showAiUsageError !== null ? (
          <Text style={styles.errorHint}>{showAiUsageError}</Text>
        ) : null}
        {/* 切片 30 阶段 1（AGENTS.md §7.41）：AI 服务重试档位（aiRetryMax，
            0–5 整数，UI 档 0/1/3/5，0=关闭即现状）。读取失败保持 null（行仍渲染、
            不可选），保存互斥走 settingsSavingKey。 */}
        <View style={styles.widgetToggleRow}>
          <View style={styles.widgetToggleText}>
            <Text style={styles.radioLabel}>AI 服务重试</Text>
            <Text style={styles.widgetToggleHint}>
              AI 服务异常时自动重试，间隔 1 秒；关闭后直接降级本地解析。
            </Text>
          </View>
        </View>
        {aiRetryMax === null ? (
          <Text style={styles.hint}>加载中…</Text>
        ) : (
          AI_RETRY_TIER_OPTIONS.map((option) => {
            const selected = aiRetryMax === option.value;
            return (
              <Pressable
                key={option.value}
                style={styles.radioRow}
                onPress={() => {
                  void handleAiRetryMaxChange(option.value);
                }}
                disabled={settingsSavingKey !== null}
              >
                <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
                  {selected ? <View style={styles.radioInner} /> : null}
                </View>
                <Text style={styles.radioLabel}>{option.label}</Text>
              </Pressable>
            );
          })
        )}
        {aiRetryError !== null ? <Text style={styles.errorHint}>{aiRetryError}</Text> : null}
        {/* 切片 30 阶段 1（AGENTS.md §7.41）：已删除条目卡片显示方式
            （flashDeletedCardDisplay：mark 置灰角标 / remove 直接移除）。 */}
        <View style={styles.widgetToggleRow}>
          <View style={styles.widgetToggleText}>
            <Text style={styles.radioLabel}>已删除条目卡片</Text>
            <Text style={styles.widgetToggleHint}>
              条目在详情页删除后，聊天里对应结果卡的处理方式。
            </Text>
          </View>
        </View>
        {flashDeletedDisplay === null ? (
          <Text style={styles.hint}>加载中…</Text>
        ) : (
          FLASH_DELETED_DISPLAY_OPTIONS.map((option) => {
            const selected = flashDeletedDisplay === option.value;
            return (
              <Pressable
                key={option.value}
                style={styles.radioRow}
                onPress={() => {
                  void handleFlashDeletedDisplayChange(option.value);
                }}
                disabled={settingsSavingKey !== null}
              >
                <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
                  {selected ? <View style={styles.radioInner} /> : null}
                </View>
                <View style={styles.widgetToggleText}>
                  <Text style={styles.radioLabel}>{option.label}</Text>
                  <Text style={styles.widgetToggleHint}>{option.hint}</Text>
                </View>
              </Pressable>
            );
          })
        )}
        {flashDeletedError !== null ? (
          <Text style={styles.errorHint}>{flashDeletedError}</Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>标签展示样式</Text>
        <Text style={styles.hint}>影响列表、详情、编辑等页面的标签显示方式。</Text>
        {TAG_DISPLAY_OPTIONS.map((option) => {
          const selected = displayMode === option.value;
          return (
            <Pressable
              key={option.value}
              style={styles.radioRow}
              onPress={() => {
                void handleModeChange(option.value);
              }}
              disabled={displayMode === null || modeSaving}
            >
              <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
                {selected ? <View style={styles.radioInner} /> : null}
              </View>
              <Text style={styles.radioLabel}>{option.label}</Text>
              <TagChip tag={SAMPLE_TAG} mode={option.value} />
            </Pressable>
          );
        })}
        {modeError !== null ? <Text style={styles.errorHint}>{modeError}</Text> : null}
      </View>

      {/* 阶段 7a：小组件显示开关（app_settings v7；emoji/标签开关随阶段 7c 渲染加入） */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>小组件显示</Text>
        <Text style={styles.hint}>控制桌面「今日待办」小组件的列表内容。</Text>
        {widgetFlags === null ? (
          <Text style={styles.hint}>加载中…</Text>
        ) : (
          WIDGET_TOGGLE_OPTIONS.map((option) => (
            <View key={option.key} style={styles.widgetToggleRow}>
              <View style={styles.widgetToggleText}>
                <Text style={styles.radioLabel}>{option.label}</Text>
                <Text style={styles.widgetToggleHint}>{option.hint}</Text>
              </View>
              <Switch
                value={widgetFlags[option.key]}
                onValueChange={(value) => {
                  void handleWidgetFlagChange(option.key, value);
                }}
                disabled={settingsSavingKey !== null}
              />
            </View>
          ))
        )}
        {widgetError !== null ? <Text style={styles.errorHint}>{widgetError}</Text> : null}
      </View>

      {/* 切片 17 阶段 2：提醒渠道预设管理（AGENTS.md §7.27）；切片 18：Chips 增量设置（§7.29） */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>提醒渠道</Text>
        <Text style={styles.hint}>管理 Webhook / Apprise 渠道预设，在提醒详情页直接选择。</Text>
        <Pressable style={styles.navRow} onPress={() => router.push('/settings/channels')}>
          <Text style={styles.navLabel}>渠道预设管理</Text>
          <Text style={styles.navChevron}>›</Text>
        </Pressable>
        <Pressable style={styles.navRow} onPress={() => router.push('/settings/chips')}>
          <Text style={styles.navLabel}>快捷 Chips 增量设置</Text>
          <Text style={styles.navChevron}>›</Text>
        </Pressable>
        {/* 切片 19 阶段 3：默认提醒方式（AGENTS.md §7.30 第二条，app_settings.defaultChannels） */}
        <Pressable style={styles.navRow} onPress={() => router.push('/settings/default-channels')}>
          <Text style={styles.navLabel}>默认提醒方式</Text>
          <Text style={styles.navChevron}>›</Text>
        </Pressable>
        {/* 切片 20 阶段 2：后台运行保障（AGENTS.md §7.31 第三条，电池优化白名单状态展示 + 弹窗/设置页引导） */}
        <Pressable style={styles.navRow} onPress={() => router.push('/settings/background-reliability')}>
          <Text style={styles.navLabel}>后台运行保障</Text>
          <Text style={styles.navChevron}>›</Text>
        </Pressable>
        {/* 切片 28（§7.42 D7）配置备份入口；切片 31（§7.43）数据备份共用本入口，文案「备份与恢复」语义已覆盖。 */}
        <Pressable style={styles.navRow} onPress={() => router.push('/settings/backup')}>
          <Text style={styles.navLabel}>备份与恢复</Text>
          <Text style={styles.navChevron}>›</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>导入</Text>
        <Text style={styles.hint}>
          选择一个 .ics 文件（如 Google Calendar 导出）。先预览勾选，确认后才写入；重复项置灰默认不选。
        </Text>
        <Pressable
          style={[styles.primaryButton, busy !== null && styles.disabled]}
          onPress={() => {
            void handleImport();
          }}
          disabled={busy !== null}
        >
          {busy === 'import' ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.primaryText}>导入 ICS</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>系统日历</Text>
        <Text style={styles.hint}>
          单向导入 Android 系统日历事件到本地（只读来源，不写回系统日历）。
        </Text>
        <Pressable style={styles.primaryButton} onPress={() => router.push('/system-calendar-import')}>
          <Text style={styles.primaryText}>导入系统日历</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>导出</Text>
        <Text style={styles.hint}>
          导出当前全部未归档条目（含已完成）为 ICS 文件，可通过系统分享面板发送或保存。
        </Text>
        <Pressable
          style={[styles.primaryButton, busy !== null && styles.disabled]}
          onPress={() => {
            void handleExport();
          }}
          disabled={busy !== null}
        >
          {busy === 'export' ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.primaryText}>导出 ICS</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>导出 JSON</Text>
        <Text style={styles.hint}>
          导出全部条目（含已完成与已归档）及其标签、提醒规则为 JSON 文件，可通过系统分享面板发送或保存。
        </Text>
        <Pressable
          style={[styles.primaryButton, busy !== null && styles.disabled]}
          onPress={() => {
            void handleExportJson();
          }}
          disabled={busy !== null}
        >
          {busy === 'export' ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.primaryText}>导出 JSON</Text>
          )}
        </Pressable>
        {exportJsonResult !== null && (
          <Text style={exportJsonResult.ok ? styles.hint : styles.errorHint}>
            {exportJsonResult.text}
          </Text>
        )}
      </View>
    </ScrollView>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: c.background,
      paddingTop: 48,
    },
    pageTitle: {
      fontSize: 24,
      fontWeight: '700',
      color: c.text,
      paddingHorizontal: 16,
      marginBottom: 12,
    },
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    content: {
      padding: 16,
      gap: 20,
    },
    section: {
      backgroundColor: c.card,
      borderRadius: 8,
      padding: 14,
      gap: 8,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
    },
    hint: {
      fontSize: 12,
      color: c.textMuted,
      lineHeight: 18,
    },
    errorHint: {
      fontSize: 12,
      color: c.danger,
      lineHeight: 18,
    },
    primaryButton: {
      backgroundColor: c.primary,
      borderRadius: 6,
      paddingVertical: 10,
      alignItems: 'center',
      alignSelf: 'flex-start',
      paddingHorizontal: 22,
    },
    primaryText: {
      color: c.textOnPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    disabled: {
      opacity: 0.5,
    },
    // —— 切片 14 阶段 3：分类/标签导航行与标签展示样式单选 ——
    navRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
      paddingHorizontal: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    navLabel: {
      fontSize: 14,
      color: c.text,
    },
    navChevron: {
      fontSize: 16,
      color: c.textMuted,
    },
    radioRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      paddingHorizontal: 4,
    },
    radioOuter: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOuterActive: {
      borderColor: c.primary,
    },
    radioInner: {
      width: 9,
      height: 9,
      borderRadius: 4.5,
      backgroundColor: c.primary,
    },
    radioLabel: {
      fontSize: 14,
      color: c.text,
      flex: 1,
    },
    // —— 切片 14 阶段 7a：小组件显示开关行 ——
    widgetToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 8,
      paddingHorizontal: 4,
    },
    widgetToggleText: {
      flex: 1,
      paddingRight: 12,
    },
    widgetToggleHint: {
      fontSize: 12,
      color: c.textMuted,
      marginTop: 2,
    },
  });
}
