import { randomUUID } from 'node:crypto';
import type { Database } from '../store/db.ts';
import { entities, entityNames, facts, knowledge } from '../store/schema.ts';
import type { EntityRef, FactChange, FactRef, ValidatedChanges } from './types.ts';

export type StoryTx = Pick<Database, 'insert'>;

export function allocateEntityIds(changes: ValidatedChanges): Map<number, string> {
  const ids = new Map<number, string>();
  for (const entity of changes.entities) ids.set(entity.line, randomUUID());
  return ids;
}

export interface WriteChangesInput {
  changes: ValidatedChanges;
  createdIds: Map<number, string>;
  turnId: string;
  versionId: string;
  entityVersionIds: string[];
  entityOrigin: 'version' | 'turn';
  protagonistId: string | null;
  parentPresentIds: string[];
}

export interface WriteChangesResult {
  createdIds: Map<number, string>;
  protagonistId: string;
  scene: { presentIds: string[] } | null;
}

export function writeChanges(tx: StoryTx, input: WriteChangesInput): WriteChangesResult {
  const createdId = (line: number): string => {
    const id = input.createdIds.get(line);
    if (!id) throw new Error(`missing created entity for line ${line}`);
    return id;
  };
  const resolve = (ref: EntityRef): string => ('existing' in ref ? ref.existing : createdId(ref.created));

  const entityRows = input.entityVersionIds.flatMap((versionId) =>
    input.changes.entities.map((entity) => ({
      versionId,
      id: createdId(entity.line),
      kind: entity.kind,
      name: entity.name,
      profile: { text: entity.profile },
      isProtagonist: entity.protagonist ? 1 : 0,
      originTurnId: input.entityOrigin === 'version' ? null : input.turnId,
    })),
  );
  if (entityRows.length) tx.insert(entities).values(entityRows).run();

  const protagonist = input.changes.entities.find((entity) => entity.protagonist);
  const protagonistId = input.protagonistId ?? (protagonist ? createdId(protagonist.line) : null);
  if (!protagonistId) throw new Error('protagonist entity missing');

  const nameRows = new Map<
    string,
    { versionId: string; entityId: string; name: string; holderId: string; originTurnId: string; sourcePara: number }
  >();
  const addName = (entityId: string, name: string, holderId: string, sourcePara: number) => {
    const key = `${entityId}|${name}|${holderId}`;
    if (!nameRows.has(key)) {
      nameRows.set(key, {
        versionId: input.versionId,
        entityId,
        name,
        holderId,
        originTurnId: input.turnId,
        sourcePara,
      });
    }
  };
  if (protagonist) {
    addName(protagonistId, protagonist.name, protagonistId, 1);
  }
  for (const entity of input.changes.entities) {
    if (!entity.knownAs) continue;
    addName(createdId(entity.line), entity.knownAs, protagonistId, entity.para);
  }
  for (const name of input.changes.names) {
    addName(resolve(name.entity), name.name, resolve(name.holder), name.para);
  }
  if (nameRows.size)
    tx.insert(entityNames)
      .values([...nameRows.values()])
      .run();

  const factIds = new Map<number, string>();
  const factRows: Array<{
    versionId: string;
    id: string;
    originTurnId: string;
    sourcePara: number;
    kind: FactChange['kind'];
    subjectId: string | null;
    objectId: string | null;
    key: string | null;
    statement: string;
    data: FactChange['data'];
  }> = [];
  for (const fact of input.changes.facts) {
    const id = randomUUID();
    factIds.set(fact.line, id);
    const data = fact.data ? { ...fact.data } : null;
    if (data && typeof data.via === 'string' && data.via.startsWith('created:')) {
      data.via = createdId(Number(data.via.slice('created:'.length)));
    }
    factRows.push({
      versionId: input.versionId,
      id,
      originTurnId: input.turnId,
      sourcePara: fact.para,
      kind: fact.kind,
      subjectId: fact.subject ? resolve(fact.subject) : null,
      objectId: fact.object ? resolve(fact.object) : null,
      key: fact.key,
      statement: fact.statement,
      data,
    });
  }
  if (factRows.length) tx.insert(facts).values(factRows).run();

  const knowledgeRows = new Map<
    string,
    {
      versionId: string;
      factId: string;
      holderId: string;
      level: ValidatedChanges['knowledge'][number]['level'];
      perceivedStatement: string | null;
      viaId: string | null;
      originTurnId: string;
      sourcePara: number;
    }
  >();
  const addKnowledge = (
    factId: string,
    holderId: string,
    level: ValidatedChanges['knowledge'][number]['level'],
    perceived: string | null,
    viaId: string | null,
    sourcePara: number,
  ) => {
    knowledgeRows.set(`${factId}|${holderId}`, {
      versionId: input.versionId,
      factId,
      holderId,
      level,
      perceivedStatement: perceived,
      viaId,
      originTurnId: input.turnId,
      sourcePara,
    });
  };
  for (const fact of input.changes.facts) {
    if (fact.kind !== 'event') continue;
    const factId = factIds.get(fact.line);
    if (!factId) continue;
    for (const witness of fact.witnesses) {
      addKnowledge(factId, resolve(witness), 'confirmed', null, null, fact.para);
    }
  }
  const resolveFact = (ref: FactRef): string => {
    if ('existing' in ref) return ref.existing;
    const id = factIds.get(ref.line);
    if (!id) throw new Error(`missing fact for line ${ref.line}`);
    return id;
  };
  for (const record of input.changes.knowledge) {
    addKnowledge(
      resolveFact(record.fact),
      resolve(record.holder),
      record.level,
      record.perceived,
      record.via ? resolve(record.via) : null,
      record.para,
    );
  }
  if (knowledgeRows.size)
    tx.insert(knowledge)
      .values([...knowledgeRows.values()])
      .run();

  return {
    createdIds: input.createdIds,
    protagonistId,
    scene: input.changes.scene ? { presentIds: input.changes.scene.present.map(resolve) } : null,
  };
}
