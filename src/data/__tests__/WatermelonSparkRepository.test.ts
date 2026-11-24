/**
 * WatermelonSparkRepository 单测（切片 37 阶段 1，AGENTS.md §7.49 D3/D4）：
 * 真实 WatermelonDB + LokiJS 内存适配器（configSnapshotRepository.test.ts 同款
 * harness），SparkAttachmentIo 注入 stub 不触网不触盘。覆盖：
 * - CRUD（双可空语义 trim 空串归 null、created_at 倒序、不存在抛错/幂等口径）；
 * - 附件（kind/fileSize 守卫、上限 20、上云回填、删除级联 IO 调用与失败披露）；
 * - 关联（item_id 存在性校验、幂等、上限 50、摘要水合含分类色 Emoji、悬挂跳过）；
 * - deleteSpark 全级联（附件行 + 关联行 + 本地文件 + 远端 DELETE）。
 */

import { Database, Q } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

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
import ChatMessageModel from '../../db/models/ChatMessageModel';
import { schema } from '../../db/schema';
import { WatermelonItemRepository } from '../WatermelonItemRepository';
import { WatermelonSparkRepository } from '../WatermelonSparkRepository';
import type { SparkAttachmentIo } from '../SparkRepository';
import type { CreateItemInput } from '../../domain/item';
import type { SparkAttachmentKind } from '../../domain/spark';
import { SPARK_ATTACHMENT_MAX_COUNT, SPARK_ITEM_LINK_MAX } from '../../domain/spark';

let dbCounter = 0;

const createdAdapters: LokiJSAdapter[] = [];

type LokiHandle = { close: () => void };

function extractLokiHandle(adapter: LokiJSAdapter): LokiHandle | null {
  const viaDriver = (adapter as unknown as { _driver?: { loki?: LokiHandle } })._driver;
  if (viaDriver?.loki) return viaDriver.loki;
  const viaBridge = (
    adapter as unknown as {
      _dispatcher?: { _worker?: { _bridge?: { driver?: { loki?: LokiHandle } } } };
    }
  )._dispatcher;
  return viaBridge?._worker?._bridge?.driver?.loki ?? null;
}

function makeStubIo(overrides: Partial<SparkAttachmentIo> = {}): SparkAttachmentIo & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    copyIntoSparksDir: async (sourceUri, extension) => {
      calls.push(`copy:${sourceUri}:${extension}`);
      return { uri: `/tmp/sparks/copied.${extension}`, fileSize: 123 };
    },
    fileExists: async (uri) => {
      calls.push(`exists:${uri}`);
      return true;
    },
    deleteFile: async (uri) => {
      calls.push(`rm:${uri}`);
    },
    downloadToSparksDir: async (remoteName) => {
      calls.push(`dl:${remoteName}`);
      return `/tmp/sparks/${remoteName}`;
    },
    deleteRemoteFile: async (remoteName) => {
      calls.push(`rdrm:${remoteName}`);
    },
    uploadSparkFile: async (localUri, originalFileName) => {
      calls.push(`up:${localUri}:${originalFileName}`);
      return { remotePath: `stub0123456789ab-${originalFileName}`, sha256: 'stub0123456789abcdef0123456789abcdef0123' };
    },
    ...overrides,
  };
}

function makeHarness(): {
  sparkRepo: WatermelonSparkRepository;
  itemRepo: WatermelonItemRepository;
  io: SparkAttachmentIo & { calls: string[] };
  database: Database;
} {
  dbCounter += 1;
  const adapter = new LokiJSAdapter({
    dbName: `test-spark-repo-${dbCounter}`,
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
      ChannelPresetModel,
      SyncTombstoneModel,
      SparkModel,
      SparkAttachmentModel,
      SparkItemModel,
      ChatMessageModel,
    ],
  });
  const io = makeStubIo();
  return {
    sparkRepo: new WatermelonSparkRepository(database, io),
    itemRepo: new WatermelonItemRepository(database),
    io,
    database,
  };
}

afterAll(() => {
  for (const adapter of createdAdapters) {
    extractLokiHandle(adapter)?.close();
  }
});

function makeCreateInput(title: string): CreateItemInput {
  return {
    title,
    content: '',
    type: 'note',
    categoryId: null,
    priority: 0,
  };
}

