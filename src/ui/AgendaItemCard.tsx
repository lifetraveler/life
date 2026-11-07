import { Pressable, StyleSheet, Text, View } from 'react-native';

import { contrastTextColor } from './color';

interface AgendaItemCardProps {
  title: string;
  /**
   * 分类颜色（十六进制，来源于 Category.color，§7.22）；null/非法值回退灰。
   * 渲染为左侧 4px 宽的颜色条（tasks/slice-14.md 核心实现要求 2）。
   */
  colorHex?: string | null;
  /** 分类 Emoji（§7.22）；null/空不渲染图标列 */
  emoji?: string | null;
  /** 时间段文案（formatAgendaTimeRange 的结果）；null 不渲染时间行（无 startAt 的待办） */
  timeLabel?: string | null;
  /** 传入则整卡可点击（进入详情） */
  onPress?: () => void;
}

/** 分类颜色缺失/非法时的颜色条回退（repository.md v0.14 数据异常回退约定） */
const FALLBACK_BAR_COLOR = '#9E9E9E';
/** 时间行在无有效分类色时的兜底文字色 */
const FALLBACK_TIME_COLOR = '#666666';

/**
 * Agenda 条目卡片容器骨架（tasks/slice-14.md 阶段 2，静态 UI）：
 * 极简风格，无边框，微小圆角（8），左侧 4px 颜色条，
 * 内部左侧 Emoji、右侧标题 + 时间段（对齐 Toki 图3）。
 * 纯展示组件：文案与颜色均由调用方传入（Phase 4 接线 ItemWithRelations）。
 */
export default function AgendaItemCard({
  title,
  colorHex,
  emoji,
  timeLabel,
  onPress,
}: AgendaItemCardProps) {
  const onColor = colorHex ? contrastTextColor(colorHex) : null;
  const barColor = onColor !== null && colorHex ? colorHex : FALLBACK_BAR_COLOR;
  const timeColor = onColor !== null && colorHex ? colorHex : FALLBACK_TIME_COLOR;

  const body = (
    <View style={styles.card}>
      <View style={[styles.bar, { backgroundColor: barColor }]} />
      <View style={styles.content}>
        {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
        <View style={styles.textColumn}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {timeLabel ? (
            <Text style={[styles.time, { color: timeColor }]}>{timeLabel}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress}>
        {body}
      </Pressable>
    );
  }
  return body;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  bar: {
    width: 4,
    alignSelf: 'stretch',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 12,
  },
  emoji: {
    fontSize: 18,
    marginRight: 10,
  },
  textColumn: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1F1F1F',
  },
  time: {
    fontSize: 12,
  },
});
