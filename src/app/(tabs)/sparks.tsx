import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sparkAttachmentIo, sparkRepository } from '../../data';
import type { Spark, SparkAttachment } from '../../domain/spark';
import {
  attachmentKindLabel,
  captureAttachment,
  formatRecordingDuration,
  formatRelativeTime,
  imageExtensionFromUri,
  sparkDisplayPreview,
  sparkDisplayTitle,
} from '../../ui/sparkCapture';
import { useTheme } from '../../ui/theme';
import type { ThemeColors } from '../../ui/theme';

/**
 * 灵感 Tab 主屏（切片 37，AGENTS.md §7.49 D6，事项占位页随本片消化）：
 * - 顶部速记条：TextInput 多行自增 + 文字发送 / 录音（点按开始→再点停止→保存，
 *   计时条含取消）/ 拍照 / 相册四入口；
 * - 灵感流：FlatList created_at 倒序卡（摘要两行 / 附件徽标 录音×n+图片首张缩略 /
 *   关联计划数 / 相对时间），点击详情、长按删除（Alert 确认）；
 * - 录音/拍照/相册产物一律经 captureAttachment 编排（复制落盘 → 附件行 → 即时上传
 *   → 回填；上传失败仅「未备份」，不阻塞）；
 * - 权限拒绝：Alert 引导跳系统设置（Linking.openSettings），不静默失败；
 * - 空态卡「随手记一条灵感」。
 */

/** 录音临时文件扩展名（RecordingPresets.HIGH_QUALITY 产物 .m4a）。 */
const AUDIO_EXTENSION = 'm4a';

