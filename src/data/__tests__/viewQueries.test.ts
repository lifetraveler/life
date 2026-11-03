import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import ItemModel from '../../db/models/ItemModel';
import ItemTagModel from '../../db/models/ItemTagModel';
import ReminderModel from '../../db/models/ReminderModel';
import TagModel from '../../db/models/TagModel';
import { schema } from '../../db/schema';
import { WatermelonItemRepository } from '../WatermelonItemRepository';
import type { Item } from '../../domain/item';
import type { ItemWithTags } from '../../domain/tag';

/**
 * 切片 7 视图查询单测（repository.md「视图查询接口（v0.7）」）。
 *
 * 用真实 WatermelonDB + LokiJS 内存适配器跑查询语义（不 mock 查询层），
 * 便于验证「条件是否真的落在查询里」而非内存过滤。Loki 与 SQLite 的空值
 * 语义在 WatermelonDB encodeQuery 中已对齐（lt/notIn 自带 not-null 守卫，
 * eq null 匹配缺失字段），本项目所有时间戳均为正数，gt 的宽松空值处理
 * （null → 0）不会产生差异。
 */

let dbCounter = 0;

// LokiJS 默认开启 500ms autosave（lokiExtensions.js），setInterval 会挂住 Node 事件循环，
// 使 jest 进程无法自然退出；测试结束后必须对每个实例调用 loki.close() 释放。
// 注意 _driver 由适配器 setUp 异步赋值，构造后立刻读是 undefined，因此惰性解析；
// jest 下 driver 也可能挂在 _dispatcher._worker._bridge.driver，两条路径都兜住。
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
    dbName: `test-view-queries-${dbCounter}`,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** createItem 的 createdAt 由 WatermelonDB 自动写 Date.now()；间隔制造 createdAt 差以保证排序确定性。 */
async function createItems(
  repository: WatermelonItemRepository,
  specs: Array<{
    title: string;
    startAt?: number | null;
    endAt?: number | null;
    allDay?: boolean;
  }>,
): Promise<Item[]> {
  const created: Item[] = [];
  for (const spec of specs) {
    created.push(
      await repository.createItem({
        type: 'task',
        title: spec.title,
        startAt: spec.startAt ?? null,
        endAt: spec.endAt ?? null,
        allDay: spec.allDay,
      }),
    );
    await sleep(5);
  }
  return created;
}

const byTitle = (items: ItemWithTags[]): string[] => items.map((item) => item.title);

// —— listScheduledItemsInRange ——

