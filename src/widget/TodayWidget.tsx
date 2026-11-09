/**
 * 今日待办小组件渲染组件（react-native-android-widget 原语组合，切片 10）：
 * - 禁 hooks、禁 React Compiler memo：本组件既在 App 进程渲染（requestWidgetUpdate），
 *   也在 Headless 任务上下文渲染（taskHandler）。buildWidgetTree 直接把自定义组件当
 *   普通函数展开（见库 src/api/build-widget-tree.ts:41-43），hooks/memo 都会破坏该展开，
 *   文件首行 "use no memo" 显式豁免 React Compiler（库报错文案给出的官方解法）；
 * - 根节点 width/height 'match_parent'：原生侧按 AppWidgetManager 实际尺寸建根视图
 *   （RNWidget.java drawWidget），无需手传像素尺寸；
 * - 亮/暗双色由 WidgetRepresentation { light, dark } 承载（切片 10 采用双色表示），
 *   本组件以 palette prop 切换同一套布局的配色；
 * - 条目行（§7.21 v0.14 阶段 5）= FlexWidget 行（flexDirection row + alignItems center）：
 *   左侧分类色点（8×8 圆，categoryColor 经合法 #RRGGBB 校验，非法/无分类回退默认灰
 *   '#9E9E9E'——阶段 6 起与本机制统一走 domain/widget/categoryDot 解析，不再用 palette
 *   muted）+
 *   内层 FlexWidget { width: 0, flex: 1 }（库 JS 层把 flex 映射为原生 LinearLayout weight，
 *   FlexWidget.js convertFlexStyle；flexShrink 仅存在于 TS 类型、运行时无实现，不可用）+
 *   内部 TextWidget（时间标签 + 标题）width match_parent + maxLines 1 + truncate 'END'
 *   （原生 setEllipsize，受权重容器约束后正确省略号截断）；
 *   clickAction OPEN_ITEM 上移到整行 FlexWidget + clickActionData { itemId }，点击语义在
 *   taskHandler 展开（契约：点击条目导航到 item/[id] 详情）；
 * - 过期行 / done 行灰显（muted），仍可点击进入详情（详情页可做完成/取消，契约禁止
 *   小组件内直接完成）；
 * - 底部快速记录按钮 = 圆角 pill FlexWidget，clickAction OPEN_QUICK_ADD（契约：
 *   deep link life://quick-add 唤起快速记录）；
 * - 空态文案 '今天没有安排'（契约未冻结空态，此处为展示文本）。
 */
'use no memo';

import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { ColorProp, HexColor } from 'react-native-android-widget';
import type { WidgetSnapshot, WidgetSnapshotEntry } from '../domain/widget';
import { resolveCategoryDotColor } from '../domain/widget';

export type TodayWidgetPaletteName = 'light' | 'dark';

interface TodayWidgetPalette {
  background: ColorProp;
  title: ColorProp;
  text: ColorProp;
  muted: ColorProp;
  accentBackground: ColorProp;
  accentText: ColorProp;
}

const PALETTES: Record<TodayWidgetPaletteName, TodayWidgetPalette> = {
  light: {
    background: '#F5F0E6',
    title: '#3D3A34',
    text: '#3D3A34',
    muted: '#8A8377',
    accentBackground: '#4C7A5C',
    accentText: '#F5F0E6',
  },
  dark: {
    background: '#201D18',
    title: '#E8E2D6',
    text: '#E8E2D6',
    muted: '#9C948A',
    accentBackground: '#5D9471',
    accentText: '#14110C',
  },
};

interface WidgetRow {
  entry: WidgetSnapshotEntry;
  /** 是否来自过期分组（灰显依据之一） */
  overdue: boolean;
}

interface TodayWidgetProps {
  snapshot: WidgetSnapshot;
  palette: TodayWidgetPaletteName;
}

export function TodayWidget({ snapshot, palette }: TodayWidgetProps) {
  const colors = PALETTES[palette];
  const rows: WidgetRow[] = [
    ...snapshot.groups.overdue.map((entry) => ({ entry, overdue: true })),
    ...snapshot.groups.scheduled.map((entry) => ({ entry, overdue: false })),
  ];

  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: 'match_parent',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: colors.background,
        borderRadius: 16,
        paddingHorizontal: 10,
        paddingVertical: 8,
      }}
    >
      <TextWidget
        text="今日待办"
        style={{
          fontSize: 13,
          fontWeight: 'bold',
          color: colors.title,
          marginBottom: 4,
        }}
      />
      <FlexWidget
        style={{
          width: 'match_parent',
          height: 'wrap_content',
          flexDirection: 'column',
          flexGap: 4,
        }}
      >
        {rows.length === 0 ? (
          <TextWidget
            text="今天没有安排"
            style={{ fontSize: 13, color: colors.muted }}
          />
        ) : (
          rows.map(({ entry, overdue }) => {
            // 解析规则在 domain/widget/categoryDot（可单测）：合法 #RRGGBB 透传，
            // null/非法回退 '#9E9E9E'（与主页卡片色条同一默认灰），恒为合法 HexColor 形态
            const dotColor: ColorProp = resolveCategoryDotColor(entry.categoryColor) as HexColor;
            return (
              <FlexWidget
                key={entry.id}
                clickAction="OPEN_ITEM"
                clickActionData={{ itemId: entry.id }}
                style={{
                  width: 'match_parent',
                  flexDirection: 'row',
                  alignItems: 'center',
                  flexGap: 6,
                }}
              >
                <FlexWidget
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: dotColor,
                  }}
                />
                <FlexWidget
                  style={{
                    width: 0,
                    flex: 1,
                    flexDirection: 'row',
                  }}
                >
                  <TextWidget
                    text={`${entry.timeLabel}  ${entry.title}`}
                    maxLines={1}
                    truncate="END"
                    style={{
                      width: 'match_parent',
                      fontSize: 13,
                      color:
                        overdue || entry.status === 'done'
                          ? colors.muted
                          : colors.text,
                    }}
                  />
                </FlexWidget>
              </FlexWidget>
            );
          })
        )}
      </FlexWidget>
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          justifyContent: 'center',
          marginTop: 6,
        }}
      >
        <FlexWidget
          clickAction="OPEN_QUICK_ADD"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.accentBackground,
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 6,
          }}
        >
          <TextWidget
            text="＋ 快速记录"
            style={{
              fontSize: 12,
              fontWeight: '600',
              color: colors.accentText,
            }}
          />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}
