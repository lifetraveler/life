/**
 * ChatMessageRepository 仓库级行为测试（切片 38 阶段 1，AGENTS.md §7.50 D2；
 * repository.md v0.44 注记节口径）：
 * - replaceTail 全量 upsert by seq：新 insert / 已有覆盖（五字段写穿、created_at
 *   不动）/ 未入选 kept 的既有行删除（滚动裁剪 + remove 模式 ghost 行）；
 * - 空输入 no-op（启动恢复竞态防护）；输入重复 seq / 非法 role/kind/seq 抛错；
 * - 200 条裁剪（CHAT_MESSAGE_PERSIST_LIMIT）；
 * - listOrdered：seq 升序 + 末尾 limit 条；limit 非正整数抛错。
 */

import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import { schema } from '../../db/schema';
import ChatMessageModel from '../../db/models/ChatMessageModel';
import { WatermelonChatMessageRepository } from '../WatermelonChatMessageRepository';
import {
  CHAT_MESSAGE_PERSIST_LIMIT,
  type PersistedChatMessage,
} from '../ChatMessageRepository';

let dbCounter = 0;

const createdAdapters: LokiJSAdapter[] = [];

afterAll(() => {
  for (const adapter of createdAdapters) {
    (adapter._driver as unknown as { loki?: { close: () => void } } | undefined)?.loki?.close();
  }
  createdAdapters.length = 0;
});

function makeMessage(overrides: Partial<PersistedChatMessage> = {}): PersistedChatMessage {
  return {
    seq: 1,
    role: 'user',
    text: '明天八点叫我起床',
    kind: 'text',
    cardPayloadJson: null,
    seedJson: null,
    ...overrides,
  };
}

type Harness = {
  repo: WatermelonChatMessageRepository;
  database: Database;
  adapter: LokiJSAdapter;
};

