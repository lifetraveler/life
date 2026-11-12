import * as Notifications from 'expo-notifications';
import type { NotificationRequest, NotificationRequestInput } from 'expo-notifications';

import { WatermelonReminderScheduler } from '../ReminderScheduler';
import { NetworkTimerRegistry } from '../channels';
import { buildOccurrenceKey } from '../../domain/recurrence';
import type { CreateItemInput, Item } from '../../domain/item';
import type { Category } from '../../domain/category';
import type { AppSettings } from '../../domain/settings';
import type { CreateReminderInput, Reminder, UpdateReminderInput } from '../../domain/reminder';
import type { ItemWithTags, Tag } from '../../domain/tag';
import type { ItemWithRelations } from '../../domain/relations/itemWithRelations';
import type {
  IcsPreviewResult,
  ImportBatchResult,
  ItemRepository,
  SystemCalendarImportInput,
  SystemImportResult,
  VisualPatch,
} from '../../data/ItemRepository';
import type {
  ChannelPreset,
  CreateChannelPresetInput,
  UpdateChannelPresetInput,
} from '../../domain/channelPreset';

// —— 固定时钟锚点：2025-06-10T08:00:00Z ——
const FIXED_NOW = 1749542400000;

// DATE 触发器断言助手：运行时窄化，避免对 NotificationTriggerInput 联合类型做不合法 cast。
function expectDateTrigger(request: NotificationRequestInput): { type: string; date: Date } {
  const trigger = request.trigger as { date?: unknown; type?: unknown };
  const date = trigger.date;
  if (!(date instanceof Date)) {
    throw new Error(`expected DATE trigger with Date value, got type=${String(trigger.type)}`);
  }
  return { type: String(trigger.type), date };
}

// r1：daily 09:00 UTC，startAt = 2025-06-10T00:00Z → 30 个 occurrence 全部落在调度窗口内。
function reminderR1(): Reminder {
  return {
    id: 'r1',
    itemId: 'i1',
    frequency: 'daily',
    localTimeHour: 9,
    localTimeMinute: 0,
    weekdays: [],
    dayOfMonth: 0,
    // 切片 16 编译必需夹具补字段（§7.13）：onceAt/channel/channelConfig。
    onceAt: null,
    channel: 'system-notification',
    channelConfig: null,
    tzid: 'UTC',
    startAt: 1749513600000,
    enabled: true,
    lastFiredOccurrenceKey: null,
    lastReconciledAt: null,
    createdAt: FIXED_NOW - 1,
    updatedAt: FIXED_NOW - 1,
  };
}

// r2：daily 08:00 UTC，startAt = 2025-06-09T00:00Z → 06-09 与 06-10（==now）两条已错过。
function reminderR2(): Reminder {
  return {
    id: 'r2',
    itemId: 'i2',
    frequency: 'daily',
    localTimeHour: 8,
    localTimeMinute: 0,
    weekdays: [],
    dayOfMonth: 0,
    // 切片 16 编译必需夹具补字段（§7.13）：onceAt/channel/channelConfig。
    onceAt: null,
    channel: 'system-notification',
    channelConfig: null,
    tzid: 'UTC',
    startAt: 1749427200000,
    enabled: true,
    lastFiredOccurrenceKey: null,
    lastReconciledAt: null,
    createdAt: FIXED_NOW - 1,
    updatedAt: FIXED_NOW - 1,
  };
}

function activeItem(id: string, title: string): Item {
  return {
    id,
    type: 'note',
    title,
    content: '',
    status: 'active',
    startAt: null,
    endAt: null,
    allDay: false,
    // 切片 8 编译必需夹具补字段（§7.13）：调度器不读来源字段，固定 local 值。
    sourceType: 'local',
    sourceUid: null,
    sourceReadOnly: false,
    // 切片 14 编译必需夹具补字段（§7.13）：调度器不读分类/优先级，固定默认值。
    categoryId: 'other',
    priority: 0,
    createdAt: FIXED_NOW - 1,
    updatedAt: FIXED_NOW - 1,
  };
}

function dailyKeys(
  scheduleId: string,
  localTime: string,
  tzid: string,
  startDate: string,
  count: number,
): string[] {
  const keys: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  for (let i = 0; i < count; i += 1) {
    keys.push(
      buildOccurrenceKey({
        scheduleId,
        localDate: cursor.toISOString().slice(0, 10),
        localTime,
        tzid,
      }),
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

const R1_EXPECTED_KEYS = dailyKeys('r1', '09:00', 'UTC', '2025-06-10', 30);
const R2_MISSED_KEYS = [
  buildOccurrenceKey({ scheduleId: 'r2', localDate: '2025-06-09', localTime: '08:00', tzid: 'UTC' }),
  buildOccurrenceKey({ scheduleId: 'r2', localDate: '2025-06-10', localTime: '08:00', tzid: 'UTC' }),
];

// —— expo-notifications mock：内存版“系统通知中心” ——

const scheduledStore = new Map<string, NotificationRequest>();

function storedRequest(identifier: string): NotificationRequest {
  return {
    identifier,
    content: {
      title: null,
      subtitle: null,
      body: null,
      data: {},
      categoryIdentifier: null,
      sound: null,
      launchImageName: null,
      badge: null,
      attachments: [],
      threadIdentifier: null,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(0) },
  };
}

jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  getAllScheduledNotificationsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  cancelAllScheduledNotificationsAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
}));

