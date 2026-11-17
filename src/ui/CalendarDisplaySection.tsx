/**
 * 筛选面板「日历显示」区（切片 27，AGENTS.md §7.39 D8；ui.md v0.31 契约）。
 *
 * 日历多选唯一入口（2026-11-17 用户决策：取消独立设置页）：按账户分组
 * （组头 = sourceName 原样显示，缺失归「其他」组）+ 色点（Calendar.color，
 * null 回退默认色）+ 日历名 + 显隐开关（眼睛图标）。
 * 点选开关即时经 updateSettings 写入 displayCalendarIds（空集合 = 功能关闭）
 * 并经 onSelectionChange 通知父级（父级喂给 useSystemCalendarEvents，
 * 四视图即时生效）。MVP 不做分组折叠。
 *
 * 区底固定说明（ui.md 契约文案）：功能语义 +「已导入过的日历同时显示可能重复」。
 * 权限拒绝态区底提示 +「重新授权」按钮（reload 走 useSystemCalendarList 重载），
 * 拒绝态不崩溃。web 平台不渲染（expo-calendar 无 web 实现）。
 *
 * 纯展示+设置写回组件：日历清单/权限态经 props 传入（plan.tsx 统一持有
 * useSystemCalendarList），不直接访问 WatermelonDB 读取路径；
 * FilterSheet 经 calendarDisplay 插槽挂载本组件（保持 FilterSheet 纯 UI）。
 */

import { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Ionicons } from '@expo/vector-icons';

import { itemRepository } from '../data';
import type { SystemCalendarInfo } from '../domain/systemCalendar/types';
import { useTheme } from './theme';
import type { ThemeColors } from './theme';

/** 合法日历色（hex；数据异常回退约定 repository.md v0.14 同款校验）。 */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** 区底固定说明文案（ui.md v0.31：功能语义 + 重复提示，逐字契约措辞）。 */
const FIXED_NOTICE =
  '选中的系统日历事件将实时显示在各视图中（仅实时读取，不保存到应用）。' +
  '已导入过的日历同时显示可能重复（按事件标识+开始时间去重，重复系列只命中被导入的首实例）。';

/** sourceName 分组缺失时的组头（ui.md：缺失归「其他」组）。 */
const OTHER_SOURCE_GROUP = '其他';

export type CalendarDisplayListStatus = 'loading' | 'ready' | 'no-permission' | 'error';

interface CalendarDisplaySectionProps {
  /** 设备日历清单（useSystemCalendarList 结果）。 */
  calendars: SystemCalendarInfo[];
  /** 清单加载状态（loading/ready/无权限/错误）。 */
  listStatus: CalendarDisplayListStatus;
  /** 「重新授权」/重试（重走 requestPermissions + getCalendars）。 */
  onReloadCalendars: () => void;
  /** 当前选中日历 id（受控值 = settings.displayCalendarIds）。 */
  selectedIds: string[];
  /** 开关切换：组件写回 settings 后上报父级（父级更新 hook 入参）。 */
  onSelectionChange: (ids: string[]) => void;
}

/** 按来源名分组（插入序保持 getCalendars 返回顺序；缺失/空归「其他」组）。 */
function groupBySourceName(calendars: SystemCalendarInfo[]): Map<string, SystemCalendarInfo[]> {
  const groups = new Map<string, SystemCalendarInfo[]>();
  for (const calendar of calendars) {
    const key = calendar.sourceName !== null && calendar.sourceName !== '' ? calendar.sourceName : OTHER_SOURCE_GROUP;
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [calendar]);
    } else {
      bucket.push(calendar);
    }
  }
  return groups;
}

