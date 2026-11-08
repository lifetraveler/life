import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

/** Ionicons 图标名的类型别名（约束 TAB_ICONS 只能取合法字形名）。 */
type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * 底部 Tab 图标表（阶段 5 代码检查：图标一律 @expo/vector-icons，禁用 emoji 图标）。
 * 选中用实心字形、未选中用线性字形（-outline 后缀）。
 */
const TAB_ICONS: Record<'flash' | 'items' | 'plan' | 'profile', { selected: IoniconName; outline: IoniconName }> = {
  flash: { selected: 'flash', outline: 'flash-outline' },
  items: { selected: 'checkbox', outline: 'checkbox-outline' },
  plan: { selected: 'calendar', outline: 'calendar-outline' },
  profile: { selected: 'person', outline: 'person-outline' },
};

/**
 * 底部 Tab 导航布局（切片 14 阶段 5，tasks/toki_1.webp 图1）：
 * - 4 个入口：闪电（占位，闪电添加留给切片 15）/ 事项（占位）/
 *   计划（主视图，原 index.tsx 移入）/ 我的（原设置页移入）；
 * - initialRouteName="plan"：启动落在计划页，根路由 '/' 命中 (tabs) 默认页；
 * - headerShown:false：计划页不渲染导航头（验收 16：无"life"标题），
 *   各 Tab 页自管顶部留白与标题；
 * - expo-router Tab 默认不卸载非活动屏：计划页的视图模式、筛选、搜索、
 *   滚动位置跨 Tab 切换保留（验收 18）。
 */
export default function TabsLayout() {
  return (
    <Tabs initialRouteName="plan" screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="flash"
        options={{
          title: '闪电',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? TAB_ICONS.flash.selected : TAB_ICONS.flash.outline}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="items"
        options={{
          title: '事项',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? TAB_ICONS.items.selected : TAB_ICONS.items.outline}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: '计划',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? TAB_ICONS.plan.selected : TAB_ICONS.plan.outline}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? TAB_ICONS.profile.selected : TAB_ICONS.profile.outline}
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