describe('listScheduledItemsInRange', () => {
  const RS = 1_000;
  const RE = 2_000;

  it('startAt ∈ [rs, re) 命中；边界：startAt = rs 含、startAt = re 不含', async () => {
    const repository = makeRepository();
    await createItems(repository, [
      { title: 'at-rs', startAt: RS, endAt: null },
      { title: 'inside', startAt: 1_500, endAt: null },
      { title: 'at-re', startAt: RE, endAt: null },
      { title: 'after', startAt: RE + 1, endAt: null },
    ]);

    const found = await repository.listScheduledItemsInRange(RS, RE);
    expect(byTitle(found).sort()).toEqual(['at-rs', 'inside']);
  });

  it('跨天项（startAt < rs 且 endAt > rs）命中；endAt = rs 不含；endAt null / endAt < rs 不含', async () => {
    const repository = makeRepository();
    await createItems(repository, [
      { title: 'cross-day', startAt: 500, endAt: 1_600 },
      { title: 'end-at-rs', startAt: 500, endAt: RS },
      { title: 'no-end', startAt: 500, endAt: null },
      { title: 'ended-before', startAt: 500, endAt: 900 },
    ]);

    const found = await repository.listScheduledItemsInRange(RS, RE);
    expect(byTitle(found)).toEqual(['cross-day']);
  });

  it('未安排（startAt null）不命中', async () => {
    const repository = makeRepository();
    await createItems(repository, [{ title: 'unscheduled', startAt: null, endAt: null }]);

    const found = await repository.listScheduledItemsInRange(RS, RE);
    expect(found).toEqual([]);
  });

  it('done/active 命中，archived 排除', async () => {
    const repository = makeRepository();
    const created = await createItems(repository, [
      { title: 'active', startAt: 1_500, endAt: null },
      { title: 'done', startAt: 1_500, endAt: null },
      { title: 'archived', startAt: 1_500, endAt: null },
    ]);
    await repository.updateItem(created[1].id, { status: 'done' });
    await repository.archiveItem(created[2].id);

    const found = await repository.listScheduledItemsInRange(RS, RE);
    expect(byTitle(found).sort()).toEqual(['active', 'done']);
  });

  it('排序：startAt 升序；startAt 相同按 created_at 升序（创建顺序）', async () => {
    const repository = makeRepository();
    await createItems(repository, [
      { title: 'b-late', startAt: 1_500, endAt: null },
      { title: 'a-early', startAt: 1_200, endAt: null },
      { title: 'tie-1', startAt: 1_100, endAt: null },
      { title: 'tie-2', startAt: 1_100, endAt: null },
    ]);

    const found = await repository.listScheduledItemsInRange(RS, RE);
    expect(byTitle(found)).toEqual(['tie-1', 'tie-2', 'a-early', 'b-late']);
  });

  it('observeScheduledItemsInRange：初次发射 + 范围内新增触发刷新 + 退订后不再发射', async () => {
    const repository = makeRepository();
    await createItems(repository, [{ title: 'initial', startAt: 1_500, endAt: null }]);

    const emissions: ItemWithTags[][] = [];
    // FIFO 等待队列：每次发射按顺序唤醒最早挂起的 next()，
    // 避免单槽位被后续 next() 覆盖导致 resolver 丢失。
    const waiters: Array<(value: ItemWithTags[]) => void> = [];
    const onNext = (items: ItemWithTags[]): void => {
      emissions.push(items);
      const waiter = waiters.shift();
      waiter?.(items);
    };
    // Loki 同步 worker 下初次发射会在 subscribe() 调用内同步到达，
    // 因此必须在订阅前挂好 resolver，否则错过发射导致悬挂。
    const next = (): Promise<ItemWithTags[]> =>
      new Promise<ItemWithTags[]>((resolve) => {
        waiters.push(resolve);
      });

    const initialPromise = next();
    const addedPromise = next();
    const unsubscribe = repository.observeScheduledItemsInRange(RS, RE, onNext);
    try {
      const initial = await initialPromise;
      expect(byTitle(initial)).toEqual(['initial']);

      await createItems(repository, [{ title: 'added', startAt: 1_600, endAt: null }]);
      const updated = await addedPromise;
      expect(byTitle(updated).sort()).toEqual(['added', 'initial']);

      // 范围外新增不触发该查询发射
      await createItems(repository, [{ title: 'outside', startAt: 9_999, endAt: null }]);
      await expect(
        Promise.race([next(), sleep(80).then(() => 'timeout')]),
      ).resolves.toBe('timeout');

      unsubscribe();
      await createItems(repository, [{ title: 'after-unsub', startAt: 1_700, endAt: null }]);
      await sleep(50);
      expect(emissions).toHaveLength(2);
    } finally {
      unsubscribe();
    }
  });

  it('observeScheduledItemsInRange：集合内 status 翻转（active→done）触发重发射，行仍按 startAt 升序', async () => {
    const repository = makeRepository();
    const created = await createItems(repository, [
      { title: 'a-early', startAt: 1_200, endAt: null },
      { title: 'b-late', startAt: 1_500, endAt: null },
    ]);

    // FIFO 等待队列与同步首发射处理同上。
    const waiters: Array<(value: ItemWithTags[]) => void> = [];
    const next = (): Promise<ItemWithTags[]> =>
      new Promise<ItemWithTags[]>((resolve) => {
        waiters.push(resolve);
      });
    const onNext = (items: ItemWithTags[]): void => {
      const waiter = waiters.shift();
      waiter?.(items);
    };

    const initialPromise = next();
    const flipPromise = next();
    const unsubscribe = repository.observeScheduledItemsInRange(RS, RE, onNext);
    try {
      const initial = await initialPromise;
      expect(byTitle(initial)).toEqual(['a-early', 'b-late']);

      // Query.observe() 只在匹配集合成员变化时发射（processChangeSet）；status 在
      // active|done 之间翻转不改变成员资格，必须依赖 observeWithColumns 捕获字段级变化。
      await repository.updateItem(created[0].id, { status: 'done' });
      const flipped = await Promise.race([
        flipPromise,
        sleep(500).then((): 'timeout' => 'timeout'),
      ]);
      if (flipped === 'timeout') {
        throw new Error('status flip did not trigger re-emission');
      }
      // Repository 契约只按 startAt↑ 排序（done-last 是 domain 分组 groupItemsForView 的职责）。
      expect(flipped.map((item) => [item.title, item.status])).toEqual([
        ['a-early', 'done'],
        ['b-late', 'active'],
      ]);
    } finally {
      unsubscribe();
    }
  });
});

