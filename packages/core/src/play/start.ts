import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { CastMode, PlaythroughView, StartInfo, StartPlaythroughInput, WorkIdInput } from '@unwritten/contracts';
import { appError } from '../errors.ts';
import {
  appearanceHash,
  PORTRAIT_PREVIEW_TTL_DAYS,
  effectiveStyle,
  illustrationEnabled,
  readIllustrationSettings,
} from '../services.ts';
import type { CoreDeps, IllustrationService, ImageService } from '../services.ts';
import type { Database } from '../store/db.ts';
import {
  TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION,
  PlaythroughIllustrationSchema,
  type PlaythroughIllustration,
} from '../store/illustration-types.ts';
import type { StoredScene, VersionMeta } from '../store/meta.ts';
import {
  entities,
  entityNames,
  playthroughs,
  portraitSets,
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

interface QueuedIllustration {
  id: string;
  routeId: string;
  turnId: string;
}

interface StartOutcome {
  enqueue: string | null;
  workId: string;
  legacyDropped: boolean;
  filled?: number;
  mode?: CastMode;
  illustration?: QueuedIllustration | null;
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

export function getStartInfo(
  deps: CoreDeps,
  input: WorkIdInput,
  image: Pick<ImageService, 'selectedServiceId' | 'activeTarget'>,
): StartInfo {
  const work = deps.db.select().from(works).where(eq(works.id, input.workId)).get();
  if (!work) throw appError('not_found', 'work not found');
  if (!work.publishedId) throw appError('not_published', 'work is not published');
  const version = deps.db.select().from(workVersions).where(eq(workVersions.id, work.publishedId)).get();
  if (!version) throw appError('not_found', 'version not found');
  const settings = readSettings(version.meta as VersionMeta);
  const protagonist = deps.db
    .select()
    .from(entities)
    .where(and(eq(entities.versionId, version.id), eq(entities.isProtagonist, 1)))
    .get();
  const last = deps.db
    .select({ illustration: playthroughs.illustration })
    .from(playthroughs)
    .innerJoin(workVersions, eq(playthroughs.versionId, workVersions.id))
    .where(and(eq(workVersions.workId, work.id), sql`json_extract(${playthroughs.illustration}, '$.enabled') = 1`))
    .orderBy(desc(playthroughs.createdAt))
    .limit(1)
    .get();
  return {
    workId: work.id,
    title: work.title,
    fields: settings.protagonist.fields,
    castMode: settings.cast.mode,
    illustration: {
      available: image.selectedServiceId() !== null,
      autoEnabled: image.activeTarget() !== null,
      authorStyle: effectiveStyle(work.illustrationStyle),
      lastStyle: last?.illustration.style ?? null,
      defaults: readIllustrationSettings(deps.db, deps.logger).defaults,
      protagonistEntityId: protagonist?.id ?? null,
    },
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

const DAY_MS = 86_400_000;

function lockedIllustration(
  tx: Reader,
  input: StartPlaythroughInput['illustration'],
  work: Pick<typeof works.$inferSelect, 'id' | 'illustrationStyle'>,
  versionId: string,
  now: number,
): PlaythroughIllustration {
  const authorStyle = effectiveStyle(work.illustrationStyle);
  if (!input) {
    return PlaythroughIllustrationSchema.parse({ ...TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION, style: authorStyle });
  }

  const characters = tx
    .select()
    .from(entities)
    .where(and(eq(entities.versionId, versionId), eq(entities.kind, 'character')))
    .all();
  const authorPortraitSetIds: Record<string, string> = {};
  for (const entity of characters) {
    const appearance = entity.profile.appearance;
    if (!appearance) continue;
    const set = tx
      .select()
      .from(portraitSets)
      .where(
        and(
          eq(portraitSets.workId, work.id),
          eq(portraitSets.scope, 'work'),
          eq(portraitSets.state, 'active'),
          eq(portraitSets.entityId, entity.id),
          eq(portraitSets.appearanceHash, appearanceHash(appearance)),
        ),
      )
      .get();
    if (set) authorPortraitSetIds[entity.id] = set.id;
  }

  let protagonistPortraitSetId: string | null = null;
  if (input.protagonistSnapshotId) {
    const protagonist = tx
      .select()
      .from(entities)
      .where(and(eq(entities.versionId, versionId), eq(entities.isProtagonist, 1)))
      .get();
    const snapshot = tx.select().from(portraitSets).where(eq(portraitSets.id, input.protagonistSnapshotId)).get();
    if (
      snapshot &&
      protagonist &&
      snapshot.workId === work.id &&
      snapshot.scope === 'pending' &&
      snapshot.state === 'active' &&
      snapshot.entityId === protagonist.id &&
      snapshot.updatedAt >= now - PORTRAIT_PREVIEW_TTL_DAYS * DAY_MS &&
      snapshot.slots.front.file !== null &&
      (input.protagonistAppearance === null || snapshot.appearanceHash === appearanceHash(input.protagonistAppearance))
    ) {
      protagonistPortraitSetId = snapshot.id;
    }
  }

  return PlaythroughIllustrationSchema.parse({
    enabled: input.enabled,
    style: input.style,
    aspectPreference: input.aspectPreference,
    resolutionTier: input.resolutionTier,
    protagonistInFrame: input.protagonistInFrame,
    protagonistAppearance: input.protagonistInFrame ? input.protagonistAppearance : null,
    authorPortraitSetIds,
    protagonistPortraitSetId,
  });
}

export function startPlaythrough(
  deps: CoreDeps & {
    image: ImageService;
    illustration: IllustrationService;
    onIllustrationQueued: () => void;
  },
  input: StartPlaythroughInput,
): { view: PlaythroughView; enqueue: string | null } {
  const illustrationTarget = deps.image.activeTarget();
  const outcome = deps.db.transaction(
    (tx): StartOutcome => {
      const existing = tx.select().from(playthroughs).where(eq(playthroughs.id, input.playthroughId)).get();
      const work = tx.select().from(works).where(eq(works.id, input.workId)).get();
      if (!work) throw appError('not_found', 'work not found');
      if (existing) {
        if (existing.versionId !== work.publishedId) {
          throw appError('idempotency_conflict', 'playthrough id is already used');
        }
        return { enqueue: null, workId: work.id, legacyDropped: false, illustration: null };
      }
      if (!work.publishedId) throw appError('not_published', 'work is not published');
      const version = tx.select().from(workVersions).where(eq(workVersions.id, work.publishedId)).get();
      if (!version) throw appError('not_found', 'version not found');
      const meta = version.meta as VersionMeta;
      const settings = readSettings(meta);
      const { values, filled } = protagonistValues(settings.protagonist.fields, input.protagonist);
      const now = Date.now();
      const illustration = lockedIllustration(tx, input.illustration, work, version.id, now);

      if (settings.cast.mode === 'per_run') {
        tx.insert(playthroughs)
          .values({
            id: input.playthroughId,
            versionId: version.id,
            kind: 'play',
            protagonist: values,
            illustration,
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
        return {
          enqueue: requestId,
          workId: work.id,
          legacyDropped: false,
          filled,
          mode: settings.cast.mode,
          illustration: null,
        };
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
          illustration,
          createdAt: now,
        })
        .run();
      const illustrationQueued = illustrationEnabled(illustration, illustrationTarget);
      tx.insert(turns)
        .values({
          id: turnId,
          playthroughId: input.playthroughId,
          depth: 0,
          prose,
          options,
          scene,
          illustratePara: illustrationQueued ? 0 : null,
          status: 'committed',
          createdAt: now,
        })
        .run();
      const illustrationId = illustrationQueued
        ? deps.illustration.enqueue(tx, {
            turnId,
            playthroughId: input.playthroughId,
            para: 0,
            settings: illustration,
            now,
          })
        : null;
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
        illustration: illustrationId === null ? null : { id: illustrationId, routeId, turnId },
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
  deps.bus.publish({ type: 'works.changed', workId: outcome.workId });
  if (outcome.enqueue) {
    deps.bus.publish({
      type: 'playthrough.updated',
      playthroughId: input.playthroughId,
      requestId: outcome.enqueue,
      status: 'running',
    });
  }
  if (outcome.illustration) {
    deps.bus.publish({
      type: 'illustration.updated',
      routeId: outcome.illustration.routeId,
      turnId: outcome.illustration.turnId,
      illustrationId: outcome.illustration.id,
    });
    deps.onIllustrationQueued();
  }
  return { view: playthroughView(deps.db, input.playthroughId), enqueue: outcome.enqueue };
}
