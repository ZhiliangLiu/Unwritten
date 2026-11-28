import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { seedLighthouseTown, seedStory } from '../test-support/story-fixtures.ts';
import { ancestorChain } from '../play/chain.ts';
import { openDatabase, type Database } from '../store/db.ts';
import { loadProjection, knowledgeOf, stateAt, stateDefByKey } from './projection.ts';
import { parseListValue } from './state.ts';
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
        ...EMPTY_CHANGES,
        entities: [
          {
            line: 1,
            kind: 'character',
            name: '老周',
            knownAs: '老周',
            profile: '看守',
            appearance: null,
            para: 1,
            protagonist: false,
            slot: null,
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
            appearance: null,
            para: 1,
            protagonist: true,
            slot: null,
          },
          {
            line: 2,
            kind: 'character',
            name: '沈岚',
            knownAs: '撑伞的女人',
            profile: '带着黑伞',
            appearance: null,
            para: 1,
            protagonist: false,
            slot: null,
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
            appearance: null,
            para: 1,
            protagonist: false,
            slot: null,
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

function appendTurn(db: Database, seeded: ReturnType<typeof seedLighthouseTown>): string {
  const id = randomUUID();
  db.run(
    sql`insert into turns (id, playthrough_id, parent_id, depth, prose, options, scene, status, created_at)
        values (${id}, ${seeded.playthroughId}, ${seeded.headTurnId}, 3, '又过了一天。', '[]',
                '{"place":"码头","time":"夜里","present":[],"presentIds":[]}', 'committed', ${Date.now()})`,
  );
  return id;
}

function parentStatesAt(db: Database, versionId: string, headTurnId: string) {
  const projection = projectionAt(db, versionId, headTurnId);
  const headDepth = projection.chain.at(-1)?.depth ?? -1;
  const states = new Map<string, { value: string | null; visible: boolean; closed: boolean }>();
  for (const def of projection.stateDefs.values()) {
    const value = stateAt(projection, def.id, headDepth);
    if (value) states.set(def.id, { value: value.value, visible: value.visible, closed: value.closed });
  }
  return states;
}

describe('writeChanges 状态栏与秘密', () => {
  it('清单只交一个新条目时保留原来的两项', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const turnId = appendTurn(opened.db, seeded);
      const changes: ValidatedChanges = {
        ...EMPTY_CHANGES,
        stateItems: [
          {
            line: 1,
            stateDef: { existing: seeded.ids['state:旧信'] ?? '' },
            item: '第二封',
            status: 'open',
          },
        ],
      };
      write(opened.db, {
        changes,
        createdIds: new Map(),
        turnId,
        versionId: seeded.versionId,
        entityVersionIds: [],
        entityOrigin: 'turn',
        protagonistId: seeded.ids.protagonist ?? null,
        parentPresentIds: [],
        parentStates: parentStatesAt(opened.db, seeded.versionId, seeded.headTurnId),
      });
      const row = opened.db.get<{ value: string; visible: number }>(
        sql`select value, visible from state_values
            where turn_id = ${turnId} and state_def_id = ${seeded.ids['state:旧信']}`,
      );
      expect(parseListValue(row?.value ?? null)).toEqual([
        { item: '第一封', status: 'done' },
        { item: '第二封', status: 'open' },
      ]);
      expect(row?.visible).toBe(1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('只交条目时沿用父回合的显示状态', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const turnId = appendTurn(opened.db, seeded);
      const changes: ValidatedChanges = {
        ...EMPTY_CHANGES,
        stateItems: [
          {
            line: 1,
            stateDef: { existing: seeded.ids['state:旧信'] ?? '' },
            item: '第三封',
            status: 'open',
          },
        ],
      };
      write(opened.db, {
        changes,
        createdIds: new Map(),
        turnId,
        versionId: seeded.versionId,
        entityVersionIds: [],
        entityOrigin: 'turn',
        protagonistId: seeded.ids.protagonist ?? null,
        parentPresentIds: [],
        parentStates: parentStatesAt(opened.db, seeded.versionId, seeded.headTurnId),
      });
      const row = opened.db.get<{ visible: number; closed: number }>(
        sql`select visible, closed from state_values
            where turn_id = ${turnId} and state_def_id = ${seeded.ids['state:旧信']}`,
      );
      expect(row?.visible).toBe(1);
      expect(row?.closed).toBe(0);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('秘密的知情者展开成确认知情', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const turnId = appendTurn(opened.db, seeded);
      const changes: ValidatedChanges = {
        ...EMPTY_CHANGES,
        secrets: [
          {
            line: 1,
            subject: { existing: seeded.ids.linchao ?? '' },
            title: '第三封信',
            statement: '第三封信藏在灯塔的灯室里',
            reveal: '主角找到第三封旧信时',
            knowers: [{ existing: seeded.ids.linchao ?? '' }],
            para: 1,
          },
        ],
      };
      write(opened.db, {
        changes,
        createdIds: new Map(),
        turnId,
        versionId: seeded.versionId,
        entityVersionIds: [],
        entityOrigin: 'turn',
        protagonistId: seeded.ids.protagonist ?? null,
        parentPresentIds: [],
        parentStates: parentStatesAt(opened.db, seeded.versionId, seeded.headTurnId),
      });
      const projection = projectionAt(opened.db, seeded.versionId, turnId);
      const fact = projection.facts.find(
        (candidate) => candidate.kind === 'secret' && candidate.statement === '第三封信藏在灯塔的灯室里',
      );
      expect(fact?.data?.title).toBe('第三封信');
      const records = fact ? knowledgeOf(projection, fact.id) : [];
      expect(records).toEqual([expect.objectContaining({ holderId: seeded.ids.linchao, level: 'confirmed' })]);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('新增栏目写进定义和状态值', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const turnId = appendTurn(opened.db, seeded);
      const changes: ValidatedChanges = {
        ...EMPTY_CHANGES,
        newStates: [
          {
            line: 1,
            key: '天气',
            label: '天气',
            display: 'text',
            config: { min: null, max: null, unit: null, stages: [] },
            hidden: false,
          },
        ],
        states: [
          {
            line: 2,
            stateDef: { created: 1 },
            value: '雨停了',
            visible: true,
            closed: null,
          },
        ],
      };
      write(opened.db, {
        changes,
        createdIds: new Map(),
        turnId,
        versionId: seeded.versionId,
        entityVersionIds: [],
        entityOrigin: 'turn',
        protagonistId: seeded.ids.protagonist ?? null,
        parentPresentIds: [],
        parentStates: parentStatesAt(opened.db, seeded.versionId, seeded.headTurnId),
      });
      const projection = projectionAt(opened.db, seeded.versionId, turnId);
      const def = stateDefByKey(projection, '天气');
      expect(def?.label).toBe('天气');
      expect(stateAt(projection, def?.id ?? '', 3)?.value).toBe('雨停了');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});

describe('writeChanges 实体形象与出处', () => {
  it('写入后档案里有形象，没有形象时档案里没有这个键', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }],
        entities: [{ key: 'lin', kind: 'character', name: '林远', protagonist: true }],
      });
      const changes: ValidatedChanges = {
        ...EMPTY_CHANGES,
        entities: [
          {
            line: 1,
            kind: 'character',
            name: '沈岚',
            knownAs: null,
            profile: '带着黑伞',
            appearance: '短卷发，深灰色旧风衣',
            para: 1,
            protagonist: false,
            slot: null,
          },
          {
            line: 2,
            kind: 'character',
            name: '老周',
            knownAs: null,
            profile: '看守',
            appearance: null,
            para: 1,
            protagonist: false,
            slot: null,
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
      const rows = opened.db.all<{ id: string; profile: string; source_para: number | null }>(
        sql`select id, profile, source_para from entities where version_id = ${seeded.versionId}`,
      );
      const shen = rows.find((row) => row.id === createdIds.get(1));
      const zhou = rows.find((row) => row.id === createdIds.get(2));
      expect(JSON.parse(shen?.profile ?? '{}')).toEqual({ text: '带着黑伞', appearance: '短卷发，深灰色旧风衣' });
      expect(Object.keys(JSON.parse(zhou?.profile ?? '{}'))).toEqual(['text']);
      expect(shen?.source_para).toBe(1);
      expect(zhou?.source_para).toBe(1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('续写的新实体记下出处段号，作者设定没有出处', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }],
        entities: [{ key: 'lin', kind: 'character', name: '林远', protagonist: true }],
      });
      const changes: ValidatedChanges = {
        ...EMPTY_CHANGES,
        entities: [
          {
            line: 1,
            kind: 'character',
            name: '沈岚',
            knownAs: null,
            profile: '带着黑伞',
            appearance: null,
            para: 3,
            protagonist: false,
            slot: null,
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
      const row = opened.db.get<{ source_para: number | null }>(
        sql`select source_para from entities where version_id = ${seeded.versionId} and id = ${createdIds.get(1)}`,
      );
      expect(row?.source_para).toBe(3);
      const projection = projectionAt(opened.db, seeded.versionId, seeded.headTurnId);
      expect(projection.entities.get(createdIds.get(1) ?? '')?.sourcePara).toBe(3);
      expect(projection.entities.get(seeded.ids.lin ?? '')?.sourcePara).toBeNull();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