const getAllScheduledNotificationsAsyncMock = jest.mocked(
  Notifications.getAllScheduledNotificationsAsync,
);
const scheduleNotificationAsyncMock = jest.mocked(Notifications.scheduleNotificationAsync);
const cancelScheduledNotificationAsyncMock = jest.mocked(
  Notifications.cancelScheduledNotificationAsync,
);
const cancelAllScheduledNotificationsAsyncMock = jest.mocked(
  Notifications.cancelAllScheduledNotificationsAsync,
);

// —— 内存版 Repository：只实现调度器会触达的方法 ——

class FakeRepository implements ItemRepository {
  items = new Map<string, Item>();
  reminders = new Map<string, Reminder>();
  firedMarks: Array<{ id: string; occurrenceKey: string }> = [];
  reconciledMarks: Array<{ id: string; lastReconciledAt: number }> = [];

  async getItem(id: string): Promise<Item | null> {
    return this.items.get(id) ?? null;
  }

  async listEnabledReminders(): Promise<Reminder[]> {
    return [...this.reminders.values()].filter((reminder) => reminder.enabled);
  }

  async markReminderFired(id: string, occurrenceKey: string): Promise<void> {
    this.firedMarks.push({ id, occurrenceKey });
    const reminder = this.reminders.get(id);
    if (reminder) {
      reminder.lastFiredOccurrenceKey = occurrenceKey;
    }
  }

  async markReminderReconciled(id: string, lastReconciledAt: number): Promise<void> {
    this.reconciledMarks.push({ id, lastReconciledAt });
    const reminder = this.reminders.get(id);
    if (reminder) {
      reminder.lastReconciledAt = lastReconciledAt;
    }
  }

  // 以下方法调度器单测不触及，为满足接口而存在。
  // 切片 14（§7.23）：查询/观察签名统一升级为 ItemWithRelations，夹具签名同步（§7.13 编译必需）。
  observeItems(_onNext: (items: ItemWithRelations[]) => void): () => void {
    throw new Error('FakeRepository: observeItems 未实现');
  }

  observeItemsWithTags(_onNext: (items: ItemWithRelations[]) => void): () => void {
    throw new Error('FakeRepository: observeItemsWithTags 未实现');
  }

  observeTags(_onNext: (tags: Tag[]) => void): () => void {
    throw new Error('FakeRepository: observeTags 未实现');
  }

  async listTags(): Promise<Tag[]> {
    throw new Error('FakeRepository: listTags 未实现');
  }

  async createItem(_input: CreateItemInput): Promise<Item> {
    throw new Error('FakeRepository: createItem 未实现');
  }

  async listItems(): Promise<ItemWithRelations[]> {
    throw new Error('FakeRepository: listItems 未实现');
  }

  async listItemsWithTags(): Promise<ItemWithRelations[]> {
    throw new Error('FakeRepository: listItemsWithTags 未实现');
  }

  async searchItems(): Promise<ItemWithRelations[]> {
    throw new Error('FakeRepository: searchItems 未实现');
  }

  async listArchivedItems(): Promise<ItemWithRelations[]> {
    throw new Error('FakeRepository: listArchivedItems 未实现');
  }

  async listArchivedItemsWithTags(): Promise<ItemWithRelations[]> {
    throw new Error('FakeRepository: listArchivedItemsWithTags 未实现');
  }

  async updateItem(): Promise<Item> {
    throw new Error('FakeRepository: updateItem 未实现');
  }

  async archiveItem(): Promise<void> {
    throw new Error('FakeRepository: archiveItem 未实现');
  }

  async unarchiveItem(): Promise<void> {
    throw new Error('FakeRepository: unarchiveItem 未实现');
  }

  async addTagToItem(): Promise<Tag> {
    throw new Error('FakeRepository: addTagToItem 未实现');
  }

  async removeTagFromItem(): Promise<void> {
    throw new Error('FakeRepository: removeTagFromItem 未实现');
  }

  // 切片 6（§4.24）新增接口方法：调度器单测不触及，为满足接口而存在。
  async getItemById(): Promise<ItemWithRelations | null> {
    throw new Error('FakeRepository: getItemById 未实现');
  }

  async updateItemTime(): Promise<Item> {
    throw new Error('FakeRepository: updateItemTime 未实现');
  }

  // 切片 7 视图查询方法：调度器单测不触及，为满足接口而存在。
  async listScheduledItemsInRange(): Promise<ItemWithRelations[]> {
    throw new Error('FakeRepository: listScheduledItemsInRange 未实现');
  }

