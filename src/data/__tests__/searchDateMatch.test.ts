import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import ItemModel from '../../db/models/ItemModel';
import ItemTagModel from '../../db/models/ItemTagModel';
import ReminderModel from '../../db/models/ReminderModel';
import CategoryModel from '../../db/models/CategoryModel';
import AppSettingsModel from '../../db/models/AppSettingsModel';
import TagModel from '../../db/models/TagModel';
import { schema } from '../../db/schema';
import { WatermelonItemRepository } from '../WatermelonItemRepository';
import type { Item } from '../../domain/item';
import type { ItemWithTags } from '../../domain/tag';

/**
 * 切片 12 搜索日期匹配单测（repository.md v0.12 搜索范围扩展）。
 *
 * 与 viewQueries.test.ts 同款夹具：真实 WatermelonDB + LokiJS 内存适配器，
 * 验证匹配语义而非内存过滤。时区经构造器注入固定为 Asia/Shanghai
 * （验收：预期值不依赖 process.env.TZ）；测试用时刻一律用 Date.UTC 显式构造。
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
    dbName: `test-search-date-${dbCounter}`,
    schema,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  createdAdapters.push(adapter);
  const database = new Database({
    adapter,
    modelClasses: [
      ItemModel,
      TagModel,
      ItemTagModel,
      ReminderModel,
      // 切片 14（§7.22）：seedPresetData 需要 categories/app_settings model，未注册则 db.get 返回 null
      CategoryModel,
      AppSettingsModel,
    ],
  });
  return new WatermelonItemRepository(database, () => 'Asia/Shanghai');
}

afterAll(() => {
  for (const adapter of createdAdapters) {
    extractLokiHandle(adapter)?.close();
  }
  createdAdapters.length = 0;
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Asia/Shanghai 民用时间 → 绝对毫秒（上海现代年份固定 +08:00，无 DST）。 */
function shanghaiInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  return Date.UTC(year, month - 1, day, hour, minute) - 8 * 60 * 60 * 1000;
}

async function createItems(
  repository: WatermelonItemRepository,
  specs: Array<{
    title: string;
    startAt?: number | null;
    endAt?: number | null;
    allDay?: boolean;
    tags?: string[];
  }>,
): Promise<Item[]> {
  const created: Item[] = [];
  for (const spec of specs) {
    const item = await repository.createItem({
      type: 'task',
      title: spec.title,
      startAt: spec.startAt ?? null,
      endAt: spec.endAt ?? null,
      allDay: spec.allDay,
    });
    for (const tag of spec.tags ?? []) {
      await repository.addTagToItem(item.id, tag);
    }
    created.push(item);
    await sleep(5);
  }
  return created;
}

const byTitle = (items: ItemWithTags[]): string[] => items.map((item) => item.title);

