import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import FlashConfirmCard from '../../ui/FlashConfirmCard';
import FlashEditModal from '../../ui/FlashEditModal';
import FlashPreviewCard from '../../ui/FlashPreviewCard';
import FlashResultCard from '../../ui/FlashResultCard';
import { useFlashChat } from '../../ui/useFlashChat';
import type { FlashChatMessage } from '../../ui/useFlashChat';
import { getDeviceTzid } from '../../ui/timeFormat';
import { useTheme } from '../../ui/theme';
import type { ThemeColors } from '../../ui/theme';

/**
 * 闪电添加 Chat 页（tasks/slice-15.md 阶段 3；AGENTS.md §7.25）：
 * - 消息列表（用户气泡靠右 / AI 提示靠左）+ 底部多行输入框与发送按钮；
 * - 预览卡片常驻输入区上方（每轮解析就地更新，验收 7「改成后天」），
 *   点击卡片进编辑弹窗（验收 8），「确认添加」落库（验收 9）；
 * - 无 Key / 断网降级为本地解析，原因注明在 AI 侧消息里（验收 5）；
 * - 确认添加后提示 Alert（含提醒未落库说明），列表由计划页响应式刷新。
 * - 切片 22 阶段 2/3（AGENTS.md §7.34）：保存成功后的 AI 回复渲染为结果卡片
 *   （kind:'card'），点击卡片主体跳详情页 /item/[id]；快捷推迟 chips 阶段 3
 *   接线（推迟 + once 提醒 onceAt 联动 + 卡片原地刷新）。
 */

function MessageRow({ message }: { message: FlashChatMessage }) {
  // 切片 24（§7.36）：颜色走全局 Token（夜间模式），深浅色跟随系统。
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isUser = message.role === 'user';
  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      <Text style={isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant}>
        {message.text}
      </Text>
    </View>
  );
}

