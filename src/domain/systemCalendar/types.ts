/**
 * 系统日历导入的领域类型（切片 9，纯 TypeScript，不依赖 React Native / WatermelonDB / expo-*）。
 * expo-calendar 的原始返回值由 data 层适配为本文件的纯类型，领域层据此保持可测性。
 */

/** expo-calendar getCalendarsAsync 返回的日历（只取本切片需要的字段）。 */
export interface SystemCalendarInfo {
  /** 日历 id（expo-calendar Calendar.id）。 */
  id: string;
  /** 日历显示名；API 未提供时为空串（如实透传，不虚构）。 */
  title: string;
}

/**
 * expo-calendar Event 归一后的纯数据事件。
 * startDate/endDate 已由 data 层换算为绝对毫秒；不可解析时保持 null（由导入管线记入 failed 清单）。
 */
export interface SystemCalendarEvent {
  /** expo-calendar event.id；Android 上为系统 Events 表 _ID（缺失/空白为 null）。 */
  externalId: string | null;
  /** 所属日历 id（内容哈希输入的一部分）。 */
  calendarId: string;
  /** 事件标题；缺失/空白为 null（映射层回退「系统日历事件」）。 */
  title: string | null;
  /** 事件备注/描述；缺失为 null（映射层归一为空串）。 */
  notes: string | null;
  /** 开始时刻绝对毫秒；缺失/不可解析为 null。 */
  startDate: number | null;
  /** 结束时刻绝对毫秒；缺失为 null。 */
  endDate: number | null;
  /** 是否全天事件（沿用系统日历标记；时间归一化由 Repository 调 normalizeAllDayTimestamps）。 */
  allDay: boolean;
}

/** sourceUid 生成策略（任务卡实现要求 4：结果页展示各策略条数）。 */
export type SourceUidStrategy = 'event-id' | 'content-hash';
