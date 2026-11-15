import { useState } from 'react';
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

import FlashEditModal from '../../ui/FlashEditModal';
import FlashPreviewCard from '../../ui/FlashPreviewCard';
import FlashResultCard from '../../ui/FlashResultCard';
import { useFlashChat } from '../../ui/useFlashChat';
import type { FlashChatMessage } from '../../ui/useFlashChat';
import { getDeviceTzid } from '../../ui/timeFormat';

/**
 * 闪电添加 Chat 页（tasks/slice-15.md 阶段 3；AGENTS.md §7.25）：
 * - 消息列表（用户气泡靠右 / AI 提示靠左）+ 底部多行输入框与发送按钮；
 * - 预览卡片常驻输入区上方（每轮解析就地更新，验收 7「改成后天」），
 *   点击卡片进编辑弹窗（验收 8），「确认添加」落库（验收 9）；
 * - 无 Key / 断网降级为本地解析，原因注明在 AI 侧消息里（验收 5）；
 * - 确认添加后提示 Alert（含提醒未落库说明），列表由计划页响应式刷新。
 * - 切片 22 阶段 2（AGENTS.md §7.34）：保存成功后的 AI 回复渲染为结果卡片
 *   （kind:'card'），点击卡片主体跳详情页 /item/[id]；快捷推迟 chips 本阶段
 *   禁用占位（onPostpone 阶段 3 接线）。
 */

function MessageRow({ message }: { message: FlashChatMessage }) {
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

  // 切片 22 阶段 2（AGENTS.md §7.34）：结果卡片消息走 FlashResultCard；
  // cardPayload 属性窄化不进闭包，先捕获到局部 const 再用于 onPress。
  const renderMessage = ({ item }: { item: FlashChatMessage }) => {
    if (item.kind === 'card' && item.cardPayload !== undefined) {
      const payload = item.cardPayload;
      return (
        <View style={styles.cardRow}>
          <FlashResultCard
            payload={payload}
            tzid={deviceTzid}
            onPress={() => router.push(`/item/${payload.itemId}`)}
          />
        </View>
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
          placeholderTextColor="#999999"
          multiline
        />
        <Pressable
          style={[styles.sendButton, (chat.busy || input.trim().length === 0) && styles.disabled]}
          onPress={handleSend}
          disabled={chat.busy || input.trim().length === 0}
        >
          {chat.busy ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
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

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: '#F5F5F5',
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
    color: '#111111',
  },
  emptyHint: {
    fontSize: 13,
    color: '#444444',
    lineHeight: 22,
    textAlign: 'left',
  },
  emptyFoot: {
    fontSize: 12,
    color: '#999999',
  },
  row: {
    flexDirection: 'row',
  },
  cardRow: {
    flexDirection: 'row',
  },
  rowUser: {
    justifyContent: 'flex-end',
  },
  rowAssistant: {
    justifyContent: 'flex-start',
  },
  bubbleTextUser: {
    backgroundColor: '#4A90D9',
    color: '#FFFFFF',
    fontSize: 14,
    borderRadius: 12,
    borderTopRightRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 280,
  },
  bubbleTextAssistant: {
    backgroundColor: '#E8E8E8',
    color: '#333333',
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
    backgroundColor: '#4A90D9',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#CCCCCC',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryText: {
    color: '#444444',
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
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#DDDDDD',
  },
  input: {
    flex: 1,
    maxHeight: 96,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#CCCCCC',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
    fontSize: 14,
    color: '#111111',
    backgroundColor: '#FAFAFA',
  },
  sendButton: {
    backgroundColor: '#4A90D9',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
