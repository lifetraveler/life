import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';

import { itemRepository } from '../../data';
import { SecureWebdavConfigStore } from '../../data/SecureWebdavConfigStore';
import { WebdavClient, type WebdavSnapshotFileInfo } from '../../data/webdav/WebdavClient';
import { WEBDAV_ERROR_KIND_LABELS, WebdavError } from '../../domain/webdav/WebdavError';
import { isWebdavConfig, type WebdavConfig } from '../../domain/webdav/config';
import { isInsecureHttpUrl } from '../../domain/webdav/url';
import {
  configSnapshotFileName,
  parseConfigSnapshot,
  serializeConfigSnapshot,
} from '../../domain/configSnapshot';
import { useTheme } from '../../ui/theme';
import type { ThemeColors } from '../../ui/theme';

/**
 * 备份与恢复设置页（切片 28 阶段 2，AGENTS.md §7.42 D7）：
 * WebDAV 连接配置（SecureStore `webdav_backup_config_v1`，不入 app_settings——
 * 恢复全列覆盖 app_settings，连接配置若在内会被旧快照回滚的自引用防护）+
 * 测试连接 + 立即备份 + 快照列表（恢复/删除）。
 * 仅手动触发；错误按 WebdavError.kind 出文案（WEBDAV_ERROR_KIND_LABELS）。
 */

const configStore = new SecureWebdavConfigStore();

type BusyAction = 'save' | 'test' | 'backup' | 'restore' | 'delete';

