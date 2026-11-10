/**
 * 今日待办小组件渲染组件（react-native-android-widget 原语组合，切片 10；
 * 阶段 7a 修订：行区改 ListWidget 滚动列表；阶段 7b 修订：「今日 | 周」页签切换，
 * 见 docs/proposals/slice-14-widget-phase7.md）：
 * - 禁 hooks、禁 React Compiler memo：本组件既在 App 进程渲染（requestWidgetUpdate），
 *   也在 Headless 任务上下文渲染（taskHandler）。buildWidgetTree 直接把自定义组件当
 *   普通函数展开（见库 src/api/build-widget-tree.ts:41-43），hooks/memo 都会破坏该展开，
 *   文件首行 "use no memo" 显式豁免 React Compiler（库报错文案给出的官方解法）；
 * - 根节点 width/height 'match_parent'：原生侧按 AppWidgetManager 实际尺寸建根视图
 *   （RNWidget.java drawWidget），无需手传像素尺寸；
 * - 亮/暗双色由 WidgetRepresentation { light, dark } 承载（切片 10 采用双色表示），
 *   本组件以 palette prop 切换同一套布局的配色；
 * - 页签（阶段 7b）：平台不支持滑动手势（全库仅 ClickableView），页切换 = 头部
 *   「今日 | 周」两个 pill 点击页签，clickAction SWITCH_PAGE + clickActionData { page }，
 *   taskHandler 写页状态（widget_page_state_v1）后整体重渲染；当前页高亮 accent，
 *   非当前页 muted；数据由 page prop 决定（today → snapshot，week → weekSnapshot，
 *   weekSnapshot 为 null 时显示兜底文案）；
 * - 滚动列表（阶段 7a）：行区包一层 FlexWidget { flex: 1 }（JS 层 flex → 原生
 *   LinearLayout weight，FlexWidget.js convertFlexStyle + BaseWidget.java:185）占满
 *   页签与按钮间剩余高度，ListWidget { width/height: 'match_parent' } 填满包裹层；
 *   ListWidget 原生映射 RemoteViews ListView（RNWidget.java addCollectionView 按其在
 *   JS 树的测量矩形 setViewPadding 收窄视口），超出可见高度即可滚动浏览；每行仍为
 *   独立渲染位图，行级 clickAction 经 PendingIntent 模板保留（CollectionView.java
 *   buildChildren）。库的 SizeStyleProps 无 flex，ListWidget 自身不能写 flex，
 *   必须借包裹层获得权重高度（空列表时同样用 FlexWidget{flex:1} 占位保持按钮贴底）；
 *   平台一次渲染最多 2 个集合视图（RNWidgetCollectionService.MAX_COLLECTION_WIDGETS=2），
 *   因此每页只用一个 ListWidget——周页把「日期头行」与「条目行」混排进同一列表；
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
 * - 显示选项（阶段 7c）：分类 emoji / 标签 chips 是否展示由 display prop
 *   （WidgetDisplayOptions，渲染侧读 app_settings 当下值，src/widget/widgetDisplay.ts；
 *   桥与 taskHandler 各自渲染前读取）决定，快照恒携带字段（domain/widget/snapshot.ts）：
 *   emoji 展示在色点之后（TextWidget fontSize 12）；标签 chips 展示在主文案之后，
 *   底色 tag.color ?? 中性底、文字 contrastTextColor ?? 中性文字（与主页 TagChip 同规则，
 *   此处不 import TagChip——RN 组件文件不进 headless 渲染路径），文案
 *   formatTagDisplay(tag, tagMode)（text/emoji/both，无 emoji 回退 name，同 App）；
 * - 行排序：今日页（阶段 7a 提案定案）已安排在前，过期组、待办组依次置底；
 *   过期行 / done 行灰显（muted），仍可点击进入详情（详情页可做完成/取消，契约禁止
 *   小组件内直接完成）；待办行正常色、时间标签为快照携带的 '待办'。
 *   周页（阶段 7b）：7 天组头行 + 条目行混排，组头按 App 日程分组同款文案
 *   （今天 / 明天 / 周X D，由快照携带的 dayLabel 渲染），空天组头直接缀「· 无安排」；
 * - 底部快速记录按钮 = 圆角 pill FlexWidget，clickAction OPEN_QUICK_ADD（契约：
 *   deep link life://quick-add 唤起快速记录），两页共用；
 * - 空态文案 '今天没有安排'（契约未冻结空态，此处为展示文本）。
 */
'use no memo';

