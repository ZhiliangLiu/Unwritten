import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../store/db.ts';
import { StoredSceneSchema, type StoredAction } from '../store/meta.ts';
import { readPlan } from '../store/plan.ts';
import { entities as entityTable, entityNames, facts as factTable, workVersions } from '../store/schema.ts';
import { appearanceFacts, loadProjection, type ProjectionInput } from './projection.ts';
import { APPEARANCE_TRAIT_KEY, STORY_LIMITS, type ProjFact, type ProjName, type StoryProjection } from './types.ts';

export interface ScenePerson {
  code: string;
  entityId: string;
  knownAs: string | null;
  appearance: string | null;
  identityFactId: string | null;
  isProtagonist: boolean;
}

export interface SceneMaterials {
  skip: boolean;
  paragraphs: string[];
  earlierText: string | null;
  place: string | null;
  people: ScenePerson[];
  bannedNames: string[];
  unknownNames: string[];
}

export const SCENE_EARLIER_TEXT_MAX_CHARS = 2_000;

interface Moment {
  turnId: string;
  depth: number;
  para: number;
}

interface TimelineRecord {
  depth: number;
  turnId: string | null;
  para: number | null;
}

interface TurnRow {
  id: string;
  depth: number;
  action: string | null;
  prose: string;
  scene: string;
}

function loadChain(db: Database, headTurnId: string): ProjectionInput['chain'] {
  const rows = db.all<TurnRow>(sql`
    WITH RECURSIVE path(id, parent_id) AS (
      SELECT id, parent_id FROM turns WHERE id = ${headTurnId}
      UNION ALL
      SELECT t.id, t.parent_id FROM turns t JOIN path p ON t.id = p.parent_id
    )
    SELECT t.id, t.depth, t.action, t.prose, t.scene
    FROM path p
    JOIN turns t ON t.id = p.id
    ORDER BY t.depth
  `);
  return rows.map((row) => ({
    id: row.id,
    depth: row.depth,
    action: row.action ? (JSON.parse(row.action) as StoredAction) : null,
    prose: row.prose,
    scene: StoredSceneSchema.parse(JSON.parse(row.scene)),
  }));
}