describe('createSpark / updateSpark / listSparks（双可空语义）', () => {
  it('title/content 同时缺省 → 双 null（录音流程合法状态）', async () => {
    const { sparkRepo } = makeHarness();
    const spark = await sparkRepo.createSpark({});
    expect(spark.title).toBeNull();
    expect(spark.content).toBeNull();
    expect(spark.createdAt).toBeGreaterThan(0);
    expect(spark.updatedAt).toBeGreaterThan(0);
  });

  it('trim 空串归 null；updateSpark 只改提供的字段', async () => {
    const { sparkRepo } = makeHarness();
    const spark = await sparkRepo.createSpark({ title: '  ', content: '想法' });
    expect(spark.title).toBeNull();
    expect(spark.content).toBe('想法');

    const updated = await sparkRepo.updateSpark(spark.id, { title: '新标题' });
    expect(updated.title).toBe('新标题');
    expect(updated.content).toBe('想法');
  });

  it('updateSpark 不存在抛错；getSparkById 不存在返回 null', async () => {
    const { sparkRepo } = makeHarness();
    await expect(sparkRepo.updateSpark('missing', { title: 'x' })).rejects.toThrow(
      'updateSpark: 灵感不存在（missing）',
    );
    await expect(sparkRepo.getSparkById('missing')).resolves.toBeNull();
  });

  it('listSparks created_at 倒序（新在前）', async () => {
    const { sparkRepo } = makeHarness();
    const first = await sparkRepo.createSpark({ title: 'first' });
    const second = await sparkRepo.createSpark({ title: 'second' });
    const list = await sparkRepo.listSparks();
    expect(list.map((s) => s.id)).toEqual([second.id, first.id]);
  });
});

describe('附件链路（addAttachment / markAttachmentUploaded / deleteAttachment）', () => {
  it('addAttachment 落库 + listAttachments 升序；markAttachmentUploaded 回填', async () => {
    const { sparkRepo } = makeHarness();
    const spark = await sparkRepo.createSpark({ title: '灵感' });
    const audio = await sparkRepo.addAttachment(spark.id, {
      kind: 'audio',
      uri: '/local/a.m4a',
      fileSize: 1024,
      durationMs: 5000,
    });
    expect(audio.remotePath).toBeNull();
    expect(audio.sha256).toBeNull();

    const image = await sparkRepo.addAttachment(spark.id, {
      kind: 'image',
      uri: '/local/b.jpg',
      fileSize: 2048,
      width: 100,
      height: 200,
    });

    const list = await sparkRepo.listAttachments(spark.id);
    expect(list.map((a) => a.id)).toEqual([audio.id, image.id]);

    const marked = await sparkRepo.markAttachmentUploaded(audio.id, {
      remotePath: 'abcdef0123456789-a.m4a',
      sha256: 'abcdef0123456789abcdef0123456789',
    });
    expect(marked.remotePath).toBe('abcdef0123456789-a.m4a');
    expect(marked.sha256).toBe('abcdef0123456789abcdef0123456789');

    const byId = await sparkRepo.getAttachmentById(image.id);
    expect(byId?.kind).toBe('image');
    await expect(sparkRepo.getAttachmentById('missing')).resolves.toBeNull();
    await expect(
      sparkRepo.markAttachmentUploaded('missing', { remotePath: 'x', sha256: 'y' }),
    ).rejects.toThrow('markAttachmentUploaded: 附件不存在');
  });

  it('守卫：非法 kind / 负 fileSize / 空 uri / 灵感不存在 → 抛错', async () => {
    const { sparkRepo } = makeHarness();
    await expect(
      sparkRepo.addAttachment('missing', { kind: 'audio', uri: '/x.m4a', fileSize: 1 }),
    ).rejects.toThrow('addAttachment: 灵感不存在');

    const spark = await sparkRepo.createSpark({ title: '灵感' });
    const invalidKind = 'video' as SparkAttachmentKind;
    await expect(
      sparkRepo.addAttachment(spark.id, {
        kind: invalidKind,
        uri: '/x.mp4',
        fileSize: 1,
      }),
    ).rejects.toThrow('非法附件类型');
    await expect(
      sparkRepo.addAttachment(spark.id, { kind: 'audio', uri: '/x.m4a', fileSize: -1 }),
    ).rejects.toThrow('非法文件大小');
    await expect(
      sparkRepo.addAttachment(spark.id, { kind: 'audio', uri: '   ', fileSize: 1 }),
    ).rejects.toThrow('附件本地路径不能为空');
  });

  it('上限 20：第 21 个附件抛错（SPARK_ATTACHMENT_MAX_COUNT）', async () => {
    const { sparkRepo } = makeHarness();
    const spark = await sparkRepo.createSpark({ title: '灵感' });
    for (let i = 0; i < SPARK_ATTACHMENT_MAX_COUNT; i += 1) {
      await sparkRepo.addAttachment(spark.id, {
        kind: 'audio',
        uri: `/local/${i}.m4a`,
        fileSize: 1,
      });
    }
    await expect(
      sparkRepo.addAttachment(spark.id, { kind: 'audio', uri: '/local/over.m4a', fileSize: 1 }),
    ).rejects.toThrow(`addAttachment: 附件数已达上限（${SPARK_ATTACHMENT_MAX_COUNT}）`);
  });

  it('deleteAttachment：行删除 + io.deleteFile/deleteRemoteFile 调用；不存在幂等', async () => {
    const { sparkRepo, io } = makeHarness();
    const spark = await sparkRepo.createSpark({ title: '灵感' });
    const audio = await sparkRepo.addAttachment(spark.id, {
      kind: 'audio',
      uri: '/local/a.m4a',
      fileSize: 1,
    });
    await sparkRepo.markAttachmentUploaded(audio.id, { remotePath: 'remote-a.m4a', sha256: 'h' });

    await sparkRepo.deleteAttachment(audio.id);
    expect(io.calls).toContain('rm:/local/a.m4a');
    expect(io.calls).toContain('rdrm:remote-a.m4a');
    await expect(sparkRepo.listAttachments(spark.id)).resolves.toEqual([]);

    // 幂等：再删不存在的附件静默成功、零 IO 调用增量。
    const before = io.calls.length;
    await sparkRepo.deleteAttachment(audio.id);
    expect(io.calls).toHaveLength(before);
  });

  it('deleteAttachment IO 失败仅披露（console.warn）不阻塞行删除', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { sparkRepo, database } = makeHarness();
    const spark = await sparkRepo.createSpark({ title: '灵感' });
    const audio = await sparkRepo.addAttachment(spark.id, {
      kind: 'audio',
      uri: '/local/a.m4a',
      fileSize: 1,
    });
    await sparkRepo.markAttachmentUploaded(audio.id, { remotePath: 'remote-a.m4a', sha256: 'h' });

    const failing = makeStubIo({
      deleteFile: async () => {
        throw new Error('fs deny');
      },
      deleteRemoteFile: async () => {
        throw new Error('net down');
      },
    });
    const repoWithFailingIo = new WatermelonSparkRepository(database, failing);
    await repoWithFailingIo.deleteAttachment(audio.id);
    // 本仓库两条披露（本地文件 + 远端）；其余 console.warn 为框架噪音，按前缀过滤。
    expect(
      warnSpy.mock.calls.filter((call) => String(call[0]).startsWith('deleteAttachment:')),
    ).toHaveLength(2);
    await expect(sparkRepo.listAttachments(spark.id)).resolves.toEqual([]);
    warnSpy.mockRestore();
  });
});

