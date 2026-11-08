/**
 * 筛选面板（BottomSheet）——tasks/slice-14.md 阶段 4 / AGENTS.md §7.21。
 *
 * 约束与实现（任务卡：禁止第三方 BottomSheet 库，零新依赖）：
 * - React Native 原生 Modal（transparent + animationType="none"）承载，
 *   进出场动画用 Animated.parallel 手写：面板 translateY 整屏滑入 + 遮罩淡入，220ms；
 * - 滑距固定为整屏高（不 onLayout 量面板高）：面板高度由内容决定（内部 ScrollView
 *   设 maxHeight 兜底，整体不超过约 80% 屏高），从整屏外滑入对任意高度都成立；
 * - 关闭走反向动画，动画结束后才回调 onClose（父级随后置 visible=false 卸载 Modal）；
 * - **即时生效（阶段 5b，用户拍板）**：无草稿/应用模型——点条件或视图选项立即经
 *   onChange(filters, viewKind) 上报父级（父级 setActiveFilters + setViewKind），
 *   面板展示完全受控（props.filters / props.viewKind 即当前已应用值）；
 *   X / 遮罩 / 安卓返回键 = 直接关闭（已生效的筛选保持）；
 * - 「重置」移至面板右上角：仅清空筛选，不动视图（阶段 5b 拍板）；
 * - 纯 UI 组件：不直接访问 WatermelonDB / expo-notifications（AGENTS.md §4 受保护契约）；
 * - 切片 14 阶段 5b：顶部「视图」区收敛为 4 项（日程/周/月/日，「今日」移除，
 *   AGENTS.md §7.21），点选即时切视图。
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { Category } from '../domain/category';
import type { ItemSourceType, ItemStatus } from '../domain/item';
import type { AgendaViewKind } from '../domain/views/agenda';
import { EMPTY_ITEM_FILTERS } from '../domain/views/filters';
import type { ItemFilters } from '../domain/views/filters';
import type { Tag } from '../domain/tag';
import CategoryChip from './CategoryChip';
import TagChip from './TagChip';
import { useTagDisplayMode } from './useTagDisplayMode';

/** 面板进出场动画时长（ms） */
const ANIMATION_DURATION_MS = 220;

/** 遮罩底色（按不透明度动画驱动） */
const BACKDROP_COLOR = 'rgba(0, 0, 0, 0.4)';

/** 日历源选项（§7.21「日历源」维度；文案沿用切片 8/9 的来源命名） */
const SOURCE_TYPE_OPTIONS: readonly { value: ItemSourceType; label: string }[] = [
  { value: 'local', label: '本地' },
  { value: 'ics', label: 'ICS 导入' },
  { value: 'system-calendar', label: '系统日历' },
];

/** 状态选项（§7.21「状态」维度；archived 项在查询层已排除，不提供该选项） */
const STATUS_OPTIONS: readonly { value: ItemStatus; label: string }[] = [
  { value: 'active', label: '未完成' },
  { value: 'done', label: '已完成' },
];

/** 视图选项（切片 14 阶段 5b：4 视图 = 日程/周/月/日，「今日」移除；图标 @expo/vector-icons） */
const VIEW_OPTIONS: readonly { kind: AgendaViewKind; label: string; icon: ComponentProps<typeof Ionicons>['name'] }[] = [
  { kind: 'agenda', label: '日程', icon: 'list-outline' },
  { kind: 'week', label: '周', icon: 'calendar-clear-outline' },
  { kind: 'month', label: '月', icon: 'calendar-outline' },
  { kind: 'day', label: '日', icon: 'sunny-outline' },
];

interface FilterSheetProps {
  visible: boolean;
  /** 分类全集（打开面板时由父级经 getCategories() 现取最新视觉传入） */
  categories: Category[];
  /** 标签全集（TagChip 按 tagDisplayMode 渲染 emoji；空集显示「暂无标签」） */
  tags: Tag[];
  /** 当前已应用的筛选（即时生效：受控值） */
  filters: ItemFilters;
  /** 当前已应用的视图模式（即时生效：受控值，切片 14 阶段 5b） */
  viewKind: AgendaViewKind;
  /** 任一条件/视图变化：父级提交新筛选 + 视图模式、不负责关闭（即时生效） */
  onChange: (filters: ItemFilters, viewKind: AgendaViewKind) => void;
  /** 关闭回调（反向动画结束后触发；父级置 visible=false 卸载 Modal） */
  onClose: () => void;
}

