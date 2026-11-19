import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { itemRepository } from '../../data';
import FlashConfirmCard from '../../ui/FlashConfirmCard';
import FlashEditModal from '../../ui/FlashEditModal';
import FlashPreviewCard from '../../ui/FlashPreviewCard';
import FlashResultCard from '../../ui/FlashResultCard';
import { useFlashChat } from '../../ui/useFlashChat';
import type { FlashChatMessage, FlashDebugPayload } from '../../ui/useFlashChat';
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

function MessageRow({
  message,
  onPress,
}: {
  message: FlashChatMessage;
  /** 切片 32（§7.44）：调试入口消息点击回调（undefined = 普通文本不可点）。 */
  onPress?: () => void;
}) {
  // 切片 24（§7.36）：颜色走全局 Token（夜间模式），深浅色跟随系统。
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isUser = message.role === 'user';
  const bubble = (
    <Text style={isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant}>
      {message.text}
    </Text>
  );
  if (onPress === undefined) {
    return <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>{bubble}</View>;
  }
  // 调试入口消息（assistant 侧）：淡色底 + 可点击。
  return (
    <View style={[styles.row, styles.rowAssistant]}>
      <Pressable onPress={onPress}>{bubble}</Pressable>
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
  // 切片 32（AGENTS.md §7.44）：调试弹层载荷（null = 关闭）。showRequest/
  // showResponse 在打开时读取当下设置（开关即时生效，弹层按当下值显隐节）。
  const [debugView, setDebugView] = useState<{
    request: string | null;
    response: string | null;
    draft: string;
    showRequest: boolean;
    showResponse: boolean;
  } | null>(null);
  const deviceTzid = getDeviceTzid();
  // 切片 21（AGENTS.md §7.32）：Tab 页顶部必须让出系统状态栏；底部让出手势条。
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleSend = (): void => {
    const text = input;
    setInput('');
    void chat.send(text);
  };

  /**
   * 切片 32（AGENTS.md §7.44）：打开调试弹层——节显隐按「当下」设置读取
   * （开关即时生效：入口消息可能是旧开关态下追加的，弹层以打开时为准）。
   * 读取失败回退双关（仅展示提示行，不炸弹层）。
   */
  const openDebugModal = useCallback(async (payload: FlashDebugPayload): Promise<void> => {
    let showRequest = false;
    let showResponse = false;
    try {
      const settings = await itemRepository.getSettings();
      showRequest = settings.showAiRequest === true;
      showResponse = settings.showAiResponse === true;
    } catch (error) {
      console.warn('[slice-32] 调试弹层设置读取失败', error);
    }
    setDebugView({
      request: payload.request,
      response: payload.response,
      draft: payload.draft,
      showRequest,
      showResponse,
    });
  }, []);

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

  // 切片 29（AGENTS.md §7.40）：聊天列表最后一条 kind:'card' 消息＝当前卡，
  // 其余 card 消息传 historical（降透明度 +「历史」角标，FlashResultCard）。
  // confirm/文本消息不参与判定；FlashConfirmCard 不传此 prop。
  const lastCardId = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i -= 1) {
      const message = chat.messages[i];
      if (message.kind === 'card' && message.cardPayload !== undefined) {
        return message.id;
      }
    }
    return null;
  }, [chat.messages]);

  // 切片 30（§7.41 D2）：页面聚焦时批量 reconcile 已删除卡——从详情页删除后
  // 返回聊天（或切 Tab 回来）即触发，一次性批量查询不轮询（切片 27 惯例）。
  useFocusEffect(
    useCallback(() => {
      void chat.reconcileDeletedCards();
    }, [chat.reconcileDeletedCards]),
  );

  // 切片 22 阶段 2（AGENTS.md §7.34）：结果卡片消息走 FlashResultCard；
  // cardPayload 属性窄化不进闭包，先捕获到局部 const 再用于 onPress。
  // 卡片直接作为 FlatList 单元渲染（不包 row wrapper：row 主轴按内容测宽
  // 会把内部 flex:1 的 body 塌缩成 0 宽——13:50 MuMu 复现，见反馈文件教训）。
  // 切片 22 阶段 3：快捷推迟 chips 接线（推迟 + once 提醒 onceAt 联动 +
  // cardPayload 原地刷新在 useFlashChat.postponeCard）。
  const renderMessage = ({ item }: { item: FlashChatMessage }) => {
    if (item.kind === 'card' && item.cardPayload !== undefined) {
      const payload = item.cardPayload;
      // 切片 30（§7.41 D2）：deleted=true（reconcile 判定条目已删）→ 置灰 +
      //「已删除」角标 + 点击禁用 + chips 隐藏（FlashResultCard 内部处理）。
      const deleted = chat.deletedItemIds.has(payload.itemId);
      return (
        <FlashResultCard
          payload={payload}
          tzid={deviceTzid}
          historical={item.id !== lastCardId}
          deleted={deleted}
          onPress={() => {
            if (deleted) return; // 已删除卡不可点进详情（双保险，Pressable 已 disabled）
            router.push(`/item/${payload.itemId}`);
          }}
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
    // 切片 32（AGENTS.md §7.44）：AI 调试入口消息（debugPayload 必有）——
    // 点击弹调试弹层；节显隐按当下设置读取（开关即时生效）。
    if (item.debugPayload !== undefined) {
      const debugPayload = item.debugPayload;
      return (
        <MessageRow
          message={item}
          onPress={() => {
            void openDebugModal(debugPayload);
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
            {/* 切片 30（§7.41）阶段 3：第三条本地操作「放弃」——纯本地清草稿
                （不发起 AI 轮次、不落库、不播种），卡片原地转弃置态。 */}
            <Pressable
              style={styles.secondaryButton}
              onPress={chat.dismissDraft}
              disabled={chat.busy}
            >
              <Text style={styles.secondaryText}>放弃</Text>
            </Pressable>
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
      ) : chat.dismissedDraft !== null ? (
        // 切片 30（§7.41）阶段 3：弃置卡——原地置灰 +「已放弃」角标，无按钮行；
        // 快照仅活到下一个动作（send 清空），内存态、不落库。
        <View style={styles.cardWrap}>
          <FlashPreviewCard
            draft={chat.dismissedDraft}
            categories={chat.categories}
            tzid={deviceTzid}
            dismissed={true}
            onPress={() => {
              /* 弃置卡不可编辑（disabled），onPress 恒不触发 */
            }}
          />
        </View>
      ) : null}

      {/* 切片 30（§7.41）：重试即时提示——仅轮进行中存在（send finally 清空），
          不进聊天历史；行本身随提示消失，无额外占位。 */}
      {chat.retryNotice !== null ? (
        <View style={styles.retryNoticeRow}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={styles.retryNoticeText}>{chat.retryNotice}</Text>
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

      {/* 切片 32（AGENTS.md §7.44）：AI 调试弹层——三节「AI 输入（请求体）」
          随 show_ai_request、「AI 输出（原始响应）」「卡片数据（草稿 JSON）」
          随 show_ai_response；ScrollView 只读展示，点遮罩/关闭按钮收起。 */}
      <Modal
        visible={debugView !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setDebugView(null)}
      >
        <Pressable style={styles.debugOverlay} onPress={() => setDebugView(null)}>
          <Pressable style={styles.debugSheet} onPress={() => undefined}>
            <View style={styles.debugHeader}>
              <Text style={styles.debugTitle}>🔍 AI 调试详情</Text>
              <Pressable onPress={() => setDebugView(null)}>
                <Text style={styles.debugClose}>关闭</Text>
              </Pressable>
            </View>
            {debugView === null ? null : !debugView.showRequest && !debugView.showResponse ? (
              <Text style={styles.debugEmpty}>
                调试开关均已关闭（设置 → AI 配置区块），无可展示内容。
              </Text>
            ) : (
              <ScrollView style={styles.debugScroll}>
                {debugView.showRequest ? (
                  <View style={styles.debugSection}>
                    <Text style={styles.debugSectionTitle}>AI 输入（请求体，不含请求头）</Text>
                    <Text style={styles.debugSectionText}>
                      {debugView.request ?? '（本轮未采集到请求体）'}
                    </Text>
                  </View>
                ) : null}
                {debugView.showResponse ? (
                  <View style={styles.debugSection}>
                    <Text style={styles.debugSectionTitle}>AI 输出（原始响应）</Text>
                    <Text style={styles.debugSectionText}>
                      {debugView.response ?? '（本轮未采集到响应）'}
                    </Text>
                  </View>
                ) : null}
                {debugView.showResponse ? (
                  <View style={styles.debugSection}>
                    <Text style={styles.debugSectionTitle}>卡片数据（草稿 JSON）</Text>
                    <Text style={styles.debugSectionText}>{debugView.draft}</Text>
                  </View>
                ) : null}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
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
    // 切片 30（§7.41）：重试即时提示行（输入栏上方；Token 化，深浅色可读）。
    retryNoticeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    retryNoticeText: {
      fontSize: 12,
      color: c.textMuted,
      flexShrink: 1,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      padding: 12,
      backgroundColor: c.card,
      borderTopWidth: StyleSheet.hairlineWidth,      borderTopColor: c.border,
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
    // 切片 32（§7.44）：AI 调试弹层（Token 化，深浅色可读）。
    debugOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    debugSheet: {
      backgroundColor: c.card,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 24,
      maxHeight: '82%',
    },
    debugHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    debugTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
    },
    debugClose: {
      fontSize: 14,
      color: c.primary,
    },
    debugEmpty: {
      fontSize: 13,
      color: c.textMuted,
      paddingVertical: 12,
    },
    debugScroll: {
      maxHeight: 560,
    },
    debugSection: {
      marginBottom: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: 8,
      padding: 10,
    },
    debugSectionTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: c.text,
      marginBottom: 6,
    },
    debugSectionText: {
      fontSize: 11,
      color: c.text,
      lineHeight: 16,
    },
  });
}
