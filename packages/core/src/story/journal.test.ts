import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { seedLighthouseTown, seedStory } from '../test-support/story-fixtures.ts';
import { ancestorChain } from '../play/chain.ts';
import { openDatabase, type Database } from '../store/db.ts';
import { buildJournal } from './journal.ts';
import { loadProjection } from './projection.ts';

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  return { temp, opened };
}

function journal(db: Database, versionId: string, headTurnId: string, routeId: string) {
  const chain = ancestorChain(db, headTurnId).map((turn) => ({
    id: turn.id,
    depth: turn.depth,
    action: turn.action,
    prose: turn.prose,
    scene: turn.scene,
  }));
  return buildJournal(loadProjection(db, { versionId, chain }), routeId);
}

describe('buildJournal', () => {
  it('只收录主角知道称呼的实体', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'known', kind: 'character', name: '沈岚' },
          { key: 'unknown', kind: 'character', name: '陌生人' },
        ],
        names: [{ entity: 'known', name: '撑伞的女人', holder: 'lin', originTurn: 0, para: 1 }],
        facts: [
          { key: 'event', kind: 'event', subject: 'known', statement: '她在等船', originTurn: 0, para: 1 },
          { key: 'other', kind: 'event', subject: 'unknown', statement: '陌生人走远了', originTurn: 0, para: 1 },
        ],
        knowledge: [
          { fact: 'event', holder: 'lin', level: 'confirmed', originTurn: 0, para: 1 },
          { fact: 'other', holder: 'lin', level: 'confirmed', originTurn: 0, para: 1 },
        ],
      });
      const view = journal(opened.db, seeded.versionId, seeded.headTurnId, seeded.routeId);
      expect(view.subjects).toHaveLength(1);
      expect(view.subjects[0]?.name).toBe('撑伞的女人');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('不知道的真名在手记里被遮住', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
        ],
        names: [{ entity: 'shen', name: '撑伞的女人', holder: 'lin', originTurn: 0, para: 1 }],
        facts: [
          {
            key: 'event',
            kind: 'event',
            subject: 'shen',
            object: 'lin',
            statement: '沈岚把伞递给林远',
            originTurn: 0,
            para: 1,
          },
        ],
        knowledge: [{ fact: 'event', holder: 'lin', level: 'confirmed', originTurn: 0, para: 1 }],
      });
      const view = journal(opened.db, seeded.versionId, seeded.headTurnId, seeded.routeId);
      const lines = view.subjects[0]?.lines ?? [];
      expect(lines[0]?.text).toBe('撑伞的女人把伞递给林远');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('听说的事用主角听到的说法', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
        ],
        names: [{ entity: 'shen', name: '撑伞的女人', holder: 'lin', originTurn: 0, para: 1 }],
        facts: [{ key: 'news', kind: 'event', subject: 'shen', statement: '沈岚是船工', originTurn: 0, para: 1 }],
        knowledge: [
          {
            fact: 'news',
            holder: 'lin',
            level: 'heard',
            perceived: '听说她认识船工',
            via: 'shen',
            originTurn: 0,
            para: 1,
          },
        ],
      });
      const view = journal(opened.db, seeded.versionId, seeded.headTurnId, seeded.routeId);
      expect(view.subjects[0]?.lines[0]?.text).toBe('听说她认识船工');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});

describe('buildJournal 秘密', () => {
  it('主角不知情的秘密不进手记', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const view = journal(opened.db, seeded.versionId, seeded.headTurnId, seeded.routeId);
      const lines = view.subjects.flatMap((subject) => subject.lines);
      expect(lines.map((line) => line.text)).not.toContain('上一任邮差在灯塔里住过一年，后来乘夜船离开');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('主角得知后进手记', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      opened.db.run(
        sql`insert into knowledge (version_id, fact_id, holder_id, level, origin_turn_id, source_para)
            values (${seeded.versionId}, ${seeded.ids.secret}, ${seeded.ids.protagonist}, 'confirmed',
                    ${seeded.turnIds[2]}, 2)`,
      );
      const view = journal(opened.db, seeded.versionId, seeded.headTurnId, seeded.routeId);
      const subject = view.subjects.find((candidate) => candidate.entityId === seeded.ids.linchao);
      expect(subject?.lines.map((line) => line.text)).toContain('上一任邮差在灯塔里住过一年，后来乘夜船离开');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