function withParagraphFacts(db: Database, projection: StoryProjection): StoryProjection {
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
  const paragraphFacts: ProjFact[] = rows.map((row) => ({
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
  return {
    ...projection,
    facts: [
      ...projection.facts.filter(
        (fact) =>
          !(fact.kind === 'trait' && fact.key === APPEARANCE_TRAIT_KEY) &&
          !(fact.kind === 'relation' && fact.key === 'acquaintance'),
      ),
      ...paragraphFacts,
    ],
  };
}

function visibleAt(record: TimelineRecord, moment: Moment): boolean {
  if (record.depth < 0) return true;
  if (record.depth < moment.depth) return true;
  return (
    record.depth === moment.depth &&
    record.turnId === moment.turnId &&
    record.para !== null &&
    record.para <= moment.para
  );
}

function laterThan(left: TimelineRecord, right: TimelineRecord): boolean {
  if (left.depth !== right.depth) return left.depth > right.depth;
  return (left.para ?? 0) > (right.para ?? 0);
}

function isWitnessedAt(projection: StoryProjection, entityId: string, turnId: string, para: number): boolean {
  const turn = projection.chain.find((candidate) => candidate.id === turnId);
  if (!turn) return false;
  const previous = projection.chain.find((candidate) => candidate.depth === turn.depth - 1);
  if (previous?.scene.presentIds.includes(entityId)) return true;
  const moment = { turnId, depth: turn.depth, para };
  let latest: ProjFact | null = null;
  for (const fact of projection.facts) {
    if (fact.kind !== 'relation' || fact.key !== 'acquaintance') continue;
    const linked =
      (fact.subjectId === projection.protagonistId && fact.objectId === entityId) ||
      (fact.subjectId === entityId && fact.objectId === projection.protagonistId);
    if (!linked || !visibleAt(fact, moment)) continue;
    if (!latest || laterThan(fact, latest)) latest = fact;
  }
  const stage = latest?.data?.stage;
  return stage === 'met' || stage === 'familiar';
}

function knownNameAt(
  projection: StoryProjection,
  entityId: string,
  holderId: string | null,
  moment: Moment,
): string | null {
  let current: ProjName | null = null;
  for (const name of projection.names) {
    if (name.entityId !== entityId || name.holderId !== holderId) continue;
    if (!visibleAt(name, moment)) continue;
    if (!current || name.depth > current.depth || (name.depth === current.depth && name.seq > current.seq)) {
      current = name;
    }
  }
  return current?.name ?? null;
}

function knownStringsAt(projection: StoryProjection, moment: Moment): Set<string> {
  const known = new Set<string>();
  for (const entity of projection.entities.values()) {
    const held = knownNameAt(projection, entity.id, projection.protagonistId, moment);
    if (held) {
      known.add(held);
      continue;
    }
    const publicName = knownNameAt(projection, entity.id, null, moment);
    if (publicName) {
      known.add(publicName);
      continue;
    }
    if (entity.id === projection.protagonistId) known.add(entity.name);
  }
  for (const name of projection.names) {
    if ((name.holderId === projection.protagonistId || name.holderId === null) && visibleAt(name, moment)) {
      known.add(name.name);
    }
  }
  const protagonist = projection.entities.get(projection.protagonistId);
  if (protagonist) known.add(protagonist.name);
  return known;
}

function appearanceKnownAt(projection: StoryProjection, factId: string, moment: Moment): boolean {
  const records = projection.knowledge.filter((record) => record.factId === factId);
  if (records.length === 0) return true;
  return records.some(
    (record) =>
      record.holderId === projection.protagonistId && record.level === 'confirmed' && visibleAt(record, moment),
  );
}

function sceneAppearance(
  projection: StoryProjection,
  entityId: string,
  moment: Moment,
): { appearance: string | null; identityFactId: string | null } {
  const base = projection.entities.get(entityId)?.appearance ?? null;
  const visible = appearanceFacts(projection, entityId).filter((fact) => {
    if (!visibleAt(fact, moment)) return false;
    if (!appearanceKnownAt(projection, fact.id, moment)) return false;
    const witnessTurnId = fact.turnId ?? moment.turnId;
    const witnessPara = fact.turnId === null ? moment.para : (fact.para ?? 0);
    return isWitnessedAt(projection, entityId, witnessTurnId, witnessPara);
  });
  const latest = visible.at(-1);
  if (!latest) return { appearance: base, identityFactId: null };
  let identityFactId: string | null = null;
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const fact = visible[index];
    if (fact && fact.data?.same_visible_identity !== 1) {
      identityFactId = fact.id;
      break;
    }
  }
  return { appearance: latest.statement, identityFactId };
}

function earlierTextOf(paragraphs: string[]): string | null {
  if (paragraphs.length === 0) return null;
  const kept = [...paragraphs];
  let text = kept.join('\n\n');
  while (kept.length > 1 && Array.from(text).length > SCENE_EARLIER_TEXT_MAX_CHARS) {
    kept.shift();
    text = kept.join('\n\n');
  }
  const chars = Array.from(text);
  return chars.length > SCENE_EARLIER_TEXT_MAX_CHARS
    ? chars.slice(chars.length - SCENE_EARLIER_TEXT_MAX_CHARS).join('')
    : text;
}

function openingSituation(db: Database, versionId: string): string | null {
  const version = db.select({ meta: workVersions.meta }).from(workVersions).where(eq(workVersions.id, versionId)).get();
  if (!version) return null;
  const item = readPlan(version.meta)?.items.find(
    (candidate) => candidate.kind === 'summary' && candidate.key === 'situation',
  );
  const text = item?.kind === 'summary' ? item.text.trim() : '';
  return text || null;
}

export function sceneMaterials(
  db: Database,
  input: {
    versionId: string;
    turnId: string;
    para: number;
    protagonistAppearance: string | null;
    protagonistInFrame: boolean;
  },
): SceneMaterials {
  const chain = loadChain(db, input.turnId);
  const base = loadProjection(db, { versionId: input.versionId, chain });
  const target = base.chain.at(-1);
  if (!target || target.id !== input.turnId) throw new Error('target turn is not in the chain');
  const projection = withParagraphFacts(db, base);
  const moment = { turnId: target.id, depth: target.depth, para: input.para };
  const previous = base.chain.find((turn) => turn.depth === target.depth - 1) ?? null;
  const opening = input.para === 0;
  const situation = opening ? openingSituation(db, input.versionId) : null;
  const skip = opening && situation === null;
  const paragraphs = opening ? [] : target.paragraphs.slice(0, input.para);
  const earlierText = opening ? situation : previous ? earlierTextOf(previous.paragraphs) : null;
  const place = opening ? null : previous?.scene.place.trim() || null;

  const people: ScenePerson[] = [];
  if (input.protagonistInFrame && (!opening || input.protagonistAppearance !== null)) {
    people.push({
      code: '',
      entityId: projection.protagonistId,
      knownAs: knownNameAt(projection, projection.protagonistId, projection.protagonistId, moment),
      appearance: input.protagonistAppearance,
      identityFactId: null,
      isProtagonist: true,
    });
  }

  const candidateIds: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (entityId: string) => {
    const entity = projection.entities.get(entityId);
    if (!entity || entity.kind !== 'character' || entity.isProtagonist || seen.has(entityId)) return;
    seen.add(entityId);
    candidateIds.push(entityId);
  };
  if (!opening) {
    for (const entityId of previous?.scene.presentIds ?? []) addCandidate(entityId);
    for (const entity of projection.entities.values()) {
      if (entity.originTurnId !== target.id) continue;
      if (entity.sourcePara === null || entity.sourcePara > input.para) continue;
      addCandidate(entity.id);
    }
    for (const name of projection.names) {
      if (name.holderId !== projection.protagonistId && name.holderId !== null) continue;
      if (Array.from(name.name).length < STORY_LIMITS.nameMinLengthForLeakCheck) continue;
      if (!visibleAt(name, moment)) continue;
      if (!paragraphs.some((paragraph) => paragraph.includes(name.name))) continue;
      addCandidate(name.entityId);
    }
  }
  for (const entityId of candidateIds) {
    if (!isWitnessedAt(projection, entityId, target.id, input.para)) continue;
    const look = sceneAppearance(projection, entityId, moment);
    people.push({
      code: '',
      entityId,
      knownAs: knownNameAt(projection, entityId, projection.protagonistId, moment),
      appearance: look.appearance,
      identityFactId: look.identityFactId,
      isProtagonist: false,
    });
  }
  const coded = people.map((person, index) => ({ ...person, code: `C${index + 1}` }));

  const banned = new Set<string>();
  const addBanned = (name: string) => {
    const trimmed = name.trim();
    if (Array.from(trimmed).length >= STORY_LIMITS.nameMinLengthForLeakCheck) banned.add(trimmed);
  };
  for (const person of coded) {
    const entity = projection.entities.get(person.entityId);
    if (entity) addBanned(entity.name);
  }
  const protagonist = projection.entities.get(projection.protagonistId);
  if (protagonist) addBanned(protagonist.name);

  const known = knownStringsAt(projection, moment);
  const unknown = new Set<string>();
  const addUnknown = (name: string) => {
    if (known.has(name)) return;
    if (Array.from(name).length < STORY_LIMITS.nameMinLengthForLeakCheck) return;
    unknown.add(name);
  };
  for (const row of db
    .select({ name: entityTable.name })
    .from(entityTable)
    .where(eq(entityTable.versionId, input.versionId))
    .all()) {
    addUnknown(row.name);
  }
  for (const row of db
    .select({ name: entityNames.name })
    .from(entityNames)
    .where(eq(entityNames.versionId, input.versionId))
    .all()) {
    addUnknown(row.name);
  }

  return {
    skip,
    paragraphs,
    earlierText,
    place,
    people: coded,
    bannedNames: [...banned],
    unknownNames: [...unknown],
  };
}
