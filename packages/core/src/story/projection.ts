import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { EntityKind } from '@unwritten/contracts';
import type { Database } from '../store/db.ts';
import { entities, entityNames, facts, knowledge, stateDefs, stateValues, turnSummaries } from '../store/schema.ts';
import type { StoredAction, StoredScene } from '../store/meta.ts';
import { splitParagraphs } from '../text/turn-text.ts';
import {
  STORY_LIMITS,
  type ChainTurn,
  type FactData,
  type FactKind,
  type ProjEntity,
  type ProjFact,
  type ProjKnowledge,
  type ProjName,
  type ProjStateDef,
  type ProjStateValue,
  type StoryProjection,
} from './types.ts';

export interface ProjectionInput {
  versionId: string;
  chain: Array<{ id: string; depth: number; action: StoredAction | null; prose: string; scene: StoredScene }>;
}

export const KIND_UNKNOWN_LABEL: Record<EntityKind, string> = {
  character: '一个不知道名字的人',
  place: '一个地方',
  item: '一件东西',
  group: '一群人',
  other: '某样东西',
};

export function loadProjection(db: Database, input: ProjectionInput): StoryProjection {
  const chainIds = input.chain.map((turn) => turn.id);
  const depthOf = new Map(input.chain.map((turn) => [turn.id, turn.depth]));
  const depth = (turnId: string | null): number => (turnId === null ? -1 : (depthOf.get(turnId) ?? -1));
  const visible =
    chainIds.length === 0
      ? isNull(entities.originTurnId)
      : or(isNull(entities.originTurnId), inArray(entities.originTurnId, chainIds));
  const visibleNames =
    chainIds.length === 0
      ? isNull(entityNames.originTurnId)
      : or(isNull(entityNames.originTurnId), inArray(entityNames.originTurnId, chainIds));
  const visibleFacts =
    chainIds.length === 0
      ? isNull(facts.originTurnId)
      : or(isNull(facts.originTurnId), inArray(facts.originTurnId, chainIds));
  const visibleKnowledge =
    chainIds.length === 0
      ? isNull(knowledge.originTurnId)
      : or(isNull(knowledge.originTurnId), inArray(knowledge.originTurnId, chainIds));
  const visibleStateDefs =
    chainIds.length === 0
      ? isNull(stateDefs.originTurnId)
      : or(isNull(stateDefs.originTurnId), inArray(stateDefs.originTurnId, chainIds));

  const entityRows = db
    .select()
    .from(entities)
    .where(and(eq(entities.versionId, input.versionId), visible))
    .all();
  const projectionEntities = new Map<string, ProjEntity>();
  for (const row of entityRows) {
    projectionEntities.set(row.id, {
      id: row.id,
      kind: row.kind,
      name: row.name,
      profile: row.profile.text,
      isProtagonist: row.isProtagonist === 1,
      originTurnId: row.originTurnId,
      originDepth: depth(row.originTurnId),
    });
  }

  const nameRows = db
    .select({
      seq: sql<number>`rowid`,
      entityId: entityNames.entityId,
      name: entityNames.name,
      holderId: entityNames.holderId,
      originTurnId: entityNames.originTurnId,
      sourcePara: entityNames.sourcePara,
    })
    .from(entityNames)
    .where(and(eq(entityNames.versionId, input.versionId), visibleNames))
    .all();
  const names: ProjName[] = nameRows
    .map((row) => ({
      entityId: row.entityId,
      name: row.name,
      holderId: row.holderId,
      depth: depth(row.originTurnId),
      turnId: row.originTurnId,
      para: row.sourcePara,
      seq: Number(row.seq),
    }))
    .sort((left, right) => left.depth - right.depth || left.seq - right.seq);

  const factRows = db
    .select()
    .from(facts)
    .where(and(eq(facts.versionId, input.versionId), visibleFacts))
    .all();
  const allFacts: ProjFact[] = factRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    subjectId: row.subjectId,
    objectId: row.objectId,
    key: row.key,
    statement: row.statement,
    data: row.data,
    depth: depth(row.originTurnId),
    turnId: row.originTurnId,
    para: row.sourcePara,
  }));
  const grouped = new Map<string, ProjFact>();
  const covered: ProjFact[] = [];
  for (const fact of allFacts) {
    if (fact.key === null) {
      covered.push(fact);
      continue;
    }
    const key = `${fact.kind}|${fact.subjectId ?? ''}|${fact.objectId ?? ''}|${fact.key}`;
    const current = grouped.get(key);
    if (!current || fact.depth > current.depth) grouped.set(key, fact);
  }
  covered.push(...grouped.values());
  covered.sort((left, right) => left.depth - right.depth);

  const knowledgeRows = db
    .select()
    .from(knowledge)
    .where(and(eq(knowledge.versionId, input.versionId), visibleKnowledge))
    .all();
  const knowledgeByHolder = new Map<string, ProjKnowledge>();
  for (const row of knowledgeRows) {
    const value: ProjKnowledge = {
      factId: row.factId,
      holderId: row.holderId,
      level: row.level,
      perceived: row.perceivedStatement,
      viaId: row.viaId,
      depth: depth(row.originTurnId),
      turnId: row.originTurnId,
      para: row.sourcePara,
    };
    const key = `${row.factId}|${row.holderId}`;
    const current = knowledgeByHolder.get(key);
    if (!current || value.depth > current.depth) knowledgeByHolder.set(key, value);
  }
  const knowledgeList = [...knowledgeByHolder.values()].sort((left, right) => left.depth - right.depth);

  const stateDefRows = db
    .select()
    .from(stateDefs)
    .where(and(eq(stateDefs.versionId, input.versionId), visibleStateDefs))
    .all();
  const projectionStateDefs = new Map<string, ProjStateDef>();
  for (const row of stateDefRows) {
    projectionStateDefs.set(row.id, {
      id: row.id,
      key: row.key,
      label: row.label,
      display: row.display,
      config: row.config,
      hidden: row.hidden === 1,
      reveal: row.reveal,
      originTurnId: row.originTurnId,
      originDepth: depth(row.originTurnId),
    });
  }

  const stateValueRows =
    chainIds.length === 0
      ? []
      : db
          .select()
          .from(stateValues)
          .where(and(eq(stateValues.versionId, input.versionId), inArray(stateValues.turnId, chainIds)))
          .all();
  const projectionStateValues: ProjStateValue[] = stateValueRows
    .map((row) => ({
      stateDefId: row.stateDefId,
      turnId: row.turnId,
      depth: depth(row.turnId),
      value: row.value,
      visible: row.visible === 1,
      closed: row.closed === 1,
    }))
    .sort((left, right) => left.depth - right.depth);

  const summaryRows =
    chainIds.length === 0 ? [] : db.select().from(turnSummaries).where(inArray(turnSummaries.turnId, chainIds)).all();
  const summaries = new Map(summaryRows.map((row) => [row.turnId, row.summary]));

  const chain: ChainTurn[] = input.chain.map((turn) => ({
    id: turn.id,
    depth: turn.depth,
    action: turn.action,
    paragraphs: splitParagraphs(turn.prose),
    scene: turn.scene,
  }));

  const protagonist = entityRows.find((row) => row.isProtagonist === 1);
  if (!protagonist) throw new Error('protagonist entity missing');

  return {
    versionId: input.versionId,
    headTurnId: input.chain.at(-1)?.id ?? '',
    protagonistId: protagonist.id,
    chain,
    entities: projectionEntities,
    names,
    facts: covered,
    knowledge: knowledgeList,
    summaries,
    stateDefs: projectionStateDefs,
    stateValues: projectionStateValues,
  };
}

