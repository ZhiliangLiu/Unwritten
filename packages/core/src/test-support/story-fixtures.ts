import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { EntityKind, KnowledgeLevel } from '@unwritten/contracts';
import type { Database } from '../store/db.ts';
import { indexTurnProse } from '../store/prose-index.ts';
import type { FactData, FactKind } from '../story/types.ts';

export interface SeedSpec {
  turns: Array<{
    prose: string;
    action?: string;
    parent?: number;
    place?: string;
    time?: string;
    presentKeys?: string[];
  }>;
  head?: number;
  entities: Array<{
    key: string;
    kind: EntityKind;
    name: string;
    profile?: string;
    protagonist?: boolean;
    originTurn?: number | null;
  }>;
  names?: Array<{
    entity: string;
    name: string;
    holder: string | null;
    originTurn?: number | null;
    para?: number;
  }>;
  facts?: Array<{
    key: string;
    kind: FactKind;
    subject?: string;
    object?: string;
    factKey?: string;
    statement: string;
    data?: FactData;
    originTurn?: number | null;
    para?: number;
  }>;
  knowledge?: Array<{
    fact: string;
    holder: string;
    level: KnowledgeLevel;
    perceived?: string;
    via?: string;
    originTurn?: number | null;
    para?: number;
  }>;
}

export interface SeededStory {
  workId: string;
  versionId: string;
  playthroughId: string;
  routeId: string;
  headTurnId: string;
  turnIds: string[];
  ids: Record<string, string>;
}

export function seedStory(db: Database, spec: SeedSpec): SeededStory {
  const workId = randomUUID();
  const versionId = randomUUID();
  const playthroughId = randomUUID();
  const routeId = randomUUID();
  const now = Date.now();
  const turnIds = spec.turns.map(() => randomUUID());
  const entityIds = new Map(spec.entities.map((entity) => [entity.key, randomUUID()]));
  const factIds = new Map((spec.facts ?? []).map((fact) => [fact.key, randomUUID()]));

  db.run(
    sql`insert into works (id, draft_id, published_id, created_at, updated_at)
        values (${workId}, ${versionId}, ${versionId}, ${now}, ${now})`,
  );
  db.run(
    sql`insert into work_versions (id, work_id, kind, content_rev, source_rev, meta, created_at, updated_at)
        values (${versionId}, ${workId}, 'published', 1, 1, '{"background":""}', ${now}, ${now})`,
  );
  db.run(
    sql`insert into playthroughs (id, version_id, kind, root_turn_id, created_at)
        values (${playthroughId}, ${versionId}, 'play', ${turnIds[0] ?? ''}, ${now})`,
  );

  const depths: number[] = [];
  spec.turns.forEach((turn, index) => {
    const parent = turn.parent ?? index - 1;
    depths.push(parent < 0 ? 0 : (depths[parent] ?? 0) + 1);
  });
  spec.turns.forEach((turn, index) => {
    const parent = turn.parent ?? index - 1;
    const presentKeys = turn.presentKeys ?? [];
    const present = presentKeys.map((key) => spec.entities.find((entity) => entity.key === key)?.name ?? key);
    const presentIds = presentKeys.map((key) => entityIds.get(key) ?? '');
    db.run(
      sql`insert into turns (id, playthrough_id, parent_id, depth, action, prose, options, scene, status, created_at)
          values (${turnIds[index] ?? ''}, ${playthroughId}, ${parent < 0 ? null : (turnIds[parent] ?? null)},
                  ${depths[index] ?? 0}, ${turn.action ? JSON.stringify({ text: turn.action, optionIndex: null }) : null},
                  ${turn.prose}, '[]',
                  ${JSON.stringify({ place: turn.place ?? '', time: turn.time ?? '', present, presentIds })},
                  'committed', ${now})`,
    );
  });
  const headIndex = spec.head ?? spec.turns.length - 1;
  db.run(
    sql`insert into routes (id, playthrough_id, head_turn_id, created_at, updated_at)
        values (${routeId}, ${playthroughId}, ${turnIds[headIndex] ?? ''}, ${now}, ${now})`,
  );

  for (const entity of spec.entities) {
    const id = entityIds.get(entity.key) ?? '';
    db.run(
      sql`insert into entities (version_id, id, kind, name, profile, is_protagonist, origin_turn_id)
          values (${versionId}, ${id}, ${entity.kind}, ${entity.name},
                  ${JSON.stringify({ text: entity.profile ?? '' })}, ${entity.protagonist ? 1 : 0},
                  ${entity.originTurn === undefined || entity.originTurn === null ? null : (turnIds[entity.originTurn] ?? null)})`,
    );
  }
  for (const name of spec.names ?? []) {
    db.run(
      sql`insert into entity_names (version_id, entity_id, name, holder_id, origin_turn_id, source_para)
          values (${versionId}, ${entityIds.get(name.entity) ?? ''}, ${name.name},
                  ${name.holder === null ? null : (entityIds.get(name.holder) ?? null)},
                  ${name.originTurn === undefined || name.originTurn === null ? null : (turnIds[name.originTurn] ?? null)},
                  ${name.para ?? null})`,
    );
  }
  for (const fact of spec.facts ?? []) {
    db.run(
      sql`insert into facts (version_id, id, origin_turn_id, source_para, kind, subject_id, object_id, key, statement, data)
          values (${versionId}, ${factIds.get(fact.key) ?? ''},
                  ${fact.originTurn === undefined || fact.originTurn === null ? null : (turnIds[fact.originTurn] ?? null)},
                  ${fact.para ?? null}, ${fact.kind},
                  ${fact.subject ? (entityIds.get(fact.subject) ?? null) : null},
                  ${fact.object ? (entityIds.get(fact.object) ?? null) : null},
                  ${fact.factKey ?? null}, ${fact.statement},
                  ${fact.data ? JSON.stringify(fact.data) : null})`,
    );
  }
  for (const record of spec.knowledge ?? []) {
    db.run(
      sql`insert into knowledge (version_id, fact_id, holder_id, level, perceived_statement, via_id, origin_turn_id, source_para)
          values (${versionId}, ${factIds.get(record.fact) ?? ''}, ${entityIds.get(record.holder) ?? ''},
                  ${record.level}, ${record.perceived ?? null},
                  ${record.via ? (entityIds.get(record.via) ?? null) : null},
                  ${record.originTurn === undefined || record.originTurn === null ? null : (turnIds[record.originTurn] ?? null)},
                  ${record.para ?? null})`,
    );
  }
  spec.turns.forEach((turn, index) => indexTurnProse(db, turnIds[index] ?? '', turn.prose));

  const ids: Record<string, string> = {};
  for (const [key, id] of entityIds) ids[key] = id;
  for (const [key, id] of factIds) ids[key] = id;

  return {
    workId,
    versionId,
    playthroughId,
    routeId,
    headTurnId: turnIds[headIndex] ?? '',
    turnIds,
    ids,
  };
}