describe('searchItems 日期片段匹配（v0.12）', () => {
  it('「2026-11」命中月：Shanghai 11 月的项命中；10 月、2025 年、未安排项不命中', async () => {
    const repository = makeRepository();
    await createItems(repository, [
      { title: 'nov-item', startAt: shanghaiInstant(2026, 11, 5, 9, 0) },
      { title: 'oct-item', startAt: shanghaiInstant(2026, 10, 5, 9, 0) },
      { title: 'last-year', startAt: shanghaiInstant(2025, 11, 5, 9, 0) },
      { title: 'unscheduled', startAt: null, endAt: null },
    ]);

    const found = await repository.searchItems('2026-11');
    expect(byTitle(found).sort()).toEqual(['nov-item']);
  });

  it('「11-05」命中当天：跨年份命中，前一天不命中', async () => {
    const repository = makeRepository();
    await createItems(repository, [
      { title: 'this-year', startAt: shanghaiInstant(2026, 11, 5, 9, 0) },
      { title: 'last-year', startAt: shanghaiInstant(2025, 11, 5, 9, 0) },
      { title: 'next-day', startAt: shanghaiInstant(2026, 11, 6, 9, 0) },
    ]);

    const found = await repository.searchItems('11-05');
    expect(byTitle(found).sort()).toEqual(['last-year', 'this-year']);
  });

  it('endAt 单独命中（startAt 为 null）', async () => {
    const repository = makeRepository();
    await createItems(repository, [
      { title: 'ends-on-day', startAt: null, endAt: shanghaiInstant(2026, 11, 5, 18, 0) },
      { title: 'ends-other-day', startAt: null, endAt: shanghaiInstant(2026, 11, 6, 18, 0) },
    ]);

    const found = await repository.searchItems('2026-11-05');
    expect(byTitle(found)).toEqual(['ends-on-day']);
  });

  it('allDay 项按设备时区日期命中（createItem 归一为 Asia/Shanghai 当天 00:00）', async () => {
    const repository = makeRepository();
    await createItems(repository, [
      { title: 'all-day-item', startAt: shanghaiInstant(2026, 11, 5, 12, 0), allDay: true },
    ]);

    const found = await repository.searchItems('2026-11-05');
    expect(byTitle(found)).toEqual(['all-day-item']);
  });

  it('非日期关键词完全不触发日期路径：日期不在标题/内容/标签中的项不出现', async () => {
    const repository = makeRepository();
    await createItems(repository, [
      { title: '买牛奶', startAt: shanghaiInstant(2026, 11, 5, 9, 0) },
      { title: '交房租', startAt: shanghaiInstant(2026, 11, 6, 9, 0) },
    ]);

    // 「买」走 title LIKE，只命中第一条——与 v0.11 行为一致
    expect(byTitle(await repository.searchItems('买'))).toEqual(['买牛奶']);
    // 非日期关键词（含日期无关数字形态）不命中任何项
    expect(await repository.searchItems('2027')).toEqual([]);
    expect(await repository.searchItems('13-01')).toEqual([]);
  });

  it('日期关键词仍走 LIKE 文本腿：标题含日期文本的项命中且与日期腿去重', async () => {
    const repository = makeRepository();
    await createItems(repository, [
      { title: '周会 2026-11-05 复盘', startAt: shanghaiInstant(2026, 11, 5, 9, 0) },
    ]);

    const found = await repository.searchItems('2026-11-05');
    expect(byTitle(found)).toEqual(['周会 2026-11-05 复盘']);
    expect(found).toHaveLength(1);
  });

  it('标签腿与日期腿并集：标签名「2026」命中的无日期项与日期命中项都返回', async () => {
    const repository = makeRepository();
    await createItems(repository, [
      { title: 'tagged', tags: ['2026'] },
      { title: 'dated', startAt: shanghaiInstant(2026, 3, 1, 9, 0) },
      { title: 'neither', startAt: shanghaiInstant(2025, 3, 1, 9, 0) },
    ]);

    const found = await repository.searchItems('2026');
    expect(byTitle(found).sort()).toEqual(['dated', 'tagged']);
  });

  it('archived 项日期命中（与文本腿一致，不过滤 status）', async () => {
    const repository = makeRepository();
    const created = await createItems(repository, [
      { title: 'archived-on-day', startAt: shanghaiInstant(2026, 11, 5, 9, 0) },
    ]);
    await repository.archiveItem(created[0].id);

    const found = await repository.searchItems('2026-11-05');
    expect(byTitle(found)).toEqual(['archived-on-day']);
  });

  it('多命中按 updatedAt 降序（后创建在前）', async () => {
    const repository = makeRepository();
    await createItems(repository, [
      { title: 'first-created', startAt: shanghaiInstant(2026, 11, 5, 9, 0) },
      { title: 'second-created', startAt: shanghaiInstant(2026, 11, 5, 10, 0) },
      { title: 'third-created', startAt: shanghaiInstant(2026, 11, 5, 11, 0) },
    ]);

    const found = await repository.searchItems('11-05');
    expect(byTitle(found)).toEqual(['third-created', 'second-created', 'first-created']);
  });

  it('空关键词返回 []（不触发日期路径）', async () => {
    const repository = makeRepository();
    await createItems(repository, [
      { title: 'dated', startAt: shanghaiInstant(2026, 11, 5, 9, 0) },
    ]);

    expect(await repository.searchItems('')).toEqual([]);
    expect(await repository.searchItems('   ')).toEqual([]);
  });
});