import { FlexWidget, ListWidget, TextWidget } from 'react-native-android-widget';
import type { ColorProp, HexColor } from 'react-native-android-widget';
import type {
  WidgetDisplayOptions,
  WidgetPageName,
  WidgetSnapshot,
  WidgetSnapshotEntry,
  WidgetSnapshotTag,
  WidgetWeekSnapshot,
} from '../domain/widget';
import { resolveCategoryDotColor } from '../domain/widget';
import { formatTagDisplay } from '../domain/tags/tagDisplay';
import { contrastTextColor } from '../ui/color';

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
  /** 当前页（阶段 7b）：today = 今日三段式，week = 今天起 7 天分组 */
  page: WidgetPageName;
  snapshot: WidgetSnapshot;
  /** 周快照（阶段 7b）；null = 尚未生成过（taskHandler/桥兜底失败），周页显示占位文案 */
  weekSnapshot: WidgetWeekSnapshot | null;
  palette: TodayWidgetPaletteName;
  /** 显示选项（阶段 7c）：emoji / 标签开关 + 标签文案模式（渲染侧读当下 app_settings） */
  display: WidgetDisplayOptions;
}

const PAGE_TABS: { page: WidgetPageName; label: string }[] = [
  { page: 'today', label: '今日' },
  { page: 'week', label: '周' },
];

/**
 * 标签 chips 中性配色（阶段 7c）：与 src/ui/TagChip.tsx NEUTRAL_BG/NEUTRAL_TEXT 一致；
 * widget 侧不复用该 RN 组件（避免把 react-native 组件引入 headless 渲染路径），
 * 只复用纯函数 contrastTextColor。
 */
const WIDGET_TAG_NEUTRAL_BG = '#eef2ff';
const WIDGET_TAG_NEUTRAL_TEXT = '#3730a3';

export function TodayWidget({ page, snapshot, weekSnapshot, palette, display }: TodayWidgetProps) {
  const colors = PALETTES[palette];
  // 阶段 7a 行序（提案定案）：已安排在前，过期、待办依次置底。
  const rows: WidgetRow[] = [
    ...snapshot.groups.scheduled.map((entry) => ({ entry, overdue: false })),
    ...snapshot.groups.overdue.map((entry) => ({ entry, overdue: true })),
    ...snapshot.groups.todos.map((entry) => ({ entry, overdue: false })),
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
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          alignItems: 'center',
          flexGap: 6,
          marginBottom: 6,
        }}
      >
        {PAGE_TABS.map(({ page: tabPage, label }) => {
          const active = tabPage === page;
          return (
            <FlexWidget
              key={tabPage}
              clickAction="SWITCH_PAGE"
              clickActionData={{ page: tabPage }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                borderRadius: 10,
                paddingHorizontal: 8,
                paddingVertical: 3,
                backgroundColor: active ? colors.accentBackground : colors.background,
                borderWidth: 1,
                borderColor: active ? colors.accentBackground : colors.muted,
              }}
            >
              <TextWidget
                text={label}
                style={{
                  fontSize: 12,
                  fontWeight: active ? 'bold' : 'normal',
                  color: active ? colors.accentText : colors.muted,
                }}
              />
            </FlexWidget>
          );
        })}
      </FlexWidget>
      {page === 'week' ? (
        renderWeekBody({ weekSnapshot, colors, display })
      ) : (
        renderTodayBody({ rows, colors, display })
      )}
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

interface BodyColors {
  text: ColorProp;
  muted: ColorProp;
}

/** 今日页主体：滚动列表（行序已安排→过期→待办）或空态（阶段 7a 布局不变）。 */
function renderTodayBody({
  rows,
  colors,
  display,
}: {
  rows: WidgetRow[];
  colors: BodyColors;
  display: WidgetDisplayOptions;
}) {
  if (rows.length === 0) {
    return (
      <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'column' }}>
        <TextWidget
          text="今天没有安排"
          style={{ fontSize: 13, color: colors.muted }}
        />
      </FlexWidget>
    );
  }
  // 滚动列表（阶段 7a）：包裹层 FlexWidget{flex:1} 借原生 weight 占满剩余高度，
  // ListWidget 填满包裹层；超出可见高度的行由原生 ListView 滚动浏览。
  return (
    <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'column' }}>
      <ListWidget style={{ width: 'match_parent', height: 'match_parent' }}>
        {rows.map(({ entry, overdue }) =>
          renderEntryRow({ entry, overdue, colors, display }),
        )}
      </ListWidget>
    </FlexWidget>
  );
}

/**
 * 周页主体（阶段 7b）：单个 ListWidget 混排「日期头行 + 条目行」——平台一次渲染
 * 最多 2 个集合视图（MAX_COLLECTION_WIDGETS=2），不能一天一个 ListWidget。
 * 7 天恒有组；空天组头行直接缀「· 无安排」。weekSnapshot 缺失显示占位文案。
 */