export default function FlashScreen() {
  // 切片 24（§7.36）：颜色走全局 Token（夜间模式），深浅色跟随系统。
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const chat = useFlashChat();
  const [input, setInput] = useState('');
  const [editVisible, setEditVisible] = useState(false);
  const deviceTzid = getDeviceTzid();
  // 切片 21（AGENTS.md §7.32）：Tab 页顶部必须让出系统状态栏；底部让出手势条。
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleSend = (): void => {
    const text = input;
    setInput('');
    void chat.send(text);
  };

  const handleConfirm = (): void => {
    void chat.confirmSave().then((result) => {
      if (!result.ok || result.notice === null) return;
      Alert.alert('已添加', result.notice);
    });
  };

  const currentDraft = chat.draft;
  const hasDraft = currentDraft !== null;

  // 切片 23 验收反馈修补（2026-11-15 MuMu）：非倒置 FlatList 不自动跟随新内容——
  // 长历史下追加消息（及预览卡出现压缩列表视口）会把列表尾部裁出屏外，
  // 视觉上像被卡片区"盖住"。
  // 修补二轮：滚动挂在 onContentSizeChange（新内容布局完成后回调），effect 仅
  // 负责视口压缩（预览卡出现/消失，contentSize 不变）的场景。
  // 修补三轮：①animated 滚动会与窗口化挂载竞速（滚途中新 item 陆续挂载、
  // 内容底边持续下移，动画停在半截）→ 改 animated:false 瞬时跳底，窗口化
  // 每次重测量都会再次跳，最终收敛；②onScroll 跟踪是否接近底部，仅近底或
  // 用户刚发送时才跟随——避免正在上翻历史时被窗口化 remeasure 硬拽回底部。
  const listRef = useRef<FlatList<FlashChatMessage> | null>(null);
  const nearBottomRef = useRef(true);
  const lastMessage = chat.messages[chat.messages.length - 1];
  const lastIsUserSent = lastMessage?.role === 'user';
  const scrollToBottom = useCallback((force: boolean) => {
    if (chat.messages.length === 0) return;
    if (!force && !nearBottomRef.current) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: false });
    });
  }, [chat.messages]);
  useEffect(() => {
    scrollToBottom(lastIsUserSent);
  }, [scrollToBottom, lastIsUserSent, hasDraft]);

  // 切片 22 阶段 2（AGENTS.md §7.34）：结果卡片消息走 FlashResultCard；
  // cardPayload 属性窄化不进闭包，先捕获到局部 const 再用于 onPress。
  // 卡片直接作为 FlatList 单元渲染（不包 row wrapper：row 主轴按内容测宽
  // 会把内部 flex:1 的 body 塌缩成 0 宽——13:50 MuMu 复现，见反馈文件教训）。
  // 切片 22 阶段 3：快捷推迟 chips 接线（推迟 + once 提醒 onceAt 联动 +
  // cardPayload 原地刷新在 useFlashChat.postponeCard）。
  const renderMessage = ({ item }: { item: FlashChatMessage }) => {
    if (item.kind === 'card' && item.cardPayload !== undefined) {
      const payload = item.cardPayload;
      return (
        <FlashResultCard
          payload={payload}
          tzid={deviceTzid}
          onPress={() => router.push(`/item/${payload.itemId}`)}
          onPostpone={(minutes) => {
            void chat.postponeCard(payload.itemId, minutes);
          }}
        />
      );
    }
    // 切片 25 阶段 2（AGENTS.md §7.37）：认真模式确认消息走 FlashConfirmCard；
    // chips 接线 applyConfirm/dismissConfirm（选项点击本地处理，不发起 AI 轮次），
    // busy（AI 轮次进行中）时禁用。载荷捕获局部 const 再进闭包（同 card 先例），
    // 同样不包 row wrapper（row 主轴按内容测宽会把 body 塌缩成 0 宽）。
    if (item.kind === 'confirm' && item.confirmPayload !== undefined) {
      const confirmPayload = item.confirmPayload;
      return (
        <FlashConfirmCard
          payload={confirmPayload}
          disabled={chat.busy}
          onApply={() => {
            chat.applyConfirm(confirmPayload.confirmId);
          }}
          onDismiss={() => {
            chat.dismissConfirm(confirmPayload.confirmId);
          }}
        />
      );
    }
    return <MessageRow message={item} />;
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { paddingTop: insets.top }]}
      behavior="padding"
    >
      <FlatList
        ref={listRef}
        onContentSizeChange={() => scrollToBottom(false)}
        onScroll={(e) => {
          const { contentSize, contentOffset, layoutMeasurement } = e.nativeEvent;
          nearBottomRef.current =
            contentOffset.y + layoutMeasurement.height >= contentSize.height - 120;
        }}
        scrollEventThrottle={100}
        style={styles.list}
        data={chat.messages}
        keyExtractor={(message) => String(message.id)}
        renderItem={renderMessage}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>⚡ 闪电添加</Text>
            <Text style={styles.emptyHint}>
              用一句话创建条目，例如：{'\n'}
              · 明天下午3点开周会，重要，#工作{'\n'}
              · 每周三晚上8点健身 提前30分钟提醒我{'\n'}
              · 周末爬山
            </Text>
            <Text style={styles.emptyFoot}>
              未配置 AI Key 时使用本地解析（设置 → AI 配置）。
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
      />

      {currentDraft !== null ? (
        <View style={styles.cardWrap}>
          <FlashPreviewCard
            draft={currentDraft}
            categories={chat.categories}
            tzid={deviceTzid}
            onPress={() => setEditVisible(true)}
          />
          <View style={styles.actionRow}>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => setEditVisible(true)}
            >
              <Text style={styles.secondaryText}>修改字段</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryButton, chat.busy && styles.disabled]}
              onPress={handleConfirm}
              disabled={chat.busy}
            >
              <Text style={styles.primaryText}>
                {chat.busy ? '保存中…' : '确认添加'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={[styles.inputRow, { paddingBottom: 12 + insets.bottom }]}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="输入事项，或继续纠正上面的卡片…"
          placeholderTextColor={colors.textMuted}
          multiline
        />
        <Pressable
          style={[styles.sendButton, (chat.busy || input.trim().length === 0) && styles.disabled]}
          onPress={handleSend}
          disabled={chat.busy || input.trim().length === 0}
        >
          {chat.busy ? (
            <ActivityIndicator size="small" color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.sendText}>发送</Text>
          )}
        </Pressable>
      </View>

      <FlashEditModal
        visible={editVisible && currentDraft !== null}
        draft={currentDraft}
        categories={chat.categories}
        onCancel={() => setEditVisible(false)}
        onConfirm={(next) => {
          chat.applyEdit(next);
          setEditVisible(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: c.background,
    },
    list: {
      flex: 1,
    },
    listContent: {
      padding: 12,
      gap: 8,
    },
    emptyWrap: {
      alignItems: 'center',
      marginTop: 64,
      gap: 10,
      paddingHorizontal: 24,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: c.text,
    },
    emptyHint: {
      fontSize: 13,
      color: c.text,
      lineHeight: 22,
      textAlign: 'left',
    },
    emptyFoot: {
      fontSize: 12,
      color: c.textMuted,
    },
    row: {
      flexDirection: 'row',
    },
    rowUser: {
      justifyContent: 'flex-end',
    },
    rowAssistant: {
      justifyContent: 'flex-start',
    },
    bubbleTextUser: {
      backgroundColor: c.primary,
      color: c.textOnPrimary,
      fontSize: 14,
      borderRadius: 12,
      borderTopRightRadius: 2,
      paddingHorizontal: 12,
      paddingVertical: 8,
      maxWidth: 280,
    },
    bubbleTextAssistant: {
      // 淡色填充底 → card（阶段 2 规则 3 按语义就近归类）
      backgroundColor: c.card,
      color: c.text,
      fontSize: 12,
      borderRadius: 12,
      borderTopLeftRadius: 2,
      paddingHorizontal: 10,
      paddingVertical: 6,
      maxWidth: 300,
    },
    cardWrap: {
      paddingHorizontal: 12,
      paddingBottom: 4,
    },
    actionRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 8,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: 'center',
    },
    secondaryButton: {
      flex: 1,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: 'center',
    },
    primaryText: {
      color: c.textOnPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    secondaryText: {
      color: c.text,
      fontSize: 14,
    },
    disabled: {
      opacity: 0.5,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      padding: 12,
      backgroundColor: c.card,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    input: {
      flex: 1,
      maxHeight: 96,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingTop: 8,
      paddingBottom: 8,
      fontSize: 14,
      color: c.text,
      backgroundColor: c.card,
    },
    sendButton: {
      backgroundColor: c.primary,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    sendText: {
      color: c.textOnPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
  });
}
