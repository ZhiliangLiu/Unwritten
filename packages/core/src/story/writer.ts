import { randomUUID } from 'node:crypto';
import type { Database } from '../store/db.ts';
import { entities, entityNames, facts, knowledge, stateDefs, stateValues } from '../store/schema.ts';
import { mergeListItems } from './state.ts';
import type {
  EntityRef,
  FactChange,
  FactRef,
  StateChange,
  StateDefRef,
  StateItemChange,
  ValidatedChanges,
} from './types.ts';

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
  parentStates?: Map<string, { value: string | null; visible: boolean; closed: boolean }>;
  castSlots?: Map<number, string>;
}

export interface WriteChangesResult {
  createdIds: Map<number, string>;
  protagonistId: string;
  scene: { presentIds: string[] } | null;
}

export function writeChanges(tx: StoryTx, input: WriteChangesInput): WriteChangesResult {
  const parentStates =
    input.parentStates ?? new Map<string, { value: string | null; visible: boolean; closed: boolean }>();
  const castSlots = input.castSlots ?? new Map<number, string>();
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
      castSlot: castSlots.get(entity.line) ?? null,
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
  const secretFactIds = new Map<number, string>();
  for (const secret of input.changes.secrets) {
    const id = randomUUID();
    secretFactIds.set(secret.line, id);
    factRows.push({
      versionId: input.versionId,
      id,
      originTurnId: input.turnId,
      sourcePara: secret.para,
      kind: 'secret',
      subjectId: secret.subject ? resolve(secret.subject) : null,
      objectId: null,
      key: null,
      statement: secret.statement,
      data: { title: secret.title, reveal: secret.reveal },
    });
  }
  for (const hit of input.changes.sceneHits) {
    factRows.push({
      versionId: input.versionId,
      id: randomUUID(),
      originTurnId: input.turnId,
      sourcePara: hit.para,
      kind: 'scene_hit',
      subjectId: null,
      objectId: null,
      key: hit.sceneId,
      statement: '关键场面已经发生。',
      data: null,
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
  for (const secret of input.changes.secrets) {
    const factId = secretFactIds.get(secret.line);
    if (!factId) continue;
    for (const knower of secret.knowers) {
      addKnowledge(factId, resolve(knower), 'confirmed', null, null, secret.para);
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

  const stateDefIds = new Map<number, string>();
  const stateDefRows = input.changes.newStates.map((def) => {
    const id = randomUUID();
    stateDefIds.set(def.line, id);
    return {
      versionId: input.versionId,
      id,
      key: def.key,
      label: def.label,
      display: def.display,
      config: def.config,
      hidden: def.hidden ? 1 : 0,
      reveal: null,
      originTurnId: input.turnId,
      rev: 0,
    };
  });
  if (stateDefRows.length) tx.insert(stateDefs).values(stateDefRows).run();

  const stateDefId = (ref: StateDefRef): string => {
    if ('existing' in ref) return ref.existing;
    const id = stateDefIds.get(ref.created);
    if (!id) throw new Error(`missing created state for line ${ref.created}`);
    return id;
  };
  const stateById = new Map<string, StateChange>();
  const itemsById = new Map<string, StateItemChange[]>();
  for (const state of input.changes.states) {
    stateById.set(stateDefId(state.stateDef), state);
  }
  for (const item of input.changes.stateItems) {
    const id = stateDefId(item.stateDef);
    const list = itemsById.get(id) ?? [];
    list.push(item);
    itemsById.set(id, list);
  }
  const stateValueInputs: Array<{
    stateDefId: string;
    value: string | null;
    visible: boolean;
    closed: boolean;
  }> = [];
  for (const id of new Set([...stateById.keys(), ...itemsById.keys()])) {
    const base = parentStates.get(id) ?? { value: null, visible: false, closed: false };
    const own = stateById.get(id);
    const items = itemsById.get(id) ?? [];
    const value = items.length
      ? mergeListItems(
          base.value,
          items.map((item) => ({ item: item.item, status: item.status })),
        )
      : (own?.value ?? base.value);
    stateValueInputs.push({
      stateDefId: id,
      value,
      visible: own?.visible ?? base.visible,
      closed: own?.closed ?? base.closed,
    });
  }
  writeStateValues(tx, { versionId: input.versionId, turnId: input.turnId, values: stateValueInputs });

  return {
    createdIds: input.createdIds,
    protagonistId,
    scene: input.changes.scene ? { presentIds: input.changes.scene.present.map(resolve) } : null,
  };
}

export function writeStateValues(
  tx: StoryTx,
  input: {
    versionId: string;
    turnId: string;
    values: Array<{ stateDefId: string; value: string | null; visible: boolean; closed: boolean }>;
  },
): void {
  if (!input.values.length) return;
  tx.insert(stateValues)
    .values(
      input.values.map((value) => ({
        versionId: input.versionId,
        turnId: input.turnId,
        stateDefId: value.stateDefId,
        value: value.value,
        visible: value.visible ? 1 : 0,
        closed: value.closed ? 1 : 0,
      })),
    )
    .run();
}
