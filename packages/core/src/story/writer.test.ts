import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { seedStory } from '../test-support/story-fixtures.ts';
import { ancestorChain } from '../play/chain.ts';
import { openDatabase, type Database } from '../store/db.ts';
import { loadProjection, knowledgeOf } from './projection.ts';
import { allocateEntityIds, writeChanges, type WriteChangesInput } from './writer.ts';
import { EMPTY_CHANGES, type ValidatedChanges } from './types.ts';

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  return { temp, opened };
}

function projectionAt(db: Database, versionId: string, headTurnId: string) {
  const chain = ancestorChain(db, headTurnId).map((turn) => ({
    id: turn.id,
    depth: turn.depth,
    action: turn.action,
    prose: turn.prose,
    scene: turn.scene,
  }));
  return loadProjection(db, { versionId, chain });
}

function write(db: Database, input: WriteChangesInput) {
  db.transaction((tx) => writeChanges(tx, input), { behavior: 'immediate' });
}

describe('writeChanges', () => {
  it('写入后投影能读到', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
        ],
      });
      const changes: ValidatedChanges = {
        entities: [
          {
            line: 1,
            kind: 'character',
            name: '老周',
            knownAs: '老周',
            profile: '看守',
            para: 1,
            protagonist: false,
          },
        ],
        names: [],
        facts: [
          {
            line: 2,
            kind: 'event',
            subject: { created: 1 },
            object: { existing: seeded.ids.lin ?? '' },
            key: null,
            statement: '老周点亮了灯',
            data: null,
            para: 1,
            witnesses: [{ existing: seeded.ids.lin ?? '' }],
          },
          {
            line: 3,
            kind: 'relation',
            subject: { existing: seeded.ids.lin ?? '' },
            object: { created: 1 },
            key: 'acquaintance',
            statement: '两人认识',
            data: { stage: 'met' },
            para: 1,
            witnesses: [],
          },
        ],
        knowledge: [],
        scene: null,
      };
      const createdIds = allocateEntityIds(changes);
      write(opened.db, {
        changes,
        createdIds,
        turnId: seeded.headTurnId,
        versionId: seeded.versionId,
        entityVersionIds: [seeded.versionId],
        entityOrigin: 'turn',
        protagonistId: seeded.ids.lin ?? null,
        parentPresentIds: [],
      });
      const projection = projectionAt(opened.db, seeded.versionId, seeded.headTurnId);
      expect(projection.entities.get(createdIds.get(1) ?? '')?.name).toBe('老周');
      expect(projection.facts.map((fact) => fact.statement)).toContain('老周点亮了灯');
      expect(projection.facts.map((fact) => fact.statement)).toContain('两人认识');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('事件的目击者展开成确认知情', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
        ],
      });
      const changes: ValidatedChanges = {
        ...EMPTY_CHANGES,
        facts: [
          {
            line: 1,
            kind: 'event',
            subject: { existing: seeded.ids.shen ?? '' },
            object: null,
            key: null,
            statement: '她点亮了灯',
            data: null,
            para: 1,
            witnesses: [{ existing: seeded.ids.lin ?? '' }, { existing: seeded.ids.shen ?? '' }],
          },
        ],
      };
      write(opened.db, {
        changes,
        createdIds: new Map(),
        turnId: seeded.headTurnId,
        versionId: seeded.versionId,
        entityVersionIds: [seeded.versionId],
        entityOrigin: 'turn',
        protagonistId: seeded.ids.lin ?? null,
        parentPresentIds: [],
      });
      const projection = projectionAt(opened.db, seeded.versionId, seeded.headTurnId);
      const fact = projection.facts.find((candidate) => candidate.statement === '她点亮了灯');
      const records = fact ? knowledgeOf(projection, fact.id) : [];
      expect(records.map((record) => record.level)).toEqual(['confirmed', 'confirmed']);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('明写的知情覆盖目击者展开的', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
        ],
      });
      const changes: ValidatedChanges = {
        ...EMPTY_CHANGES,
        facts: [
          {
            line: 1,
            kind: 'event',
            subject: { existing: seeded.ids.shen ?? '' },
            object: null,
            key: null,
            statement: '她点亮了灯',
            data: null,
            para: 1,
            witnesses: [{ existing: seeded.ids.lin ?? '' }],
          },
        ],
        knowledge: [
          {
            line: 2,
            fact: { line: 1 },
            holder: { existing: seeded.ids.lin ?? '' },
            level: 'suspects',
            perceived: '也许是灯',
            via: null,
            para: 1,
          },
        ],
      };
      write(opened.db, {
        changes,
        createdIds: new Map(),
        turnId: seeded.headTurnId,
        versionId: seeded.versionId,
        entityVersionIds: [seeded.versionId],
        entityOrigin: 'turn',
        protagonistId: seeded.ids.lin ?? null,
        parentPresentIds: [],
      });
      const projection = projectionAt(opened.db, seeded.versionId, seeded.headTurnId);
      const fact = projection.facts.find((candidate) => candidate.statement === '她点亮了灯');
      const record = fact ? projection.knowledge.find((candidate) => candidate.factId === fact.id) : undefined;
      expect(record?.level).toBe('suspects');
      expect(record?.perceived).toBe('也许是灯');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('开场的新实体写进两个版本，id相同', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }],
        entities: [],
      });
      const draftId = randomUUID();
      opened.db.run(
        sql`insert into work_versions (id, work_id, kind, content_rev, meta, created_at, updated_at)
            values (${draftId}, ${seeded.workId}, 'draft', 0, '{"background":""}', ${Date.now()}, ${Date.now()})`,
      );
      const changes: ValidatedChanges = {
        ...EMPTY_CHANGES,
        entities: [
          {
            line: 1,
            kind: 'character',
            name: '林远',
            knownAs: null,
            profile: '邮差',
            para: 1,
            protagonist: true,
          },
          {
            line: 2,
            kind: 'character',
            name: '沈岚',
            knownAs: '撑伞的女人',
            profile: '带着黑伞',
            para: 1,
            protagonist: false,
          },
        ],
        names: [{ line: 3, entity: { created: 2 }, name: '沈岚', holder: { created: 1 }, para: 1 }],
      };
      const createdIds = allocateEntityIds(changes);
      write(opened.db, {
        changes,
        createdIds,
        turnId: seeded.headTurnId,
        versionId: seeded.versionId,
        entityVersionIds: [seeded.versionId, draftId],
        entityOrigin: 'version',
        protagonistId: null,
        parentPresentIds: [],
      });
      for (const versionId of [seeded.versionId, draftId]) {
        const rows = opened.db.all<{ id: string; is_protagonist: number }>(
          sql`select id, is_protagonist from entities where version_id = ${versionId}`,
        );
        expect(rows.map((row) => row.id).sort()).toEqual([...createdIds.values()].sort());
        expect(rows.find((row) => row.is_protagonist === 1)?.id).toBe(createdIds.get(1));
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('关系的 via 指向本次新增的人物时换成真实 id', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
        ],
      });
      const changes: ValidatedChanges = {
        ...EMPTY_CHANGES,
        entities: [
          {
            line: 1,
            kind: 'character',
            name: '老周',
            knownAs: null,
            profile: '',
            para: 1,
            protagonist: false,
          },
        ],
        facts: [
          {
            line: 2,
            kind: 'relation',
            subject: { existing: seeded.ids.lin ?? '' },
            object: { existing: seeded.ids.shen ?? '' },
            key: 'trust',
            statement: '主角信任沈岚',
            data: { via: 'created:1' },
            para: 1,
            witnesses: [],
          },
        ],
      };
      const createdIds = allocateEntityIds(changes);
      write(opened.db, {
        changes,
        createdIds,
        turnId: seeded.headTurnId,
        versionId: seeded.versionId,
        entityVersionIds: [seeded.versionId],
        entityOrigin: 'turn',
        protagonistId: seeded.ids.lin ?? null,
        parentPresentIds: [],
      });
      const row = opened.db.get<{ data: string }>(sql`select data from facts where statement = '主角信任沈岚'`);
      expect(row ? JSON.parse(row.data).via : null).toBe(createdIds.get(1));
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
