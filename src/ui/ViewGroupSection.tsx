/**
 * 切片 7：今日/本周视图的分组区块与行组件（ui.md「今日/本周视图（v0.7）」节）。
 *
 * - 空分组不渲染任何内容（契约：单个分组为空时隐藏该分组标题）；
 * - 行展示 title / type / 时间标签，点击进入详情页；归档/删除不在此提供；
 * - 时间标签：已安排=时刻或“全天”，过期=“已过期”+endAt，今日创建=创建时间；
 * - done 项置灰展示（排序“同组末尾”由 groupItemsForView 保证，本组件只负责展示）；
 * - 快速完成/取消完成按钮：任一行切换进行中时全部置灰（串行化，防重复提交）。
 *   数据流转与 reconcile 由页面负责（见 src/app/today.tsx / week.tsx）。
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { formatLocalTime, getZonedParts } from '../domain/recurrence/civilTime';
import type { ItemWithTags } from '../domain/tag';
import type { ViewGroupId } from '../domain/views/grouping';
import { TYPE_LABELS } from './display';
import { formatItemTime } from './timeFormat';

interface ViewGroupSectionProps {
  title: string;
  groupId: ViewGroupId;
  items: ItemWithTags[];
  /** 设备 IANA 时区（页面挂载时用 getDeviceTzid() 确定一次） */
  tzid: string;
  /** 正在切换状态的 item id；非 null 期间所有快速完成按钮置灰 */
  busyItemId: string | null;
  onToggleStatus: (item: ItemWithTags) => void;
}

/**
 * 行时间标签（ui.md v0.7 展示节）：
 * - 过期组：'已过期 YYYY-MM-DD HH:mm'（endAt 由分组逻辑保证非 null，null 时防御性只显“已过期”）；
 * - 已安排组：allDay → '全天'；否则显当天时刻 'HH:mm'；
 * - 今日创建组：'创建于 YYYY-MM-DD HH:mm'。
 */
function rowTimeLabel(item: ItemWithTags, groupId: ViewGroupId, tzid: string): string {
  if (groupId === 'overdue') {
    const endAt = item.endAt;
    if (endAt === null) {
      return '已过期';
    }
    return `已过期 ${formatItemTime(endAt, tzid)}`;
  }
  if (groupId === 'scheduled') {
    if (item.allDay) {
      return '全天';
    }
    const startAt = item.startAt;
    if (startAt === null) {
      return '未安排';
    }
    const parts = getZonedParts(startAt, tzid);
    return formatLocalTime(parts.hour, parts.minute);
  }
  return `创建于 ${formatItemTime(item.createdAt, tzid)}`;
}

export function ViewGroupSection({
  title,
  groupId,
  items,
  tzid,
  busyItemId,
  onToggleStatus,
}: ViewGroupSectionProps) {
  const router = useRouter();

  if (items.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.map((item) => {
        const isDone = item.status === 'done';
        const busy = busyItemId !== null;
        return (
          <Pressable
            key={item.id}
            style={styles.row}
            onPress={() => router.push(`/item/${item.id}`)}
          >
            <View style={styles.rowTextColumn}>
              <Text style={[styles.rowTitle, isDone && styles.rowTitleDone]}>{item.title}</Text>
              <Text style={styles.rowMeta}>
                {TYPE_LABELS[item.type]} · {rowTimeLabel(item, groupId, tzid)}
              </Text>
            </View>
            <Pressable
              style={[styles.toggleButton, busy && styles.toggleButtonDisabled]}
              disabled={busy}
              onPress={() => onToggleStatus(item)}
            >
              <Text
                style={[styles.toggleButtonText, busy && styles.toggleButtonTextDisabled]}
              >
                {isDone ? '取消完成' : '完成'}
              </Text>
            </Pressable>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#555555',
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#dddddd',
  },
  rowTextColumn: {
    flex: 1,
    marginRight: 8,
  },
  rowTitle: {
    fontSize: 15,
    color: '#111111',
  },
  rowTitleDone: {
    color: '#aaaaaa',
  },
  rowMeta: {
    fontSize: 12,
    color: '#888888',
    marginTop: 2,
  },
  toggleButton: {
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  toggleButtonDisabled: {
    borderColor: '#cccccc',
  },
  toggleButtonText: {
    fontSize: 12,
    color: '#2563eb',
  },
  toggleButtonTextDisabled: {
    color: '#cccccc',
  },
});
