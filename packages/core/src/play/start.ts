import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { CastMode, PlaythroughView, StartInfo, StartPlaythroughInput, WorkIdInput } from '@unwritten/contracts';
import { appError } from '../errors.ts';
import type { CoreDeps } from '../services.ts';
import type { Database } from '../store/db.ts';
import type { StoredScene, VersionMeta } from '../store/meta.ts';
import {
  entities,
  entityNames,
  playthroughs,
  routes,
  turnRequests,
  turns,
  workVersions,
  works,
} from '../store/schema.ts';
import { readSettings } from '../store/plan.ts';
import { indexTurnProse } from '../store/prose-index.ts';
import { substitutePlaceholders } from '../text/placeholders.ts';
import { EMPTY_CHANGES, ValidatedChangesSchema, type ValidatedChanges } from '../story/types.ts';
import { writeChanges, writeStateValues, type StoryTx } from '../story/writer.ts';

type Reader = Pick<Database, 'select'>;

interface StartOutcome {
  enqueue: string | null;
  workId: string;
  legacyDropped: boolean;
  filled?: number;
  mode?: CastMode;
}

function openingRequestView(row: typeof turnRequests.$inferSelect) {
  return {
    id: row.id,
    status: row.status,
    error: (row.error as NonNullable<PlaythroughView['opening']>['error']) ?? null,
    attempts: row.attempts,
    updatedAt: row.updatedAt,
  };
}

export function playthroughView(db: Database, playthroughId: string): PlaythroughView {
  const playthrough = db.select().from(playthroughs).where(eq(playthroughs.id, playthroughId)).get();
  if (!playthrough) throw appError('not_found', 'playthrough not found');
  const version = db.select().from(workVersions).where(eq(workVersions.id, playthrough.versionId)).get();
  if (!version) throw appError('not_found', 'version not found');
  const work = db.select().from(works).where(eq(works.id, version.workId)).get();
  if (!work) throw appError('not_found', 'work not found');
  const route = db
    .select()
    .from(routes)
    .where(eq(routes.playthroughId, playthroughId))
    .orderBy(asc(routes.createdAt))
    .limit(1)
    .get();
  const opening = db
    .select()
    .from(turnRequests)
    .where(and(eq(turnRequests.playthroughId, playthroughId), eq(turnRequests.kind, 'opening')))
    .orderBy(desc(turnRequests.createdAt))
    .limit(1)
    .get();
  return {
    id: playthrough.id,
    workId: work.id,
    workTitle: work.title,
    routeId: route?.id ?? null,
    opening: opening ? openingRequestView(opening) : null,
  };
}

export function getStartInfo(deps: CoreDeps, input: WorkIdInput): StartInfo {
  const work = deps.db.select().from(works).where(eq(works.id, input.workId)).get();
  if (!work) throw appError('not_found', 'work not found');
  if (!work.publishedId) throw appError('not_published', 'work is not published');
  const version = deps.db.select().from(workVersions).where(eq(workVersions.id, work.publishedId)).get();
  if (!version) throw appError('not_found', 'version not found');
  const settings = readSettings(version.meta as VersionMeta);
  return {
    workId: work.id,
    title: work.title,
    fields: settings.protagonist.fields,
    castMode: settings.cast.mode,
  };
}

function protagonistValues(fields: StartInfo['fields'], input: Record<string, string>) {
  const values: Record<string, string> = {};
  for (const field of fields) values[field.name] = field.defaultValue;
  let filled = 0;
  for (const [key, raw] of Object.entries(input)) {
    if (!fields.some((field) => field.name === key)) {
      throw appError('protagonist_input_invalid', 'unknown protagonist field');
    }
    const value = raw.trim();
    if (value) {
      filled += 1;
      values[key] = value;
    }
  }
  return { values, filled };
}

function publishedScene(db: Reader, versionId: string, scene: StoredScene): StoredScene {
  const needsNames = scene.present.length !== scene.presentIds.length || scene.present.some((name) => !name);
  if (!needsNames) return scene;
  const names = new Map(
    db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(eq(entities.versionId, versionId))
      .all()
      .map((row) => [row.id, row.name]),
  );
  return { ...scene, present: scene.presentIds.map((id, index) => scene.present[index] || names.get(id) || '') };
}

function legacyChanges(
  db: Reader,
  versionId: string,
  changes: ValidatedChanges,
): { changes: ValidatedChanges; createdIds: Map<number, string>; dropped: boolean } {
  const authored = db
    .select()
    .from(entities)
    .where(and(eq(entities.versionId, versionId), isNull(entities.originTurnId)))
    .all();
  const createdIds = new Map<number, string>();
  for (const entity of changes.entities) {
    const match = entity.protagonist
      ? authored.find((candidate) => candidate.isProtagonist === 1)
      : authored.find((candidate) => candidate.kind === entity.kind && candidate.name === entity.name);
    if (!match) return { changes: EMPTY_CHANGES, createdIds: new Map(), dropped: true };
    createdIds.set(entity.line, match.id);
  }
  return { changes, createdIds, dropped: false };
}

export function writeProtagonistName(
  tx: StoryTx,
  input: { versionId: string; turnId: string; entityId: string; name: string },
) {
  tx.insert(entityNames)
    .values({
      versionId: input.versionId,
      entityId: input.entityId,
      name: input.name,
      holderId: input.entityId,
      originTurnId: input.turnId,
      sourcePara: 1,
    })
    .onConflictDoNothing()
    .run();
}

