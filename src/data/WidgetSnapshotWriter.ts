/**
 * 今日待办小组件快照写入/读取器（切片 10）：
 * - 桥接通道：WidgetSnapshotStore 本地 Expo 模块（modules/widget-snapshot-store，方案 A，
 *   用户开工确认；react-native-android-widget 自身无任何存储 API）；
 * - 键：WIDGET_SNAPSHOT_PREFS_KEY（'widget_today_snapshot_v1'，AGENTS §7.16 冻结）；
 *   阶段 7b 新增周快照键 WIDGET_WEEK_SNAPSHOT_PREFS_KEY（'widget_week_snapshot_v1'）
 *   与页状态键 WIDGET_PAGE_STATE_PREFS_KEY（'widget_page_state_v1'，docs/proposals/
 *   slice-14-widget-phase7.md 已确认）；
 * - 数据来源：消费切片 7 视图查询 listOverdueItems / listScheduledItemsInRange（签名冻结）
 *   与阶段 7a 的 listUnscheduledItems，经 buildTodayWidgetSnapshot / buildWeekWidgetSnapshot
 *   纯函数生成；本类不查询、不重复实现分组；过期/待办两组是否拉取由 app_settings
 *   小组件开关决定；
 * - Repository 接口不变（repository.md 冻结）；本类挂在 src/data/ 但不是 Repository 实现；
 * - 所有失败（原生模块缺失、写入失败、JSON 异常）捕获记录并返回失败态，不向上抛：
 *   小组件刷新失败不影响 App 主流程（任务卡实现要求）。
 */

import { getTodayRange } from '../domain/views/ranges';
import {
  buildTodayWidgetSnapshot,
  narrowSnapshotEntry,
  WIDGET_SNAPSHOT_PREFS_KEY,
} from '../domain/widget';
import type { WidgetSnapshot } from '../domain/widget';
import {
  buildWeekWidgetSnapshot,
  getWidgetWeekDayStarts,
  narrowWidgetWeekSnapshot,
  WIDGET_WEEK_SNAPSHOT_PREFS_KEY,
} from '../domain/widget/weekSnapshot';
import type { WidgetWeekSnapshot } from '../domain/widget/weekSnapshot';
import {
  narrowWidgetPageState,
  WIDGET_PAGE_STATE_PREFS_KEY,
} from '../domain/widget/pageState';
import type { WidgetPageName } from '../domain/widget/pageState';
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
   * 阶段 7a：读取 app_settings 小组件显示开关——widgetShowOverdue=false 时不查
   * 过期项、widgetShowTodos=false 时不查待办项（对应组写空数组，JSON 三组恒在）；
   * 配置变更由设置页改完后触发一次本方法（桥不订阅 app_settings）。
   * 返回写入是否成功。
   */
  async writeSnapshotFromRepository(nowMs: number, tzid: string): Promise<boolean> {
    try {
      const todayRange = getTodayRange(nowMs, tzid);
      const [settings, scheduled] = await Promise.all([
        this.itemRepository.getSettings(),
        this.itemRepository.listScheduledItemsInRange(todayRange.startMs, todayRange.endMs),
      ]);
      const [overdue, todos] = await Promise.all([
        settings.widgetShowOverdue
          ? this.itemRepository.listOverdueItems(nowMs)
          : Promise.resolve([]),
        settings.widgetShowTodos
          ? this.itemRepository.listUnscheduledItems()
          : Promise.resolve([]),
      ]);
      const snapshot = buildTodayWidgetSnapshot({ overdue, scheduled, todos, nowMs, tzid });
      return this.writeSnapshot(snapshot);
    } catch (error) {
      console.warn('[WidgetSnapshotWriter] writeSnapshotFromRepository failed:', error);
      return false;
    }
  }

  /**
   * 查库 → 生成周快照 → 写入 SharedPreferences（阶段 7b）。
   * 范围 = 今天起 7 天（getWidgetWeekDayStarts，DST 语义同 getTodayRange）；
   * 只含已安排项（有 start_at），不读 app_settings（周页暂无显示开关，7c 若加再接）。
   * 返回写入是否成功。
   */
  async writeWeekSnapshotFromRepository(nowMs: number, tzid: string): Promise<boolean> {
    try {
      const { dayStartsMs, rangeEndMs } = getWidgetWeekDayStarts(nowMs, tzid);
      const items = await this.itemRepository.listScheduledItemsInRange(
        dayStartsMs[0],
        rangeEndMs,
      );
      const snapshot = buildWeekWidgetSnapshot({ items, dayStartsMs, nowMs, tzid });
      return this.writeWeekSnapshot(snapshot);
    } catch (error) {
      console.warn('[WidgetSnapshotWriter] writeWeekSnapshotFromRepository failed:', error);
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

  /** 序列化并写入周快照（阶段 7b）；返回 commit() 是否成功。 */
  writeWeekSnapshot(snapshot: WidgetWeekSnapshot): boolean {
    try {
      const json = JSON.stringify(snapshot);
      return WidgetSnapshotStoreModule.setString(WIDGET_WEEK_SNAPSHOT_PREFS_KEY, json);
    } catch (error) {
      console.warn('[WidgetSnapshotWriter] writeWeekSnapshot failed:', error);
      return false;
    }
  }

  /**
   * 读取上次持久化快照（渲染兜底用）；缺失/损坏返回 null。
   * 形状校验做最小收窄（groups.overdue/scheduled 必须是数组；todos 阶段 7a 起可选，
   * 缺失读空数组），不信任存储内容。
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

  /** 读取上周持久化周快照（阶段 7b，渲染兜底用）；缺失/损坏返回 null。 */
  readWeekSnapshot(): WidgetWeekSnapshot | null {
    try {
      const raw = WidgetSnapshotStoreModule.getString(WIDGET_WEEK_SNAPSHOT_PREFS_KEY);
      if (raw === null) {
        return null;
      }
      const parsed: unknown = JSON.parse(raw);
      return narrowWidgetWeekSnapshot(parsed);
    } catch (error) {
      console.warn('[WidgetSnapshotWriter] readWeekSnapshot failed:', error);
      return null;
    }
  }

  /** 持久化页状态（阶段 7b，taskHandler SWITCH_PAGE 调用）；返回写入是否成功。 */
  writePageState(page: WidgetPageName): boolean {
    try {
      const json = JSON.stringify({ page });
      return WidgetSnapshotStoreModule.setString(WIDGET_PAGE_STATE_PREFS_KEY, json);
    } catch (error) {
      console.warn('[WidgetSnapshotWriter] writePageState failed:', error);
      return false;
    }
  }

  /** 读取页状态（阶段 7b）；缺失/损坏回退 'today'（narrowWidgetPageState 兜底）。 */
  readPageState(): WidgetPageName {
    try {
      const raw = WidgetSnapshotStoreModule.getString(WIDGET_PAGE_STATE_PREFS_KEY);
      if (raw === null) {
        return narrowWidgetPageState(null);
      }
      const parsed: unknown = JSON.parse(raw);
      return narrowWidgetPageState(parsed);
    } catch (error) {
      console.warn('[WidgetSnapshotWriter] readPageState failed:', error);
      return narrowWidgetPageState(null);
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
      // todos 为阶段 7a 新增：旧版本快照无此字段，宽松读为空数组（其余组仍严格）
      todos: Array.isArray(groups.todos) ? narrowEntryList(groups.todos) : [],
    },
  };
}

function narrowEntryList(list: unknown[]): WidgetSnapshot['groups']['overdue'] {
  return list.flatMap((entry) => {
    const e = narrowSnapshotEntry(entry);
    return e === null ? [] : [e];
  });
}