/** WebdavError → 展示文案（kind 标签 + HTTP 状态 + 详情）；其余错误取 message。 */
function formatWebdavError(err: unknown): string {
  if (err instanceof WebdavError) {
    const label = WEBDAV_ERROR_KIND_LABELS[err.kind];
    const status = err.status !== null ? `（HTTP ${err.status}）` : '';
    const detail = err.message.length > 0 ? `：${err.message}` : '';
    return `${label}${status}${detail}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** 服务器 lastModified → 本地时间短文案；无效值不展示。 */
function formatSnapshotDate(date: Date | null): string | null {
  if (date === null || Number.isNaN(date.getTime())) {
    return null;
  }
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function BackupSettingsPage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [baseUrl, setBaseUrl] = useState('');
  const [basePath, setBasePath] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [hasStoredConfig, setHasStoredConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configNotice, setConfigNotice] = useState<string | null>(null);

  const [snapshots, setSnapshots] = useState<WebdavSnapshotFileInfo[] | null>(null);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);

  const anyBusy = busy !== null;

  const loadSnapshots = useCallback(async (config: WebdavConfig): Promise<void> => {
    setSnapshots(null);
    try {
      const list = await new WebdavClient().listSnapshots(config);
      setSnapshots(list);
    } catch (err) {
      setSnapshots([]);
      setBackupError(`快照列表读取失败：${formatWebdavError(err)}`);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        const stored = await configStore.load();
        if (!active) {
          return;
        }
        if (stored !== null) {
          setBaseUrl(stored.baseUrl);
          setBasePath(stored.basePath);
          setUsername(stored.username);
          setPassword(stored.password);
          setHasStoredConfig(true);
          await loadSnapshots(stored);
        } else {
          setHasStoredConfig(false);
          setSnapshots(null);
        }
      })();
      return () => {
        active = false;
      };
    }, [loadSnapshots]),
  );

  /** 表单 → 归一校验（isWebdavConfig：baseUrl 必须为 http(s)，其余字段任意串）。 */
  const normalizedFromForm = (): WebdavConfig | null =>
    isWebdavConfig({ baseUrl, basePath, username, password });

  const handleSave = async (): Promise<void> => {
    if (busy !== null) {
      return;
    }
    const normalized = normalizedFromForm();
    if (normalized === null) {
      setConfigError('BaseURL 需以 http:// 或 https:// 开头');
      return;
    }
    setBusy('save');
    setConfigError(null);
    setConfigNotice(null);
    try {
      await configStore.save(normalized);
      setBaseUrl(normalized.baseUrl);
      setBasePath(normalized.basePath);
      setHasStoredConfig(true);
      setConfigNotice('连接配置已保存');
      await loadSnapshots(normalized);
    } catch (err) {
      setConfigError(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async (): Promise<void> => {
    if (busy !== null) {
      return;
    }
    const normalized = normalizedFromForm();
    if (normalized === null) {
      setConfigError('BaseURL 需以 http:// 或 https:// 开头');
      return;
    }
    setBusy('test');
    setConfigError(null);
    setConfigNotice(null);
    try {
      await new WebdavClient().testConnection(normalized);
      Alert.alert('连接成功', 'WebDAV 目录可访问。');
    } catch (err) {
      Alert.alert('连接失败', formatWebdavError(err));
    } finally {
      setBusy(null);
    }
  };

  const requireStoredConfig = async (): Promise<WebdavConfig | null> => {
    const stored = await configStore.load();
    if (stored === null) {
      setBackupError('请先保存连接配置');
      return null;
    }
    return stored;
  };

  const handleBackup = async (): Promise<void> => {
    if (busy !== null) {
      return;
    }
    const stored = await requireStoredConfig();
    if (stored === null) {
      return;
    }
    setBusy('backup');
    setBackupError(null);
    try {
      const snapshot = await itemRepository.createConfigSnapshot();
      const content = serializeConfigSnapshot(snapshot);
      const result = await new WebdavClient().uploadSnapshot(
        stored,
        configSnapshotFileName(new Date()),
        content,
      );
      const pruned =
        result.prunedCount > 0 ? `，已清理 ${result.prunedCount} 份旧快照` : '';
      const pruneFailed =
        result.pruneFailedNames.length > 0
          ? `；${result.pruneFailedNames.length} 份旧快照清理失败（保留在服务器）`
          : '';
      Alert.alert('备份完成', `${result.fileName} 已上传${pruned}${pruneFailed}。`);
      await loadSnapshots(stored);
    } catch (err) {
      setBackupError(`备份失败：${formatWebdavError(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = (target: WebdavSnapshotFileInfo): void => {
    if (busy !== null) {
      return;
    }
    Alert.alert(
      '恢复配置',
      `将用快照 ${target.name} 覆盖本地设置、分类视觉与标签（按增量覆盖规则），继续？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '恢复',
          onPress: () => {
            void (async () => {
              const stored = await requireStoredConfig();
              if (stored === null) {
                return;
              }
              setBusy('restore');
              setBusyTarget(target.name);
              setBackupError(null);
              try {
                const raw = await new WebdavClient().downloadSnapshot(stored, target.name);
                const snapshot = parseConfigSnapshot(raw);
                const result = await itemRepository.applyConfigSnapshot(snapshot);
                const skipped =
                  result.skipped > 0 ? `，跳过 ${result.skipped} 项（形状不符）` : '';
                Alert.alert('恢复完成', `已应用 ${result.applied} 项${skipped}。`);
              } catch (err) {
                setBackupError(`恢复失败：${formatWebdavError(err)}`);
              } finally {
                setBusy(null);
                setBusyTarget(null);
              }
            })();
          },
        },
      ],
    );
  };

  const handleDelete = (target: WebdavSnapshotFileInfo): void => {
    if (busy !== null) {
      return;
    }
    Alert.alert('删除快照', `确定删除服务器上的 ${target.name}？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const stored = await requireStoredConfig();
            if (stored === null) {
              return;
            }
            setBusy('delete');
            setBusyTarget(target.name);
            setBackupError(null);
            try {
              const removed = await new WebdavClient().deleteSnapshot(stored, target.name);
              if (!removed) {
                setBackupError(`快照不存在或已被删除：${target.name}`);
              }
              await loadSnapshots(stored);
            } catch (err) {
              setBackupError(`删除失败：${formatWebdavError(err)}`);
            } finally {
              setBusy(null);
              setBusyTarget(null);
            }
          })();
        },
      },
    ]);
  };

  const insecureHttp = isInsecureHttpUrl(baseUrl);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>WebDAV 连接</Text>
        <Text style={styles.hint}>
          配置仅保存在本机安全存储，不进入备份快照；恢复配置不会覆盖这里的连接信息。
        </Text>
        <Text style={styles.label}>BaseURL</Text>
        <TextInput
          style={styles.input}
          value={baseUrl}
          onChangeText={setBaseUrl}
          placeholder="https://dav.example.com/dav"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        {insecureHttp ? (
          <Text style={styles.warnHint}>当前为 http 明文连接，建议改用 https。</Text>
        ) : null}
        <Text style={styles.label}>目录路径（可空 = 根目录）</Text>
        <TextInput
          style={styles.input}
          value={basePath}
          onChangeText={setBasePath}
          placeholder="/life-backup"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.label}>用户名（可空 = 匿名）</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.label}>密码（可空 = 匿名）</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={[styles.input, styles.passwordInput]}
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!showPassword}
          />
          <Pressable
            style={styles.showToggle}
            onPress={() => setShowPassword((current) => !current)}
          >
            <Text style={styles.showToggleText}>{showPassword ? '隐藏' : '显示'}</Text>
          </Pressable>
        </View>
        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.secondaryButton, anyBusy && styles.disabled]}
            disabled={anyBusy}
            onPress={() => {
              void handleTest();
            }}
          >
            {busy === 'test' ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={styles.secondaryText}>测试连接</Text>
            )}
          </Pressable>
          <Pressable
            style={[styles.primaryButton, anyBusy && styles.disabled]}
            disabled={anyBusy}
            onPress={() => {
              void handleSave();
            }}
          >
            {busy === 'save' ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.primaryText}>保存连接</Text>
            )}
          </Pressable>
        </View>
        {configNotice !== null ? <Text style={styles.notice}>{configNotice}</Text> : null}
        {configError !== null ? <Text style={styles.errorHint}>{configError}</Text> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>备份</Text>
        <Text style={styles.hint}>
          手动备份当前设置、分类与标签到 WebDAV（服务器保留最近 10 份）。仅手动触发，
          不自动备份。
        </Text>
        <Pressable
          style={[styles.primaryButton, anyBusy && styles.disabled]}
          disabled={anyBusy}
          onPress={() => {
            void handleBackup();
          }}
        >
          {busy === 'backup' ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.primaryText}>立即备份</Text>
          )}
        </Pressable>
        {backupError !== null ? <Text style={styles.errorHint}>{backupError}</Text> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>快照列表</Text>
        <Text style={styles.hint}>
          恢复会覆盖本地设置、分类视觉与标签（按增量覆盖规则）；不恢复条目数据。
        </Text>
        {!hasStoredConfig ? (
          <Text style={styles.hint}>尚未保存连接配置。</Text>
        ) : snapshots === null ? (
          <ActivityIndicator />
        ) : snapshots.length === 0 ? (
          <Text style={styles.hint}>暂无快照（尚未备份或目录为空）。</Text>
        ) : (
          snapshots.map((snapshot) => {
            const dateText = formatSnapshotDate(snapshot.lastModified);
            const targetBusy =
              (busy === 'restore' || busy === 'delete') && busyTarget === snapshot.name;
            return (
              <View key={snapshot.name} style={styles.snapshotRow}>
                <View style={styles.snapshotText}>
                  <Text style={styles.snapshotName} numberOfLines={1}>
                    {snapshot.name}
                  </Text>
                  {dateText !== null ? (
                    <Text style={styles.snapshotDate}>{dateText}</Text>
                  ) : null}
                </View>
                {targetBusy ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <View style={styles.snapshotActions}>
                    <Pressable
                      style={[styles.snapshotButton, anyBusy && styles.disabled]}
                      disabled={anyBusy}
                      onPress={() => handleRestore(snapshot)}
                    >
                      <Text style={styles.snapshotButtonPrimary}>恢复</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.snapshotButton, anyBusy && styles.disabled]}
                      disabled={anyBusy}
                      onPress={() => handleDelete(snapshot)}
                    >
                      <Text style={styles.snapshotButtonDanger}>删除</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })
        )}
      </View>
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
      gap: 16,
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
    warnHint: {
      fontSize: 12,
      color: c.danger,
      lineHeight: 18,
    },
    errorHint: {
      fontSize: 12,
      color: c.danger,
      lineHeight: 18,
    },
    notice: {
      fontSize: 12,
      color: c.primary,
      lineHeight: 18,
    },
    label: {
      fontSize: 13,
      color: c.text,
      marginTop: 4,
    },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 6,
      backgroundColor: c.card,
      color: c.text,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 14,
    },
    passwordRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    passwordInput: {
      flex: 1,
    },
    showToggle: {
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    showToggleText: {
      fontSize: 13,
      color: c.primary,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 6,
    },
    primaryButton: {
      backgroundColor: c.primary,
      borderRadius: 6,
      paddingVertical: 10,
      paddingHorizontal: 18,
      alignItems: 'center',
      flex: 1,
    },
    primaryText: {
      color: c.textOnPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    secondaryButton: {
      borderWidth: 1,
      borderColor: c.primary,
      borderRadius: 6,
      paddingVertical: 10,
      paddingHorizontal: 18,
      alignItems: 'center',
      flex: 1,
    },
    secondaryText: {
      color: c.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    disabled: {
      opacity: 0.5,
    },
    snapshotRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 8,
      paddingHorizontal: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      gap: 8,
    },
    snapshotText: {
      flex: 1,
      minWidth: 0,
    },
    snapshotName: {
      fontSize: 13,
      color: c.text,
    },
    snapshotDate: {
      fontSize: 11,
      color: c.textMuted,
      marginTop: 2,
    },
    snapshotActions: {
      flexDirection: 'row',
      gap: 6,
    },
    snapshotButton: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 6,
      paddingVertical: 6,
      paddingHorizontal: 12,
    },
    snapshotButtonPrimary: {
      fontSize: 13,
      color: c.primary,
      fontWeight: '600',
    },
    snapshotButtonDanger: {
      fontSize: 13,
      color: c.danger,
      fontWeight: '600',
    },
  });
}