describe('关联链路（linkSparkToItem / unlinkSparkFromItem / listItemsForSpark）', () => {
  it('关联前 item_id 存在性校验（不命中抛错）；存在则建立 join', async () => {
    const { sparkRepo, itemRepo } = makeHarness();
    const spark = await sparkRepo.createSpark({ title: '灵感' });
    await expect(sparkRepo.linkSparkToItem(spark.id, 'missing-item')).rejects.toThrow(
      'linkSparkToItem: 条目不存在（missing-item）',
    );

    const item = await itemRepo.createItem(makeCreateInput('计划 A'));
    await sparkRepo.linkSparkToItem(spark.id, item.id);
    // 幂等：重复关联不重复建行。
    await sparkRepo.linkSparkToItem(spark.id, item.id);
    const summaries = await sparkRepo.listItemsForSpark(spark.id);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].itemId).toBe(item.id);
  });

  it('上限 50：第 51 条关联抛错（SPARK_ITEM_LINK_MAX）', async () => {
    const { sparkRepo, itemRepo, database } = makeHarness();
    const spark = await sparkRepo.createSpark({ title: '灵感' });
    const item = await itemRepo.createItem(makeCreateInput('计划'));
    // 直接灌 50 行 join（测试数据面，绕过上限检查本身）。
    for (let i = 0; i < SPARK_ITEM_LINK_MAX; i += 1) {
      await database.write(async () => {
        await database.get<SparkItemModel>('spark_items').create((row) => {
          row.sparkId = spark.id;
          row.itemId = `filler-${i}`;
        });
      });
    }
    await expect(sparkRepo.linkSparkToItem(spark.id, item.id)).rejects.toThrow(
      `linkSparkToItem: 关联计划数已达上限（${SPARK_ITEM_LINK_MAX}）`,
    );
  });

  it('listItemsForSpark 摘要水合（status/startAt/分类色 Emoji/linkedAt）', async () => {
    const { sparkRepo, itemRepo } = makeHarness();
    const spark = await sparkRepo.createSpark({ title: '灵感' });
    const item = await itemRepo.createItem({
      ...makeCreateInput('带分类计划'),
      categoryId: 'work',
    });
    await sparkRepo.linkSparkToItem(spark.id, item.id);
    const summaries = await sparkRepo.listItemsForSpark(spark.id);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      itemId: item.id,
      title: '带分类计划',
      status: 'active',
      startAt: null,
      allDay: false,
    });
    // 分类视觉字段键恒携带（work 分类被 seed 预置，具体色值/Emoji 取决于 seed 值）。
    expect('categoryColor' in summaries[0]).toBe(true);
    expect('categoryEmoji' in summaries[0]).toBe(true);
    expect(summaries[0].linkedAt).toBeGreaterThan(0);
  });

  it('listItemsForSpark 灵感不存在抛错；unlink 幂等；悬挂 join（条目已删）跳过', async () => {
    const { sparkRepo, itemRepo } = makeHarness();
    await expect(sparkRepo.listItemsForSpark('missing')).rejects.toThrow(
      'listItemsForSpark: 灵感不存在（missing）',
    );

    const spark = await sparkRepo.createSpark({ title: '灵感' });
    const item = await itemRepo.createItem(makeCreateInput('将被删除的计划'));
    await sparkRepo.linkSparkToItem(spark.id, item.id);
    await sparkRepo.unlinkSparkFromItem(spark.id, item.id);
    // 幂等：再解除静默成功。
    await sparkRepo.unlinkSparkFromItem(spark.id, item.id);
    await expect(sparkRepo.listItemsForSpark(spark.id)).resolves.toEqual([]);

    // 悬挂：重新关联后删除条目（deleteItem 级联不含 spark_items）→ 摘要跳过。
    const item2 = await itemRepo.createItem(makeCreateInput('计划 2'));
    await sparkRepo.linkSparkToItem(spark.id, item2.id);
    await itemRepo.deleteItem(item2.id);
    await expect(sparkRepo.listItemsForSpark(spark.id)).resolves.toEqual([]);
  });
});

