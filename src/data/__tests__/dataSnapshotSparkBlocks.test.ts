/**
 * 数据快照 Spark 可选三块仓库级行为测试（切片 37 阶段 1，AGENTS.md §7.49 D5；
 * repository.md v0.43 注记节口径）：
 * - createDataSnapshot 追加 sparks/sparkAttachments/sparkItems 全量组包；
 * - applyDataSnapshot 三块恢复（id/时间戳保真、命中覆盖写穿、悬挂/超限/形状 skipped）；
 * - 缺块跳过（旧格式快照双向兼容，sparkAttachmentFiles 缺省）；
 * - sparkItems 块存在=权威替换（resolved sparks 删旧建新，_raw.id 保真）；
 * - 附件文件补链（事务外逐个，io 注入；失败仅计数披露）。
 */

import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { Q } from '@nozbe/watermelondb';

import { schema } from '../../db/schema';
import ItemModel from '../../db/models/ItemModel';
import ItemTagModel from '../../db/models/ItemTagModel';
import ReminderModel from '../../db/models/ReminderModel';
import CategoryModel from '../../db/models/CategoryModel';
import AppSettingsModel from '../../db/models/AppSettingsModel';
import TagModel from '../../db/models/TagModel';
import ChannelPresetModel from '../../db/models/ChannelPresetModel';
import SyncTombstoneModel from '../../db/models/SyncTombstoneModel';
import SparkModel from '../../db/models/SparkModel';
import SparkAttachmentModel from '../../db/models/SparkAttachmentModel';
import SparkItemModel from '../../db/models/SparkItemModel';
import { WatermelonItemRepository } from '../WatermelonItemRepository';
import { WatermelonSparkRepository } from '../WatermelonSparkRepository';
import type { SparkAttachmentIo } from '../SparkRepository';
import {
  parseDataSnapshot,
  serializeDataSnapshot,
  type DataSnapshot,
} from '../../domain/dataSnapshot';

let dbCounter = 0;

const createdAdapters: LokiJSAdapter[] = [];

type LokiHandle = {
  close: () => void;
  getCollection: (name: string) => { data: unknown[] } | null;
};

function extractLokiHandle(adapter: LokiJSAdapter): LokiHandle | null {
  const viaDriver = (adapter as unknown as { _driver?: { loki?: LokiHandle } })._driver;
  if (viaDriver?.loki) {
    return viaDriver.loki;
  }
  return null;
}

type StubIo = SparkAttachmentIo & { calls: string[] };

function makeStubIo(overrides: Partial<SparkAttachmentIo> = {}): StubIo {
  const calls: string[] = [];
  return {
    calls,
    copyIntoSparksDir:
      overrides.copyIntoSparksDir ??
      (async (sourceUri: string, extension: string) => ({
        uri: `/tmp/sparks/copied.${extension}`,
        fileSize: 123,
      })),
    fileExists: overrides.fileExists ?? (async () => false),
    deleteFile: overrides.deleteFile ?? (async () => undefined),
    downloadToSparksDir:
      overrides.downloadToSparksDir ??
      (async (remoteName: string) => {
        calls.push(`dl:${remoteName}`);
        return `/sparks/restored-${remoteName}`;
      }),
    deleteRemoteFile: overrides.deleteRemoteFile ?? (async () => undefined),
    uploadSparkFile:
      overrides.uploadSparkFile ??
      (async (localUri: string, originalFileName: string) => ({
        remotePath: `stub0123456789ab-${originalFileName}`,
        sha256: 'stub0123456789abcdef0123456789abcdef0123',
      })),
  };
}

const MODEL_CLASSES = [
  ItemModel,
  TagModel,
  ItemTagModel,
  ReminderModel,
  CategoryModel,
  AppSettingsModel,
  ChannelPresetModel,
  SyncTombstoneModel,
  SparkModel,
  SparkAttachmentModel,
  SparkItemModel,
];

type Harness = {
  repo: WatermelonItemRepository;
  sparkRepo: WatermelonSparkRepository;
  database: Database;
  adapter: LokiJSAdapter;
};

