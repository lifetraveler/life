import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import ItemModel from '../../db/models/ItemModel';
import ItemTagModel from '../../db/models/ItemTagModel';
import ReminderModel from '../../db/models/ReminderModel';
import TagModel from '../../db/models/TagModel';
import { schema } from '../../db/schema';
import { WatermelonItemRepository } from '../WatermelonItemRepository';
import { serializeExportData } from '../../domain/export';

/**
 * 切片 12 数据导出集成面单测：listAllReminders（决策 A-1，契约外显式扩展）
 * + listItemsWithTags ∪ listArchivedItemsWithTags（决策 B）→ serializeExportData
 * 全链路（tasks/slice-12.md 实现要求 3）。
 */

let dbCounter = 0;

// LokiJS 默认开启 autosave（setInterval 挂住事件循环），测试结束后必须 close
// 释放；_driver 为异步赋值需惰性解析，jest 下还可能挂在 bridge 上，两条路都兜住。
const createdAdapters: LokiJSAdapter[] = [];

function extractLokiHandle(adapter: LokiJSAdapter): { close: () => void } | null {
  const viaDriver = (adapter as unknown as { _driver?: { loki?: { close: () => void } } })
    ._driver;
  if (viaDriver?.loki) {
    return viaDriver.loki;
  }
  const viaBridge = (
    adapter as unknown as {
      _dispatcher?: { _worker?: { _bridge?: { driver?: { loki?: { close: () => void } } } } };
    }
  )._dispatcher;
  return viaBridge?._worker?._bridge?.driver?.loki ?? null;
}

function makeRepository(): WatermelonItemRepository {
  dbCounter += 1;
  const adapter = new LokiJSAdapter({
    dbName: `test-export-data-${dbCounter}`,
    schema,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  createdAdapters.push(adapter);
  const database = new Database({
    adapter,
    modelClasses: [ItemModel, TagModel, ItemTagModel, ReminderModel],
  });
  return new WatermelonItemRepository(database);
}

afterAll(() => {
  for (const adapter of createdAdapters) {
    extractLokiHandle(adapter)?.close();
  }
  createdAdapters.length = 0;
});

describe('数据导出集成面（listAllReminders + 列表并集 → serializeExportData）', () => {
  it('空库：listAllReminders 返回 []，导出为空负载', async () => {
    const repository = makeRepository();
    expect(await repository.listAllReminders()).toEqual([]);
    const parsed = JSON.parse(serializeExportData([], [])) as { items: unknown[] };
    expect(parsed.items).toEqual([]);
  });

  it('listAllReminders 不过滤 enabled：enabled 与禁用提醒都返回', async () => {
    const repository = makeRepository();
    const item = await repository.createItem({ type: 'task', title: '带提醒' });
    await repository.createReminder({
      itemId: item.id,
      frequency: 'daily',
      localTimeHour: 9,
      localTimeMinute: 5,
      tzid: 'Asia/Shanghai',
      startAt: 1767225600000,
      enabled: true,
    });
    await repository.createReminder({
      itemId: item.id,
      frequency: 'weekly',
      localTimeHour: 20,
      localTimeMinute: 30,
      weekdays: [1, 3],
      tzid: 'Asia/Shanghai',
      startAt: 1767312000000,
      enabled: false,
    });

    const all = await repository.listAllReminders();
    expect(all).toHaveLength(2);
    expect(all.map((reminder) => [reminder.frequency, reminder.enabled])).toEqual([
      ['daily', true],
      ['weekly', false],
    ]);
  });

  it('决策 B 全链路：归档条目经并集进入导出，提醒摘要挂到条目下且无调度器内部字段', async () => {
    const repository = makeRepository();
    const item = await repository.createItem({ type: 'task', title: '交房租', content: '每月 1 日' });
    await repository.addTagToItem(item.id, '固定支出');
    await repository.createReminder({
      itemId: item.id,
      frequency: 'monthly',
      localTimeHour: 8,
      localTimeMinute: 0,
      dayOfMonth: 1,
      tzid: 'Asia/Shanghai',
      startAt: 1767225600000,
      enabled: true,
    });
    await repository.archiveItem(item.id);

    const [defaultItems, archivedItems, allReminders] = await Promise.all([
      repository.listItemsWithTags(),
      repository.listArchivedItemsWithTags(),
      repository.listAllReminders(),
    ]);
    // 归档后：默认列表为空、归档列表有它（并集是导出范围的来源）。
    expect(defaultItems).toHaveLength(0);
    expect(archivedItems.map((entry) => entry.title)).toEqual(['交房租']);

    const json = serializeExportData([...defaultItems, ...archivedItems], allReminders);
    const parsed = JSON.parse(json) as {
      version: number;
      items: Array<{
        title: string;
        status: string;
        tags: string[];
        reminders: Array<Record<string, unknown>>;
      }>;
    };
    expect(parsed.version).toBe(1);
    expect(parsed.items).toHaveLength(1);
    const exported = parsed.items[0];
    expect(exported?.title).toBe('交房租');
    expect(exported?.status).toBe('archived');
    expect(exported?.tags).toEqual(['固定支出']);
    expect(exported?.reminders).toHaveLength(1);
    // 摘要字段齐全、调度器内部字段与 id/itemId 已剔除（toEqual 全量校验）。
    expect(exported?.reminders[0]).toEqual({
      frequency: 'monthly',
      localTime: '08:00',
      weekdays: [],
      dayOfMonth: 1,
      tzid: 'Asia/Shanghai',
      startAt: 1767225600000,
      enabled: true,
    });
  });
});