export default function CalendarDisplaySection({
  calendars,
  listStatus,
  onReloadCalendars,
  selectedIds,
  onSelectionChange,
}: CalendarDisplaySectionProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // 乐观开关：先翻转本地选中集再写库；写库失败回退（updateSettings 抛错路径）。
  const [pendingWrite, setPendingWrite] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const groups = useMemo(() => groupBySourceName(calendars), [calendars]);

  const toggle = useCallback(
    (calendarId: string): void => {
      if (pendingWrite) {
        return;
      }
      const next = selectedSet.has(calendarId)
        ? selectedIds.filter((id) => id !== calendarId)
        : [...selectedIds, calendarId];
      onSelectionChange(next);
      setPendingWrite(true);
      void itemRepository
        .updateSettings({ displayCalendarIds: next })
        .then(() => {
          setPendingWrite(false);
        })
        .catch(() => {
          // 写库失败：回退选择（保持 settings 为准），下次操作可重试
          onSelectionChange(selectedIds);
          setPendingWrite(false);
        });
    },
    [onSelectionChange, pendingWrite, selectedIds, selectedSet],
  );

  if (Platform.OS === 'web') {
    return null;
  }

  return (
    <View>
      <Text style={styles.sectionLabel}>日历显示</Text>
      {listStatus === 'loading' ? (
        <Text style={styles.emptyHint}>正在读取系统日历…</Text>
      ) : null}
      {listStatus === 'no-permission' ? (
        <View style={styles.stateRow}>
          <Text style={styles.emptyHint}>未获得日历读取权限，无法列出系统日历。</Text>
          <Pressable
            style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
            onPress={onReloadCalendars}
            accessibilityLabel="重新授权日历读取"
          >
            <Text style={styles.retryText}>重新授权</Text>
          </Pressable>
        </View>
      ) : null}
      {listStatus === 'error' ? (
        <View style={styles.stateRow}>
          <Text style={styles.emptyHint}>读取系统日历失败，请重试。</Text>
          <Pressable
            style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
            onPress={onReloadCalendars}
            accessibilityLabel="重试读取日历"
          >
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </View>
      ) : null}
      {listStatus === 'ready' && calendars.length === 0 ? (
        <Text style={styles.emptyHint}>未找到可显示的系统日历。</Text>
      ) : null}
      {listStatus === 'ready' && calendars.length > 0
        ? [...groups.entries()].map(([sourceName, groupCalendars]) => (
            <View key={sourceName}>
              <Text style={styles.groupHeader}>{sourceName}</Text>
              {groupCalendars.map((calendar) => {
                const selected = selectedSet.has(calendar.id);
                const dotColor =
                  calendar.color !== null && HEX_COLOR_PATTERN.test(calendar.color)
                    ? calendar.color
                    : colors.border;
                const calendarTitle =
                  calendar.title !== '' ? calendar.title : '（未命名日历）';
                return (
                  <Pressable
                    key={calendar.id}
                    style={({ pressed }) => [styles.calendarRow, pressed && styles.rowPressed]}
                    onPress={() => toggle(calendar.id)}
                    accessibilityLabel={
                      selected ? `隐藏日历 ${calendarTitle}` : `显示日历 ${calendarTitle}`
                    }
                    accessibilityState={{ selected }}
                  >
                    <View style={[styles.colorDot, { backgroundColor: dotColor }]} />
                    <Text style={styles.calendarTitle} numberOfLines={1}>
                      {calendarTitle}
                    </Text>
                    <View style={styles.eyeSlot}>
                      <Ionicons
                        name={selected ? 'eye-outline' : 'eye-off-outline'}
                        size={20}
                        color={selected ? colors.text : colors.textMuted}
                      />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))
        : null}
      <Text style={styles.fixedNotice}>{FIXED_NOTICE}</Text>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    sectionLabel: {
      fontSize: 12,
      color: c.textMuted,
      marginTop: 12,
      marginBottom: 8,
    },
    emptyHint: {
      fontSize: 13,
      color: c.textMuted,
    },
    stateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    retryButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.background,
    },
    retryButtonPressed: {
      opacity: 0.6,
    },
    retryText: {
      fontSize: 13,
      color: c.text,
    },
    groupHeader: {
      fontSize: 12,
      fontWeight: '600',
      color: c.textMuted,
      marginTop: 8,
      marginBottom: 4,
    },
    calendarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
    },
    rowPressed: {
      opacity: 0.6,
    },
    colorDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
    },
    calendarTitle: {
      flex: 1,
      fontSize: 14,
      color: c.text,
    },
    eyeSlot: {
      width: 28,
      alignItems: 'center',
    },
    fixedNotice: {
      fontSize: 12,
      color: c.textMuted,
      marginTop: 10,
      lineHeight: 17,
    },
  });
}