describe('deleteSpark 全级联', () => {
  it('附件行 + 关联行 + 本地文件 + 远端 DELETE 一并清理；不存在幂等', async () => {
    const { sparkRepo, itemRepo, io, database } = makeHarness();
    const spark = await sparkRepo.createSpark({ title: '灵感' });
    const audio = await sparkRepo.addAttachment(spark.id, {
      kind: 'audio',
      uri: '/local/a.m4a',
      fileSize: 1,
    });
    await sparkRepo.markAttachmentUploaded(audio.id, { remotePath: 'remote-a.m4a', sha256: 'h' });
    await sparkRepo.addAttachment(spark.id, {
      kind: 'image',
      uri: '/local/b.jpg',
      fileSize: 2,
    }); // 未上云 → 无远端删除
    const item = await itemRepo.createItem(makeCreateInput('计划'));
    await sparkRepo.linkSparkToItem(spark.id, item.id);

    await sparkRepo.deleteSpark(spark.id);
    expect(io.calls).toContain('rm:/local/a.m4a');
    expect(io.calls).toContain('rm:/local/b.jpg');
    expect(io.calls).toContain('rdrm:remote-a.m4a');
    await expect(sparkRepo.listSparks()).resolves.toEqual([]);
    await expect(sparkRepo.getAttachmentById(audio.id)).resolves.toBeNull();
    // 关联行同删（直接查 join 表计数；listItemsForSpark 因灵感已删抛错不再适用）。
    await expect(
      database.get<SparkItemModel>('spark_items').query(Q.where('spark_id', spark.id)).fetchCount(),
    ).resolves.toBe(0);

    // 幂等：删除不存在的灵感静默成功、零 IO 调用增量。
    const before = io.calls.length;
    await sparkRepo.deleteSpark(spark.id);
    expect(io.calls).toHaveLength(before);
  });

  it('IO 失败仅 console.warn 披露，库内级联照常完成', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { sparkRepo, database } = makeHarness();
    const spark = await sparkRepo.createSpark({ title: '灵感' });
    await sparkRepo.addAttachment(spark.id, {
      kind: 'audio',
      uri: '/local/a.m4a',
      fileSize: 1,
    });
    await sparkRepo.markAttachmentUploaded(
      (await sparkRepo.listAttachments(spark.id))[0].id,
      { remotePath: 'remote-a.m4a', sha256: 'h' },
    );

    const failing = makeStubIo({
      deleteFile: async () => {
        throw new Error('fs deny');
      },
      deleteRemoteFile: async () => {
        throw new Error('net down');
      },
    });
    const repoWithFailingIo = new WatermelonSparkRepository(database, failing);
    await repoWithFailingIo.deleteSpark(spark.id);
    expect(
      warnSpy.mock.calls.filter((call) => String(call[0]).startsWith('deleteSpark:')),
    ).toHaveLength(2);
    await expect(sparkRepo.listSparks()).resolves.toEqual([]);
    warnSpy.mockRestore();
  });
});
