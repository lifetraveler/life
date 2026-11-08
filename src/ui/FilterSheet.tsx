/**
 * 筛选面板（BottomSheet）——tasks/slice-14.md 阶段 4 / AGENTS.md §7.21。
 *
 * 约束与实现（任务卡：禁止第三方 BottomSheet 库，零新依赖）：
 * - React Native 原生 Modal（transparent + animationType="none"）承载，
 *   进出场动画用 Animated.parallel 手写：面板 translateY 整屏滑入 + 遮罩淡入，220ms；
 * - 滑距固定为整屏高（不 onLayout 量面板高）：面板高度由内容决定（内部 ScrollView
 *   设 maxHeight 兜底，整体不超过约 80% 屏高），从整屏外滑入对任意高度都成立；
 * - 关闭走反向动画，动画结束后才回调 onClose（父级随后置 visible=false 卸载 Modal）；
 * - 草稿模型：visible 变 true 时从 initialFilters 快照（各数组浅拷贝，杜绝共享可变引用）；
 *   应用 = onApply(draft)（父级只提交筛选、不负责关面板）→ 面板自行播放关闭动画 → onClose；
 *   重置 = 清空草稿、面板不关；X / 遮罩 / 安卓返回键 = 丢弃草稿关闭；
 * - 纯 UI 组件：不直接访问 WatermelonDB / expo-notifications（AGENTS.md §4 受保护契约）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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

import type { Category } from '../domain/category';
import type { ItemSourceType, ItemStatus } from '../domain/item';
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

interface FilterSheetProps {
  visible: boolean;
  /** 分类全集（打开面板时由父级经 getCategories() 现取最新视觉传入） */
  categories: Category[];
  /** 标签全集（TagChip 按 tagDisplayMode 渲染 emoji；空集显示「暂无标签」） */
  tags: Tag[];
  /** 打开时刻的已应用筛选（草稿种子） */
  initialFilters: ItemFilters;
  /** 应用：父级只提交筛选、不负责关闭；面板自行播放关闭动画后回调 onClose */
  onApply: (filters: ItemFilters) => void;
  /** 关闭回调（反向动画结束后触发；父级置 visible=false 卸载 Modal） */
  onClose: () => void;
}

/** ItemFilters 快照（各数组浅拷贝） */
function cloneFilters(filters: ItemFilters): ItemFilters {
  return {
    categoryIds: [...filters.categoryIds],
    sourceTypes: [...filters.sourceTypes],
    tagIds: [...filters.tagIds],
    statuses: [...filters.statuses],
  };
}

export default function FilterSheet({
  visible,
  categories,
  tags,
  initialFilters,
  onApply,
  onClose,
}: FilterSheetProps) {
  const tagDisplayMode = useTagDisplayMode();

  const [draft, setDraft] = useState<ItemFilters>(() => cloneFilters(EMPTY_ITEM_FILTERS));

  // initialFilters 经 ref 转交，避免把草稿快照 effect 绑在父级 state 对象引用上
  const initialFiltersRef = useRef(initialFilters);
  initialFiltersRef.current = initialFilters;

  // 初始值即整屏高（面板在屏外）；关闭动画结束后回到屏外，循环打开不闪帧
  const translateY = useRef(new Animated.Value(Dimensions.get('window').height)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);

  // 打开：草稿快照 + 滑入动画
  useEffect(() => {
    if (!visible) {
      return;
    }
    setDraft(cloneFilters(initialFiltersRef.current));
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

  const handleApply = useCallback(() => {
    onApply(draft);
    requestClose();
  }, [draft, onApply, requestClose]);

  const toggleCategory = useCallback((categoryId: string) => {
    setDraft((prev) => ({
      ...prev,
      categoryIds: prev.categoryIds.includes(categoryId)
        ? prev.categoryIds.filter((id) => id !== categoryId)
        : [...prev.categoryIds, categoryId],
    }));
  }, []);

  const toggleTag = useCallback((tagId: string) => {
    setDraft((prev) => ({
      ...prev,
      tagIds: prev.tagIds.includes(tagId)
        ? prev.tagIds.filter((id) => id !== tagId)
        : [...prev.tagIds, tagId],
    }));
  }, []);

  const toggleSource = useCallback((sourceType: ItemSourceType) => {
    setDraft((prev) => ({
      ...prev,
      sourceTypes: prev.sourceTypes.includes(sourceType)
        ? prev.sourceTypes.filter((value) => value !== sourceType)
        : [...prev.sourceTypes, sourceType],
    }));
  }, []);

  const toggleStatus = useCallback((status: ItemStatus) => {
    setDraft((prev) => ({
      ...prev,
      statuses: prev.statuses.includes(status)
        ? prev.statuses.filter((value) => value !== status)
        : [...prev.statuses, status],
    }));
  }, []);

  const handleReset = useCallback(() => {
    setDraft(cloneFilters(EMPTY_ITEM_FILTERS));
  }, []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={requestClose}
    >
      <View style={styles.root}>
        {/* 全屏遮罩：点击关闭（丢弃草稿） */}
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
            <View style={styles.headerSpacer} />
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <Text style={styles.sectionLabel}>分类</Text>
            <View style={styles.chipWrap}>
              {categories.map((category) => (
                <CategoryChip
                  key={category.id}
                  category={category}
                  selected={draft.categoryIds.includes(category.id)}
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
                    selected={draft.tagIds.includes(tag.id)}
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
                  selected={draft.sourceTypes.includes(option.value)}
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
                  selected={draft.statuses.includes(option.value)}
                  onPress={() => toggleStatus(option.value)}
                />
              ))}
            </View>
          </ScrollView>

          <View style={styles.footerRow}>
            <Pressable style={styles.resetButton} onPress={handleReset}>
              <Text style={styles.resetText}>重置</Text>
            </Pressable>
            <Pressable style={styles.applyButton} onPress={handleApply}>
              <Text style={styles.applyText}>应用</Text>
            </Pressable>
          </View>
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
  headerSpacer: {
    width: 32,
  },
  scroll: {
    // 内容超出时滚动；上限保证面板整体（头部 ~52 + 底部按钮 ~68）约 80% 屏高以内
    maxHeight: Dimensions.get('window').height * 0.58,
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
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  emptyHint: {
    fontSize: 13,
    color: '#999999',
  },
  footerRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
  },
  resetButton: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#CCCCCC',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  resetText: {
    fontSize: 15,
    color: '#333333',
  },
  applyButton: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111111',
  },
  applyText: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