// —— listOverdueItems ——

describe('listOverdueItems', () => {
  const NOW = 1_500;

  it('endAt < now 且 active 命中；endAt = now 不含（严格小于）；endAt null 不含', async () => {
    const repository = makeRepository();
    await createItems(repository, [
      { title: 'overdue', startAt: 100, endAt: NOW - 1 },
      { title: 'at-now', startAt: 100, endAt: NOW },
      { title: 'future', startAt: 100, endAt: NOW + 1 },
      { title: 'no-end', startAt: 100, endAt: null },
    ]);

    const found = await repository.listOverdueItems(NOW);
    expect(byTitle(found)).toEqual(['overdue']);
  });

  it('done 与 archived 排除（仅 active）', async () => {
    const repository = makeRepository();
    const created = await createItems(repository, [
      { title: 'active-overdue', startAt: 100, endAt: 1_400 },
      { title: 'done-overdue', startAt: 100, endAt: 1_400 },
      { title: 'archived-overdue', startAt: 100, endAt: 1_400 },
    ]);
    await repository.updateItem(created[1].id, { status: 'done' });
    await repository.archiveItem(created[2].id);

    const found = await repository.listOverdueItems(NOW);
    expect(byTitle(found)).toEqual(['active-overdue']);
  });

  it('排序：endAt 升序；endAt 相同按 created_at 升序', async () => {
    const repository = makeRepository();
    await createItems(repository, [
      { title: 'late', startAt: 100, endAt: 1_400 },
      { title: 'early', startAt: 100, endAt: 1_200 },
      { title: 'tie-1', startAt: 100, endAt: 1_300 },
      { title: 'tie-2', startAt: 100, endAt: 1_300 },
    ]);

    const found = await repository.listOverdueItems(NOW);
    expect(byTitle(found)).toEqual(['early', 'tie-1', 'tie-2', 'late']);
  });

  it('observeOverdueItems：完成后（status → done）下次发射移除', async () => {
    const repository = makeRepository();
    const created = await createItems(repository, [
      { title: 'overdue', startAt: 100, endAt: 1_400 },
    ]);

    const emissions: ItemWithTags[][] = [];
    // FIFO 等待队列：每次发射按顺序唤醒最早挂起的 next()，
    // 避免单槽位被后续 next() 覆盖导致 resolver 丢失。
    const waiters: Array<(value: ItemWithTags[]) => void> = [];
    const onNext = (items: ItemWithTags[]): void => {
      emissions.push(items);
      const waiter = waiters.shift();
      waiter?.(items);
    };
    const next = (): Promise<ItemWithTags[]> =>
      new Promise<ItemWithTags[]>((resolve) => {
        waiters.push(resolve);
      });

    const initialPromise = next();
    const afterDonePromise = next();
    const unsubscribe = repository.observeOverdueItems(NOW, onNext);
    try {
      const initial = await initialPromise;
      expect(byTitle(initial)).toEqual(['overdue']);

      await repository.updateItem(created[0].id, { status: 'done' });
      const updated = await afterDonePromise;
      expect(byTitle(updated)).toEqual([]);
    } finally {
      unsubscribe();
    }
  });
});

