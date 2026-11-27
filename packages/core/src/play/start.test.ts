import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createEventBus } from '../events/bus.ts';
import type { Logger } from '../log/logger.ts';
import { createRecordingSummary } from '../test-support/fake-summary.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { seedLighthouseTown } from '../test-support/story-fixtures.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { openDatabase } from '../store/db.ts';
import { entityNames, facts, playthroughs, stateValues, turns, workVersions } from '../store/schema.ts';
import type { VersionMeta } from '../store/meta.ts';
import { createPlayService } from './service.ts';

function silentLogger(): Logger {
  return {
    record() {},
    sample() {},
    async flush() {},
    async close() {},
  };
}

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const seeded = seedLighthouseTown(opened.db);
  const llm = createScriptedLlm();
  const play = createPlayService({
    dataDir: temp.dir,
    db: opened.db,
    bus: createEventBus(),
    logger: silentLogger(),
    shutdown: new AbortController().signal,
    llm,
    summary: createRecordingSummary(),
  });
  return { temp, opened, seeded, llm, play };
}

describe('play.start 固定人物', () => {
  it('固定人物的开局不调模型，占位符换成玩家填的名字', () => {
    const { temp, opened, seeded, llm, play } = setup();
    try {
      const playthroughId = randomUUID();
      const view = play.start({ workId: seeded.workId, playthroughId, protagonist: { 名字: '阿岚' } });
      expect(view.routeId).not.toBeNull();
      expect(llm.runs).toHaveLength(0);
      const route = play.getRoute({ routeId: view.routeId! });
      const prose = route.turns[0]?.paragraphs.join('\n') ?? '';
      expect(prose).toContain('阿岚');
      expect(prose).not.toContain('{{');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('留空的填写项用默认值', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const playthroughId = randomUUID();
      const view = play.start({ workId: seeded.workId, playthroughId, protagonist: { 名字: '   ' } });
      const route = play.getRoute({ routeId: view.routeId! });
      expect(route.turns[0]?.paragraphs.join('\n')).toContain('阿岚');
      const row = opened.db.select().from(playthroughs).where(eq(playthroughs.id, playthroughId)).get();
      expect(row?.protagonist).toEqual({ 名字: '阿岚', 职业: '邮差' });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('传了作品没有的填写项被拒', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      let error: unknown;
      try {
        play.start({ workId: seeded.workId, playthroughId: randomUUID(), protagonist: { 年龄: '三十' } });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: 'protagonist_input_invalid' });
      expect(opened.db.select().from(playthroughs).all()).toHaveLength(1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('填写值替换后段落数不变', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const view = play.start({ workId: seeded.workId, playthroughId: randomUUID(), protagonist: { 名字: '阿岚' } });
      const route = play.getRoute({ routeId: view.routeId! });
      expect(route.turns[0]?.paragraphs).toHaveLength(3);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('主角记得自己填的名字', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const view = play.start({ workId: seeded.workId, playthroughId: randomUUID(), protagonist: { 名字: '阿岚' } });
      const root = play.getRoute({ routeId: view.routeId! }).turns[0]!;
      const names = opened.db.select().from(entityNames).where(eq(entityNames.originTurnId, root.id)).all();
      expect(
        names.some(
          (row) =>
            row.entityId === seeded.ids.protagonist && row.holderId === seeded.ids.protagonist && row.name === '阿岚',
        ),
      ).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('开场的事实和初始状态写进根回合', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const view = play.start({ workId: seeded.workId, playthroughId: randomUUID(), protagonist: { 名字: '阿岚' } });
      const root = play.getRoute({ routeId: view.routeId! }).turns[0]!;
      const rootFacts = opened.db.select().from(facts).where(eq(facts.originTurnId, root.id)).all();
      expect(rootFacts.some((fact) => fact.kind === 'event')).toBe(true);
      const names = opened.db.select().from(entityNames).where(eq(entityNames.originTurnId, root.id)).all();
      expect(names.some((row) => row.entityId === seeded.ids.linchao && row.name === '守灯人')).toBe(true);
      const states = opened.db.select().from(stateValues).where(eq(stateValues.turnId, root.id)).all();
      const byId = new Map(states.map((row) => [row.stateDefId, row.value]));
      expect(byId.get(seeded.ids['state:潮位']!)).toBe('3');
      expect(byId.get(seeded.ids['state:信任']!)).toBe('陌生');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同一个开局 id 重复提交只建一次', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const playthroughId = randomUUID();
      const playthroughsBefore = opened.db.select().from(playthroughs).all().length;
      const turnsBefore = opened.db.select().from(turns).all().length;
      const first = play.start({ workId: seeded.workId, playthroughId, protagonist: { 名字: '阿岚' } });
      const second = play.start({ workId: seeded.workId, playthroughId, protagonist: { 名字: '阿岚' } });
      expect(second.routeId).toBe(first.routeId);
      expect(opened.db.select().from(playthroughs).all()).toHaveLength(playthroughsBefore + 1);
      expect(opened.db.select().from(turns).all()).toHaveLength(turnsBefore + 1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('没发布的作品不能开局', () => {
    const { temp, opened, play } = setup();
    try {
      const workId = randomUUID();
      opened.db.run(
        sql`insert into works (id, draft_id, created_at, updated_at)
            values (${workId}, ${randomUUID()}, ${Date.now()}, ${Date.now()})`,
      );
      let error: unknown;
      try {
        play.start({ workId, playthroughId: randomUUID(), protagonist: {} });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: 'not_published' });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('第二个里程碑的作品也能重新开局', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const version = opened.db.select().from(workVersions).where(eq(workVersions.id, seeded.versionId)).get()!;
      const meta = version.meta as VersionMeta;
      const opening = meta.opening!;
      const legacy: VersionMeta = {
        ...meta,
        opening: {
          ...opening,
          createdIds: undefined,
          scene: { place: '码头', time: '夜里', present: [], presentIds: [seeded.ids.linchao!] },
        },
      };
      opened.db.run(sql`update work_versions set meta = ${JSON.stringify(legacy)} where id = ${seeded.versionId}`);
      const view = play.start({ workId: seeded.workId, playthroughId: randomUUID(), protagonist: { 名字: '阿岚' } });
      const root = play.getRoute({ routeId: view.routeId! }).turns[0]!;
      expect(root.paragraphs.join('\n')).toContain('阿岚');
      const names = opened.db.select().from(entityNames).where(eq(entityNames.originTurnId, root.id)).all();
      expect(names.some((row) => row.name === '阿岚')).toBe(true);
      expect(names.some((row) => row.entityId === seeded.ids.linchao && row.name === '守灯人')).toBe(true);
      const rootTurn = opened.db.select().from(turns).where(eq(turns.id, root.id)).get()!;
      expect(rootTurn.scene.present).toEqual(['林潮']);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