function makeHarness(io: SparkAttachmentIo | null = null): Harness {
  dbCounter += 1;
  const adapter = new LokiJSAdapter({
    dbName: `test-ds-spark-${dbCounter}`,
    schema,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  createdAdapters.push(adapter);
  const database = new Database({ adapter, modelClasses: MODEL_CLASSES });
  const repo = new WatermelonItemRepository(database, undefined, undefined, io);
  const sparkRepo = new WatermelonSparkRepository(database, makeStubIo());
  return { repo, sparkRepo, database, adapter };
}

/** 与 WatermelonItemRepository 内部表名常量同值（测试直查表计数用）。 */
const SPARKS_TABLE = 'sparks';
const SPARK_ATTACHMENTS_TABLE = 'spark_attachments';
const SPARK_ITEMS_TABLE = 'spark_items';

afterAll(() => {
  for (const adapter of createdAdapters) {
    extractLokiHandle(adapter)?.close();
  }
});

/** 源设备组包一份含 Spark 三块的快照（JSON round trip 模拟跨设备传输）。 */
async function buildSourceSnapshot(): Promise<{
  snapshot: DataSnapshot;
  wire: string;
  ids: { sparkId: string; itemId: string; audioId: string; imageId: string; linkId: string };
}> {
  const { repo, sparkRepo } = makeHarness();
  const item = await repo.createItem({ title: '关联计划', type: 'task' });
  const spark = await sparkRepo.createSpark({ title: '灵感一', content: '内容' });
  const audio = await sparkRepo.addAttachment(spark.id, {
    kind: 'audio',
    uri: '/sparks/src-a.m4a',
    fileSize: 1024,
    durationMs: 3000,
  });
  await sparkRepo.markAttachmentUploaded(audio.id, {
    remotePath: 'abc123def4567890-a.m4a',
    sha256: 'abc123def4567890',
  });
  const image = await sparkRepo.addAttachment(spark.id, {
    kind: 'image',
    uri: '/sparks/src-b.jpg',
    fileSize: 2048,
    width: 800,
    height: 600,
  }); // 未上云 → remotePath null
  await sparkRepo.linkSparkToItem(spark.id, item.id); // 返回 void；join 行 id 由快照组包读取
  const snapshot = await repo.createDataSnapshot();
  const linkEntry = snapshot.sparkItems?.find((entry) => entry.itemId === item.id);
  return {
    snapshot,
    wire: serializeDataSnapshot(snapshot),
    ids: { sparkId: spark.id, itemId: item.id, audioId: audio.id, imageId: image.id, linkId: linkEntry?.id ?? '' },
  };
}

describe('createDataSnapshot：可选三块组包（§7.49 D5）', () => {
  it('空库 → 三块键恒携带且为空数组；version/kind 不变', async () => {
    const { repo } = makeHarness();
    const snapshot = await repo.createDataSnapshot();
    expect(snapshot.version).toBe(1);
    expect(snapshot.kind).toBe('data');
    expect(snapshot.sparks).toEqual([]);
    expect(snapshot.sparkAttachments).toEqual([]);
    expect(snapshot.sparkItems).toEqual([]);
  });

  it('含数据 → sparks/attachments/joins 全量投影（id/remotePath/时间戳保真）', async () => {
    const { snapshot, ids } = await buildSourceSnapshot();
    expect(snapshot.sparks).toHaveLength(1);
    expect(snapshot.sparkAttachments).toHaveLength(2);
    expect(snapshot.sparkItems).toHaveLength(1);
    expect(snapshot.sparks?.[0]).toMatchObject({ id: ids.sparkId, title: '灵感一', content: '内容' });
    const audioEntry = snapshot.sparkAttachments?.find((entry) => entry.id === ids.audioId);
    expect(audioEntry).toMatchObject({
      sparkId: ids.sparkId,
      kind: 'audio',
      remotePath: 'abc123def4567890-a.m4a',
      sha256: 'abc123def4567890',
      durationMs: 3000,
    });
    const imageEntry = snapshot.sparkAttachments?.find((entry) => entry.id === ids.imageId);
    expect(imageEntry).toMatchObject({ kind: 'image', remotePath: null, width: 800, height: 600 });
    expect(snapshot.sparkItems?.[0]).toMatchObject({ sparkId: ids.sparkId, itemId: ids.itemId });
  });
});

describe('applyDataSnapshot：三块恢复（id/时间戳保真 + 计数口径）', () => {
  it('全新目标库恢复 → 行创建 id 保真 + createdAt 保真 + applied 计数；无 IO 时文件补链 0/0', async () => {
    const { wire, ids } = await buildSourceSnapshot();
    const { repo, sparkRepo, database } = makeHarness(null);
    const parsed = parseDataSnapshot(wire);
    const baseApplied = parsed.items.length + parsed.itemTags.length; // itemTags 重建 1 join
    const result = await repo.applyDataSnapshot(parsed);
    expect(result.applied).toBe(baseApplied + 1 + 2 + 1);
    expect(result.skipped).toBe(0);
    expect(result.sparkAttachmentFiles).toEqual({ restored: 0, failed: 0 });

    const spark = await sparkRepo.getSparkById(ids.sparkId);
    expect(spark).toMatchObject({ id: ids.sparkId, title: '灵感一', content: '内容' });
    expect(spark?.createdAt).toBeGreaterThan(0);
    const attachments = await sparkRepo.listAttachments(ids.sparkId);
    expect(attachments).toHaveLength(2);
    const restoredAudio = attachments.find((entry) => entry.id === ids.audioId);
    expect(restoredAudio).toMatchObject({ remotePath: 'abc123def4567890-a.m4a', fileSize: 1024 });
    // uri 暂为快照值（源设备路径），补链未注入 → 不改写
    expect(restoredAudio?.uri).toBe('/sparks/src-a.m4a');
    const joins = await database
      .get<SparkItemModel>(SPARK_ITEMS_TABLE)
      .query(Q.where('item_id', ids.itemId))
      .fetch();
    expect(joins).toHaveLength(1);
    expect(joins[0].id).toBe(ids.linkId);
    const sparkRow = await database.get<SparkModel>(SPARKS_TABLE).find(ids.sparkId);
    expect(sparkRow.createdAt.getTime()).toBe(
      parsed.sparks?.[0]?.createdAt,
    );
  });

  it('缺块（旧格式快照）→ Spark 域零改动 + sparkAttachmentFiles 缺省（双向兼容）', async () => {
    const { wire } = await buildSourceSnapshot();
    const parsed = parseDataSnapshot(wire) as Record<string, unknown> & DataSnapshot;
    delete parsed.sparks;
    delete parsed.sparkAttachments;
    delete parsed.sparkItems;
    const { repo, sparkRepo } = makeHarness();
    const result = await repo.applyDataSnapshot(parsed as DataSnapshot);
    expect(result.applied).toBe((parsed.items as unknown[]).length);
    expect(result.sparkAttachmentFiles).toBeUndefined();
    await expect(sparkRepo.listSparks()).resolves.toEqual([]);
    const reSerialized = serializeDataSnapshot(parsed as unknown as DataSnapshot);
    expect(reSerialized).not.toContain('"sparks"');
  });

  it('重复恢复同一快照 → 命中覆盖不重复建行；title/content 写穿（trim 空串归 null）', async () => {
    const { wire, ids } = await buildSourceSnapshot();
    const { repo, sparkRepo, database } = makeHarness();
    const first = parseDataSnapshot(wire);
    await repo.applyDataSnapshot(first);
    // 第二轮：改 title/content（content 改为纯空格 → 归一 null）
    const secondJson = JSON.parse(wire) as DataSnapshot;
    const sparkEntry = secondJson.sparks?.[0];
    if (sparkEntry) {
      sparkEntry.title = '  灵感一改  ';
      sparkEntry.content = '   ';
    }
    const attachmentEntry = secondJson.sparkAttachments?.find((entry) => entry.id === ids.audioId);
    if (attachmentEntry) {
      attachmentEntry.fileSize = 4096;
    }
    const second = parseDataSnapshot(JSON.stringify(secondJson));
    const result = await repo.applyDataSnapshot(second);
    // sparkItems 命中 pair 幂等保留不重建（applied 仅实际写入：sparks 1 + 附件 2）
    expect(result.applied).toBe(first.items.length + first.itemTags.length + 1 + 2 + 0);

    const spark = await sparkRepo.getSparkById(ids.sparkId);
    expect(spark?.title).toBe('灵感一改');
    expect(spark?.content).toBeNull();
    const attachments = await sparkRepo.listAttachments(ids.sparkId);
    expect(attachments).toHaveLength(2);
    expect(attachments.find((entry) => entry.id === ids.audioId)?.fileSize).toBe(4096);
    await expect(sparkRepo.listSparks()).resolves.toHaveLength(1);
    // join 行 id 稳定（pair 保留不重建）
    const joinsAfter = await database
      .get<SparkItemModel>(SPARK_ITEMS_TABLE)
      .query(Q.where('item_id', ids.itemId))
      .fetch();
    expect(joinsAfter.map((row) => row.id)).toEqual([ids.linkId]);
  });

  it('悬挂 spark_id / 超限 25MB / 形状不符附件 → 逐条 skipped 不炸整体', async () => {
    const { wire, ids } = await buildSourceSnapshot();
    const json = JSON.parse(wire) as DataSnapshot;
    const sparks = json.sparks ?? [];
    const attachments = json.sparkAttachments ?? [];
    attachments.push({
      id: 'att-dangling',
      sparkId: 'missing-spark',
      kind: 'audio',
      uri: '/x.m4a',
      remotePath: null,
      sha256: null,
      fileSize: 1,
      durationMs: null,
      width: null,
      height: null,
      createdAt: 111,
    });
    attachments.push({
      id: 'att-oversize',
      sparkId: ids.sparkId,
      kind: 'audio',
      uri: '/x.m4a',
      remotePath: null,
      sha256: null,
      fileSize: 25 * 1024 * 1024 + 1,
      durationMs: null,
      width: null,
      height: null,
      createdAt: 111,
    });
    attachments.push({ id: 'att-bad', sparkId: ids.sparkId } as unknown as DataSnapshot['sparkAttachments'] extends (infer T)[]
      ? T
      : never);
    // 悬挂 spark 条目也一并验证
    sparks.push({ id: 'spark-dangling', title: '幽灵', content: null, createdAt: 1, updatedAt: 1 });
    // 引用幽灵 spark 的 join → skipped
    (json.sparkItems ?? []).push({
      id: 'link-dangling',
      sparkId: 'missing-spark',
      itemId: ids.itemId,
      createdAt: 111,
    });
    const { repo, sparkRepo } = makeHarness();
    const result = await repo.applyDataSnapshot(parseDataSnapshot(JSON.stringify(json)));
    expect(result.skipped).toBeGreaterThanOrEqual(4); // dangling att + oversize + bad shape + dangling link
    await expect(sparkRepo.getSparkById(ids.sparkId)).resolves.toMatchObject({ title: '灵感一' });
    await expect(sparkRepo.getSparkById('spark-dangling')).resolves.toMatchObject({ title: '幽灵' });
    await expect(sparkRepo.listAttachments(ids.sparkId)).resolves.toHaveLength(2);
  });

  it('sparkItems 块存在=权威替换：本地旧 join 删除重建；空数组清空 resolved sparks 的 join', async () => {
    const { wire, ids } = await buildSourceSnapshot();
    const { repo, sparkRepo, database } = makeHarness();
    await repo.applyDataSnapshot(parseDataSnapshot(wire));
    // 本地额外关联另一条目（不在快照 sparkItems 声明中）
    const extraItem = await repo.createItem({ title: '本地新增计划', type: 'note' });
    await sparkRepo.linkSparkToItem(ids.sparkId, extraItem.id);
    expect(await sparkRepo.listItemsForSpark(ids.sparkId)).toHaveLength(2);

    // 第二轮快照：sparkItems 置空数组 → resolved spark 的 join 全清
    const json = JSON.parse(wire) as DataSnapshot;
    json.sparkItems = [];
    const result = await repo.applyDataSnapshot(parseDataSnapshot(JSON.stringify(json)));
    expect(result.applied).toBe(json.items.length + 1 + 2 + 0);
    const joinCount = await database
      .get<SparkItemModel>(SPARK_ITEMS_TABLE)
      .query(Q.where('spark_id', ids.sparkId))
      .fetchCount();
    expect(joinCount).toBe(0);
    await expect(sparkRepo.listItemsForSpark(ids.sparkId)).resolves.toEqual([]);
  });

  it('未在快照中的本地灵感：行与 join 均不受三块恢复影响', async () => {
    const { wire } = await buildSourceSnapshot();
    const { repo, sparkRepo } = makeHarness();
    await repo.applyDataSnapshot(parseDataSnapshot(wire));
    const localSpark = await sparkRepo.createSpark({ title: '本地独有' });
    const item = await repo.createItem({ title: '本地条目', type: 'note' });
    await sparkRepo.linkSparkToItem(localSpark.id, item.id);
    const localJoinId = (await sparkRepo.listItemsForSpark(localSpark.id))[0]?.itemId;

    // 再恢复一次（快照 sparkItems 声明 join-1），本地独有 join 不被误删
    await repo.applyDataSnapshot(parseDataSnapshot(wire));
    await expect(sparkRepo.getSparkById(localSpark.id)).resolves.toMatchObject({ title: '本地独有' });
    const summaries = await sparkRepo.listItemsForSpark(localSpark.id);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.itemId).toBe(localJoinId);
  });
});

describe('applyDataSnapshot：附件文件补链（io 注入，事务外逐个）', () => {
  it('本地文件缺失 → downloadToSparksDir 后回写行 uri；已存在（同机）跳过', async () => {
    const { wire, ids } = await buildSourceSnapshot();
    const io = makeStubIo({
      fileExists: async (uri: string) => uri === '/sparks/exists.jpg',
    });
    const { repo, sparkRepo } = makeHarness(io);
    // image 附件（未上云 remotePath null）不改 uri；audio 下载回写
    const result = await repo.applyDataSnapshot(parseDataSnapshot(wire));
    expect(result.sparkAttachmentFiles).toEqual({ restored: 1, failed: 0 });
    expect(io.calls).toContain('dl:abc123def4567890-a.m4a');
    const attachments = await sparkRepo.listAttachments(ids.sparkId);
    expect(attachments.find((entry) => entry.id === ids.audioId)?.uri).toBe(
      '/sparks/restored-abc123def4567890-a.m4a',
    );
    expect(attachments.find((entry) => entry.id === ids.imageId)?.uri).toBe('/sparks/src-b.jpg');
  });

  it('下载失败 → failed 计数披露，行 uri 保持快照值（可后补）', async () => {
    const { wire } = await buildSourceSnapshot();
    const io = makeStubIo({
      downloadToSparksDir: async () => {
        throw new Error('net down');
      },
    });
    const { repo, sparkRepo } = makeHarness(io);
    const result = await repo.applyDataSnapshot(parseDataSnapshot(wire));
    expect(result.sparkAttachmentFiles).toEqual({ restored: 0, failed: 1 });
    await expect(
      (async () => {
        const spark = await sparkRepo.listSparks();
        const attachments = await sparkRepo.listAttachments(spark[0]?.id ?? '');
        return attachments.find((entry) => entry.remotePath === 'abc123def4567890-a.m4a')?.uri;
      })(),
    ).resolves.toBe('/sparks/src-a.m4a');
  });
});

// 表名常量同值断言（WatermelonSparkRepository/WatermelonItemRepository 内部常量未导出，直查字面量）。
describe('表名常量同值断言', () => {
  it('SPARKS_TABLE === "sparks"', () => {
    expect(SPARKS_TABLE).toBe('sparks');
    expect(SPARK_ATTACHMENTS_TABLE).toBe('spark_attachments');
    expect(SPARK_ITEMS_TABLE).toBe('spark_items');
  });
});
