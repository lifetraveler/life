import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import ItemModel from '../../db/models/ItemModel';
import ItemTagModel from '../../db/models/ItemTagModel';
import ReminderModel from '../../db/models/ReminderModel';
import CategoryModel from '../../db/models/CategoryModel';
import AppSettingsModel from '../../db/models/AppSettingsModel';
import TagModel from '../../db/models/TagModel';
import ChannelPresetModel from '../../db/models/ChannelPresetModel';
import { schema } from '../../db/schema';
import { WatermelonItemRepository } from '../WatermelonItemRepository';
import type { ChannelPreset } from '../../domain/channelPreset';

/**
 * 切片 17 阶段 1（AGENTS.md §7.27）：渠道预设 CRUD 的仓库层单测
 * （真实 WatermelonDB + LokiJS 内存适配器，同 sourceFields.test.ts 基准）。
 * 覆盖：写路径守卫（name trim 非空 / type 枚举 / configJson 过渠道守卫）、
 * created_at 降序列表、patch 合并更新、删除与 not-found、非法 type 读出抛错。
 */

let dbCounter = 0;

// LokiJS 默认开启 500ms autosave（lokiExtensions.js），setInterval 会挂住 Node 事件循环，
// 测试结束后必须对每个实例调用 loki.close() 释放（同 viewQueries.test.ts 的处理）。
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
    dbName: `test-channel-presets-${dbCounter}`,
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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const WEBHOOK_ZULIP_CONFIG = JSON.stringify({
  url: 'https://zulip.example/api/v1/external/zulip',
  mode: 'form',
  payloadTemplate: { type: 'stream', topic: '{{title}}', content: '{{body}}' },
});

const APPRISE_CONFIG = JSON.stringify({ baseUrl: 'https://apprise.example', key: 'k1' });

describe('WatermelonItemRepository 渠道预设 CRUD（切片 17 阶段 1）', () => {
  it('createChannelPreset：name trim、守卫通过、返回领域对象（createdAt 毫秒）', async () => {
    const repository = makeRepository();

    const created = await repository.createChannelPreset({
      name: '  Zulip 主站  ',
      type: 'webhook',
      configJson: WEBHOOK_ZULIP_CONFIG,
    });

    expect(created.name).toBe('Zulip 主站');
    expect(created.type).toBe('webhook');
    expect(created.configJson).toBe(WEBHOOK_ZULIP_CONFIG);
    expect(created.createdAt).toBeGreaterThan(0);
    expect(created.id.length).toBeGreaterThan(0);
  });

  it('createChannelPreset：name 空白 / type 枚举外 / configJson 未过守卫 → 抛明确错误', async () => {
    const repository = makeRepository();

    await expect(
      repository.createChannelPreset({ name: '   ', type: 'webhook', configJson: WEBHOOK_ZULIP_CONFIG }),
    ).rejects.toThrow('createChannelPreset: name must not be blank');

    await expect(
      repository.createChannelPreset({
        name: 'x',
        type: 'slack' as 'webhook', // 接口类型层面不可达的值，运行时守卫必须拦截
        configJson: WEBHOOK_ZULIP_CONFIG,
      }),
    ).rejects.toThrow('createChannelPreset: invalid preset type: slack');

    await expect(
      repository.createChannelPreset({
        name: 'x',
        type: 'webhook',
        configJson: JSON.stringify({ url: 'ftp://x' }), // url 非 http(s)
      }),
    ).rejects.toThrow('WebhookChannel: channelConfig.url must start with http:// or https://');

    await expect(
      repository.createChannelPreset({
        name: 'x',
        type: 'apprise',
        configJson: 'not json at all',
      }),
    ).rejects.toThrow('AppriseChannel:');
  });

  it('listChannelPresets：created_at 降序（新→旧）', async () => {
    const repository = makeRepository();
    await repository.createChannelPreset({ name: '旧预设', type: 'webhook', configJson: 'https://hook.example/old' });
    await sleep(10); // created_at 毫秒精度，隔开两次插入
    await repository.createChannelPreset({ name: '新预设', type: 'apprise', configJson: APPRISE_CONFIG });

    const presets = await repository.listChannelPresets();

    expect(presets.map((preset: ChannelPreset) => preset.name)).toEqual(['新预设', '旧预设']);
  });

  it('updateChannelPreset：patch 合并（只改提供字段）、configJson 按既有 type 重过守卫', async () => {
    const repository = makeRepository();
    const created = await repository.createChannelPreset({
      name: '原名字',
      type: 'webhook',
      configJson: 'https://hook.example/legacy',
    });

    const renamed = await repository.updateChannelPreset(created.id, { name: '  新名字  ' });
    expect(renamed.name).toBe('新名字');
    expect(renamed.configJson).toBe('https://hook.example/legacy');

    const reconfigured = await repository.updateChannelPreset(created.id, {
      configJson: WEBHOOK_ZULIP_CONFIG,
    });
    expect(reconfigured.configJson).toBe(WEBHOOK_ZULIP_CONFIG);
    expect(reconfigured.name).toBe('新名字');
  });

  it('updateChannelPreset：空 patch / 新 config 未过既有 type 守卫 / not-found → 抛错', async () => {
    const repository = makeRepository();
    const created = await repository.createChannelPreset({
      name: 'apprise 预设',
      type: 'apprise',
      configJson: APPRISE_CONFIG,
    });

    await expect(repository.updateChannelPreset(created.id, {})).rejects.toThrow(
      'updateChannelPreset: patch must contain at least one of name / configJson',
    );
    await expect(repository.updateChannelPreset(created.id, { name: '  ' })).rejects.toThrow(
      'updateChannelPreset: name must not be blank',
    );
    // configJson 用 webhook 形态灌进 apprise 预设 → apprise 守卫拦截
    await expect(
      repository.updateChannelPreset(created.id, { configJson: 'https://hook.example/x' }),
    ).rejects.toThrow('AppriseChannel:');
    await expect(repository.updateChannelPreset('no-such-id', { name: 'x' })).rejects.toThrow(
      'updateChannelPreset: channel preset not found: no-such-id',
    );
  });

  it('deleteChannelPreset：删除后列表不再包含；not-found 抛明确错误', async () => {
    const repository = makeRepository();
    const created = await repository.createChannelPreset({
      name: '待删除',
      type: 'webhook',
      configJson: 'https://hook.example/del',
    });

    await repository.deleteChannelPreset(created.id);
    expect(await repository.listChannelPresets()).toEqual([]);

    await expect(repository.deleteChannelPreset(created.id)).rejects.toThrow(
      'deleteChannelPreset: channel preset not found',
    );
  });

  it('读取层：channel_presets 行 type 非法（外部直写）→ listChannelPresets 抛错不静默', async () => {
    const repository = makeRepository();
    const created = await repository.createChannelPreset({
      name: '正常行',
      type: 'webhook',
      configJson: 'https://hook.example/ok',
    });

    // 模拟绕过 Repository 的外部直写（migration 事故 / 未来版本回退）：type 篡改为非法值
    const db = (
      repository as unknown as { db: Database }
    ).db;
    await db.write(async () => {
      const model = await db.get<ChannelPresetModel>('channel_presets').find(created.id);
      await model.update((draft) => {
        // model.type 的装饰器类型是 string，绕过 isChannelPresetType 的写路径守卫
        (draft as unknown as { type: string }).type = 'telegram';
      });
    });

    await expect(repository.listChannelPresets()).rejects.toThrow('has invalid type: telegram');
  });
});