  async listOverdueItems(): Promise<ItemWithRelations[]> {
    throw new Error('FakeRepository: listOverdueItems 未实现');
  }

  async listUnscheduledItemsCreatedInRange(): Promise<ItemWithRelations[]> {
    throw new Error('FakeRepository: listUnscheduledItemsCreatedInRange 未实现');
  }

  observeScheduledItemsInRange(): () => void {
    throw new Error('FakeRepository: observeScheduledItemsInRange 未实现');
  }

  observeOverdueItems(): () => void {
    throw new Error('FakeRepository: observeOverdueItems 未实现');
  }

  observeUnscheduledItemsCreatedInRange(): () => void {
    throw new Error('FakeRepository: observeUnscheduledItemsCreatedInRange 未实现');
  }

  // 切片 8（repository.md v0.8 + 契约外扩展）新增接口方法：调度器单测不触及，为满足接口而存在。
  async createImportedItem(): Promise<ItemWithTags> {
    throw new Error('FakeRepository: createImportedItem 未实现');
  }

  async findItemBySource(): Promise<ItemWithRelations | null> {
    throw new Error('FakeRepository: findItemBySource 未实现');
  }

  async listItemsForExport(): Promise<ItemWithRelations[]> {
    throw new Error('FakeRepository: listItemsForExport 未实现');
  }

  async updateImportedItemTime(): Promise<Item> {
    throw new Error('FakeRepository: updateImportedItemTime 未实现');
  }

  async deleteItem(): Promise<void> {
    throw new Error('FakeRepository: deleteItem 未实现');
  }

  async importItemsInBatches(): Promise<ImportBatchResult> {
    throw new Error('FakeRepository: importItemsInBatches 未实现');
  }

  async createReminder(_input: CreateReminderInput): Promise<Reminder> {
    throw new Error('FakeRepository: createReminder 未实现');
  }

  async updateReminder(_id: string, _patch: UpdateReminderInput): Promise<Reminder> {
    throw new Error('FakeRepository: updateReminder 未实现');
  }

  async deleteReminder(): Promise<void> {
    throw new Error('FakeRepository: deleteReminder 未实现');
  }

  async listRemindersByItem(): Promise<Reminder[]> {
    throw new Error('FakeRepository: listRemindersByItem 未实现');
  }

  async listAllReminders(): Promise<Reminder[]> {
    throw new Error('FakeRepository: listAllReminders 未实现');
  }

  // 切片 9：接口新增方法，调度器单测不触及，为满足接口而存在（§7.13 夹具编译必需）。
  async importSystemCalendarEvents(
    _input: SystemCalendarImportInput,
  ): Promise<SystemImportResult> {
    throw new Error('FakeRepository: importSystemCalendarEvents 未实现');
  }

  // 切片 14：分类与全局设置接口方法，调度器单测不触及，为满足接口而存在
  // （§7.13 夹具编译必需；stub 返回空数组/简单值，调度器路径不会触达）。
  async getCategories(): Promise<Category[]> {
    return [];
  }

  async updateCategoryVisuals(_id: string, _patch: VisualPatch): Promise<Category> {
    return { id: '', name: '', color: null, emoji: null, priority: 0 };
  }

  async updateTagVisuals(_id: string, _patch: VisualPatch): Promise<Tag> {
    return { id: '', name: '', color: null, emoji: null, createdAt: 0 };
  }

  async getSettings(): Promise<AppSettings> {
    return {
      tagDisplayMode: 'text',
      widgetShowOverdue: true,
      widgetShowTodos: false,
      widgetShowCategoryEmoji: false,
      widgetShowTags: false,
    };
  }

  async updateSettings(_patch: Partial<AppSettings>): Promise<void> {
    return undefined;
  }

  // —— 切片 14 阶段 7a 接口扩展的测试夹具 stub（§7.13：编译必需，调度器不触达） ——

  async listUnscheduledItems(): Promise<ItemWithRelations[]> {
    return [];
  }

  observeUnscheduledItems(_onNext: (items: ItemWithRelations[]) => void): () => void {
    return () => undefined;
  }

  // —— 切片 17 阶段 1 接口扩展的测试夹具 stub（§7.13：编译必需，调度器不触达） ——

  async listChannelPresets(): Promise<ChannelPreset[]> {
    return [];
  }

  async createChannelPreset(_input: CreateChannelPresetInput): Promise<ChannelPreset> {
    throw new Error('FakeRepository: createChannelPreset 未实现');
  }

  async updateChannelPreset(_id: string, _patch: UpdateChannelPresetInput): Promise<ChannelPreset> {
    throw new Error('FakeRepository: updateChannelPreset 未实现');
  }

  async deleteChannelPreset(_id: string): Promise<void> {
    return undefined;
  }