function renderWeekBody({
  weekSnapshot,
  colors,
  display,
}: {
  weekSnapshot: WidgetWeekSnapshot | null;
  colors: BodyColors;
  display: WidgetDisplayOptions;
}) {
  if (weekSnapshot === null) {
    return (
      <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'column' }}>
        <TextWidget
          text="周视图暂无数据"
          style={{ fontSize: 13, color: colors.muted }}
        />
      </FlexWidget>
    );
  }
  return (
    <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'column' }}>
      <ListWidget style={{ width: 'match_parent', height: 'match_parent' }}>
        {weekSnapshot.days.map((day) => {
          const header = (
            <FlexWidget
              key={`day-${day.civilKey}`}
              style={{
                width: 'match_parent',
                flexDirection: 'row',
                alignItems: 'center',
                flexGap: 4,
                paddingTop: 6,
                paddingBottom: 2,
              }}
            >
              <TextWidget
                text={day.dayLabel}
                maxLines={1}
                truncate="END"
                style={{
                  fontSize: 12,
                  fontWeight: 'bold',
                  color: colors.text,
                }}
              />
              {day.entries.length === 0 ? (
                <TextWidget
                  text="· 无安排"
                  maxLines={1}
                  style={{ fontSize: 11, color: colors.muted }}
                />
              ) : null}
            </FlexWidget>
          );
          const entryRows = day.entries.map((entry) =>
            renderEntryRow({ entry, overdue: false, colors, display, keyPrefix: `week-${day.civilKey}` }),
          );
          return [header, ...entryRows];
        })}
      </ListWidget>
    </FlexWidget>
  );
}

/**
 * 条目行（今日/周共用）：色点 + [分类 emoji] + 「时间标签  标题」+ [标签 chips]，
 * 整行 clickAction OPEN_ITEM。emoji/标签是否渲染由 display 决定（阶段 7c），
 * 快照恒携带字段；周页 key 加 civilKey 前缀避免跨天撞 key
 * （今日页三组互斥 id 唯一，无需前缀）。
 */
function renderEntryRow({
  entry,
  overdue,
  colors,
  display,
  keyPrefix,
}: {
  entry: WidgetSnapshotEntry;
  overdue: boolean;
  colors: BodyColors;
  display: WidgetDisplayOptions;
  keyPrefix?: string;
}) {
  // 解析规则在 domain/widget/categoryDot（可单测）：合法 #RRGGBB 透传，
  // null/非法回退 '#9E9E9E'（与主页卡片色条同一默认灰），恒为合法 HexColor 形态
  const dotColor: ColorProp = resolveCategoryDotColor(entry.categoryColor) as HexColor;
  return (
    <FlexWidget
      key={keyPrefix === undefined ? entry.id : `${keyPrefix}-${entry.id}`}
      clickAction="OPEN_ITEM"
      clickActionData={{ itemId: entry.id }}
      style={{
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        flexGap: 6,
        paddingBottom: 4,
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
      {display.showCategoryEmoji && entry.categoryEmoji !== null ? (
        <TextWidget
          text={entry.categoryEmoji}
          style={{ fontSize: 12 }}
        />
      ) : null}
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
            color: overdue || entry.status === 'done' ? colors.muted : colors.text,
          }}
        />
      </FlexWidget>
      {display.showTags && entry.tags.length > 0 ? (
        <FlexWidget
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flexGap: 4,
          }}
        >
          {entry.tags.map((tag: WidgetSnapshotTag) => {
            // 与主页 TagChip 同规则：有 color 用 color，文字色按对比度回退中性文字；
            // 底色仅接受合法 #RRGGBB（ColorProp 严格类型 + 原生解析失败会变透明底）
            const chipBackground: ColorProp =
              tag.color !== null && /^#[0-9a-fA-F]{6}$/.test(tag.color)
                ? (tag.color as HexColor)
                : WIDGET_TAG_NEUTRAL_BG;
            const chipText: ColorProp = tag.color
              ? (contrastTextColor(tag.color) ?? WIDGET_TAG_NEUTRAL_TEXT)
              : WIDGET_TAG_NEUTRAL_TEXT;
            return (
              <FlexWidget
                key={tag.name}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderRadius: 999,
                  backgroundColor: chipBackground,
                  paddingHorizontal: 5,
                  paddingVertical: 1,
                }}
              >
                <TextWidget
                  text={formatTagDisplay(tag, display.tagMode)}
                  maxLines={1}
                  style={{
                    fontSize: 10,
                    color: chipText,
                  }}
                />
              </FlexWidget>
            );
          })}
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}
