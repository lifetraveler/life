import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { itemRepository } from '../../data';
import { validateChipsIncrements } from '../../domain/settings';
import { formatChipIncrementLabel } from '../../ui/OnceAtField';

/**
 * 快捷 Chips 增量设置页（切片 18 阶段 3，AGENTS.md §7.29 / 提案 §7）：
 * once 触发时刻的快捷增量默认 +10分钟/+1小时，允许改为 1–4 项、每项 1–10080 整数分钟，
 * 存入 app_settings.chipsIncrements。校验用 validateChipsIncrements（与写路径同一规则），
 * 失败展示具体文案，不落库。动态行数：默认两行（对应默认 [10, 60]）。
 */
export default function ChipsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<string[]>(['10', '60']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      itemRepository
        .getSettings()
        .then((settings) => {
          if (!active) {
            return;
          }
          setRows(settings.chipsIncrements.map((minutes) => String(minutes)));
          setError(null);
        })
        .catch((err) => {
          console.warn('[slice-18] Chips 增量读取失败', err);
          if (active) {
            setError(`读取失败：${String(err)}`);
          }
        })
        .finally(() => {
          if (active) {
            setLoading(false);
          }
        });
      return () => {
        active = false;
      };
    }, []),
  );

  const updateRow = (index: number, text: string): void => {
    setRows((current) => current.map((row, i) => (i === index ? text : row)));
    setSaved(false);
  };

  const addRow = (): void => {
    setRows((current) => (current.length >= 4 ? current : [...current, '']));
    setSaved(false);
  };

  const removeRow = (index: number): void => {
    setRows((current) => (current.length <= 1 ? current : current.filter((_, i) => i !== index)));
    setSaved(false);
  };

  const handleSave = async (): Promise<void> => {
    if (saving) {
      return;
    }
    // 空串按未填写处理：整行丢弃后再校验（与「至少 1 项」语义一致由校验兜底）。
    const parsed = rows
      .map((row) => row.trim())
      .filter((row) => row.length > 0)
      .map((row) => Number(row));
    try {
      const values = validateChipsIncrements(parsed);
      setSaving(true);
      await itemRepository.updateSettings({ chipsIncrements: values });
      setRows(values.map((minutes) => String(minutes)));
      setError(null);
      setSaved(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[slice-18] Chips 增量保存失败', err);
      setError(`保存失败：${message}`);
    } finally {
      setSaving(false);
    }
  };

  const preview = rows
    .map((row) => row.trim())
    .filter((row) => row.length > 0)
    .map((row) => Number(row));

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.hint}>
        「单次提醒」的快捷按钮增量（分钟）。可设 1–4 项，每项 1–10080 的整数；整小时自动显示为
        「+N小时」。
      </Text>

      {rows.map((row, index) => {
        const minutes = Number(row.trim());
        const validRow = row.trim().length > 0 && Number.isFinite(minutes) && minutes >= 1 && minutes <= 10080;
        return (
          <View key={index} style={styles.row}>
            <TextInput
              style={styles.input}
              value={row}
              onChangeText={(text) => updateRow(index, text)}
              placeholder="分钟（如 15）"
              keyboardType="number-pad"
              maxLength={5}
            />
            <Text style={styles.preview}>
              {validRow && Number.isInteger(minutes)
                ? `快捷按钮显示「${formatChipIncrementLabel(minutes)}」`
                : ' '}
            </Text>
            <Pressable
              style={[styles.rowButton, rows.length <= 1 && styles.rowButtonDisabled]}
              disabled={rows.length <= 1}
              onPress={() => removeRow(index)}
            >
              <Text style={styles.rowButtonText}>－</Text>
            </Pressable>
          </View>
        );
      })}

      {rows.length < 4 ? (
        <Pressable style={styles.addRow} onPress={addRow}>
          <Text style={styles.addRowText}>＋ 添加一项</Text>
        </Pressable>
      ) : null}

      <Pressable style={styles.saveButton} disabled={saving} onPress={() => void handleSave()}>
        <Text style={styles.saveText}>{saving ? '保存中…' : '保存'}</Text>
      </Pressable>
      {saved ? <Text style={styles.savedText}>已保存</Text> : null}
      {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    padding: 16,
    paddingBottom: 32,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    fontSize: 12,
    color: '#888',
    lineHeight: 18,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    width: 120,
    fontSize: 15,
    backgroundColor: '#fff',
  },
  preview: {
    flex: 1,
    fontSize: 12,
    color: '#888',
  },
  rowButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#c62828',
    borderRadius: 6,
  },
  rowButtonDisabled: {
    opacity: 0.4,
  },
  rowButtonText: {
    fontSize: 16,
    color: '#c62828',
  },
  addRow: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#1e6f5c',
    borderRadius: 6,
    marginBottom: 12,
  },
  addRowText: {
    fontSize: 13,
    color: '#1e6f5c',
  },
  saveButton: {
    backgroundColor: '#1e6f5c',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  savedText: {
    fontSize: 12,
    color: '#1e6f5c',
    marginTop: 8,
  },
  errorText: {
    fontSize: 12,
    color: '#c62828',
    marginTop: 8,
  },
});