  async generateIcsPreview(_icsText: string, _deviceTzid: string): Promise<IcsPreviewResult> {
    return { entries: [], failures: [], sameFileDuplicates: [], duplicateCount: 0 };
  }
}

function makeScheduler(repository: FakeRepository): WatermelonReminderScheduler {
  return new WatermelonReminderScheduler({ repository, now: () => FIXED_NOW });
}

async function seedAndReconcile(
  repository: FakeRepository,
): Promise<ReturnType<WatermelonReminderScheduler['reconcile']>> {
  const scheduler = makeScheduler(repository);
  return scheduler.reconcile();
}

describe('WatermelonReminderScheduler（mock expo-notifications）', () => {
  let repository: FakeRepository;

  beforeEach(() => {
    scheduledStore.clear();
    jest.clearAllMocks();
    repository = new FakeRepository();
    getAllScheduledNotificationsAsyncMock.mockImplementation(async () => [
      ...scheduledStore.values(),
    ]);
    scheduleNotificationAsyncMock.mockImplementation(async (request) => {
      const identifier = request.identifier ?? `auto-${scheduledStore.size}`;
      scheduledStore.set(identifier, storedRequest(identifier));
      return identifier;
    });
    cancelScheduledNotificationAsyncMock.mockImplementation(async (identifier) => {
      scheduledStore.delete(identifier);
    });
    cancelAllScheduledNotificationsAsyncMock.mockImplementation(async () => {
      scheduledStore.clear();
    });
  });

  describe('reconcile', () => {
    it('首次对账：为窗口内 30 个 occurrence 调度通知，newlyScheduled 为期望键集', async () => {
      repository.items.set('i1', activeItem('i1', '标题甲'));
      repository.reminders.set('r1', reminderR1());

      const result = await seedAndReconcile(repository);

      expect(scheduleNotificationAsyncMock).toHaveBeenCalledTimes(30);
      expect(result.newlyScheduled).toEqual(R1_EXPECTED_KEYS);
      expect(result.cancelled).toEqual([]);
      expect(result.missed).toEqual([]);
      expect([...scheduledStore.keys()].sort()).toEqual([...R1_EXPECTED_KEYS].sort());

      const firstCall = scheduleNotificationAsyncMock.mock.calls[0][0];
      expect(firstCall.identifier).toBe(R1_EXPECTED_KEYS[0]);
      expect(firstCall.content.title).toBe('标题甲');
      expect(firstCall.content.data).toEqual({
        occurrenceKey: R1_EXPECTED_KEYS[0],
        reminderId: 'r1',
        itemId: 'i1',
      });
    });

    it('第二次对账：无新增、无取消、不再调用 scheduleNotificationAsync', async () => {
      repository.items.set('i1', activeItem('i1', '标题甲'));
      repository.reminders.set('r1', reminderR1());
      const scheduler = makeScheduler(repository);
      await scheduler.reconcile();
      expect(scheduleNotificationAsyncMock).toHaveBeenCalledTimes(30);

      const second = await scheduler.reconcile();

      expect(scheduleNotificationAsyncMock).toHaveBeenCalledTimes(30);
      expect(second).toEqual({ newlyScheduled: [], cancelled: [], missed: [] });
    });

    it('reminder 被删除后对账：其通知全部取消', async () => {
      repository.items.set('i1', activeItem('i1', '标题甲'));
      repository.reminders.set('r1', reminderR1());
      const scheduler = makeScheduler(repository);
      await scheduler.reconcile();

      repository.reminders.clear();
      const result = await scheduler.reconcile();

      expect(result.cancelled).toEqual(R1_EXPECTED_KEYS);
      expect(result.newlyScheduled).toEqual([]);
      expect(scheduledStore.size).toBe(0);
    });

    it('Item 置为 done 后对账：其通知全部取消，且不计 missed', async () => {
      repository.items.set('i1', activeItem('i1', '标题甲'));
      repository.reminders.set('r1', reminderR1());
      const scheduler = makeScheduler(repository);
      await scheduler.reconcile();

      const item = repository.items.get('i1');
      if (!item) throw new Error('测试前置失败：i1 不存在');
      item.status = 'done';
      const result = await scheduler.reconcile();

      expect(result.cancelled).toEqual(R1_EXPECTED_KEYS);
      expect(result.missed).toEqual([]);
      expect(scheduledStore.size).toBe(0);
    });

    it('错过补提醒：窗口内已过期 occurrence 首次对账计入 missed 并推进 lastFiredOccurrenceKey，第二次不再报告', async () => {
      repository.items.set('i2', activeItem('i2', '标题乙'));
      repository.reminders.set('r2', reminderR2());

      const first = await seedAndReconcile(repository);

      expect(first.missed.map((o) => o.occurrenceKey)).toEqual(R2_MISSED_KEYS);
      expect(repository.firedMarks).toEqual([{ id: 'r2', occurrenceKey: R2_MISSED_KEYS[1] }]);

      const second = await seedAndReconcile(repository);

      expect(second.missed).toEqual([]);
    });

    it('对账与 cancelAll 均不触碰他 App 前缀的通知', async () => {
      repository.items.set('i1', activeItem('i1', '标题甲'));
      repository.reminders.set('r1', reminderR1());
      const scheduler = makeScheduler(repository);
      await scheduler.reconcile();

      scheduledStore.set('other-app:xyz', storedRequest('other-app:xyz'));

      const result = await scheduler.reconcile();
      expect(result.cancelled).not.toContain('other-app:xyz');
      expect(scheduledStore.has('other-app:xyz')).toBe(true);

      await scheduler.cancelAll();
      expect(scheduledStore.has('other-app:xyz')).toBe(true);
      expect([...scheduledStore.keys()].every((key) => key.startsWith('other-app:'))).toBe(true);
    });

    it('每个 reminder 都被 markReminderReconciled', async () => {
      repository.items.set('i1', activeItem('i1', '标题甲'));
      repository.reminders.set('r1', reminderR1());
      repository.items.set('i2', activeItem('i2', '标题乙'));
      repository.reminders.set('r2', reminderR2());

      await seedAndReconcile(repository);

      // ordered 按 nextInstant 升序：r1 的下一个 occurrence 是 06-10 09:00，
      // 早于 r2 的 06-11 08:00，因此 r1 先被 markReminderReconciled。
      expect(repository.reconciledMarks).toEqual([
        { id: 'r1', lastReconciledAt: FIXED_NOW },
        { id: 'r2', lastReconciledAt: FIXED_NOW },
      ]);
    });

    // —— 切片 11（notifications.md v0.11）：forceRebuild ——
    it('forceRebuild=true：清空本 App 全部通知后全量重排，幽灵注册表不再误导 diff', async () => {
      repository.items.set('i1', activeItem('i1', '标题甲'));
      repository.reminders.set('r1', reminderR1());
      const scheduler = makeScheduler(repository);
      await scheduler.reconcile();
      expect(scheduledStore.size).toBe(30);

      // 模拟幽灵注册表：注册表残留一条 DB 中已无对应 occurrence 的通知。
      scheduledStore.set('recurrence:v1|ghost|2025-06-10|09:00|UTC', storedRequest('recurrence:v1|ghost|2025-06-10|09:00|UTC'));

      const result = await scheduler.reconcile({ forceRebuild: true });

      expect(cancelAllScheduledNotificationsAsyncMock).toHaveBeenCalledTimes(1);
      expect(scheduledStore.has('recurrence:v1|ghost|2025-06-10|09:00|UTC')).toBe(false);
      expect([...scheduledStore.keys()].sort()).toEqual([...R1_EXPECTED_KEYS].sort());
      expect(result.newlyScheduled).toEqual(R1_EXPECTED_KEYS);
      // actual 视为空集：幽灵不进入 toCancel，取消动作完全由 cancelAll 承担。
      expect(result.cancelled).toEqual([]);
      expect(result.missed).toEqual([]);
    });

    it('forceRebuild 缺省/false：不调用 cancelAllScheduledNotificationsAsync，diff 语义不变', async () => {
      repository.items.set('i1', activeItem('i1', '标题甲'));
      repository.reminders.set('r1', reminderR1());
      const scheduler = makeScheduler(repository);

      await scheduler.reconcile();
      await scheduler.reconcile({ forceRebuild: false });

      expect(cancelAllScheduledNotificationsAsyncMock).not.toHaveBeenCalled();
      expect(scheduledStore.size).toBe(30);
    });

    it('连续两次 forceRebuild：第二次 missed 为空（missed 逻辑仍基于 lastFiredOccurrenceKey）', async () => {
      repository.items.set('i2', activeItem('i2', '标题乙'));
      repository.reminders.set('r2', reminderR2());

      const first = await seedAndReconcile(repository);
      expect(first.missed.map((o) => o.occurrenceKey)).toEqual(R2_MISSED_KEYS);

      const second = await seedAndReconcile(repository);
      expect(second.missed).toEqual([]);
    });
  });

  describe('cancelForReminder', () => {
    it('取消该 reminder 名下所有前缀匹配的通知', async () => {
      repository.items.set('i1', activeItem('i1', '标题甲'));
      repository.reminders.set('r1', reminderR1());
      const scheduler = makeScheduler(repository);
      await scheduler.reconcile();

      await scheduler.cancelForReminder('r1');

      expect(scheduledStore.size).toBe(0);
      expect(cancelScheduledNotificationAsyncMock).toHaveBeenCalledTimes(30);
    });
  });

  describe('scheduleForReminder', () => {
    it('reminder 已删除或 disabled → 等价 cancel', async () => {
      repository.items.set('i1', activeItem('i1', '标题甲'));
      repository.reminders.set('r1', reminderR1());
      const scheduler = makeScheduler(repository);
      await scheduler.reconcile();

      const deleted = repository.reminders.get('r1');
      if (!deleted) throw new Error('测试前置失败：r1 不存在');
      deleted.enabled = false;
      repository.reminders.delete('r1');

      await scheduler.scheduleForReminder('r1');

      expect(scheduledStore.size).toBe(0);
    });

    it('Item 已完成/已归档 → 等价 cancel', async () => {
      repository.items.set('i1', activeItem('i1', '标题甲'));
      repository.reminders.set('r1', reminderR1());
      const scheduler = makeScheduler(repository);
      await scheduler.reconcile();

      const item = repository.items.get('i1');
      if (!item) throw new Error('测试前置失败：i1 不存在');
      item.status = 'archived';
      await scheduler.scheduleForReminder('r1');

      expect(scheduledStore.size).toBe(0);
    });

    it('已存在同 identifier 的通知不重复注册', async () => {
      repository.items.set('i1', activeItem('i1', '标题甲'));
      repository.reminders.set('r1', reminderR1());
      const scheduler = makeScheduler(repository);
      await scheduler.reconcile();
      expect(scheduleNotificationAsyncMock).toHaveBeenCalledTimes(30);

      await scheduler.scheduleForReminder('r1');

      expect(scheduleNotificationAsyncMock).toHaveBeenCalledTimes(30);
      expect(scheduledStore.size).toBe(30);
    });

    it('规则编辑后：取消旧 occurrence，调度新 occurrence', async () => {
      repository.items.set('i1', activeItem('i1', '标题甲'));
      repository.reminders.set('r1', reminderR1());
      const scheduler = makeScheduler(repository);
      await scheduler.reconcile();

      const reminder = repository.reminders.get('r1');
      if (!reminder) throw new Error('测试前置失败：r1 不存在');
      reminder.localTimeHour = 10;
      reminder.updatedAt = FIXED_NOW;
      await scheduler.scheduleForReminder('r1');

      const newKeys = dailyKeys('r1', '10:00', 'UTC', '2025-06-10', 30);
      expect([...scheduledStore.keys()].sort()).toEqual([...newKeys].sort());
      expect(scheduledStore.size).toBe(30);
    });
  });

  describe('getLastReconciledAt（切片 11 cold start 阈值数据源，决议②）', () => {
    it('无 enabled reminder 或从未对账 → null', async () => {
      const scheduler = makeScheduler(repository);
      expect(await scheduler.getLastReconciledAt()).toBeNull();

      repository.reminders.set('r1', reminderR1());
      expect(await scheduler.getLastReconciledAt()).toBeNull();
    });

    it('对账后返回 lastReconciledAt 最大值（fixed clock 下即 FIXED_NOW）', async () => {
      repository.items.set('i1', activeItem('i1', '标题甲'));
      repository.reminders.set('r1', reminderR1());
      repository.items.set('i2', activeItem('i2', '标题乙'));
      repository.reminders.set('r2', reminderR2());

      const scheduler = makeScheduler(repository);
      await scheduler.reconcile();

      expect(await scheduler.getLastReconciledAt()).toBe(FIXED_NOW);
    });
  });

  // —— 切片 16 阶段 2（notifications.md v0.16）：渠道分发与 once occurrenceKey ——

  describe('渠道分发与 once（切片 16 阶段 2）', () => {
    const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
    let nowMs = FIXED_NOW;

    function makeChannelScheduler(repo: FakeRepository): WatermelonReminderScheduler {
      return new WatermelonReminderScheduler({
        repository: repo,
        now: () => nowMs,
        fetchImpl: fetchMock,
      });
    }

    function onceReminder(
      id: string,
      itemId: string,
      onceAt: { year: number; month: number; day: number; hour: number; minute: number },
      channel: Reminder['channel'],
      channelConfig: string | null,
      tzid: string = 'UTC',
    ): Reminder {
      return {
        id,
        itemId,
        frequency: 'once',
        localTimeHour: 0,
        localTimeMinute: 0,
        weekdays: [],
        dayOfMonth: 0,
        onceAt,
        channel,
        channelConfig,
        tzid,
        startAt: FIXED_NOW,
        enabled: true,
        lastFiredOccurrenceKey: null,
        lastReconciledAt: null,
        createdAt: FIXED_NOW - 1,
        updatedAt: FIXED_NOW - 1,
      };
    }

    // 排干 deliver/fetch 微任务链，使 timer 触发的异步投递断言稳定。
    async function flushAsync(): Promise<void> {
      for (let i = 0; i < 20; i += 1) {
        await Promise.resolve();
      }
    }

    beforeEach(() => {
      // timer 全链测试会把时钟推到 fireAt；每条测试复位，保证窗口过滤 (now, now+30d] 一致。
      nowMs = FIXED_NOW;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('once+system-notification：按确认格式路由到 expo，identifier 与 trigger.date 为绝对毫秒', async () => {
      const fireAt = Date.UTC(2025, 5, 15, 9, 0);
      const key = `once:rO:${fireAt}`;
      repository.items.set('iO', activeItem('iO', '标题丙'));
      repository.reminders.set(
        'rO',
        onceReminder('rO', 'iO', { year: 2025, month: 6, day: 15, hour: 9, minute: 0 }, 'system-notification', null),
      );
      const scheduler = makeChannelScheduler(repository);

      await scheduler.scheduleForReminder('rO');

      expect(scheduleNotificationAsyncMock).toHaveBeenCalledTimes(1);
      const request = scheduleNotificationAsyncMock.mock.calls[0][0];
      expect(request.identifier).toBe(key);
      const trigger = expectDateTrigger(request);
      expect(trigger.type).toBe('date');
      expect(trigger.date.getTime()).toBe(fireAt);
      expect(scheduledStore.has(key)).toBe(true);
    });

    it('once+webhook：定时器到点 fetch 正确 URL（timer→deliver 全链）', async () => {
      jest.useFakeTimers();
      const fireAt = Date.UTC(2025, 5, 15, 9, 0);
      const key = `once:rW:${fireAt}`;
      repository.items.set('iW', activeItem('iW', '标题丙'));
      repository.reminders.set(
        'rW',
        onceReminder('rW', 'iW', { year: 2025, month: 6, day: 15, hour: 9, minute: 0 }, 'webhook', 'https://hook.example/hi'),
      );
      fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
      // 在 fake timers 就绪后创建调度器，registry 才会持有 jest 的 setTimeout。
      const scheduler = makeChannelScheduler(repository);

      await scheduler.scheduleForReminder('rW');

      expect(scheduleNotificationAsyncMock).not.toHaveBeenCalled();
      expect(scheduler.getNetworkArmedKeys()).toEqual([key]);
      expect(fetchMock).not.toHaveBeenCalled();

      nowMs = fireAt;
      jest.advanceTimersByTime(fireAt - FIXED_NOW);
      await flushAsync();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://hook.example/hi');
      expect(scheduler.getNetworkArmedKeys()).toEqual([]);
    });

    it('once+webhook：missed 立即补发到正确 URL，不向 OS 注册、不挂未来 timer', async () => {
      const fireAt = Date.UTC(2025, 5, 9, 9, 0); // < FIXED_NOW → missed
      const key = `once:rW:${fireAt}`;
      repository.items.set('iW', activeItem('iW', '标题丙'));
      repository.reminders.set(
        'rW',
        onceReminder('rW', 'iW', { year: 2025, month: 6, day: 9, hour: 9, minute: 0 }, 'webhook', 'https://hook.example/past'),
      );
      fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
      const scheduler = makeChannelScheduler(repository);

      const result = await scheduler.reconcile();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://hook.example/past');
      expect(result.missed.map((o) => o.occurrenceKey)).toEqual([key]);
      expect(repository.firedMarks).toEqual([{ id: 'rW', occurrenceKey: key }]);
      expect(scheduleNotificationAsyncMock).not.toHaveBeenCalled();
      expect(scheduler.getNetworkArmedKeys()).toEqual([]);
    });

    it('本进程已成功投递（attempt ok）的 occurrence 不重复补发，游标照常推进', async () => {
      const fireAt = Date.UTC(2025, 5, 9, 9, 0);
      const key = `once:rW:${fireAt}`;
      repository.items.set('iW', activeItem('iW', '标题丙'));
      repository.reminders.set(
        'rW',
        onceReminder('rW', 'iW', { year: 2025, month: 6, day: 9, hour: 9, minute: 0 }, 'webhook', 'https://hook.example/again'),
      );
      fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
      // 注入 registry 并预记 ok：模拟本进程早前已成功投递该 occurrence。
      const registry = new NetworkTimerRegistry({ now: () => FIXED_NOW, onFire: () => undefined });
      registry.recordAttempt(key, 'ok');
      const scheduler = new WatermelonReminderScheduler({
        repository,
        now: () => FIXED_NOW,
        fetchImpl: fetchMock,
        registry,
      });

      const result = await scheduler.reconcile();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.missed.map((o) => o.occurrenceKey)).toEqual([key]);
      expect(repository.firedMarks).toEqual([{ id: 'rW', occurrenceKey: key }]);
    });

    it('补发失败（非 2xx）后游标仍推进：下一轮 reconcile 不再补发（每轮至多一次机会）', async () => {
      const fireAt = Date.UTC(2025, 5, 9, 9, 0);
      repository.items.set('iW', activeItem('iW', '标题丙'));
      repository.reminders.set(
        'rW',
        onceReminder('rW', 'iW', { year: 2025, month: 6, day: 9, hour: 9, minute: 0 }, 'webhook', 'https://hook.example/bad'),
      );
      fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
      const scheduler = makeChannelScheduler(repository);

      const first = await scheduler.reconcile();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(first.missed.map((o) => o.occurrenceKey)).toEqual([`once:rW:${fireAt}`]);
      expect(repository.firedMarks).toEqual([{ id: 'rW', occurrenceKey: `once:rW:${fireAt}` }]);

      const second = await scheduler.reconcile();
      expect(fetchMock).toHaveBeenCalledTimes(1); // 未新增调用
      expect(second.missed).toEqual([]);
    });

    it('alarm 渠道：路由到 expo 调度，identifier = occurrenceKey', async () => {
      const fireAt = Date.UTC(2025, 5, 16, 7, 30);
      const key = `once:rA:${fireAt}`;
      repository.items.set('iA', activeItem('iA', '标题丁'));
      repository.reminders.set(
        'rA',
        onceReminder('rA', 'iA', { year: 2025, month: 6, day: 16, hour: 7, minute: 30 }, 'alarm', null),
      );
      const scheduler = makeChannelScheduler(repository);

      await scheduler.scheduleForReminder('rA');

      expect(scheduleNotificationAsyncMock).toHaveBeenCalledTimes(1);
      expect(scheduleNotificationAsyncMock.mock.calls[0][0].identifier).toBe(key);
      expect(scheduledStore.has(key)).toBe(true);
    });

    it('渠道切换卫生：system→webhook 后残留 expo 通知被清、改挂网络定时器', async () => {
      // fake timers：测试结束时定时器仍挂载，真实 setTimeout 会吊住 jest 进程不退出。
      jest.useFakeTimers();
      const fireAt = Date.UTC(2025, 5, 15, 9, 0);
      const key = `once:rX:${fireAt}`;
      repository.items.set('iX', activeItem('iX', '标题丙'));
      repository.reminders.set(
        'rX',
        onceReminder('rX', 'iX', { year: 2025, month: 6, day: 15, hour: 9, minute: 0 }, 'system-notification', null),
      );
      const scheduler = makeChannelScheduler(repository);
      await scheduler.scheduleForReminder('rX');
      expect(scheduledStore.size).toBe(1);

      const reminder = repository.reminders.get('rX');
      if (!reminder) throw new Error('rX missing');
      reminder.channel = 'webhook';
      reminder.channelConfig = 'https://hook.example/x';

      await scheduler.scheduleForReminder('rX');

      expect(scheduledStore.size).toBe(0);
      expect(scheduler.getNetworkArmedKeys()).toEqual([key]);
    });

    it('渠道切换卫生：webhook→system 后内存定时器被清、expo 正常注册', async () => {
      jest.useFakeTimers();
      const fireAt = Date.UTC(2025, 5, 15, 9, 0);
      const key = `once:rX:${fireAt}`;
      repository.items.set('iX', activeItem('iX', '标题丙'));
      repository.reminders.set(
        'rX',
        onceReminder('rX', 'iX', { year: 2025, month: 6, day: 15, hour: 9, minute: 0 }, 'webhook', 'https://hook.example/x'),
      );
      const scheduler = makeChannelScheduler(repository);
      await scheduler.scheduleForReminder('rX');
      expect(scheduler.getNetworkArmedKeys()).toEqual([key]);

      const reminder = repository.reminders.get('rX');
      if (!reminder) throw new Error('rX missing');
      reminder.channel = 'system-notification';
      reminder.channelConfig = null;

      await scheduler.scheduleForReminder('rX');

      expect(scheduler.getNetworkArmedKeys()).toEqual([]);
      expect(scheduledStore.has(key)).toBe(true);
    });

    it('disabled 后 reconcile：网络定时器被 pruneExcept 清空', async () => {
      jest.useFakeTimers();
      const fireAt = Date.UTC(2025, 5, 15, 9, 0);
      repository.items.set('iW', activeItem('iW', '标题丙'));
      repository.reminders.set(
        'rW',
        onceReminder('rW', 'iW', { year: 2025, month: 6, day: 15, hour: 9, minute: 0 }, 'webhook', 'https://hook.example/x'),
      );
      const scheduler = makeChannelScheduler(repository);
      await scheduler.scheduleForReminder('rW');
      expect(scheduler.getNetworkArmedKeys()).toHaveLength(1);

      const reminder = repository.reminders.get('rW');
      if (!reminder) throw new Error('rW missing');
      reminder.enabled = false;

      await scheduler.reconcile();

      expect(scheduler.getNetworkArmedKeys()).toEqual([]);
    });

    it('once 落春季 gap（America/New_York 2026-03-08 02:30）：无 occurrence，不调度不挂载', async () => {
      repository.items.set('iG', activeItem('iG', '标题戊'));
      repository.reminders.set(
        'rG',
        onceReminder(
          'rG',
          'iG',
          { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
          'webhook',
          'https://hook.example/gap',
          'America/New_York',
        ),
      );
      const scheduler = makeChannelScheduler(repository);

      await scheduler.scheduleForReminder('rG');

      expect(scheduleNotificationAsyncMock).not.toHaveBeenCalled();
      expect(scheduler.getNetworkArmedKeys()).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
