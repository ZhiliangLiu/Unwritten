import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { seedLighthouseTown, seedNorthCape, seedStory } from '../test-support/story-fixtures.ts';
import { ancestorChain } from '../play/chain.ts';
import { openDatabase, type Database } from '../store/db.ts';
import { loadProjection, protagonistNameOf, sceneHitIds, stateAt, stateDefByKey } from './projection.ts';

function load(db: Database, versionId: string, headTurnId: string) {
  const chain = ancestorChain(db, headTurnId).map((turn) => ({
    id: turn.id,
    depth: turn.depth,
    action: turn.action,
    prose: turn.prose,
    scene: turn.scene,
  }));
  return loadProjection(db, { versionId, chain });
}

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  return { temp, opened };
}

describe('loadProjection', () => {
  it('只看得见祖先链上的事实', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }, { prose: 'A 分支', action: '走 A' }, { prose: 'B 分支', action: '走 B', parent: 0 }],
        entities: [
          { key: 'lin', kind: 'character', name: '主角', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
        ],
        facts: [
          { key: 'author', kind: 'event', subject: 'lin', statement: '作者设定的事' },
          { key: 'a', kind: 'event', subject: 'lin', statement: 'A 发生的事', originTurn: 1 },
          { key: 'b', kind: 'event', subject: 'lin', statement: 'B 发生的事', originTurn: 2 },
        ],
      });
      const first = load(opened.db, seeded.versionId, seeded.turnIds[1] ?? '');
      expect(first.facts.map((fact) => fact.statement)).toContain('作者设定的事');
      expect(first.facts.map((fact) => fact.statement)).toContain('A 发生的事');
      expect(first.facts.map((fact) => fact.statement)).not.toContain('B 发生的事');
      const second = load(opened.db, seeded.versionId, seeded.turnIds[2] ?? '');
      expect(second.facts.map((fact) => fact.statement)).toContain('B 发生的事');
      expect(second.facts.map((fact) => fact.statement)).not.toContain('A 发生的事');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('有键的事实后写的覆盖先写的，事件全部保留', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }, { prose: '第一回合', action: '一' }, { prose: '第三回合', action: '三' }],
        entities: [
          { key: 'lin', kind: 'character', name: '主角', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
        ],
        facts: [
          {
            key: 'mood1',
            kind: 'trait',
            subject: 'shen',
            factKey: 'mood',
            statement: '她有些不安',
            originTurn: 1,
            para: 1,
          },
          {
            key: 'mood2',
            kind: 'trait',
            subject: 'shen',
            factKey: 'mood',
            statement: '她平静下来',
            originTurn: 2,
            para: 1,
          },
          { key: 'event1', kind: 'event', subject: 'shen', statement: '第一件事', originTurn: 1, para: 1 },
          { key: 'event2', kind: 'event', subject: 'shen', statement: '第二件事', originTurn: 2, para: 1 },
        ],
      });
      const projection = load(opened.db, seeded.versionId, seeded.headTurnId);
      const moods = projection.facts.filter((fact) => fact.kind === 'trait' && fact.key === 'mood');
      expect(moods).toHaveLength(1);
      expect(moods[0]?.statement).toBe('她平静下来');
      expect(projection.facts.filter((fact) => fact.kind === 'event')).toHaveLength(2);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('知情取最新的程度', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }, { prose: '第一回合', action: '一' }, { prose: '第二回合', action: '二' }],
        entities: [
          { key: 'lin', kind: 'character', name: '主角', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
        ],
        facts: [
          {
            key: 'news',
            kind: 'event',
            subject: 'shen',
            statement: '渡轮停航了',
            originTurn: 0,
            para: 1,
          },
        ],
        knowledge: [
          { fact: 'news', holder: 'lin', level: 'heard', originTurn: 0, para: 1, perceived: '好像停航了' },
          { fact: 'news', holder: 'lin', level: 'confirmed', originTurn: 2, para: 1 },
        ],
      });
      const projection = load(opened.db, seeded.versionId, seeded.headTurnId);
      const record = projection.knowledge.find((candidate) => candidate.factId === (seeded.ids.news ?? ''));
      expect(record?.level).toBe('confirmed');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('主角的称呼随路线变化', () => {
    const { temp, opened } = setup();
    try {
      const early = seedNorthCape(opened.db, { head: 1 });
      const late = seedNorthCape(opened.db, { head: 2 });
      const earlyProjection = load(opened.db, early.versionId, early.headTurnId);
      const lateProjection = load(opened.db, late.versionId, late.headTurnId);
      expect(protagonistNameOf(earlyProjection, early.ids.shen ?? '')).toBe('撑伞的女人');
      expect(protagonistNameOf(lateProjection, late.ids.shen ?? '')).toBe('沈岚');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('缺主角时报错', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      opened.db.run(sql`delete from entities where version_id = ${seeded.versionId} and id = ${seeded.ids.lin}`);
      expect(() => load(opened.db, seeded.versionId, seeded.headTurnId)).toThrow('protagonist entity missing');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});

describe('loadProjection 作者设定与状态栏', () => {
  it('没有回合时只投影作者设定', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const projection = loadProjection(opened.db, { versionId: seeded.versionId, chain: [] });
      expect(projection.headTurnId).toBe('');
      expect(projection.entities.get(seeded.ids.linchao ?? '')?.name).toBe('林潮');
      expect(projection.stateDefs.size).toBe(4);
      expect(projection.stateValues).toEqual([]);
      expect(projection.facts.map((fact) => fact.kind)).toEqual(['secret']);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('状态值和已触发的场面按链投影', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const projection = load(opened.db, seeded.versionId, seeded.headTurnId);
      const trust = stateDefByKey(projection, '信任');
      expect(trust?.label).toBe('信任');
      expect(stateAt(projection, trust?.id ?? '', 0)?.value).toBe('陌生');
      expect(stateAt(projection, trust?.id ?? '', 1)?.value).toBe('相识');
      expect(stateAt(projection, trust?.id ?? '', 1)?.visible).toBe(true);
      expect(sceneHitIds(projection).has(seeded.ids['scene:towerTop'] ?? '')).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
