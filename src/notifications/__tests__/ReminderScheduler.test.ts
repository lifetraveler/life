import * as Notifications from 'expo-notifications';
import type { NotificationRequest } from 'expo-notifications';

import { WatermelonReminderScheduler } from '../ReminderScheduler';
import { buildOccurrenceKey } from '../../domain/recurrence';
import type { CreateItemInput, Item } from '../../domain/item';
import type { CreateReminderInput, Reminder, UpdateReminderInput } from '../../domain/reminder';
import type { ItemWithTags, Tag } from '../../domain/tag';
import type { ItemRepository } from '../../data/ItemRepository';

// —— 固定时钟锚点：2025-06-10T08:00:00Z ——
const FIXED_NOW = 1749542400000;

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
  observeItems(_onNext: (items: Item[]) => void): () => void {
    throw new Error('FakeRepository: observeItems 未实现');
  }

  observeItemsWithTags(_onNext: (items: ItemWithTags[]) => void): () => void {
    throw new Error('FakeRepository: observeItemsWithTags 未实现');
  }

  observeTags(_onNext: (tags: Tag[]) => void): () => void {
    throw new Error('FakeRepository: observeTags 未实现');
  }

  async createItem(_input: CreateItemInput): Promise<Item> {
    throw new Error('FakeRepository: createItem 未实现');
  }

  async listItems(): Promise<Item[]> {
    throw new Error('FakeRepository: listItems 未实现');
  }

  async listItemsWithTags(): Promise<ItemWithTags[]> {
    throw new Error('FakeRepository: listItemsWithTags 未实现');
  }

  async searchItems(): Promise<ItemWithTags[]> {
    throw new Error('FakeRepository: searchItems 未实现');
  }

  async listArchivedItems(): Promise<ItemWithTags[]> {
    throw new Error('FakeRepository: listArchivedItems 未实现');
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
});