export default function SparksScreen() {
  // 切片 24（§7.36）：颜色走全局 Token（夜间模式），深浅色跟随系统。
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [sparks, setSparks] = useState<Spark[]>([]);
  const [attachmentsBySpark, setAttachmentsBySpark] = useState<Map<string, SparkAttachment[]>>(new Map());
  const [linkCounts, setLinkCounts] = useState<Map<string, number>>(new Map());
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);

  // 录音计时与 durationMs 用本地 wall-clock 累计（Date.now 起点）：expo-audio 1.1.1 的
  // Property("currentTime") 在 Android 上返回 recorder.startTime（epoch ms，库缺陷
  // expo/expo#39646，修复 PR #40239 未进 SDK 54 补丁线），不读该属性。
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStartRef = useRef<number | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await sparkRepository.listSparks();
      // 流卡徽标数据：逐灵感读附件与关联（N+1；MVP 数据量可接受，提案 D6）。
      const pairs = await Promise.all(
        list.map(async (spark) => {
          try {
            const [attachments, links] = await Promise.all([
              sparkRepository.listAttachments(spark.id),
              sparkRepository.listItemsForSpark(spark.id),
            ]);
            return { sparkId: spark.id, attachments, linkCount: links.length };
          } catch {
            return { sparkId: spark.id, attachments: [] as SparkAttachment[], linkCount: 0 };
          }
        }),
      );
      setSparks(list);
      setAttachmentsBySpark(new Map(pairs.map((p) => [p.sparkId, p.attachments])));
      setLinkCounts(new Map(pairs.map((p) => [p.sparkId, p.linkCount])));
    } catch (error) {
      console.warn('[slice-37] 灵感流读取失败', error);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {
        if (recordTimerRef.current !== null) {
          clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
      };
    }, [refresh]),
  );

  const stopRecordTimer = (): void => {
    if (recordTimerRef.current !== null) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  /** 录音权限拒绝披露（Alert 引导跳系统设置；提案 D6 权限拒绝态）。 */
  const alertPermissionDenied = (title: string): void => {
    Alert.alert(title, '请在系统设置中授权后重试。', [
      { text: '取消', style: 'cancel' },
      { text: '去设置', onPress: () => void Linking.openSettings() },
    ]);
  };

  /** 统一捕获链（录音/拍照/相册共用）：先建灵感行（双空合法）再挂附件。 */
  const captureFile = useCallback(
    async (sourceUri: string, extension: string, kind: 'audio' | 'image', meta: { durationMs?: number; width?: number; height?: number }): Promise<void> => {
      setBusy(true);
      try {
        const spark = await sparkRepository.createSpark({});
        const outcome = await captureAttachment(sparkAttachmentIo, sparkRepository, spark.id, {
          kind,
          sourceUri,
          extension,
          ...meta,
        });
        if (!outcome.uploaded) {
          Alert.alert('已保存灵感', '附件上传失败（未备份），可稍后在详情页重传。');
        }
        await refresh();
      } catch (error) {
        console.warn('[slice-37] 附件捕获失败', error);
        Alert.alert('保存失败', error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const startRecording = useCallback(async (): Promise<void> => {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        alertPermissionDenied('麦克风权限未授予');
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordStartRef.current = Date.now();
      setRecordMs(0);
      setRecording(true);
      recordTimerRef.current = setInterval(() => {
        const startedAt = recordStartRef.current;
        setRecordMs(startedAt === null ? 0 : Date.now() - startedAt);
      }, 250);
    } catch (error) {
      console.warn('[slice-37] 录音启动失败', error);
      Alert.alert('录音失败', error instanceof Error ? error.message : String(error));
    }
  }, [recorder]);

  const finishRecording = useCallback(
    async (save: boolean): Promise<void> => {
      stopRecordTimer();
      setRecording(false);
      setRecordMs(0);
      // wall-clock 时长在重置前捕获；startAt 缺失（理论不可达）归 0。
      const startedAt = recordStartRef.current;
      const durationMs = startedAt === null ? 0 : Date.now() - startedAt;
      recordStartRef.current = null;
      try {
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false });
        const uri = recorder.uri;
        if (uri === null || uri === undefined) return;
        if (!save) {
          // 取消：丢弃临时录音文件（sparks/ 副本尚未产生）。
          await sparkAttachmentIo.deleteFile(uri).catch(() => undefined);
          return;
        }
        await captureFile(uri, AUDIO_EXTENSION, 'audio', { durationMs });
      } catch (error) {
        console.warn('[slice-37] 录音停止失败', error);
        Alert.alert('录音失败', error instanceof Error ? error.message : String(error));
      }
    },
    [captureFile, recorder],
  );

  const pickImage = useCallback(
    async (mode: 'camera' | 'library'): Promise<void> => {
      try {
        if (mode === 'camera') {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) {
            alertPermissionDenied('相机权限未授予');
            return;
          }
        } else {
          const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!permission.granted) {
            alertPermissionDenied('相册权限未授予');
            return;
          }
        }
        const result = mode === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 1 })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              quality: 1,
            });
        if (result.canceled || result.assets.length === 0) return;
        const asset = result.assets[0];
        await captureFile(asset.uri, imageExtensionFromUri(asset.uri), 'image', {
          width: asset.width,
          height: asset.height,
        });
      } catch (error) {
        console.warn('[slice-37] 图片捕获失败', error);
        Alert.alert('保存失败', error instanceof Error ? error.message : String(error));
      }
    },
    [captureFile],
  );

  const sendText = useCallback(async (): Promise<void> => {
    const text = draft.trim();
    if (text.length === 0 || busy) return;
    setBusy(true);
    try {
      await sparkRepository.createSpark({ content: text });
      setDraft('');
      await refresh();
    } catch (error) {
      console.warn('[slice-37] 灵感保存失败', error);
      Alert.alert('保存失败', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [busy, draft, refresh]);

  const confirmDeleteSpark = useCallback((spark: Spark): void => {
    Alert.alert('删除灵感', '删除后附件与本地文件一并清除，且不可恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await sparkRepository.deleteSpark(spark.id);
              await refresh();
            } catch (error) {
              console.warn('[slice-37] 灵感删除失败', error);
              Alert.alert('删除失败', error instanceof Error ? error.message : String(error));
            }
          })();
        },
      },
    ]);
  }, [refresh]);

  const renderCard = useCallback(({ item }: { item: Spark }): React.ReactElement => {
    const attachments = attachmentsBySpark.get(item.id) ?? [];
    const audioCount = attachments.filter((a) => a.kind === 'audio').length;
    const imageCount = attachments.filter((a) => a.kind === 'image').length;
    const firstImage = attachments.find((a) => a.kind === 'image');
    const linkCount = linkCounts.get(item.id) ?? 0;
    return (
      <Pressable
        style={styles.card}
        onPress={() => router.push(`/spark/${item.id}`)}
        onLongPress={() => confirmDeleteSpark(item)}
        testID={`spark-card-${item.id}`}
      >
        <View style={styles.cardTopRow}>
          <Ionicons name="bulb" size={16} color={colors.primary} />
          <Text style={styles.cardTitle} numberOfLines={1}>
            {sparkDisplayTitle(item)}
          </Text>
          <Text style={styles.cardTime}>{formatRelativeTime(item.createdAt, Date.now())}</Text>
        </View>
        {sparkDisplayPreview(item) !== null ? (
          <Text style={styles.cardPreview} numberOfLines={2}>
            {sparkDisplayPreview(item)}
          </Text>
        ) : null}
        <View style={styles.cardBottomRow}>
          {audioCount > 0 ? (
            <View style={styles.badge}>
              <Ionicons name="musical-notes" size={12} color={colors.textMuted} />
              <Text style={styles.badgeText}>录音×{audioCount}</Text>
            </View>
          ) : null}
          {imageCount > 0 ? (
            <View style={styles.badge}>
              <Ionicons name="images" size={12} color={colors.textMuted} />
              <Text style={styles.badgeText}>图片×{imageCount}</Text>
            </View>
          ) : null}
          {firstImage !== undefined ? (
            <Image source={{ uri: firstImage.uri }} style={styles.thumb} />
          ) : null}
          <View style={styles.spacer} />
          {linkCount > 0 ? <Text style={styles.linkCount}>关联 {linkCount} 条计划</Text> : null}
        </View>
      </Pressable>
    );
  }, [attachmentsBySpark, colors.primary, colors.textMuted, confirmDeleteSpark, linkCounts, router, styles]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.screenTitle}>灵感</Text>
      <View style={styles.captureBar}>
        <TextInput
          style={styles.draftInput}
          value={draft}
          onChangeText={setDraft}
          placeholder="随手记一条灵感…"
          placeholderTextColor={colors.textMuted}
          multiline
        />
        <View style={styles.captureActions}>
          <Pressable style={styles.iconButton} onPress={() => void sendText()} disabled={busy || draft.trim().length === 0} testID="spark-send">
            <Ionicons name="send" size={20} color={draft.trim().length > 0 && !busy ? colors.primary : colors.textMuted} />
          </Pressable>
          {recording ? (
            <View style={styles.recordingRow}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingTime}>{formatRecordingDuration(recordMs)}</Text>
              <Pressable style={styles.iconButton} onPress={() => void finishRecording(true)} testID="spark-record-stop">
                <Ionicons name="stop" size={20} color={colors.danger} />
              </Pressable>
              <Pressable style={styles.iconButton} onPress={() => void finishRecording(false)} testID="spark-record-cancel">
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </Pressable>
            </View>
          ) : (
            <>
              <Pressable style={styles.iconButton} onPress={() => void startRecording()} disabled={busy} testID="spark-record-start">
                <Ionicons name="mic" size={20} color={colors.primary} />
              </Pressable>
              <Pressable style={styles.iconButton} onPress={() => void pickImage('camera')} disabled={busy} testID="spark-camera">
                <Ionicons name="camera" size={20} color={colors.primary} />
              </Pressable>
              <Pressable style={styles.iconButton} onPress={() => void pickImage('library')} disabled={busy} testID="spark-library">
                <Ionicons name="images" size={20} color={colors.primary} />
              </Pressable>
            </>
          )}
        </View>
      </View>
      <FlatList
        style={styles.list}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 16 }]}
        data={sparks}
        keyExtractor={(item) => item.id}
        renderItem={renderCard}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons name="bulb-outline" size={40} color={colors.textMuted} />
            <Text style={styles.emptyText}>随手记一条灵感</Text>
          </View>
        }
      />
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    screenTitle: {
      fontSize: 20,
      fontWeight: '600',
      color: c.text,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 4,
    },
    captureBar: {
      marginHorizontal: 16,
      marginTop: 8,
      backgroundColor: c.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      padding: 10,
    },
    draftInput: {
      color: c.text,
      fontSize: 14,
      minHeight: 40,
      maxHeight: 120,
      paddingVertical: 8,
    },
    captureActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: 4,
    },
    iconButton: {
      padding: 4,
    },
    recordingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    recordingDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.danger,
    },
    recordingTime: {
      fontSize: 13,
      color: c.text,
      fontVariant: ['tabular-nums'],
    },
    list: {
      flex: 1,
      marginTop: 8,
    },
    listContent: {
      paddingHorizontal: 16,
      gap: 10,
    },
    card: {
      backgroundColor: c.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      padding: 12,
      gap: 6,
    },
    cardTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    cardTitle: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: c.text,
    },
    cardTime: {
      fontSize: 12,
      color: c.textMuted,
    },
    cardPreview: {
      fontSize: 13,
      color: c.textMuted,
    },
    cardBottomRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: c.background,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    badgeText: {
      fontSize: 11,
      color: c.textMuted,
    },
    thumb: {
      width: 36,
      height: 36,
      borderRadius: 6,
    },
    spacer: {
      flex: 1,
    },
    linkCount: {
      fontSize: 12,
      color: c.textMuted,
    },
    emptyCard: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 64,
      gap: 10,
    },
    emptyText: {
      fontSize: 14,
      color: c.textMuted,
    },
  });
}
