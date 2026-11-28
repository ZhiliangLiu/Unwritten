import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { JournalPortraitsInput } from '../services.ts';
import type { Database } from '../store/db.ts';
import type { PlaythroughIllustration } from '../store/illustration-types.ts';
import { facts as factTable, portraitSets, routes } from '../store/schema.ts';
import { acquaintanceStage, protagonistNameOf } from '../story/projection.ts';
import { APPEARANCE_TRAIT_KEY, type ProjFact, type StoryProjection } from '../story/types.ts';

export interface JournalPortraitSelection {
  setId: string;
  updatedAt: number;
}

type PortraitSetRow = typeof portraitSets.$inferSelect;

interface Moment {
  turnId: string;
  depth: number;
  para: number;
}

function visibleAt(fact: ProjFact, moment: Moment): boolean {
  if (fact.depth < 0) return true;
  if (fact.depth < moment.depth) return true;
  return fact.depth === moment.depth && fact.turnId === moment.turnId && fact.para !== null && fact.para <= moment.para;
}

function laterThan(left: ProjFact, right: ProjFact): boolean {
  if (left.depth !== right.depth) return left.depth > right.depth;
  return (left.para ?? 0) > (right.para ?? 0);
}

function paragraphFacts(db: Database, projection: StoryProjection): ProjFact[] {
  const chainIds = projection.chain.map((turn) => turn.id);
  const depths = new Map(projection.chain.map((turn) => [turn.id, turn.depth]));
  const rows = db
    .select()
    .from(factTable)
    .where(
      and(
        eq(factTable.versionId, projection.versionId),
        inArray(factTable.kind, ['trait', 'relation']),
        or(eq(factTable.key, APPEARANCE_TRAIT_KEY), eq(factTable.key, 'acquaintance')),
        chainIds.length === 0
          ? isNull(factTable.originTurnId)
          : or(isNull(factTable.originTurnId), inArray(factTable.originTurnId, chainIds)),
      ),
    )
    .all();
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    subjectId: row.subjectId,
    objectId: row.objectId,
    key: row.key,
    statement: row.statement,
    data: row.data,
    depth: row.originTurnId === null ? -1 : (depths.get(row.originTurnId) ?? -1),
    turnId: row.originTurnId,
    para: row.sourcePara,
  }));
}

function acquaintanceStageAt(
  projection: StoryProjection,
  facts: ProjFact[],
  entityId: string,
  moment: Moment,
): string | null {
  let latest: ProjFact | null = null;
  for (const fact of facts) {
    if (fact.kind !== 'relation' || fact.key !== 'acquaintance') continue;
    const forward = fact.subjectId === projection.protagonistId && fact.objectId === entityId;
    const backward = fact.subjectId === entityId && fact.objectId === projection.protagonistId;
    if (!forward && !backward) continue;
    if (!visibleAt(fact, moment)) continue;
    if (!latest || laterThan(fact, latest)) latest = fact;
  }
  const stage = latest?.data?.stage;
  return typeof stage === 'string' ? stage : null;
}

function witnessed(projection: StoryProjection, facts: ProjFact[], entityId: string, fact: ProjFact): boolean {
  const turn = fact.turnId === null ? projection.chain.at(-1) : projection.chain.find((row) => row.id === fact.turnId);
  if (!turn) return false;
  const previous = projection.chain.find((candidate) => candidate.depth === turn.depth - 1);
  if (previous?.scene.presentIds.includes(entityId)) return true;
  const para = fact.turnId === null ? turn.paragraphs.length : (fact.para ?? 0);
  const stage = acquaintanceStageAt(projection, facts, entityId, { turnId: turn.id, depth: turn.depth, para });
  return stage === 'met' || stage === 'familiar';
}

function appearanceKnown(projection: StoryProjection, factId: string): boolean {
  const records = projection.knowledge.filter((record) => record.factId === factId);
  if (records.length === 0) return true;
  return records.some((record) => record.holderId === projection.protagonistId && record.level === 'confirmed');
}

function identityFactId(projection: StoryProjection, facts: ProjFact[], entityId: string): string | null {
  const visible = facts
    .filter(
      (fact) =>
        fact.subjectId === entityId &&
        fact.kind === 'trait' &&
        fact.key === APPEARANCE_TRAIT_KEY &&
        appearanceKnown(projection, fact.id) &&
        witnessed(projection, facts, entityId, fact),
    )
    .sort((left, right) => left.depth - right.depth || (left.para ?? 0) - (right.para ?? 0));
  if (visible.length === 0) return null;
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const fact = visible[index];
    if (fact && fact.data?.same_visible_identity !== 1) return fact.id;
  }
  return null;
}

function setById(db: Database, setId: string | null, entityId: string, playthroughId: string): PortraitSetRow | null {
  if (setId === null) return null;
  const row = db.select().from(portraitSets).where(eq(portraitSets.id, setId)).get();
  if (!row || row.entityId !== entityId) return null;
  if (row.playthroughId !== null && row.playthroughId !== playthroughId) return null;
  return row;
}

function playthroughSet(
  db: Database,
  playthroughId: string,
  entityId: string,
  factId: string | null,
): PortraitSetRow | null {
  const row = db
    .select()
    .from(portraitSets)
    .where(
      and(
        eq(portraitSets.scope, 'playthrough'),
        eq(portraitSets.playthroughId, playthroughId),
        eq(portraitSets.entityId, entityId),
        factId === null ? isNull(portraitSets.appearanceFactId) : eq(portraitSets.appearanceFactId, factId),
      ),
    )
    .get();
  return row ?? null;
}

function frontSet(
  db: Database,
  settings: PlaythroughIllustration,
  playthroughId: string,
  entityId: string,
  factId: string | null,
): PortraitSetRow | null {
  const frozenId = factId === null ? (settings.authorPortraitSetIds[entityId] ?? null) : null;
  const frozen = setById(db, frozenId, entityId, playthroughId);
  if (frozen !== null && frozen.slots.front.file !== null) return frozen;
  const playthrough = playthroughSet(db, playthroughId, entityId, factId);
  if (playthrough !== null && playthrough.slots.front.file !== null) return playthrough;
  return null;
}

export function journalPortraits(db: Database, input: JournalPortraitsInput): Map<string, JournalPortraitSelection> {
  const selection = new Map<string, JournalPortraitSelection>();
  if (!input.settings.enabled) return selection;
  const route = db.select().from(routes).where(eq(routes.id, input.routeId)).get();
  if (!route || route.playthroughId !== input.playthroughId || route.headTurnId !== input.projection.headTurnId) {
    return selection;
  }
  const facts = paragraphFacts(db, input.projection);
  for (const entity of input.projection.entities.values()) {
    if (entity.kind !== 'character' || entity.id === input.projection.protagonistId) continue;
    if (protagonistNameOf(input.projection, entity.id) === null) continue;
    const stage = acquaintanceStage(input.projection, entity.id);
    if (stage !== 'met' && stage !== 'familiar') continue;
    const set = frontSet(
      db,
      input.settings,
      input.playthroughId,
      entity.id,
      identityFactId(input.projection, facts, entity.id),
    );
    if (set !== null) selection.set(entity.id, { setId: set.id, updatedAt: set.updatedAt });
  }
  return selection;
}
