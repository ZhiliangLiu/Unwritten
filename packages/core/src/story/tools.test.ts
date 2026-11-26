import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { seedNorthCape } from '../test-support/story-fixtures.ts';
import { ancestorChain } from '../play/chain.ts';
import { openDatabase } from '../store/db.ts';
import { createCodeBook } from './codebook.ts';
import { loadProjection } from './projection.ts';
import { createStoryTools, storyToolSchemaText } from './tools.ts';
import type { TurnRequestLog } from '../store/meta.ts';
import { estimateTokens } from '../llm/budget.ts';

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const seeded = seedNorthCape(opened.db);
  const chain = ancestorChain(opened.db, seeded.headTurnId).map((turn) => ({
    id: turn.id,
    depth: turn.depth,
    action: turn.action,
    prose: turn.prose,
    scene: turn.scene,
  }));
  const projection = loadProjection(opened.db, { versionId: seeded.versionId, chain });
  const codebook = createCodeBook(projection);
  for (const entity of projection.entities.values()) codebook.entityCode(entity.id);
  for (const fact of projection.facts) codebook.factCode(fact.id);
  const log: TurnRequestLog = [];
  const samples: Array<{ tool: string; records: number; ok: boolean }> = [];
  const tools = createStoryTools({
    db: opened.db,
    projection,
    codebook,
    log,
    onSample: (sample) => samples.push(sample),
  });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return { temp, opened, seeded, projection, codebook, log, samples, byName };
}

describe('createStoryTools', () => {
  it('七个工具各返回结果', async () => {
    const { temp, opened, seeded, byName } = setup();
    try {
      const character = byName.get('get_character');
      const place = byName.get('get_place');
      const entity = byName.get('get_entity');
      const catalog = byName.get('list_catalog');
      const fact = byName.get('who_knows');
      const search = byName.get('search_story');
      const turn = byName.get('read_turn');
      expect(character).toBeTruthy();
      expect(place).toBeTruthy();
      expect(entity).toBeTruthy();
      expect(catalog).toBeTruthy();
      expect(fact).toBeTruthy();
      expect(search).toBeTruthy();
      expect(turn).toBeTruthy();
      expect((await character!.execute({ target: '@2' })).text).toContain('@2 人物 · 真名：沈岚');
      expect((await place!.execute({ target: '北岬灯塔' })).text).toContain('地点 · 真名：北岬灯塔');
      expect((await entity!.execute({ target: '铜钥匙' })).text).toContain('物品 · 真名：铜钥匙');
      expect((await catalog!.execute({ category: 'characters', cursor: '' })).text).toContain('人物（第 1–3 条');
      expect((await fact!.execute({ fact: '#2' })).text).toContain('知情者：');
      expect((await search!.execute({ query: '栈桥' })).text).toContain('搜索「栈桥」');
      expect((await turn!.execute({ turn: 'T2' })).text).toContain('玩家行动：问撑伞的女人叫什么名字');
      expect(seeded.ids.shen).toBeTruthy();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('工具调用记进请求足迹', async () => {
    const { temp, opened, byName, log, samples } = setup();
    try {
      await byName.get('get_character')!.execute({ target: '@2' });
      expect(log[0]).toMatchObject({ tool: 'get_character', ok: true });
      expect(log[0]?.args).toEqual({ target: '@2' });
      expect(log[0]?.records?.length).toBe(1);
      expect(samples[0]).toMatchObject({ tool: 'get_character', records: 1, ok: true });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('查不到时把错误交还给模型', async () => {
    const { temp, opened, byName, log } = setup();
    try {
      await expect(byName.get('get_character')!.execute({ target: '@99' })).rejects.toThrow('不是本次给出的编号');
      expect(log[0]?.ok).toBe(false);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('只读工具不写库', async () => {
    const { temp, opened, byName, log } = setup();
    try {
      const tables = ['entities', 'entity_names', 'facts', 'knowledge', 'turn_summaries'];
      const before = tables.map((table) => opened.db.all(sql`select * from ${sql.raw(table)}`).length);
      await byName.get('get_character')!.execute({ target: '@2' });
      await byName.get('get_place')!.execute({ target: '北岬灯塔' });
      await byName.get('get_entity')!.execute({ target: '铜钥匙' });
      await byName.get('list_catalog')!.execute({ category: 'characters', cursor: '' });
      await byName.get('who_knows')!.execute({ fact: '#2' });
      await byName.get('search_story')!.execute({ query: '栈桥' });
      await byName.get('read_turn')!.execute({ turn: 'T2' });
      const after = tables.map((table) => opened.db.all(sql`select * from ${sql.raw(table)}`).length);
      expect(after).toEqual(before);
      expect(log).toHaveLength(7);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('工具说明的 token 棘轮', () => {
    expect(estimateTokens(storyToolSchemaText())).toBe(843);
  });
});
