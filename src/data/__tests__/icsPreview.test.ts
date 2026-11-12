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
import type { ImportedItemInput } from '../../domain/item';

/**
 * 切片 17 阶段 1（AGENTS.md §7.28 导入预览的仓库层支撑）：generateIcsPreview 单测。
 * 覆盖：复用 parseIcs（解析结果透传）、uid→existingItemId 去重标记、sourceUid=null
 * 恒不标重、duplicateCount 统计、failures/sameFileDuplicates 透传、纯读不落库。
 * 判定键与 importItemsInBatches 的 skippedDuplicate 同键（预览=实际落库行为）。
 */

let dbCounter = 0;

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
    dbName: `test-ics-preview-${dbCounter}`,
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
      CategoryModel,
      AppSettingsModel,
    ],
  });
  return new WatermelonItemRepository(database, () => 'UTC');
}

afterAll(() => {
  for (const adapter of createdAdapters) {
    extractLokiHandle(adapter)?.close();
  }
  createdAdapters.length = 0;
});

const EVT = (body: string): string =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//test//EN', body, 'END:VCALENDAR'].join(
    '\r\n',
  );

const VEVENT = (inner: string[]): string =>
  ['BEGIN:VEVENT', ...inner, 'END:VEVENT'].join('\r\n');

// 与 parseIcs.test.ts 相同锚点：2026-11-10 10:30 Asia/Shanghai → 02:30Z
const START_AT = Date.UTC(2026, 10, 10, 2, 30);

function makeImportInput(overrides: Partial<ImportedItemInput> = {}): ImportedItemInput {
  return {
    title: '已有 ICS 事件',
    content: '来自 ICS',
    startAt: START_AT,
    endAt: START_AT + 3_600_000,
    allDay: false,
    sourceUid: 'uid-existing',
    ...overrides,
  };
}

describe('generateIcsPreview（切片 17 阶段 1）', () => {
  it('全新文件：全部 entries isDuplicate=false、existingItemId=null、duplicateCount=0', async () => {
    const repository = makeRepository();
    const icsText = EVT(
      [
        VEVENT(['UID:evt-1', 'SUMMARY:事件一', 'DTSTART:20261110T103000']),
        VEVENT(['UID:evt-2', 'SUMMARY:事件二', 'DTSTART:20261111T103000']),
      ].join('\r\n'),
    );

    const preview = await repository.generateIcsPreview(icsText, 'UTC');

    expect(preview.entries).toHaveLength(2);
    expect(preview.entries.map((entry) => entry.input.title)).toEqual(['事件一', '事件二']);
    for (const entry of preview.entries) {
      expect(entry.isDuplicate).toBe(false);
      expect(entry.existingItemId).toBeNull();
      expect(entry.floating).toBe(true); // 无 TZID 非 UTC → floating
    }
    expect(preview.duplicateCount).toBe(0);
    expect(preview.failures).toEqual([]);
    expect(preview.sameFileDuplicates).toEqual([]);
  });

  it('uid 已存在 → isDuplicate=true 且 existingItemId 指向既有项（判定键与 importItemsInBatches 同键）', async () => {
    const repository = makeRepository();
    const existing = await repository.createImportedItem(makeImportInput({ sourceUid: 'uid-dup' }));

    const icsText = EVT(
      [
        VEVENT(['UID:uid-dup', 'SUMMARY:重复事件', 'DTSTART:20261110T103000']),
        VEVENT(['UID:uid-new', 'SUMMARY:新增事件', 'DTSTART:20261111T103000']),
      ].join('\r\n'),
    );

    const preview = await repository.generateIcsPreview(icsText, 'UTC');

    expect(preview.entries).toHaveLength(2);
    const dup = preview.entries.find((entry) => entry.input.sourceUid === 'uid-dup');
    const fresh = preview.entries.find((entry) => entry.input.sourceUid === 'uid-new');
    expect(dup?.isDuplicate).toBe(true);
    expect(dup?.existingItemId).toBe(existing.id);
    expect(fresh?.isDuplicate).toBe(false);
    expect(fresh?.existingItemId).toBeNull();
    expect(preview.duplicateCount).toBe(1);
  });

  it('sourceUid=null 的 ICS 事件恒不标重（无 UID 不去重）', async () => {
    const repository = makeRepository();
    // 先落一条 sourceUid=null 的项（每次都是新项），再预览一个无 UID 的事件
    await repository.createImportedItem(makeImportInput({ sourceUid: null }));

    const icsText = EVT(VEVENT(['SUMMARY:无UID事件', 'DTSTART:20261110T103000']));
    const preview = await repository.generateIcsPreview(icsText, 'UTC');

    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0]?.isDuplicate).toBe(false);
    expect(preview.entries[0]?.existingItemId).toBeNull();
    expect(preview.duplicateCount).toBe(0);
  });

  it('解析失败事件进 failures、同文件重复 UID 进 sameFileDuplicates（parseIcs 结果透传）', async () => {
    const repository = makeRepository();
    const icsText = EVT(
      [
        VEVENT(['UID:evt-same-1', 'SUMMARY:首条', 'DTSTART:20261110T103000']),
        VEVENT(['UID:evt-same-1', 'SUMMARY:同文件重复', 'DTSTART:20261111T103000']),
        // 日期缺失 → parseIcs 单事件失败不抛，进 failures
        VEVENT(['UID:evt-broken', 'SUMMARY:坏事件']),
      ].join('\r\n'),
    );

    const preview = await repository.generateIcsPreview(icsText, 'UTC');

    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0]?.input.title).toBe('首条');
    expect(preview.sameFileDuplicates).toEqual([
      { uid: 'evt-same-1', summary: '同文件重复' },
    ]);
    expect(preview.failures).toHaveLength(1);
    expect(preview.failures[0]?.summary).toBe('坏事件');
    expect(typeof preview.failures[0]?.reason).toBe('string');
    expect(preview.duplicateCount).toBe(0);
  });

  it('预览是纯读操作：调用前后 items 总数不变', async () => {
    const repository = makeRepository();
    const existing = await repository.createImportedItem(makeImportInput({ sourceUid: 'uid-x' }));
    const before = await repository.listItemsForExport({ includeArchived: false, includeDone: true });

    const icsText = EVT(
      [
        VEVENT(['UID:uid-x', 'SUMMARY:重复', 'DTSTART:20261110T103000']),
        VEVENT(['UID:uid-y', 'SUMMARY:新事件', 'DTSTART:20261111T103000']),
      ].join('\r\n'),
    );
    const preview = await repository.generateIcsPreview(icsText, 'UTC');

    const after = await repository.listItemsForExport({ includeArchived: false, includeDone: true });
    expect(after).toHaveLength(before.length);
    expect(preview.duplicateCount).toBe(1);
    expect(preview.entries[0]?.existingItemId).toBe(existing.id);
  });
});