export default function FilterSheet({
  visible,
  categories,
  tags,
  filters,
  viewKind,
  onChange,
  onClose,
}: FilterSheetProps) {
  const tagDisplayMode = useTagDisplayMode();

  // 初始值即整屏高（面板在屏外）；关闭动画结束后回到屏外，循环打开不闪帧
  const translateY = useRef(new Animated.Value(Dimensions.get('window').height)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);

  // 打开：滑入动画（受控值即最新筛选，无需快照种子）
  useEffect(() => {
    if (!visible) {
      return;
    }
    translateY.setValue(Dimensions.get('window').height);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: ANIMATION_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: ANIMATION_DURATION_MS,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, translateY, backdropOpacity]);

  /** 关闭：反向动画，结束后才回调 onClose（期间忽略重复触发） */
  const requestClose = useCallback(() => {
    if (closingRef.current) {
      return;
    }
    closingRef.current = true;
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: Dimensions.get('window').height,
        duration: ANIMATION_DURATION_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: ANIMATION_DURATION_MS,
        useNativeDriver: true,
      }),
    ]).start(() => {
      closingRef.current = false;
      onClose();
    });
  }, [onClose, translateY, backdropOpacity]);

  const toggleCategory = useCallback(
    (categoryId: string) => {
      onChange(
        {
          ...filters,
          categoryIds: filters.categoryIds.includes(categoryId)
            ? filters.categoryIds.filter((id) => id !== categoryId)
            : [...filters.categoryIds, categoryId],
        },
        viewKind,
      );
    },
    [filters, onChange, viewKind],
  );

  const toggleTag = useCallback(
    (tagId: string) => {
      onChange(
        {
          ...filters,
          tagIds: filters.tagIds.includes(tagId)
            ? filters.tagIds.filter((id) => id !== tagId)
            : [...filters.tagIds, tagId],
        },
        viewKind,
      );
    },
    [filters, onChange, viewKind],
  );

  const toggleSource = useCallback(
    (sourceType: ItemSourceType) => {
      onChange(
        {
          ...filters,
          sourceTypes: filters.sourceTypes.includes(sourceType)
            ? filters.sourceTypes.filter((value) => value !== sourceType)
            : [...filters.sourceTypes, sourceType],
        },
        viewKind,
      );
    },
    [filters, onChange, viewKind],
  );

  const toggleStatus = useCallback(
    (status: ItemStatus) => {
      onChange(
        {
          ...filters,
          statuses: filters.statuses.includes(status)
            ? filters.statuses.filter((value) => value !== status)
            : [...filters.statuses, status],
        },
        viewKind,
      );
    },
    [filters, onChange, viewKind],
  );

  const selectViewKind = useCallback(
    (kind: AgendaViewKind) => {
      onChange(filters, kind);
    },
    [filters, onChange],
  );

  /** 重置（右上角）：仅清空筛选，不动视图（阶段 5b 拍板） */
  const handleReset = useCallback(() => {
    onChange(EMPTY_ITEM_FILTERS, viewKind);
  }, [onChange, viewKind]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={requestClose}
    >
      <View style={styles.root}>
        {/* 全屏遮罩：点击直接关闭（即时生效模式下无需丢弃草稿） */}
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: BACKDROP_COLOR, opacity: backdropOpacity },
            ]}
          />
        </Pressable>

        {/* 底部面板：高度由内容决定，内部 ScrollView 兜底防溢出 */}
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.headerRow}>
            <Pressable hitSlop={12} onPress={requestClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
            <Text style={styles.headerTitle}>筛选</Text>
            <Pressable hitSlop={12} onPress={handleReset} style={styles.resetButton}>
              <Text style={styles.resetText}>重置</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {/* 切片 14 阶段 5b：视图区（图标上、文字下；选中描边高亮；点选即时切视图） */}
            <Text style={styles.sectionLabel}>视图</Text>
            <View style={styles.viewRow}>
              {VIEW_OPTIONS.map((option) => {
                const selected = option.kind === viewKind;
                return (
                  <Pressable
                    key={option.kind}
                    style={[styles.viewOption, selected && styles.viewOptionSelected]}
                    onPress={() => selectViewKind(option.kind)}
                  >
                    <Ionicons name={option.icon} size={20} color={selected ? '#111111' : '#999999'} />
                    <Text style={[styles.viewOptionText, selected && styles.viewOptionTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.sectionLabel}>分类</Text>
            <View style={styles.chipWrap}>
              {categories.map((category) => (
                <CategoryChip
                  key={category.id}
                  category={category}
                  selected={filters.categoryIds.includes(category.id)}
                  onPress={() => toggleCategory(category.id)}
                />
              ))}
            </View>

            <Text style={styles.sectionLabel}>标签</Text>
            <View style={styles.chipWrap}>
              {tags.length === 0 ? (
                <Text style={styles.emptyHint}>暂无标签</Text>
              ) : (
                tags.map((tag) => (
                  <TagChip
                    key={tag.id}
                    tag={tag}
                    mode={tagDisplayMode}
                    selected={filters.tagIds.includes(tag.id)}
                    onPress={() => toggleTag(tag.id)}
                  />
                ))
              )}
            </View>

            <Text style={styles.sectionLabel}>日历源</Text>
            <View style={styles.chipWrap}>
              {SOURCE_TYPE_OPTIONS.map((option) => (
                <TagChip
                  key={option.value}
                  label={option.label}
                  selected={filters.sourceTypes.includes(option.value)}
                  onPress={() => toggleSource(option.value)}
                />
              ))}
            </View>

            <Text style={styles.sectionLabel}>状态</Text>
            <View style={styles.chipWrap}>
              {STATUS_OPTIONS.map((option) => (
                <TagChip
                  key={option.value}
                  label={option.label}
                  selected={filters.statuses.includes(option.value)}
                  onPress={() => toggleStatus(option.value)}
                />
              ))}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#FFFFFF',
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 14,
    color: '#333333',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: '#111111',
  },
  resetButton: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetText: {
    fontSize: 13,
    color: '#888888',
  },
  scroll: {
    // 内容超出时滚动；上限保证面板整体（头部 ~52）约 80% 屏高以内
    maxHeight: Dimensions.get('window').height * 0.6,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  sectionLabel: {
    fontSize: 12,
    color: '#888888',
    marginTop: 12,
    marginBottom: 8,
  },
  // 视图区（阶段 5b）：四选项等宽一行，选中描边 + 浅灰底
  viewRow: {
    flexDirection: 'row',
    gap: 8,
  },
  viewOption: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
  },
  viewOptionSelected: {
    borderColor: '#111111',
    backgroundColor: '#F5F5F5',
  },
  viewOptionText: {
    fontSize: 12,
    color: '#666666',
  },
  viewOptionTextSelected: {
    color: '#111111',
    fontWeight: '600',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  emptyHint: {
    fontSize: 13,
    color: '#999999',
  },
});
