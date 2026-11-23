import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioPlayer,
} from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sparkAttachmentIo, sparkRepository } from '../../data';
import type {
  Spark,
  SparkAttachment,
  SparkLinkedItemSummary,
} from '../../domain/spark';
import {
  attachmentBackupLabel,
  attachmentKindLabel,
  captureAttachment,
  formatRecordingDuration,
  imageExtensionFromUri,
  reuploadAttachment,
} from '../../ui/sparkCapture';
import { formatItemStart, getDeviceTzid } from '../../ui/timeFormat';
import { useTheme } from '../../ui/theme';
import type { ThemeColors } from '../../ui/theme';

/**
 * 灵感详情页（切片 37，AGENTS.md §7.49 D7）：
 * - 标题/内容 TextInput 失焦保存（trim 空串归 null；无变化不触发 updateSpark）；
 * - 附件列表：录音播放/暂停（共用一个 AudioPlayer）+时长+已备份徽标；图片缩略图
 *   +Modal 全屏；均含删除（Alert 确认；远端 DELETE 失败由 Repository 仅披露）；
 * - 未备份附件行内「重传」入口（reuploadAttachment 编排，失败 Alert）；
 * - 添加附件按钮组：录音/拍照/相册（与主屏同一 captureAttachment 编排）；
 * - 关联计划列表：分类色点+标题+状态+时间（点击跳 item/[id]，行内解除关联）；
 * - 「转计划」主按钮：router.push('/item/new', {fromSpark, title, content}) 预填；
 * - 灵感已被删除（getSparkById null）→ 空态提示。
 */

const AUDIO_EXTENSION = 'm4a';