export function currentNameHeldBy(p: StoryProjection, entityId: string, holderId: string | null): string | null {
  let current: ProjName | null = null;
  for (const name of p.names) {
    if (name.entityId !== entityId || name.holderId !== holderId) continue;
    if (!current || name.depth > current.depth || (name.depth === current.depth && name.seq > current.seq)) {
      current = name;
    }
  }
  return current?.name ?? null;
}

export function protagonistNameOf(p: StoryProjection, entityId: string): string | null {
  const held = currentNameHeldBy(p, entityId, p.protagonistId);
  if (held) return held;
  const publicName = currentNameHeldBy(p, entityId, null);
  if (publicName) return publicName;
  if (entityId === p.protagonistId) return p.entities.get(entityId)?.name ?? null;
  return null;
}

export function knowledgeOf(p: StoryProjection, factId: string): ProjKnowledge[] {
  return p.knowledge.filter((record) => record.factId === factId);
}

export function protagonistKnowledge(p: StoryProjection, factId: string): ProjKnowledge | null {
  return p.knowledge.find((record) => record.factId === factId && record.holderId === p.protagonistId) ?? null;
}

export function presentIdsAtHead(p: StoryProjection): string[] {
  const present = p.chain.at(-1)?.scene.presentIds ?? [];
  return present.filter((id) => p.entities.has(id));
}

