import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import CategoryModel from '../../db/models/CategoryModel';
import AppSettingsModel from '../../db/models/AppSettingsModel';
import ItemModel from '../../db/models/ItemModel';
import ItemTagModel from '../../db/models/ItemTagModel';
import ReminderModel from '../../db/models/ReminderModel';
import TagModel from '../../db/models/TagModel';
import { schema } from '../../db/schema';
import { WatermelonItemRepository } from '../WatermelonItemRepository';
import type { CreateReminderInput, OnceCivilTime } from '../../domain/reminder';

/**
 * 切片 16 阶段 1（AGENTS.md §7.26）：once 频率 + 渠道字段的 Repository 读写映射单测。
 *
 * 与 archivedWithTags.test.ts 同款夹具：真实 WatermelonDB + LokiJS 内存适配器。
 * 注意两点边界（migrations.ts 注释同步记录）：
 * - LokiJS 适配器忽略 'sql' 迁移步骤，channel 回填的行为级验收依赖真机覆盖安装；
 *   本文件用「经 model 直写脏数据再读」模拟存量异常行，验证读取层防御。
 * - once_civil_json 的存储原文在本文件精确断言（单列 JSON，键序冻结）。
 */

let dbCounter = 0;

// LokiJS 默认开启 autosave（setInterval 挂住事件循环），测试结束后必须 close（先例同 archivedWithTags）。
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

interface Fixture {
  repository: WatermelonItemRepository;
  database: Database;
}