function makeHarness(): Harness {
  dbCounter += 1;
  const adapter = new LokiJSAdapter({
    dbName: `test-chat-repo-${dbCounter}`,
    schema,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  createdAdapters.push(adapter);
  const database = new Database({ adapter, modelClasses: [ChatMessageModel] });
  return { repo: new WatermelonChatMessageRepository(database), database, adapter };
}

describe('WatermelonChatMessageRepository.replaceTail（全量 upsert by seq）', () => {
  it('新 seq insert：行落库且 created_at 自动生成、行 id 与 seq 解耦', async () => {
    const { repo, database } = makeHarness();
    await repo.replaceTail([
      makeMessage({ seq: 1, role: 'user', text: '输入' }),
      makeMessage({ seq: 2, role: 'assistant', text: '已保存', kind: 'card', cardPayloadJson: '{"k":1}', seedJson: '{"s":1}' }),
    ]);
    const rows = await database.get<ChatMessageModel>('flash_chat_messages').query().fetch();
    expect(rows).toHaveLength(2);
    const bySeq = new Map(rows.map((row) => [row.seq, row]));
    expect(bySeq.get(1)?.text).toBe('输入');
    expect(bySeq.get(2)?.kind).toBe('card');
    expect(bySeq.get(2)?.cardPayloadJson).toBe('{"k":1}');
    expect(bySeq.get(2)?.seedJson).toBe('{"s":1}');
    expect(bySeq.get(1)?.createdAt).toBeInstanceOf(Date);
    // 行 id 与业务键 seq 解耦（WatermelonDB 自动生成，非 `1` 这类 seq 数字串）。
    expect(bySeq.get(1)?.id).not.toBe('1');
  });

  it('已有 seq 覆盖：五字段写穿、created_at 保持不动；字段无变化不重写', async () => {
    const { repo, database } = makeHarness();
    await repo.replaceTail([makeMessage({ seq: 5, text: '旧文案' })]);
    const before = (await database.get<ChatMessageModel>('flash_chat_messages').query().fetch())[0];
    const createdAtBefore = before.createdAt.getTime();

    await repo.replaceTail([
      makeMessage({
        seq: 5,
        role: 'assistant',
        text: '新文案',
        kind: 'card',
        cardPayloadJson: '{"itemId":"i1"}',
        seedJson: '{"title":"x"}',
      }),
    ]);
    const after = (await database.get<ChatMessageModel>('flash_chat_messages').query().fetch())[0];
    expect(after.text).toBe('新文案');
    expect(after.role).toBe('assistant');
    expect(after.kind).toBe('card');
    expect(after.cardPayloadJson).toBe('{"itemId":"i1"}');
    expect(after.seedJson).toBe('{"title":"x"}');
    expect(after.createdAt.getTime()).toBe(createdAtBefore);
    expect(after.id).toBe(before.id);

    // 同一输入再跑一遍（幂等）：无字段变化，不产生第二次写（行对象引用不变式
    // 无法直接观察，改验行为——结果一致且无异常）。
    await repo.replaceTail([
      makeMessage({
        seq: 5,
        role: 'assistant',
        text: '新文案',
        kind: 'card',
        cardPayloadJson: '{"itemId":"i1"}',
        seedJson: '{"title":"x"}',
      }),
    ]);
    const idempotent = await database.get<ChatMessageModel>('flash_chat_messages').query().fetch();
    expect(idempotent).toHaveLength(1);
    expect(idempotent[0].text).toBe('新文案');
  });

  it('滚动裁剪：超过 200 条只保留最近 200 条（seq 最大者在内）', async () => {
    const { repo, database } = makeHarness();
    const messages: PersistedChatMessage[] = [];
    for (let seq = 1; seq <= CHAT_MESSAGE_PERSIST_LIMIT + 10; seq += 1) {
      messages.push(makeMessage({ seq, text: `消息 ${seq}` }));
    }
    await repo.replaceTail(messages);
    const rows = await database.get<ChatMessageModel>('flash_chat_messages').query().fetch();
    expect(rows).toHaveLength(CHAT_MESSAGE_PERSIST_LIMIT);
    const seqs = rows.map((row) => row.seq).sort((a, b) => a - b);
    expect(seqs[0]).toBe(11);
    expect(seqs[seqs.length - 1]).toBe(CHAT_MESSAGE_PERSIST_LIMIT + 10);
  });

  it('未入选 kept 的既有行删除：remove 模式 ghost 行与裁剪一并清掉', async () => {
    const { repo, database } = makeHarness();
    await repo.replaceTail([
      makeMessage({ seq: 1 }),
      makeMessage({ seq: 2, text: '保留' }),
      makeMessage({ seq: 3 }),
    ]);
    // 下一轮输入缺 seq 1/3（已从内存移除）→ 两行删除。
    await repo.replaceTail([makeMessage({ seq: 2, text: '保留' }), makeMessage({ seq: 4 })]);
    const rows = await database.get<ChatMessageModel>('flash_chat_messages').query().fetch();
    expect(rows.map((row) => row.seq).sort((a, b) => a - b)).toEqual([2, 4]);
  });

  it('空输入 no-op：不写不删（启动恢复竞态防护）', async () => {
    const { repo, database } = makeHarness();
    await repo.replaceTail([makeMessage({ seq: 1 })]);
    await repo.replaceTail([]);
    const rows = await database.get<ChatMessageModel>('flash_chat_messages').query().fetch();
    expect(rows).toHaveLength(1);
    expect(rows[0].seq).toBe(1);
  });

  it('输入重复 seq 抛错', async () => {
    const { repo } = makeHarness();
    await expect(
      repo.replaceTail([makeMessage({ seq: 1 }), makeMessage({ seq: 1, text: '重复' })]),
    ).rejects.toThrow('duplicate seq');
  });

  it('写路径守卫：非法 role/kind/seq 抛错', async () => {
    const { repo } = makeHarness();
    await expect(
      repo.replaceTail([makeMessage({ role: 'system' as unknown as 'user' })]),
    ).rejects.toThrow('invalid role');
    await expect(
      repo.replaceTail([makeMessage({ kind: 'confirm' as unknown as 'text' })]),
    ).rejects.toThrow('invalid kind');
    await expect(repo.replaceTail([makeMessage({ seq: 0 })])).rejects.toThrow('positive integer');
    await expect(repo.replaceTail([makeMessage({ seq: 1.5 })])).rejects.toThrow('positive integer');
  });
});

describe('WatermelonChatMessageRepository.listOrdered', () => {
  it('seq 升序返回；limit 截取末尾 N 条（最近 limit 条）', async () => {
    const { repo } = makeHarness();
    await repo.replaceTail(
      [1, 2, 3, 4, 5].map((seq) => makeMessage({ seq, text: `消息 ${seq}` })),
    );
    const all = await repo.listOrdered(10);
    expect(all.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5]);
    const tail = await repo.listOrdered(3);
    expect(tail.map((entry) => entry.seq)).toEqual([3, 4, 5]);
    expect(tail[0]).toEqual(makeMessage({ seq: 3, text: '消息 3' }));
  });

  it('limit 非正整数抛错', async () => {
    const { repo } = makeHarness();
    await expect(repo.listOrdered(0)).rejects.toThrow('limit must be a positive integer');
    await expect(repo.listOrdered(1.5)).rejects.toThrow('limit must be a positive integer');
  });
});