export function appearedEntityIds(p: StoryProjection): Set<string> {
  const appeared = new Set<string>();
  for (const entity of p.entities.values()) {
    if (entity.originDepth >= 0) appeared.add(entity.id);
  }
  for (const fact of p.facts) {
    if (fact.depth < 0) continue;
    if (fact.subjectId) appeared.add(fact.subjectId);
    if (fact.objectId) appeared.add(fact.objectId);
  }
  for (const turn of p.chain) {
    for (const id of turn.scene.presentIds) appeared.add(id);
  }
  for (const name of p.names) {
    if (name.depth >= 0) appeared.add(name.entityId);
  }
  return appeared;
}

export function acquaintanceStage(p: StoryProjection, entityId: string): string | null {
  let latest: ProjFact | null = null;
  for (const fact of p.facts) {
    if (fact.kind !== 'relation' || fact.key !== 'acquaintance') continue;
    const forward = fact.subjectId === p.protagonistId && fact.objectId === entityId;
    const backward = fact.subjectId === entityId && fact.objectId === p.protagonistId;
    if (!forward && !backward) continue;
    if (!latest || fact.depth > latest.depth) latest = fact;
  }
  const stage = latest?.data?.stage;
  return typeof stage === 'string' ? stage : null;
}

export function openPromises(p: StoryProjection): ProjFact[] {
  return p.facts.filter((fact) => fact.kind === 'promise' && fact.data?.status === 'agreed');
}

export function stateDefByKey(p: StoryProjection, key: string): ProjStateDef | null {
  let found: ProjStateDef | null = null;
  for (const def of p.stateDefs.values()) {
    if (def.key !== key) continue;
    if (!found || def.originDepth > found.originDepth) found = def;
  }
  return found;
}

export function stateAt(p: StoryProjection, stateDefId: string, depth: number): ProjStateValue | null {
  let found: ProjStateValue | null = null;
  for (const value of p.stateValues) {
    if (value.stateDefId !== stateDefId || value.depth > depth) continue;
    if (!found || value.depth > found.depth) found = value;
  }
  return found;
}

export function sceneHitIds(p: StoryProjection): Set<string> {
  const ids = new Set<string>();
  for (const fact of p.facts) if (fact.kind === 'scene_hit' && fact.key !== null) ids.add(fact.key);
  return ids;
}

export function protagonistKnownStrings(p: StoryProjection): Set<string> {
  const known = new Set<string>();
  for (const entity of p.entities.values()) {
    const name = protagonistNameOf(p, entity.id);
    if (name) known.add(name);
  }
  for (const name of p.names) {
    if (name.holderId === p.protagonistId || name.holderId === null) known.add(name.name);
  }
  const protagonist = p.entities.get(p.protagonistId);
  if (protagonist) known.add(protagonist.name);
  return known;
}

export function maskUnknownNames(p: StoryProjection, text: string): string {
  const known = protagonistKnownStrings(p);
  const replacements: Array<{ from: string; to: string }> = [];
  for (const entity of p.entities.values()) {
    const candidates = new Set<string>([entity.name]);
    for (const name of p.names) if (name.entityId === entity.id) candidates.add(name.name);
    for (const candidate of candidates) {
      if (Array.from(candidate).length < STORY_LIMITS.nameMinLengthForLeakCheck) continue;
      if (known.has(candidate)) continue;
      replacements.push({
        from: candidate,
        to: protagonistNameOf(p, entity.id) ?? KIND_UNKNOWN_LABEL[entity.kind],
      });
    }
  }
  replacements.sort((left, right) => Array.from(right.from).length - Array.from(left.from).length);
  let result = text;
  for (const replacement of replacements) result = result.replaceAll(replacement.from, replacement.to);
  return result;
}

export type { FactData, FactKind };
