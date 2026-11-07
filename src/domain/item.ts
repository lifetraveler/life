/**
 * 领域类型定义（纯 TypeScript，不依赖 React Native / WatermelonDB）。
 *
 * Item 的字段集合是 AGENTS.md §4.1 的受保护契约：
 * 不得增删字段、不得重命名、type 枚举不得扩展。
 *
 * v0.14（AGENTS.md §7.22，schema v6）明确扩展 categoryId / priority 两个字段；
 * Item 不再有 color 字段——颜色统一由关联 Category 提供（§7.22）。
 */

export type ItemType = 'note' | 'task' | 'event';

export type ItemStatus = 'active' | 'done' | 'archived';

/**
 * Item 外部来源类型（data-model.md v0.8，切片 8 落地）：
 * 'local' 本地创建；'ics' ICS 导入；'system-calendar' 系统日历导入（切片 9 预留，本切片不实现）。
 */
export type ItemSourceType = 'local' | 'ics' | 'system-calendar';

/** 数据模型：Item（AGENTS.md §4.1 + §4.23 v0.6 时间字段 + data-model.md v0.8 外部来源字段） */
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
  /** 外部来源类型；迁移前的既有行经读取层归一为 'local'（data-model.md v0.8） */
  sourceType: ItemSourceType;
  /** 外部来源唯一标识（如 ICS UID）；null 表示无（本地项或缺 UID 的导入项） */
  sourceUid: string | null;
  /** true 时只读：不可编辑时间/标题/内容，可完成/取消完成、可归档/删除（data-model.md v0.8） */
  sourceReadOnly: boolean;
  /**
   * 关联分类 id（§7.22，schema v6）。列 isOptional（迁移回填 'other'）；
   * 域层经 toDomainItem 以 'other' 归一，恒非空（与 sourceType ?? 'local' 同一模式）。
   */
  categoryId: string;
  /** 优先级（§7.22）：0=无 1=低 2=中 3=高；迁移对既有行回填 0 */
  priority: number;
  /** 毫秒时间戳 */
  createdAt: number;
  /** 毫秒时间戳 */
  updatedAt: number;
}

/**
 * 创建 Item 的输入：标题必填，内容可选（缺省存空字符串），status 固定初始为 'active'。
 * 时间字段可选（§4.24）：未传时 startAt/endAt 落 null、allDay 落 false。
 * v0.14 扩展（repository.md v0.14 + §7.22）：categoryId 可选（未传落 'other'）；
 * priority 可选（未传落 0）——priority 为契约外文档化扩展（先例：deleteItem/observe*），供阶段 3 编辑页使用。
 */
export interface CreateItemInput {
  type: ItemType;
  title: string;
  content?: string;
  startAt?: number | null;
  endAt?: number | null;
  allDay?: boolean;
  /** 关联分类 id；null/未传 → 'other'（§7.22 默认） */
  categoryId?: string | null;
  /** 0=无 1=低 2=中 3=高；未传 → 0（§7.22 默认） */
  priority?: number;
}

/**
 * 更新 Item 的输入（AGENTS.md §4.5，签名冻结）：
 * 允许更新 title、content、type、status；不允许更新 id、createdAt。
 * updatedAt 不在输入内——由存储层在写路径自动维护。
 * v0.14 扩展（repository.md v0.14 + §7.22）：categoryId / priority 同 CreateItemInput 规则。
 */
export interface UpdateItemInput {
  title?: string;
  content?: string;
  type?: ItemType;
  status?: ItemStatus;
  /** 关联分类 id；null 显式表示移出分类（落 'other'） */
  categoryId?: string | null;
  /** 0=无 1=低 2=中 3=高 */
  priority?: number;
}

/**
 * ICS 导入专用输入（repository.md v0.8 冻结，切片 8）：
 * sourceType 固定 'ics'、sourceReadOnly 固定 true，由 Repository 写入，不从输入传入。
 * type 不在输入内：VEVENT 映射固定 type='event'（tasks/slice-08.md 实现要求 2），由实现写入。
 * allDay 归一化在 Repository 内统一执行，调用方传解析出的原始绝对时刻即可。
 */
export interface ImportedItemInput {
  title: string;
  content?: string;
  /** DTSTART 绝对毫秒时刻（VEVENT 必有 DTSTART） */
  startAt: number;
  /** DTEND 绝对毫秒时刻；缺失为 null */
  endAt: number | null;
  /** DTSTART VALUE=DATE 时为 true */
  allDay?: boolean;
  /** ICS UID；缺失为 null（null 不做去重） */
  sourceUid: string | null;
}