function makeFixture(): Fixture {
  dbCounter += 1;
  const adapter = new LokiJSAdapter({
    dbName: `test-reminder-once-${dbCounter}`,
    schema,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  createdAdapters.push(adapter);
  const database = new Database({
    adapter,
    modelClasses: [ItemModel, TagModel, ItemTagModel, ReminderModel, CategoryModel, AppSettingsModel],
  });
  return { repository: new WatermelonItemRepository(database), database };
}

afterAll(() => {
  for (const adapter of createdAdapters) {
    extractLokiHandle(adapter)?.close();
  }
  createdAdapters.length = 0;
});

/** 任务卡阶段 1 验收样例时刻：{"year":2026,"month":11,"day":12,"hour":9,"minute":0} */
const ONCE_AT: OnceCivilTime = { year: 2026, month: 11, day: 12, hour: 9, minute: 0 };
const ONCE_JSON = '{"year":2026,"month":11,"day":12,"hour":9,"minute":0}';
const START_AT = 1767225600000;

async function createOwnerItem(repository: WatermelonItemRepository): Promise<string> {
  const item = await repository.createItem({ type: 'task', title: 'once-owner' });
  return item.id;
}

async function rawReminderRow(database: Database, id: string): Promise<ReminderModel> {
  return database.get<ReminderModel>('reminders').find(id);
}

function baseOnceInput(itemId: string, overrides: Partial<CreateReminderInput> = {}): CreateReminderInput {
  return {
    itemId,
    frequency: 'once',
    localTimeHour: 0,
    localTimeMinute: 0,
    onceAt: ONCE_AT,
    tzid: 'Asia/Shanghai',
    startAt: START_AT,
    enabled: true,
    ...overrides,
  };
}

describe('createReminder：once（切片 16）', () => {
  it('once 创建：once_civil_json 存精确单列 JSON，localTime/weekdays/dayOfMonth 落零值，默认渠道', async () => {
    const { repository, database } = makeFixture();
    const itemId = await createOwnerItem(repository);

    const reminder = await repository.createReminder(baseOnceInput(itemId));

    expect(reminder.frequency).toBe('once');
    expect(reminder.onceAt).toEqual(ONCE_AT);
    expect(reminder.localTimeHour).toBe(0);
    expect(reminder.localTimeMinute).toBe(0);
    expect(reminder.weekdays).toEqual([]);
    expect(reminder.dayOfMonth).toBe(0);
    // 切片 18：多渠道形状；缺省渠道集合 = DEFAULT_REMINDER_CHANNELS。
    expect(reminder.channels).toEqual(['system-notification']);
    expect(reminder.channelConfigs).toEqual({});

    const raw = await rawReminderRow(database, reminder.id);
    expect(raw.onceCivilJson).toBe(ONCE_JSON);
    expect(raw.weekdaysJson).toBe('');
    expect(raw.dayOfMonth).toBe(0);
    expect(raw.localTimeHour).toBe(0);
    expect(raw.localTimeMinute).toBe(0);
    expect(raw.channelsJson).toBe('["system-notification"]');
    expect(raw.channelConfigsJson).toBeNull();
    // 旧单渠道列在 v10 新行上不再写入：非可选 string 列被 sanitizedRaw 以 '' 零值回填。
    expect(raw.channel).toBe('');
    expect(raw.channelConfig).toBeNull();
  });

  it('once 无 onceAt（violating input：onceAt 显式 null）抛明确错误', async () => {
    const { repository } = makeFixture();
    const itemId = await createOwnerItem(repository);

    await expect(
      repository.createReminder(baseOnceInput(itemId, { onceAt: null })),
    ).rejects.toThrow("frequency 'once' requires onceAt (civil {year,month,day,hour,minute}), got none");
  });

  it('onceAt 范围越界/非整数/结构坏值写路径抛错（resolveOnceAt → assertOnceCivilTime）', async () => {
    const { repository } = makeFixture();
    const itemId = await createOwnerItem(repository);

    await expect(
      repository.createReminder(baseOnceInput(itemId, { onceAt: { ...ONCE_AT, month: 13 } })),
    ).rejects.toThrow(/got month: 13/);
    await expect(
      repository.createReminder(baseOnceInput(itemId, { onceAt: { ...ONCE_AT, hour: 24 } })),
    ).rejects.toThrow(/got hour: 24/);
    await expect(
      repository.createReminder(baseOnceInput(itemId, { onceAt: { ...ONCE_AT, day: 1.5 } })),
    ).rejects.toThrow(/got day: 1\.5/);

    // 结构坏值（year 为字符串）：经 JSON 反序列化绕过编译期形状，验证运行时防御（不用 as 断言）。
    const badShape: OnceCivilTime = JSON.parse(
      '{"year":"2026","month":11,"day":12,"hour":9,"minute":0}',
    );
    await expect(
      repository.createReminder(baseOnceInput(itemId, { onceAt: badShape })),
    ).rejects.toThrow(/got year: 2026/); // String(raw) 格式化，不带引号
  });

  it('tzid 白名单对 once 同样生效（提案 §2.3）', async () => {
    const { repository } = makeFixture();
    const itemId = await createOwnerItem(repository);

    await expect(
      repository.createReminder(baseOnceInput(itemId, { tzid: 'Asia/Tokyo' })),
    ).rejects.toThrow(/tzid "Asia\/Tokyo" is not supported/);
  });

  it('webhook 渠道：config trim 后落库；alarm 渠道：expo 键静默跳过（提案 §5 互斥/无配置）', async () => {
    const { repository, database } = makeFixture();
    const itemId = await createOwnerItem(repository);

    const webhook = await repository.createReminder(
      baseOnceInput(itemId, {
        channels: ['webhook'],
        channelConfigs: { webhook: '  https://example.com/hook  ' },
      }),
    );
    expect(webhook.channels).toEqual(['webhook']);
    expect(webhook.channelConfigs).toEqual({ webhook: 'https://example.com/hook' });
    const rawWebhook = await rawReminderRow(database, webhook.id);
    expect(rawWebhook.channelConfigsJson).toBe('{"webhook":"https://example.com/hook"}');

    const alarm = await repository.createReminder(
      baseOnceInput(itemId, { channels: ['alarm'], channelConfigs: { alarm: 'should-drop' } }),
    );
    expect(alarm.channels).toEqual(['alarm']);
    expect(alarm.channelConfigs).toEqual({});
    const rawAlarm = await rawReminderRow(database, alarm.id);
    expect(rawAlarm.channelConfigsJson).toBeNull();
  });

  it('webhook 缺 config 条目接受（宽松态，阶段 3 UI 补齐）；config 纯空白抛明确错误', async () => {
    const { repository, database } = makeFixture();
    const itemId = await createOwnerItem(repository);

    const webhook = await repository.createReminder(
      baseOnceInput(itemId, { channels: ['webhook'] }),
    );
    expect(webhook.channels).toEqual(['webhook']);
    expect(webhook.channelConfigs).toEqual({});
    const raw = await rawReminderRow(database, webhook.id);
    expect(raw.channelConfigsJson).toBeNull();

    await expect(
      repository.createReminder(
        baseOnceInput(itemId, { channels: ['apprise'], channelConfigs: { apprise: '   ' } }),
      ),
    ).rejects.toThrow(/whitespace-only/);
  });
});

describe('updateReminder：once 切换与渠道（切片 16）', () => {
  it('daily → once：onceAt 落库、规则字段归零；once → daily：onceAt 清空', async () => {
    const { repository, database } = makeFixture();
    const itemId = await createOwnerItem(repository);

    const daily = await repository.createReminder({
      itemId,
      frequency: 'daily',
      localTimeHour: 9,
      localTimeMinute: 30,
      tzid: 'Asia/Shanghai',
      startAt: START_AT,
      enabled: true,
    });

    const asOnce = await repository.updateReminder(daily.id, {
      frequency: 'once',
      onceAt: ONCE_AT,
    });
    expect(asOnce.frequency).toBe('once');
    expect(asOnce.onceAt).toEqual(ONCE_AT);
    expect(asOnce.localTimeHour).toBe(0);
    expect(asOnce.localTimeMinute).toBe(0);
    expect(asOnce.weekdays).toEqual([]);
    expect(asOnce.dayOfMonth).toBe(0);
    const rawOnce = await rawReminderRow(database, daily.id);
    expect(rawOnce.onceCivilJson).toBe(ONCE_JSON);

    const backToDaily = await repository.updateReminder(daily.id, {
      frequency: 'daily',
      localTimeHour: 7,
      localTimeMinute: 45,
    });
    expect(backToDaily.frequency).toBe('daily');
    expect(backToDaily.onceAt).toBeNull();
    expect(backToDaily.localTimeHour).toBe(7);
    expect(backToDaily.localTimeMinute).toBe(45);
    const rawDaily = await rawReminderRow(database, daily.id);
    expect(rawDaily.onceCivilJson).toBeNull();
  });

  it('daily → once 缺 onceAt（patch 只有 frequency）抛明确错误', async () => {
    const { repository } = makeFixture();
    const itemId = await createOwnerItem(repository);

    const daily = await repository.createReminder({
      itemId,
      frequency: 'daily',
      localTimeHour: 9,
      localTimeMinute: 30,
      tzid: 'Asia/Shanghai',
      startAt: START_AT,
      enabled: true,
    });

    await expect(
      repository.updateReminder(daily.id, { frequency: 'once' }),
    ).rejects.toThrow(/requires onceAt/);
  });

  it('once 保持 once 但 patch.onceAt 显式 null 抛明确错误（合并结果无时刻）', async () => {
    const { repository } = makeFixture();
    const itemId = await createOwnerItem(repository);

    const once = await repository.createReminder(baseOnceInput(itemId));

    await expect(
      repository.updateReminder(once.id, { onceAt: null }),
    ).rejects.toThrow(/requires onceAt/);
  });

  it('once 保持 once 且不传 onceAt：沿用现状时刻（patch 只改 enabled）', async () => {
    const { repository } = makeFixture();
    const itemId = await createOwnerItem(repository);

    const once = await repository.createReminder(baseOnceInput(itemId));

    const updated = await repository.updateReminder(once.id, { enabled: false });
    expect(updated.enabled).toBe(false);
    expect(updated.onceAt).toEqual(ONCE_AT);
    expect(updated.frequency).toBe('once');
  });

  it('webhook → system-notification：渠道切换后旧 config 条目被剪除（per-key merge + prune）', async () => {
    const { repository, database } = makeFixture();
    const itemId = await createOwnerItem(repository);

    const webhook = await repository.createReminder(
      baseOnceInput(itemId, {
        channels: ['webhook'],
        channelConfigs: { webhook: 'https://example.com/hook' },
      }),
    );
    expect(webhook.channelConfigs).toEqual({ webhook: 'https://example.com/hook' });

    const switched = await repository.updateReminder(webhook.id, {
      channels: ['system-notification'],
    });
    expect(switched.channels).toEqual(['system-notification']);
    expect(switched.channelConfigs).toEqual({});
    const raw = await rawReminderRow(database, webhook.id);
    expect(raw.channelConfigsJson).toBeNull();
  });
});

describe('读取层防御（切片 16：模拟 LokiJS 忽略回填 SQL / 存量脏数据）', () => {
  it("legacy 桥：channels_json 置空 + channel=''（LokiJS 忽略 v8 sql 步骤的产物）读回回退默认渠道，不抛错", async () => {
    const { repository, database } = makeFixture();
    const itemId = await createOwnerItem(repository);
    const once = await repository.createReminder(baseOnceInput(itemId));

    await database.write(async () => {
      const record = await database.get<ReminderModel>('reminders').find(once.id);
      await record.update((draft) => {
        // 模拟 v9 存量行：多渠道列无数据，仅旧单渠道列（清零值）。
        draft.channelsJson = null;
        draft.channelConfigsJson = null;
        draft.channel = '';
      });
    });

    const reminders = await repository.listRemindersByItem(itemId);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.channels).toEqual(['system-notification']);
    expect(reminders[0]?.channelConfigs).toEqual({});
  });

  it("legacy 桥：channels_json 置空 + channel='bogus'（枚举外脏数据）读回回退默认渠道，不抛错", async () => {
    const { repository, database } = makeFixture();
    const itemId = await createOwnerItem(repository);
    const once = await repository.createReminder(baseOnceInput(itemId));

    await database.write(async () => {
      const record = await database.get<ReminderModel>('reminders').find(once.id);
      await record.update((draft) => {
        draft.channelsJson = null;
        draft.channel = 'bogus';
      });
    });

    const reminders = await repository.listRemindersByItem(itemId);
    expect(reminders[0]?.channels).toEqual(['system-notification']);
  });

  it('once_civil_json 坏 JSON 读回抛明确错误，不静默（对齐 weekdays 纪律）', async () => {
    const { repository, database } = makeFixture();
    const itemId = await createOwnerItem(repository);
    const once = await repository.createReminder(baseOnceInput(itemId));

    await database.write(async () => {
      const record = await database.get<ReminderModel>('reminders').find(once.id);
      await record.update((draft) => {
        draft.onceCivilJson = 'not-json';
      });
    });

    await expect(repository.listRemindersByItem(itemId)).rejects.toThrow(
      /reminders\.once_civil_json .*invalid JSON/,
    );
  });
});
