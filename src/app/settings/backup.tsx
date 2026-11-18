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
  isConfigSnapshotFileName,
  parseConfigSnapshot,
  serializeConfigSnapshot,
} from '../../domain/configSnapshot';
import {
  dataSnapshotFileName,
  isDataSnapshotFileName,
  parseDataSnapshot,
  serializeDataSnapshot,
} from '../../domain/dataSnapshot';
import { reminderScheduler } from '../../notifications';
import { useTheme } from '../../ui/theme';
import type { ThemeColors } from '../../ui/theme';

/**
 * 备份与恢复设置页（切片 28 阶段 2，AGENTS.md §7.42 D7）：
 * WebDAV 连接配置（SecureStore `webdav_backup_config_v1`，不入 app_settings——
 * 恢复全列覆盖 app_settings，连接配置若在内会被旧快照回滚的自引用防护）+
 * 测试连接 + 立即备份 + 快照列表（恢复/删除）。
 * 仅手动触发；错误按 WebdavError.kind 出文案（WEBDAV_ERROR_KIND_LABELS）。
 *
 * 切片 31 阶段 2（AGENTS.md §7.43）：新增「数据备份」与「数据快照列表」区块
 * （items/tags/reminders/channelPresets/itemTags 六块快照）。连接区块复用不动；
 * 快照列表一次 PROPFIND（CONFIG∪DATA 谓词）取回后按文件名正则拆分两列，
 * 滚动保留各 10 份互不挤占（SnapshotFileNameFilter 参数化）；数据恢复成功后
 * reminderScheduler.reconcile() 显式重排一次（失败不阻断，Alert 内披露）。
 */

const configStore = new SecureWebdavConfigStore();

