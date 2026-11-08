/**
 * 今日待办小组件快照写入/读取器（切片 10）：
 * - 桥接通道：WidgetSnapshotStore 本地 Expo 模块（modules/widget-snapshot-store，方案 A，
 *   用户开工确认；react-native-android-widget 自身无任何存储 API）；
 * - 键：WIDGET_SNAPSHOT_PREFS_KEY（'widget_today_snapshot_v1'，AGENTS §7.16 冻结）；
 * - 数据来源：消费切片 7 视图查询 listOverdueItems / listScheduledItemsInRange（签名冻结），
 *   经 buildTodayWidgetSnapshot 纯函数生成；本类不查询、不重复实现分组；
 * - Repository 接口不变（repository.md 冻结）；本类挂在 src/data/ 但不是 Repository 实现；
 * - 所有失败（原生模块缺失、写入失败、JSON 异常）捕获记录并返回失败态，不向上抛：
 *   小组件刷新失败不影响 App 主流程（任务卡实现要求）。
 */

import { getTodayRange } from '../domain/views/ranges';
import {
  buildTodayWidgetSnapshot,
  WIDGET_SNAPSHOT_PREFS_KEY,
} from '../domain/widget';
import type { WidgetSnapshot } from '../domain/widget';
import type { ItemRepository } from './ItemRepository';
import WidgetSnapshotStoreModule from '../../modules/widget-snapshot-store';

export class WidgetSnapshotWriter {
  private readonly itemRepository: ItemRepository;

  constructor(itemRepository: ItemRepository) {
    this.itemRepository = itemRepository;
  }

  /**
   * 查库 → 生成快照 → 写入 SharedPreferences。
   * nowMs 由调用方传入（启动/回前台/变更回调各自取当下）；
   * tzid 用 getDeviceTzid()（切片 11 变更 A 起为真实设备时区；此前恒 'UTC' 的
   * 运行时伪影已修，见 slice-11 提案与 closeout）。
   * 返回写入是否成功。
   */
  async writeSnapshotFromRepository(nowMs: number, tzid: string): Promise<boolean> {
    try {
      const todayRange = getTodayRange(nowMs, tzid);
      const [overdue, scheduled] = await Promise.all([
        this.itemRepository.listOverdueItems(nowMs),
        this.itemRepository.listScheduledItemsInRange(todayRange.startMs, todayRange.endMs),
      ]);
      const snapshot = buildTodayWidgetSnapshot({ overdue, scheduled, nowMs, tzid });
      return this.writeSnapshot(snapshot);
    } catch (error) {
      console.warn('[WidgetSnapshotWriter] writeSnapshotFromRepository failed:', error);
      return false;
    }
  }

  /** 序列化并写入；返回 commit() 是否成功（原生模块同步落盘）。 */
  writeSnapshot(snapshot: WidgetSnapshot): boolean {
    try {
      const json = JSON.stringify(snapshot);
      return WidgetSnapshotStoreModule.setString(WIDGET_SNAPSHOT_PREFS_KEY, json);
    } catch (error) {
      console.warn('[WidgetSnapshotWriter] writeSnapshot failed:', error);
      return false;
    }
  }

  /**
   * 读取上次持久化快照（渲染兜底用）；缺失/损坏返回 null。
   * 形状校验做最小收窄（groups.overdue/scheduled 必须是数组），不信任存储内容。
   */
  readSnapshot(): WidgetSnapshot | null {
    try {
      const raw = WidgetSnapshotStoreModule.getString(WIDGET_SNAPSHOT_PREFS_KEY);
      if (raw === null) {
        return null;
      }
      const parsed: unknown = JSON.parse(raw);
      return narrowWidgetSnapshot(parsed);
    } catch (error) {
      console.warn('[WidgetSnapshotWriter] readSnapshot failed:', error);
      return null;
    }
  }
}

/**
 * 最小形状收窄：字段齐且类型对才算合法快照（数据源是我们自己写入的 JSON，
 * 但 SharedPreferences 仍可能被旧版本/手工改动污染，此处防御）。
 */
function narrowWidgetSnapshot(value: unknown): WidgetSnapshot | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const root = value as Record<string, unknown>;
  if (typeof root.generatedAt !== 'number' || typeof root.tzid !== 'string') {
    return null;
  }
  if (typeof root.groups !== 'object' || root.groups === null) {
    return null;
  }
  const groups = root.groups as Record<string, unknown>;
  if (!Array.isArray(groups.overdue) || !Array.isArray(groups.scheduled)) {
    return null;
  }
  return {
    generatedAt: root.generatedAt,
    tzid: root.tzid,
    groups: {
      overdue: narrowEntryList(groups.overdue),
      scheduled: narrowEntryList(groups.scheduled),
    },
  };
}

function narrowEntryList(list: unknown[]): WidgetSnapshot['groups']['overdue'] {
  return list.flatMap((entry) => {
    const e = narrowEntry(entry);
    return e === null ? [] : [e];
  });
}

function narrowEntry(value: unknown): WidgetSnapshot['groups']['overdue'][number] | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const e = value as Record<string, unknown>;
  // categoryColor 为 v0.14 阶段 5 新增：旧版本快照无此字段，宽松读为 null（其余字段仍严格）
  const legacyColor = e.categoryColor;
  if (
    typeof e.id !== 'string'
    || typeof e.title !== 'string'
    || typeof e.type !== 'string'
    || typeof e.timeLabel !== 'string'
    || typeof e.status !== 'string'
    || !(legacyColor === undefined || legacyColor === null || typeof legacyColor === 'string')
  ) {
    return null;
  }
  return {
    id: e.id,
    title: e.title,
    type: e.type as WidgetSnapshot['groups']['overdue'][number]['type'],
    timeLabel: e.timeLabel,
    status: e.status as WidgetSnapshot['groups']['overdue'][number]['status'],
    categoryColor: legacyColor === undefined ? null : legacyColor,
  };
}
