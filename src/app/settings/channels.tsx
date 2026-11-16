import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { itemRepository } from '../../data';
import type { ChannelPreset, ChannelPresetType } from '../../domain/channelPreset';
import ChannelPresetEditor from '../../ui/ChannelPresetEditor';
import type { ChannelPresetDraft } from '../../ui/ChannelPresetEditor';
import { channelPresetSummary } from '../../ui/reminderForm';
import { useTheme } from '../../ui/theme';
import type { ThemeColors } from '../../ui/theme';

/**
 * 提醒渠道预设管理页（切片 17 阶段 2，AGENTS.md §7.27 / §7.28）：
 * - 列出全局渠道预设（listChannelPresets，created_at 降序），展示名称/类型/摘要；
 * - 新建（ChannelPresetEditor，type 可选）与编辑（type 锁定）走页内展开表单；
 * - 删除走 Alert 确认（契约：删除预设不影响已保存提醒的 channel_config）；
 * - config 构建与校验在 ChannelPresetEditor 内完成，本页只做 Repository 调用与错误透出。
 */

const TYPE_LABELS: Record<ChannelPresetType, string> = {
  webhook: 'Webhook',
  apprise: 'Apprise',
};

export default function ChannelPresetSettingsPage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [presets, setPresets] = useState<ChannelPreset[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const loaded = await itemRepository.listChannelPresets();
      setPresets(loaded);
      setError(null);
    } catch (err) {
      console.warn('[slice-17] 渠道预设列表读取失败', err);
      setError(`读取失败：${String(err)}`);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleCreate = useCallback(
    async (draft: ChannelPresetDraft): Promise<void> => {
      if (saving) {
        return;
      }
      setSaving(true);
      try {
        await itemRepository.createChannelPreset({
          name: draft.name,
          type: draft.type,
          configJson: draft.configJson,
        });
        setCreating(false);
        await load();
      } catch (err) {
        console.warn('[slice-17] 渠道预设创建失败', err);
        setError(`保存失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setSaving(false);
      }
    },
    [saving, load],
  );

  const handleUpdate = useCallback(
    async (preset: ChannelPreset, draft: ChannelPresetDraft): Promise<void> => {
      if (saving) {
        return;
      }
      setSaving(true);
      try {
        await itemRepository.updateChannelPreset(preset.id, {
          name: draft.name,
          configJson: draft.configJson,
        });
        setExpandedId(null);
        await load();
      } catch (err) {
        console.warn('[slice-17] 渠道预设更新失败', err);
        setError(`保存失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setSaving(false);
      }
    },
    [saving, load],
  );

  const handleSetDefault = useCallback(
    async (preset: ChannelPreset): Promise<void> => {
      if (saving) {
        return;
      }
      setSaving(true);
      try {
        // 同 type 其余预设自动取消默认（Repository 事务内保证，AGENTS.md §7.29）。
        await itemRepository.updateChannelPreset(preset.id, { isDefault: true });
        await load();
      } catch (err) {
        console.warn('[slice-18] 设为默认失败', err);
        setError(`设为默认失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setSaving(false);
      }
    },
    [saving, load],
  );

  const handleDelete = useCallback(
    (preset: ChannelPreset): void => {
      Alert.alert(
        '删除预设',
        `确定删除「${preset.name}」吗？已保存的提醒不受影响（其渠道配置已随提醒保存）。`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  await itemRepository.deleteChannelPreset(preset.id);
                  setExpandedId(null);
                  await load();
                } catch (err) {
                  console.warn('[slice-17] 渠道预设删除失败', err);
                  setError(`删除失败：${String(err)}`);
                }
              })();
            },
          },
        ],
      );
    },
    [load],
  );

  if (presets === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.hint}>
        把 Webhook / Apprise 的常用配置存为预设，在提醒详情页直接选择，无需每次输入长 URL。
      </Text>

      {creating ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>新建预设</Text>
          <ChannelPresetEditor
            initial={null}
            saving={saving}
            onSave={(draft) => {
              void handleCreate(draft);
            }}
            onCancel={() => setCreating(false)}
          />
        </View>
      ) : (
        <Pressable
          style={styles.primaryButton}
          onPress={() => {
            setExpandedId(null);
            setCreating(true);
          }}
        >
          <Text style={styles.primaryText}>＋ 新建预设</Text>
        </Pressable>
      )}

      {presets.map((preset) => {
        const expanded = expandedId === preset.id;
        return (
          <View key={preset.id} style={styles.card}>
            <Pressable
              style={styles.row}
              onPress={() => {
                setCreating(false);
                setExpandedId(expanded ? null : preset.id);
              }}
            >
              <View style={styles.rowTextCol}>
                <Text style={styles.presetName}>
                  {preset.isDefault ? '★ ' : ''}{preset.name}
                </Text>
                <Text style={styles.presetMeta}>
                  {`[${TYPE_LABELS[preset.type]}]${preset.isDefault ? ' 默认' : ''} ${channelPresetSummary(preset)}`}
                </Text>
              </View>
              <Text style={styles.rowAction}>{expanded ? '收起' : '编辑'}</Text>
            </Pressable>
            {!preset.isDefault ? (
              <Pressable
                style={styles.defaultButton}
                disabled={saving}
                onPress={() => {
                  void handleSetDefault(preset);
                }}
              >
                <Text style={styles.defaultText}>设为默认</Text>
              </Pressable>
            ) : null}
            {expanded ? (
              <View>
                <ChannelPresetEditor
                  initial={{ name: preset.name, type: preset.type, configJson: preset.configJson }}
                  saving={saving}
                  onSave={(draft) => {
                    void handleUpdate(preset, draft);
                  }}
                  onCancel={() => setExpandedId(null)}
                />
                <Pressable
                  style={styles.deleteButton}
                  onPress={() => handleDelete(preset)}
                >
                  <Text style={styles.deleteText}>删除预设</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}

      {presets.length === 0 && !creating ? (
        <Text style={styles.emptyText}>暂无预设。点击「＋ 新建预设」创建第一个。</Text>
      ) : null}

      {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: c.background,
  },
  container: {
    padding: 16,
    paddingBottom: 32,
  },
  hint: {
    fontSize: 12,
    color: c.textMuted,
    lineHeight: 18,
    marginBottom: 10,
  },
  primaryButton: {
    backgroundColor: c.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryText: {
    fontSize: 14,
    color: c.textOnPrimary,
    fontWeight: '600',
  },
  card: {
    backgroundColor: c.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: c.text,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowTextCol: {
    flex: 1,
    gap: 2,
  },
  presetName: {
    fontSize: 15,
    color: c.text,
  },
  presetMeta: {
    fontSize: 12,
    color: c.textMuted,
  },
  rowAction: {
    fontSize: 13,
    color: c.primary,
  },
  defaultButton: {
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: c.primary,
    borderRadius: 6,
  },
  defaultText: {
    fontSize: 13,
    color: c.primary,
  },
  deleteButton: {
    marginTop: 8,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.danger,
    borderRadius: 6,
  },
  deleteText: {
    fontSize: 13,
    color: c.danger,
  },
  emptyText: {
    fontSize: 13,
    color: c.textMuted,
    textAlign: 'center',
    marginTop: 16,
  },
  errorText: {
    fontSize: 12,
    color: c.danger,
    marginTop: 8,
  },
  });
}