type BusyAction =
  | 'save'
  | 'test'
  | 'backup'
  | 'restore'
  | 'delete'
  // 切片 31（§7.43）：数据备份区块动作（与配置备份动作互斥共用 anyBusy）。
  | 'dataBackup'
  | 'dataRestore'
  | 'dataDelete';

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
  const [dataSnapshots, setDataSnapshots] = useState<WebdavSnapshotFileInfo[] | null>(null);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  // 切片 31：数据区块动作错误 + 两次列表共用的列表读取错误（单 PROPFIND，失败两列表同报）。
  const [dataError, setDataError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const anyBusy = busy !== null;

  // 一次 PROPFIND 取回 CONFIG∪DATA 文件，再按各自文件名正则拆分两列
  // （SnapshotFileNameFilter 参数化，切片 31 阶段 1）。
  const loadSnapshots = useCallback(async (config: WebdavConfig): Promise<void> => {
    setSnapshots(null);
    setDataSnapshots(null);
    setListError(null);
    try {
      const list = await new WebdavClient().listSnapshots(
        config,
        (name) => isConfigSnapshotFileName(name) || isDataSnapshotFileName(name),
      );
      setSnapshots(list.filter((file) => isConfigSnapshotFileName(file.name)));
      setDataSnapshots(list.filter((file) => isDataSnapshotFileName(file.name)));
    } catch (err) {
      setSnapshots([]);
      setDataSnapshots([]);
      setListError(`快照列表读取失败：${formatWebdavError(err)}`);
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

  // —— 切片 31（§7.43）数据备份区块：与配置备份同构（仅手动/滚动 10 份/全量明文）——

  const handleDataBackup = async (): Promise<void> => {
    if (busy !== null) {
      return;
    }
    const stored = await requireStoredConfig();
    if (stored === null) {
      return;
    }
    setBusy('dataBackup');
    setDataError(null);
    try {
      const snapshot = await itemRepository.createDataSnapshot();
      const content = serializeDataSnapshot(snapshot);
      const result = await new WebdavClient().uploadSnapshot(
        stored,
        dataSnapshotFileName(new Date()),
        content,
        isDataSnapshotFileName,
      );
      const pruned =
        result.prunedCount > 0 ? `，已清理 ${result.prunedCount} 份旧快照` : '';
      const pruneFailed =
        result.pruneFailedNames.length > 0
          ? `；${result.pruneFailedNames.length} 份旧快照清理失败（保留在服务器）`
          : '';
      Alert.alert('数据备份完成', `${result.fileName} 已上传${pruned}${pruneFailed}。`);
      await loadSnapshots(stored);
    } catch (err) {
      setDataError(`数据备份失败：${formatWebdavError(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleDataRestore = (target: WebdavSnapshotFileInfo): void => {
    if (busy !== null) {
      return;
    }
    Alert.alert(
      '恢复数据',
      `将用快照 ${target.name} 按增量覆盖规则合并本地数据：同 id 条目/标签/提醒/渠道预设覆盖，本地独有条目保留；恢复成功后自动重排提醒。继续？`,
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
              setBusy('dataRestore');
              setBusyTarget(target.name);
              setDataError(null);
              try {
                const raw = await new WebdavClient().downloadSnapshot(
                  stored,
                  target.name,
                  isDataSnapshotFileName,
                );
                const snapshot = parseDataSnapshot(raw);
                const result = await itemRepository.applyDataSnapshot(snapshot);
                // 恢复成功后显式重排提醒一次（§7.43：失败不阻断，仅披露）。
                let reconcileNote = '';
                try {
                  await reminderScheduler.reconcile();
                } catch (reconcileError) {
                  console.warn('[slice-31] 数据恢复后 reconcile 失败', reconcileError);
                  reconcileNote = '；提醒重排失败（将在下次启动时自动对账）';
                }
                const skipped =
                  result.skipped > 0
                    ? `，跳过 ${result.skipped} 项（形状不符或引用缺失）`
                    : '';
                Alert.alert('恢复完成', `已应用 ${result.applied} 项${skipped}${reconcileNote}。`);
              } catch (err) {
                setDataError(`恢复失败：${formatWebdavError(err)}`);
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

  const handleDataDelete = (target: WebdavSnapshotFileInfo): void => {
    if (busy !== null) {
      return;
    }
    Alert.alert('删除数据快照', `确定删除服务器上的 ${target.name}？`, [
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
            setBusy('dataDelete');
            setBusyTarget(target.name);
            setDataError(null);
            try {
              const removed = await new WebdavClient().deleteSnapshot(
                stored,
                target.name,
                isDataSnapshotFileName,
              );
              if (!removed) {
                setDataError(`快照不存在或已被删除：${target.name}`);
              }
              await loadSnapshots(stored);
            } catch (err) {
              setDataError(`删除失败：${formatWebdavError(err)}`);
            } finally {
              setBusy(null);
              setBusyTarget(null);
            }
          })();
        },
      },
    ]);
  };

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

      {/* 切片 31（§7.43）：数据备份区块——items/tags/reminders/channelPresets/itemTags。 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>数据备份</Text>
        <Text style={styles.hint}>
          手动备份全部条目、标签、提醒与渠道预设到 WebDAV（服务器保留最近 10 份，
          与配置快照互不挤占）。仅手动触发，不自动备份；全量明文上传。
        </Text>
        <Pressable
          style={[styles.primaryButton, anyBusy && styles.disabled]}
          disabled={anyBusy}
          onPress={() => {
            void handleDataBackup();
          }}
        >
          {busy === 'dataBackup' ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.primaryText}>立即备份数据</Text>
          )}
        </Pressable>
        {dataError !== null ? <Text style={styles.errorHint}>{dataError}</Text> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>快照列表</Text>
        <Text style={styles.hint}>
          恢复会覆盖本地设置、分类视觉与标签（按增量覆盖规则）；不恢复条目数据。
        </Text>
        {listError !== null ? <Text style={styles.errorHint}>{listError}</Text> : null}
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

      {/* 切片 31（§7.43）：数据快照列表——恢复/删除与配置列表同构，文件名按 DATA 正则。 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>数据快照列表</Text>
        <Text style={styles.hint}>
          恢复会按增量覆盖规则合并本地数据：同 id 条目/标签/提醒/渠道预设覆盖，
          本地独有条目保留；恢复成功后自动重排提醒。
        </Text>
        {listError !== null ? <Text style={styles.errorHint}>{listError}</Text> : null}
        {!hasStoredConfig ? (
          <Text style={styles.hint}>尚未保存连接配置。</Text>
        ) : dataSnapshots === null ? (
          <ActivityIndicator />
        ) : dataSnapshots.length === 0 ? (
          <Text style={styles.hint}>暂无数据快照（尚未备份数据或目录为空）。</Text>
        ) : (
          dataSnapshots.map((snapshot) => {
            const dateText = formatSnapshotDate(snapshot.lastModified);
            const targetBusy =
              (busy === 'dataRestore' || busy === 'dataDelete') && busyTarget === snapshot.name;
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
                      onPress={() => handleDataRestore(snapshot)}
                    >
                      <Text style={styles.snapshotButtonPrimary}>恢复</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.snapshotButton, anyBusy && styles.disabled]}
                      disabled={anyBusy}
                      onPress={() => handleDataDelete(snapshot)}
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