export function startPlaythrough(
  deps: CoreDeps,
  input: StartPlaythroughInput,
): { view: PlaythroughView; enqueue: string | null } {
  const outcome = deps.db.transaction(
    (tx): StartOutcome => {
      const existing = tx.select().from(playthroughs).where(eq(playthroughs.id, input.playthroughId)).get();
      const work = tx.select().from(works).where(eq(works.id, input.workId)).get();
      if (!work) throw appError('not_found', 'work not found');
      if (existing) {
        if (existing.versionId !== work.publishedId) {
          throw appError('idempotency_conflict', 'playthrough id is already used');
        }
        return { enqueue: null, workId: work.id, legacyDropped: false };
      }
      if (!work.publishedId) throw appError('not_published', 'work is not published');
      const version = tx.select().from(workVersions).where(eq(workVersions.id, work.publishedId)).get();
      if (!version) throw appError('not_found', 'version not found');
      const meta = version.meta as VersionMeta;
      const settings = readSettings(meta);
      const { values, filled } = protagonistValues(settings.protagonist.fields, input.protagonist);
      const now = Date.now();

      if (settings.cast.mode === 'per_run') {
        tx.insert(playthroughs)
          .values({
            id: input.playthroughId,
            versionId: version.id,
            kind: 'play',
            protagonist: values,
            createdAt: now,
          })
          .run();
        const requestId = randomUUID();
        tx.insert(turnRequests)
          .values({
            id: requestId,
            playthroughId: input.playthroughId,
            routeId: null,
            kind: 'opening',
            status: 'running',
            attempts: 1,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        return { enqueue: requestId, workId: work.id, legacyDropped: false, filled, mode: settings.cast.mode };
      }

      const opening = meta.opening;
      if (!opening) throw appError('internal', 'opening missing');
      const prose = substitutePlaceholders(opening.prose, values);
      const options = opening.options.map((option) => ({
        text: substitutePlaceholders(option.text, values),
        hint: option.hint === null ? null : substitutePlaceholders(option.hint, values),
      }));
      const initialState = (opening.initialState ?? []).map((entry) => ({
        stateDefId: entry.stateDefId,
        value: entry.value === null ? null : substitutePlaceholders(entry.value, values),
        visible: entry.visible,
      }));
      const parsed = ValidatedChangesSchema.parse(opening.changes ?? EMPTY_CHANGES);
      const resolved = opening.createdIds
        ? {
            changes: parsed,
            createdIds: new Map(Object.entries(opening.createdIds).map(([line, id]) => [Number(line), id])),
            dropped: false,
          }
        : legacyChanges(tx, version.id, parsed);
      const protagonist = tx
        .select()
        .from(entities)
        .where(and(eq(entities.versionId, version.id), eq(entities.isProtagonist, 1)))
        .get();
      if (!protagonist) throw appError('internal', 'protagonist entity missing');
      const scene = publishedScene(tx, version.id, opening.scene);
      const turnId = randomUUID();
      const routeId = randomUUID();
      tx.insert(playthroughs)
        .values({
          id: input.playthroughId,
          versionId: version.id,
          kind: 'play',
          protagonist: values,
          rootTurnId: turnId,
          createdAt: now,
        })
        .run();
      tx.insert(turns)
        .values({
          id: turnId,
          playthroughId: input.playthroughId,
          depth: 0,
          prose,
          options,
          scene,
          status: 'committed',
          createdAt: now,
        })
        .run();
      writeChanges(tx, {
        changes: resolved.changes,
        createdIds: resolved.createdIds,
        turnId,
        versionId: version.id,
        entityVersionIds: [],
        entityOrigin: 'version',
        protagonistId: protagonist.id,
        parentPresentIds: [],
        parentStates: new Map(),
      });
      const nameField = settings.protagonist.fields.find((field) => field.isName);
      if (nameField) {
        writeProtagonistName(tx, {
          versionId: version.id,
          turnId,
          entityId: protagonist.id,
          name: values[nameField.name]!,
        });
      }
      writeStateValues(tx, {
        versionId: version.id,
        turnId,
        values: initialState.map((entry) => ({ ...entry, closed: false })),
      });
      indexTurnProse(tx, turnId, prose);
      tx.insert(routes)
        .values({ id: routeId, playthroughId: input.playthroughId, headTurnId: turnId, createdAt: now, updatedAt: now })
        .run();
      return {
        enqueue: null,
        workId: work.id,
        legacyDropped: resolved.dropped,
        filled,
        mode: settings.cast.mode,
      };
    },
    { behavior: 'immediate' },
  );

  if (outcome.legacyDropped) {
    deps.logger.record({
      level: 'info',
      module: 'play',
      event: 'playthrough.legacy_changes_dropped',
      workId: outcome.workId,
    });
  }
  if (outcome.filled !== undefined) {
    deps.logger.record({
      level: 'info',
      module: 'play',
      event: 'playthrough.started',
      workId: outcome.workId,
      data: { mode: outcome.mode, fields: outcome.filled },
    });
  }
  if (outcome.enqueue) {
    deps.bus.publish({
      type: 'playthrough.updated',
      playthroughId: input.playthroughId,
      requestId: outcome.enqueue,
      status: 'running',
    });
  }
  return { view: playthroughView(deps.db, input.playthroughId), enqueue: outcome.enqueue };
}
