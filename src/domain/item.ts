/**
 * 领域类型定义（纯 TypeScript，不依赖 React Native / WatermelonDB）。
 *
 * Item 的字段集合是 AGENTS.md §4.1 的受保护契约：
 * 不得增删字段、不得重命名、type 枚举不得扩展。
 */

export type ItemType = 'note' | 'task' | 'event';

export type ItemStatus = 'active' | 'done' | 'archived';

/** 数据模型：Item（AGENTS.md §4.1 + §4.23 v0.6 新增时间字段） */
export interface Item {
  id: string;
  type: ItemType;
  title: string;
  content: string;
  status: ItemStatus;
  /** 绝对毫秒时间戳；null 表示未安排（§4.23） */
  startAt: number | null;
  /** 绝对毫秒时间戳；null 表示无结束时间（§4.23） */
  endAt: number | null;
  /** true 时 startAt 表示设备时区当天 00:00（§4.23）；默认 false */
  allDay: boolean;
  /** 毫秒时间戳 */
  createdAt: number;
  /** 毫秒时间戳 */
  updatedAt: number;
}

/**
 * 创建 Item 的输入：标题必填，内容可选（缺省存空字符串），status 固定初始为 'active'。
 * 时间字段可选（§4.24）：未传时 startAt/endAt 落 null、allDay 落 false。
 */
export interface CreateItemInput {
  type: ItemType;
  title: string;
  content?: string;
  startAt?: number | null;
  endAt?: number | null;
  allDay?: boolean;
}

/**
 * 更新 Item 的输入（AGENTS.md §4.5，签名冻结）：
 * 允许更新 title、content、type、status；不允许更新 id、createdAt。
 * updatedAt 不在输入内——由存储层在写路径自动维护。
 */
export interface UpdateItemInput {
  title?: string;
  content?: string;
  type?: ItemType;
  status?: ItemStatus;
}