// —— listUnscheduledItemsCreatedInRange ——

describe('listUnscheduledItemsCreatedInRange', () => {
  it('startAt null 且 createdAt ∈ [rs, re) 且 active 命中；边界：createdAt = rs 含、= re 不含', async () => {
    const repository = makeRepository();
    const created = await createItems(repository, [
      { title: 'a', startAt: null, endAt: null },
      { title: 'b', startAt: null, endAt: null },
    ]);
    const aCreated = created[0].createdAt;
    const bCreated = created[1].createdAt;
    expect(bCreated).toBeGreaterThan(aCreated);

    // a 的 createdAt 为左端点（含），b 的 createdAt 为右端点（不含）
    const found = await repository.listUnscheduledItemsCreatedInRange(aCreated, bCreated);
    expect(byTitle(found)).toEqual(['a']);
  });

  it('startAt 非 null 的项即使 createdAt 在范围内也不命中', async () => {
    const repository = makeRepository();
    const created = await createItems(repository, [
      { title: 'unscheduled', startAt: null, endAt: null },
      { title: 'scheduled', startAt: 1_000, endAt: null },
    ]);
    const rs = created[0].createdAt - 1;
    const re = created[1].createdAt + 1;

    const found = await repository.listUnscheduledItemsCreatedInRange(rs, re);
    expect(byTitle(found)).toEqual(['unscheduled']);
  });

  it('done / archived 排除（仅 active）', async () => {
    const repository = makeRepository();
    const created = await createItems(repository, [
      { title: 'active', startAt: null, endAt: null },
      { title: 'done', startAt: null, endAt: null },
      { title: 'archived', startAt: null, endAt: null },
    ]);
    await repository.updateItem(created[1].id, { status: 'done' });
    await repository.archiveItem(created[2].id);
    const rs = created[0].createdAt - 1;
    const re = created[2].createdAt + 1;

    const found = await repository.listUnscheduledItemsCreatedInRange(rs, re);
    expect(byTitle(found)).toEqual(['active']);
  });

  it('排序：createdAt 降序（后创建在前）', async () => {
    const repository = makeRepository();
    const created = await createItems(repository, [
      { title: 'first', startAt: null, endAt: null },
      { title: 'second', startAt: null, endAt: null },
      { title: 'third', startAt: null, endAt: null },
    ]);
    const rs = created[0].createdAt - 1;
    const re = created[2].createdAt + 1;

    const found = await repository.listUnscheduledItemsCreatedInRange(rs, re);
    expect(byTitle(found)).toEqual(['third', 'second', 'first']);
  });

  it('observeUnscheduledItemsCreatedInRange：完成后下次发射移除', async () => {
    const repository = makeRepository();
    const created = await createItems(repository, [{ title: 'created', startAt: null, endAt: null }]);
    const rs = created[0].createdAt - 1;
    const re = created[0].createdAt + 1;

    const emissions: ItemWithTags[][] = [];
    // FIFO 等待队列：每次发射按顺序唤醒最早挂起的 next()，
    // 避免单槽位被后续 next() 覆盖导致 resolver 丢失。
    const waiters: Array<(value: ItemWithTags[]) => void> = [];
    const onNext = (items: ItemWithTags[]): void => {
      emissions.push(items);
      const waiter = waiters.shift();
      waiter?.(items);
    };
    const next = (): Promise<ItemWithTags[]> =>
      new Promise<ItemWithTags[]>((resolve) => {
        waiters.push(resolve);
      });

    // Loki 同步 worker 下初次发射会在 subscribe() 调用内同步到达，
    // 因此必须在订阅前挂好 resolver，否则错过发射导致悬挂。
    const initialPromise = next();
    const afterDonePromise = next();
    const unsubscribe = repository.observeUnscheduledItemsCreatedInRange(rs, re, onNext);
    try {
      const initial = await initialPromise;
      expect(byTitle(initial)).toEqual(['created']);

      await repository.updateItem(created[0].id, { status: 'done' });
      const updated = await afterDonePromise;
      expect(byTitle(updated)).toEqual([]);
    } finally {
      unsubscribe();
    }
  });
});
