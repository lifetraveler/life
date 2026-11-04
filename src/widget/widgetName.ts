/**
 * 今日待办小组件唯一名称（切片 10，AGENTS §7.16：MVP 只做一个小组件类型）。
 * app.json config plugin 的 widgets[].name、requestWidgetUpdate、taskHandler 三处共用；
 * 名称改动等于换了一个新小组件，桌面已添加的旧实例会失联，故视为准冻结常量。
 */
export const WIDGET_NAME = 'TodayWidget';