export function seedNorthCape(db: Database, options?: { head?: number }): SeededStory {
  return seedStory(db, {
    head: options?.head,
    turns: [
      {
        prose:
          '雨下到第三天，北岬灯塔的灯还亮着。你提着行李走上栈桥，木板在脚下吱呀作响。\n\n栈桥尽头站着一个撑伞的女人。她把伞往你这边倾了倾，说末班渡轮已经停航。\n\n灯塔看守老周从值班室探出头，朝你们招手。',
        place: '北岬栈桥',
        time: '第三天傍晚',
        presentKeys: ['shen', 'zhou'],
      },
      {
        action: '把行李交给老周，问他今晚能不能借宿',
        prose: '老周接过行李，说值班室后面还有一张空床。\n\n撑伞的女人没有跟进来，她站在门口，看着海面。',
        place: '北岬栈桥',
        time: '第三天傍晚',
        presentKeys: ['shen', 'zhou'],
      },
      {
        action: '问撑伞的女人叫什么名字',
        prose: '她说她叫沈岚，在等下一班船。\n\n老周把一把铜钥匙放在桌上，说灯塔顶层的门只有这一把钥匙。',
        place: '北岬灯塔值班室',
        time: '第三天夜里',
        presentKeys: ['shen', 'zhou'],
      },
    ],
    entities: [
      { key: 'lin', kind: 'character', name: '林远', profile: '刚到北岬的邮差', protagonist: true },
      { key: 'shen', kind: 'character', name: '沈岚', profile: '说话很慢，总带着一把黑伞' },
      { key: 'zhou', kind: 'character', name: '老周', profile: '灯塔看守，话不多' },
      { key: 'tower', kind: 'place', name: '北岬灯塔', profile: '岬角尽头的白色灯塔' },
      { key: 'brassKey', kind: 'item', name: '铜钥匙', profile: '灯塔顶层门的钥匙', originTurn: 2 },
    ],
    names: [
      { entity: 'lin', name: '林远', holder: 'lin', originTurn: 0, para: 1 },
      { entity: 'shen', name: '撑伞的女人', holder: 'lin', originTurn: 0, para: 2 },
      { entity: 'shen', name: '沈岚', holder: 'lin', originTurn: 2, para: 1 },
      { entity: 'zhou', name: '老周', holder: 'lin', originTurn: 0, para: 3 },
      { entity: 'tower', name: '北岬灯塔', holder: 'lin', originTurn: 0, para: 1 },
      { entity: 'brassKey', name: '铜钥匙', holder: 'lin', originTurn: 2, para: 2 },
    ],
    facts: [
      {
        key: 'meet',
        kind: 'relation',
        subject: 'lin',
        object: 'shen',
        factKey: 'acquaintance',
        statement: '主角在栈桥上遇见撑伞的女人',
        data: { stage: 'met' },
        originTurn: 0,
        para: 2,
      },
      {
        key: 'ferry',
        kind: 'event',
        subject: 'shen',
        object: 'lin',
        statement: '沈岚告诉主角末班渡轮已经停航',
        originTurn: 0,
        para: 2,
      },
      {
        key: 'wait',
        kind: 'trait',
        subject: 'shen',
        factKey: '等待',
        statement: '她在等下一班船',
        originTurn: 2,
        para: 1,
      },
      {
        key: 'keyOnTable',
        kind: 'event',
        subject: 'zhou',
        object: 'brassKey',
        statement: '老周把灯塔顶层的铜钥匙放在桌上',
        originTurn: 2,
        para: 2,
      },
    ],
    knowledge: [
      { fact: 'ferry', holder: 'lin', level: 'confirmed', originTurn: 0, para: 2 },
      { fact: 'ferry', holder: 'shen', level: 'confirmed', originTurn: 0, para: 2 },
      { fact: 'keyOnTable', holder: 'lin', level: 'confirmed', originTurn: 2, para: 2 },
      { fact: 'keyOnTable', holder: 'zhou', level: 'confirmed', originTurn: 2, para: 2 },
      { fact: 'wait', holder: 'lin', level: 'confirmed', originTurn: 2, para: 1 },
    ],
  });
}