export default function SparkDetailScreen() {
  // 切片 24（§7.36）：颜色走全局 Token（夜间模式）。
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const sparkId = typeof params.id === 'string' ? params.id : '';

  const [spark, setSpark] = useState<Spark | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [attachments, setAttachments] = useState<SparkAttachment[]>([]);
  const [links, setLinks] = useState<SparkLinkedItemSummary[]>([]);
  const [titleDraft, setTitleDraft] = useState('');
  const [contentDraft, setContentDraft] = useState('');
  const [imageModalUri, setImageModalUri] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const playerRef = useRef<AudioPlayer | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const current = await sparkRepository.getSparkById(sparkId);
    if (current === null) {
      setSpark(null);
      setLoaded(true);
      return;
    }
    const [atts, linked] = await Promise.all([
      sparkRepository.listAttachments(sparkId),
      sparkRepository.listItemsForSpark(sparkId),
    ]);
    setSpark(current);
    setTitleDraft(current.title ?? '');
    setContentDraft(current.content ?? '');
    setAttachments(atts);
    setLinks(linked);
    setLoaded(true);
  }, [sparkId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {
        playerRef.current = null;
        setPlayingId(null);
        setImageModalUri(null);
      };
    }, [refresh]),
  );

  const alertPermissionDenied = (title: string): void => {
    Alert.alert(title, '请在系统设置中授权后重试。', [
      { text: '取消', style: 'cancel' },
      { text: '去设置', onPress: () => void Linking.openSettings() },
    ]);
  };

  /** 附件捕获（录音/拍照/相册共用；与主屏同一编排）。 */
  const captureFile = useCallback(
    async (sourceUri: string, extension: string, kind: 'audio' | 'image', meta: { durationMs?: number; width?: number; height?: number }): Promise<void> => {
      try {
        const outcome = await captureAttachment(sparkAttachmentIo, sparkRepository, sparkId, {
          kind,
          sourceUri,
          extension,
          ...meta,
        });
        if (!outcome.uploaded) {
          Alert.alert('已添加附件', '上传失败（未备份），可稍后点「重传」。');
        }
        await refresh();
      } catch (error) {
        console.warn('[slice-37] 附件捕获失败', error);
        Alert.alert('添加失败', error instanceof Error ? error.message : String(error));
      }
    },
    [refresh, sparkId],
  );

  const startRecording = useCallback(async (): Promise<void> => {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        alertPermissionDenied('麦克风权限未授予');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch (error) {
      console.warn('[slice-37] 录音启动失败', error);
      Alert.alert('录音失败', error instanceof Error ? error.message : String(error));
    }
  }, [recorder]);

  const stopRecording = useCallback(async (): Promise<void> => {
    setRecording(false);
    try {
      const durationMs = Math.round(recorder.currentTime * 1000);
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (uri === null || uri === undefined) return;
      await captureFile(uri, AUDIO_EXTENSION, 'audio', { durationMs });
    } catch (error) {
      console.warn('[slice-37] 录音停止失败', error);
      Alert.alert('录音失败', error instanceof Error ? error.message : String(error));
    }
  }, [captureFile, recorder]);

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
        Alert.alert('添加失败', error instanceof Error ? error.message : String(error));
      }
    },
    [captureFile],
  );

  /** 标题/内容失焦保存：trim 空串归 null；无变化不触发（§7.49 D7）。 */
  const saveFieldOnBlur = useCallback(
    async (field: 'title' | 'content'): Promise<void> => {
      if (spark === null) return;
      const next = field === 'title' ? titleDraft : contentDraft;
      const trimmed = next.trim();
      const baseline = field === 'title' ? (spark.title ?? '') : (spark.content ?? '');
      if (trimmed === baseline.trim()) return;
      try {
        await sparkRepository.updateSpark(spark.id, field === 'title' ? { title: next } : { content: next });
        await refresh();
      } catch (error) {
        console.warn('[slice-37] 灵感保存失败', error);
        Alert.alert('保存失败', error instanceof Error ? error.message : String(error));
      }
    },
    [contentDraft, refresh, spark, titleDraft],
  );

  const togglePlayback = useCallback((attachment: SparkAttachment): void => {
    if (playingId === attachment.id) {
      playerRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (playerRef.current === null) {
      playerRef.current = createAudioPlayer({ uri: attachment.uri });
    } else {
      playerRef.current.replace({ uri: attachment.uri });
    }
    playerRef.current.play();
    setPlayingId(attachment.id);
  }, [playingId]);

  const confirmDeleteAttachment = useCallback((attachment: SparkAttachment): void => {
    Alert.alert('删除附件', '将删除本地文件与附件记录（远端删除失败会披露但继续）。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await sparkRepository.deleteAttachment(attachment.id);
              await refresh();
            } catch (error) {
              console.warn('[slice-37] 附件删除失败', error);
              Alert.alert('删除失败', error instanceof Error ? error.message : String(error));
            }
          })();
        },
      },
    ]);
  }, [refresh]);

  const reupload = useCallback(async (attachment: SparkAttachment): Promise<void> => {
    try {
      await reuploadAttachment(sparkAttachmentIo, sparkRepository, attachment);
      await refresh();
    } catch (error) {
      console.warn('[slice-37] 附件重传失败', error);
      Alert.alert('重传失败', error instanceof Error ? error.message : String(error));
    }
  }, [refresh]);

  const unlink = useCallback(async (itemId: string): Promise<void> => {
    try {
      await sparkRepository.unlinkSparkFromItem(sparkId, itemId);
      await refresh();
    } catch (error) {
      console.warn('[slice-37] 解除关联失败', error);
      Alert.alert('解除失败', error instanceof Error ? error.message : String(error));
    }
  }, [refresh, sparkId]);

  const goToItem = useCallback((itemId: string): void => {
    router.push(`/item/${itemId}`);
  }, [router]);

  const startConvertToItem = useCallback((): void => {
    if (spark === null) return;
    router.push({
      pathname: '/item/new',
      params: {
        fromSpark: spark.id,
        title: spark.title ?? '',
        content: spark.content ?? '',
      },
    });
  }, [router, spark]);

  if (!loaded) {
    return <View style={[styles.container, { paddingTop: insets.top }]} />;
  }
  if (spark === null) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <Ionicons name="bulb-outline" size={40} color={colors.textMuted} />
        <Text style={styles.emptyText}>灵感不存在或已被删除</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}>
        <TextInput
          style={styles.titleInput}
          value={titleDraft}
          onChangeText={setTitleDraft}
          onBlur={() => void saveFieldOnBlur('title')}
          placeholder="灵感标题（可空）"
          placeholderTextColor={colors.textMuted}
          multiline
          testID="spark-title-input"
        />
        <TextInput
          style={styles.contentInput}
          value={contentDraft}
          onChangeText={setContentDraft}
          onBlur={() => void saveFieldOnBlur('content')}
          placeholder="灵感内容（可空）"
          placeholderTextColor={colors.textMuted}
          multiline
          testID="spark-content-input"
        />

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>附件（{attachments.length}）</Text>
          <View style={styles.attachActions}>
            <Pressable style={styles.attachButton} onPress={() => (recording ? void stopRecording() : void startRecording())} testID="spark-attach-audio">
              <Ionicons name={recording ? 'stop' : 'mic'} size={16} color={colors.primary} />
              <Text style={styles.attachButtonText}>{recording ? '停止' : '录音'}</Text>
            </Pressable>
            <Pressable style={styles.attachButton} onPress={() => void pickImage('camera')} testID="spark-attach-camera">
              <Ionicons name="camera" size={16} color={colors.primary} />
              <Text style={styles.attachButtonText}>拍照</Text>
            </Pressable>
            <Pressable style={styles.attachButton} onPress={() => void pickImage('library')} testID="spark-attach-library">
              <Ionicons name="images" size={16} color={colors.primary} />
              <Text style={styles.attachButtonText}>相册</Text>
            </Pressable>
          </View>
        </View>
        {attachments.length === 0 ? (
          <Text style={styles.sectionEmpty}>暂无附件</Text>
        ) : (
          attachments.map((attachment) => (
            <View key={attachment.id} style={styles.attachmentRow} testID={`spark-attachment-row-${attachment.id}`}>
              {attachment.kind === 'audio' ? (
                <Pressable style={styles.playButton} onPress={() => togglePlayback(attachment)}>
                  <Ionicons name={playingId === attachment.id ? 'pause' : 'play'} size={16} color={colors.primary} />
                </Pressable>
              ) : (
                <Pressable onPress={() => setImageModalUri(attachment.uri)}>
                  <Image source={{ uri: attachment.uri }} style={styles.attachmentThumb} />
                </Pressable>
              )}
              <View style={styles.attachmentMeta}>
                <Text style={styles.attachmentKind}>{attachmentKindLabel(attachment.kind)}</Text>
                <Text style={styles.attachmentSub}>
                  {attachment.kind === 'audio' ? formatRecordingDuration(attachment.durationMs ?? 0) : null}
                  {' · '}
                  {attachmentBackupLabel(attachment)}
                </Text>
              </View>
              {attachment.remotePath === null ? (
                <Pressable style={styles.reuploadButton} onPress={() => void reupload(attachment)} testID={`spark-reupload-${attachment.id}`}>
                  <Text style={styles.reuploadText}>重传</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.deleteButton} onPress={() => confirmDeleteAttachment(attachment)} testID={`spark-attachment-delete-${attachment.id}`}>
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
              </Pressable>
            </View>
          ))
        )}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>关联计划（{links.length}）</Text>
        </View>
        {links.length === 0 ? (
          <Text style={styles.sectionEmpty}>尚未关联计划</Text>
        ) : (
          links.map((summary) => (
            <View key={summary.itemId} style={styles.linkRow} testID={`spark-link-row-${summary.itemId}`}>
              <Pressable style={styles.linkBody} onPress={() => goToItem(summary.itemId)}>
                <View style={[styles.categoryDot, { backgroundColor: summary.categoryColor ?? colors.border }]} />
                <Text style={styles.linkTitle} numberOfLines={1}>{summary.title}</Text>
                <Text style={styles.linkMeta}>
                  {summary.startAt !== null ? formatItemStart(summary.startAt, summary.allDay, getDeviceTzid()) : '无时刻'}
                </Text>
              </Pressable>
              <Pressable style={styles.deleteButton} onPress={() => void unlink(summary.itemId)} testID={`spark-unlink-${summary.itemId}`}>
                <Ionicons name="unlink" size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          ))
        )}

        <Pressable style={styles.convertButton} onPress={startConvertToItem} testID="spark-to-item">
          <Ionicons name="git-branch-outline" size={18} color={colors.textOnPrimary} />
          <Text style={styles.convertButtonText}>转计划</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={imageModalUri !== null} transparent onRequestClose={() => setImageModalUri(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setImageModalUri(null)} testID="spark-image-modal">
          {imageModalUri !== null ? (
            <Image source={{ uri: imageModalUri }} style={styles.modalImage} resizeMode="contain" />
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    center: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    emptyText: {
      fontSize: 14,
      color: c.textMuted,
    },
    scrollContent: {
      padding: 16,
      gap: 12,
    },
    titleInput: {
      fontSize: 18,
      fontWeight: '600',
      color: c.text,
      backgroundColor: c.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    contentInput: {
      fontSize: 14,
      color: c.text,
      backgroundColor: c.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      minHeight: 96,
      textAlignVertical: 'top',
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 4,
    },
    sectionTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: c.text,
    },
    attachActions: {
      flexDirection: 'row',
      gap: 8,
    },
    attachButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: c.card,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    attachButtonText: {
      fontSize: 12,
      color: c.primary,
    },
    sectionEmpty: {
      fontSize: 13,
      color: c.textMuted,
    },
    attachmentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: c.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      padding: 10,
    },
    playButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.background,
    },
    attachmentThumb: {
      width: 44,
      height: 44,
      borderRadius: 8,
    },
    attachmentMeta: {
      flex: 1,
      gap: 2,
    },
    attachmentKind: {
      fontSize: 14,
      color: c.text,
    },
    attachmentSub: {
      fontSize: 12,
      color: c.textMuted,
    },
    reuploadButton: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    reuploadText: {
      fontSize: 12,
      color: c.primary,
    },
    deleteButton: {
      padding: 6,
    },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      padding: 10,
    },
    linkBody: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    categoryDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    linkTitle: {
      flex: 1,
      fontSize: 14,
      color: c.text,
    },
    linkMeta: {
      fontSize: 12,
      color: c.textMuted,
    },
    convertButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: c.primary,
      borderRadius: 10,
      paddingVertical: 12,
      marginTop: 8,
    },
    convertButtonText: {
      fontSize: 15,
      fontWeight: '600',
      color: c.textOnPrimary,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.9)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalImage: {
      width: '100%',
      height: '100%',
    },
  });
}
