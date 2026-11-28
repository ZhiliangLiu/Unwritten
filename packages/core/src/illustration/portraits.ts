import { createHash, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { and, eq, isNull } from 'drizzle-orm';
import {
  ErrorCodeSchema,
  PORTRAIT_IMPORT_MAX_BYTES,
  PORTRAIT_IMPORT_MAX_EDGE,
  PORTRAIT_SLOTS,
  type ErrorCode,
  type IllustrationFormat,
  type IllustrationStyle,
  type ImageCapabilities,
  type ImageSize,
  type OutputPreferences,
  type PortraitAdoptInput,
  type PortraitDraftInput,
  type PortraitDraftView,
  type PortraitGenerateInput,
  type PortraitGetInput,
  type PortraitPreviewInput,
  type PortraitSetView,
  type PortraitSlot,
  type PortraitUpdateInput,
  type PortraitUploadInput,
} from '@unwritten/contracts';
import { appError } from '../errors.ts';
import type { EventBus } from '../events/bus.ts';
import type { Logger } from '../log/logger.ts';
import { ImageError, type ImageDispatchGuard, type ImageService } from '../services.ts';
import type { Database } from '../store/db.ts';
import {
  EMPTY_PORTRAIT_SLOTS,
  EMPTY_PORTRAIT_TASKS,
  PortraitSlotsStoredSchema,
  PortraitTasksSchema,
  type ImageFileRef,
  type PortraitSlotsStored,
  type PortraitTask,
  type PortraitTasks,
} from '../store/illustration-types.ts';
import type { VersionMeta } from '../store/meta.ts';
import { readPlan } from '../store/plan.ts';
import { entities, playthroughs, portraitSets, workVersions, works } from '../store/schema.ts';
import { appearanceHash } from './appearance.ts';
import { frontPrompt, previewPrompt, viewPrompt } from './portrait-prompt.ts';
import type { PortraitRunner } from './portrait-runner.ts';
import { toView } from './portrait-views.ts';
import { effectiveStyle } from './style.ts';
import { ImageStoreError, type ImageStore } from './storage.ts';

type Reader = Pick<Database, 'select'>;
type PortraitImage = Pick<
  ImageService,
  'selectedServiceId' | 'capabilities' | 'prepareGeneration' | 'generate' | 'assertFormat'
>;

export interface PortraitDeps {
  db: Database;
  bus: EventBus;
  logger: Logger;
  image: PortraitImage;
  store: ImageStore;
  runner: PortraitRunner;
  shutdown: AbortSignal;
}

interface PortraitJob {
  setId: string;
  workId: string;
  slot: PortraitSlot;
  attemptId: string;
  serviceId: string;
  task: PortraitTask;
  preference: OutputPreferences | null;
  defaultTier: '1k' | 'default';
  appearance: string;
  style: IllustrationStyle;
  prompt: string | null;
}

interface ResolvedFormat {
  format: IllustrationFormat;
  aspect: string;
  size: ImageSize | null;
}

const frontFlights = new Map<string, Promise<{ setId: string; front: ImageFileRef }>>();
const PORTRAIT_REQUEST_TTL_MS = 10 * 60 * 1000;

interface PortraitRequestEntry {
  fingerprint: string;
  expiresAt: number;
  result: unknown;
}

const portraitRequests = new Map<string, PortraitRequestEntry>();

function cachedPortraitResult<T>(requestId: string, fingerprint: string): T | null {
  const entry = portraitRequests.get(requestId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    portraitRequests.delete(requestId);
    return null;
  }
  if (entry.fingerprint !== fingerprint) {
    throw appError('idempotency_conflict', 'request id is already used with a different input');
  }
  return entry.result as T;
}

function rememberPortraitResult<T>(requestId: string, fingerprint: string, result: T): T {
  const now = Date.now();
  for (const [key, entry] of portraitRequests) {
    if (entry.expiresAt <= now) portraitRequests.delete(key);
  }
  portraitRequests.set(requestId, { fingerprint, expiresAt: now + PORTRAIT_REQUEST_TTL_MS, result });
  return result;
}

function contentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

class StalePortraitJob extends Error {
  constructor() {
    super('portrait job is stale');
    this.name = 'StalePortraitJob';
  }
}

function stale(message: string): never {
  throw appError('stale_revision', message);
}

function invalid(message: string): never {
  throw appError('invalid_input', message);
}

function notFound(message: string): never {
  throw appError('not_found', message);
}

function readSlots(raw: unknown): PortraitSlotsStored {
  const parsed = PortraitSlotsStoredSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_PORTRAIT_SLOTS;
}

function readTasks(raw: unknown): PortraitTasks | null {
  if (raw === null || raw === undefined) return null;
  const parsed = PortraitTasksSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function emptySlot() {
  return { file: null, source: null, needsReview: false };
}

function requireSet(db: Reader, setId: string): typeof portraitSets.$inferSelect {
  const row = db.select().from(portraitSets).where(eq(portraitSets.id, setId)).get();
  if (!row) notFound('portrait set not found');
  return row;
}

function requireDraftSet(db: Reader, setId: string, expectedRev: number): typeof portraitSets.$inferSelect {
  const row = requireSet(db, setId);
  if (row.state !== 'draft' || row.draftRev !== expectedRev) stale('portrait draft revision is stale');
  return row;
}

function viewOf(db: Reader, setId: string): PortraitSetView {
  return toView(requireSet(db, setId));
}

function activeSetFor(
  db: Reader,
  input: { workId: string; entityId: string; appearanceHash: string },
): typeof portraitSets.$inferSelect | undefined {
  return db
    .select()
    .from(portraitSets)
    .where(
      and(
        eq(portraitSets.workId, input.workId),
        eq(portraitSets.scope, 'work'),
        eq(portraitSets.state, 'active'),
        eq(portraitSets.entityId, input.entityId),
        eq(portraitSets.appearanceHash, input.appearanceHash),
      ),
    )
    .get();
}

function reviewedSlots(slots: PortraitSlotsStored): { slots: PortraitSlotsStored; count: number } {
  const reviewed = { ...slots };
  let count = 0;
  for (const slot of PORTRAIT_SLOTS) {
    if (slots[slot].file !== null && !slots[slot].needsReview) {
      count += 1;
      continue;
    }
    reviewed[slot] = emptySlot();
  }
  return { slots: PortraitSlotsStoredSchema.parse(reviewed), count };
}

function markOtherSlotsForReview(slots: PortraitSlotsStored): PortraitSlotsStored {
  const next = { ...slots };
  for (const slot of PORTRAIT_SLOTS) {
    if (slot === 'front') continue;
    if (next[slot].file !== null) next[slot] = { ...next[slot], needsReview: true };
  }
  return next;
}

function withTask(tasks: PortraitTasks | null, slot: PortraitSlot, task: PortraitTask | null): PortraitTasks {
  return PortraitTasksSchema.parse({ ...(tasks ?? EMPTY_PORTRAIT_TASKS), [slot]: task });
}

function resolveFormat(
  capabilities: ImageCapabilities,
  preference: OutputPreferences | null,
  quality: 'fast' | 'best',
  defaultTier: '1k' | 'default',
): ResolvedFormat {
  const fixedAspect =
    preference !== null && preference.aspectPreference !== 'auto' ? preference.aspectPreference : null;
  let aspect = fixedAspect;
  if (aspect === null) {
    const vertical = capabilities.aspects.find((candidate) => {
      const [width, height] = candidate.split(':').map(Number);
      return (height ?? 0) > (width ?? 0);
    });
    aspect = capabilities.aspects.includes('3:4') ? '3:4' : (vertical ?? capabilities.aspects[0] ?? '3:4');
  } else if (!capabilities.aspects.includes(aspect)) {
    throw appError('image_output_format_unavailable', 'aspect is not supported');
  }

  const tier =
    preference?.resolutionTier ??
    (defaultTier === 'default' || !capabilities.resolutions[aspect]?.['1k'] ? 'default' : '1k');
  if (tier !== 'default' && !capabilities.resolutions[aspect]?.[tier]) {
    throw appError('image_output_format_unavailable', 'resolution tier is not supported');
  }
  if (!capabilities.qualities.includes(quality)) {
    throw appError('image_output_format_unavailable', 'quality is not supported');
  }
  const size = tier === 'default' ? null : (capabilities.resolutions[aspect]?.[tier] ?? null);
  return {
    format: { aspectPreference: aspect, resolutionTier: tier, size },
    aspect,
    size,
  };
}

function errorCodeOf(error: unknown): ErrorCode {
  if (error instanceof ImageError) return error.code;
  const code = (error as { code?: unknown }).code;
  const parsed = ErrorCodeSchema.safeParse(code);
  return parsed.success ? parsed.data : 'internal';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isStale(error: unknown): boolean {
  return error instanceof StalePortraitJob;
}

function assertGenerationCurrent(deps: PortraitDeps, job: PortraitJob): void {
  const row = deps.db.select().from(portraitSets).where(eq(portraitSets.id, job.setId)).get();
  if (!row || row.state !== 'draft' || row.appearanceHash !== job.task.appearanceHash) throw new StalePortraitJob();
  const tasks = readTasks(row.task);
  if (tasks?.[job.slot]?.attemptId !== job.attemptId) throw new StalePortraitJob();
  if (job.slot === 'front') return;
  const slots = readSlots(row.slots);
  if (slots.front.file?.hash !== job.task.inputFiles[0]?.hash) throw new StalePortraitJob();
}

function recordTaskFormat(deps: PortraitDeps, job: PortraitJob, format: IllustrationFormat): boolean {
  const changed = deps.db.transaction(
    (tx) => {
      const row = tx.select().from(portraitSets).where(eq(portraitSets.id, job.setId)).get();
      if (!row) return false;
      const tasks = readTasks(row.task);
      const task = tasks?.[job.slot];
      if (!task || task.attemptId !== job.attemptId) return false;
      tx.update(portraitSets)
        .set({
          task: withTask(tasks, job.slot, { ...task, format }),
          updatedAt: Date.now(),
        })
        .where(eq(portraitSets.id, job.setId))
        .run();
      job.task = { ...job.task, format };
      return true;
    },
    { behavior: 'immediate' },
  );
  return changed;
}

async function runGeneration(deps: PortraitDeps, job: PortraitJob): Promise<void> {
  try {
    let format = job.task.format;
    let capabilities = format === null ? null : deps.image.capabilities(job.serviceId);
    if (format === null || job.slot !== 'front' || capabilities === null) {
      capabilities = await deps.image.prepareGeneration(job.serviceId, {
        manual: true,
        signal: deps.shutdown,
      });
    }
    if (format === null) {
      if (!capabilities) throw new ImageError('image_not_configured', 'final');
      const resolved = resolveFormat(capabilities, job.preference, job.task.quality, job.defaultTier);
      deps.image.assertFormat(capabilities, {
        aspect: resolved.aspect,
        size: resolved.size,
        quality: job.task.quality,
      });
      format = resolved.format;
      if (!recordTaskFormat(deps, job, format)) throw new StalePortraitJob();
    }

    const references: Array<{ mime: string; bytes: Uint8Array }> = [];
    if (job.slot !== 'front') {
      if (!capabilities) throw new ImageError('image_not_configured', 'final');
      if (capabilities.maxReferences < 1) throw new ImageError('image_invalid_request', 'final');
      const front = job.task.inputFiles[0];
      if (!front) invalid('front portrait is missing');
      if (capabilities.maxReferenceBytes !== null && front.bytes > capabilities.maxReferenceBytes) {
        throw new ImageError('image_reference_too_large', 'final');
      }
      const bytes = await deps.store.read(front);
      if (bytes === null) throw appError('image_file_missing', 'front portrait file is missing');
      references.push({ mime: front.mime, bytes });
    }

    const prompt =
      job.prompt ?? (job.slot === 'front' ? frontPrompt(job.appearance, job.style) : viewPrompt(job.slot, job.style));
    const result = await deps.image.generate({
      serviceId: job.serviceId,
      prompt,
      negativePrompt: null,
      references,
      aspect: format.aspectPreference,
      size: format.size,
      quality: job.task.quality,
      seed: null,
      signal: deps.shutdown,
      ref: { workId: job.workId, kind: 'portrait', id: job.setId },
      manual: true,
    });

    const staged = await deps.store.stage(result.bytes, { rejectMetadata: true });
    const committed = await deps.store.commit(
      [staged],
      () => {
        const now = Date.now();
        const row = requireSet(deps.db, job.setId);
        const slots = readSlots(row.slots);
        const next = { ...slots, [job.slot]: { file: staged.ref, source: 'generate' as const, needsReview: false } };
        deps.db
          .update(portraitSets)
          .set({
            slots: PortraitSlotsStoredSchema.parse(job.slot === 'front' ? markOtherSlotsForReview(next) : next),
            task: withTask(readTasks(row.task), job.slot, null),
            draftRev: row.draftRev + 1,
            updatedAt: now,
          })
          .where(eq(portraitSets.id, job.setId))
          .run();
        return row;
      },
      () => assertGenerationCurrent(deps, job),
    );

    deps.bus.publish({ type: 'portrait.updated', workId: committed.workId });
    deps.logger.record({
      level: 'info',
      module: 'illustration',
      workId: committed.workId,
      event: 'portrait.done',
      data: { setId: job.setId, slot: job.slot, source: 'generate' },
    });
  } catch (error) {
    if (isAbortError(error)) return;
    if (isStale(error)) {
      clearTaskIfOwned(deps, job);
      return;
    }
    markFailed(deps, job, errorCodeOf(error));
  }
}

function clearTaskIfOwned(deps: PortraitDeps, job: PortraitJob): boolean {
  const workId = deps.db.transaction(
    (tx) => {
      const row = tx.select().from(portraitSets).where(eq(portraitSets.id, job.setId)).get();
      if (!row) return null;
      const tasks = readTasks(row.task);
      if (tasks?.[job.slot]?.attemptId !== job.attemptId) return null;
      tx.update(portraitSets)
        .set({ task: withTask(tasks, job.slot, null), updatedAt: Date.now() })
        .where(eq(portraitSets.id, job.setId))
        .run();
      return row.workId;
    },
    { behavior: 'immediate' },
  );
  if (workId === null) return false;
  deps.bus.publish({ type: 'portrait.updated', workId });
  return true;
}

function markFailed(deps: PortraitDeps, job: PortraitJob, code: ErrorCode): void {
  const outcome = deps.db.transaction(
    (tx) => {
      const row = tx.select().from(portraitSets).where(eq(portraitSets.id, job.setId)).get();
      if (!row) return null;
      const tasks = readTasks(row.task);
      const task = tasks?.[job.slot];
      if (!task || task.attemptId !== job.attemptId) return null;
      const inputChanged =
        row.state !== 'draft' ||
        row.appearanceHash !== job.task.appearanceHash ||
        (job.slot !== 'front' && readSlots(row.slots).front.file?.hash !== job.task.inputFiles[0]?.hash);
      tx.update(portraitSets)
        .set({
          task: inputChanged
            ? withTask(tasks, job.slot, null)
            : withTask(tasks, job.slot, { ...task, status: 'failed', error: code }),
          updatedAt: Date.now(),
        })
        .where(eq(portraitSets.id, job.setId))
        .run();
      return { workId: row.workId, inputChanged };
    },
    { behavior: 'immediate' },
  );
  if (outcome === null) return;
  deps.bus.publish({ type: 'portrait.updated', workId: outcome.workId });
  if (outcome.inputChanged) return;
  deps.logger.record({
    level: 'warn',
    module: 'illustration',
    workId: outcome.workId,
    event: 'portrait.failed',
    data: { setId: job.setId, slot: job.slot, source: 'generate', code },
  });
}

function scheduleJob(deps: PortraitDeps, job: PortraitJob): void {
  deps.runner.run(() => runGeneration(deps, job));
}

export function portraitDraft(deps: PortraitDeps, input: PortraitDraftInput): PortraitDraftView {
  const work = deps.db.select().from(works).where(eq(works.id, input.workId)).get();
  if (!work) notFound('work not found');

  if (input.scope === 'work') {
    if (input.target.kind !== 'entity') notFound('entity target required');
    return workDraft(deps, work, input.target.entityId);
  }
  if (input.target.kind !== 'protagonist') notFound('protagonist target required');
  return protagonistDraft(deps, work, input.appearance);
}

function workDraft(deps: PortraitDeps, work: typeof works.$inferSelect, entityId: string): PortraitDraftView {
  const version = deps.db.select().from(workVersions).where(eq(workVersions.id, work.draftId)).get();
  if (!version) notFound('draft version not found');
  const planItem = readPlan(version.meta as VersionMeta)?.items.find(
    (item) => item.kind === 'entity' && item.id === entityId,
  );
  const entity = deps.db
    .select()
    .from(entities)
    .where(and(eq(entities.versionId, version.id), eq(entities.id, entityId)))
    .get();
  const planCharacter = planItem?.kind === 'entity' && planItem.entityKind === 'character' ? planItem : null;
  if (!planCharacter && entity?.kind !== 'character') notFound('character not found');

  const appearance = planCharacter?.appearance ?? entity?.profile.appearance ?? '';
  const existing = deps.db
    .select()
    .from(portraitSets)
    .where(
      and(
        eq(portraitSets.workId, work.id),
        eq(portraitSets.scope, 'work'),
        eq(portraitSets.entityId, entityId),
        eq(portraitSets.state, 'draft'),
      ),
    )
    .get();
  if (existing) {
    const active = activeSetFor(deps.db, {
      workId: work.id,
      entityId,
      appearanceHash: existing.appearanceHash,
    });
    return { draft: toView(existing), activeSetId: active?.id ?? null };
  }

  const hash = appearanceHash(appearance);
  const active = activeSetFor(deps.db, { workId: work.id, entityId, appearanceHash: hash });
  const now = Date.now();
  const id = randomUUID();
  deps.db.transaction(
    (tx) => {
      tx.insert(portraitSets)
        .values({
          id,
          workId: work.id,
          scope: 'work',
          playthroughId: null,
          entityId,
          appearanceFactId: null,
          appearanceHash: hash,
          appearance,
          style: effectiveStyle(work.illustrationStyle),
          state: 'draft',
          draftRev: 0,
          slots: PortraitSlotsStoredSchema.parse(active?.slots ?? EMPTY_PORTRAIT_SLOTS),
          task: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    },
    { behavior: 'immediate' },
  );
  return { draft: viewOf(deps.db, id), activeSetId: active?.id ?? null };
}

function protagonistDraft(
  deps: PortraitDeps,
  work: typeof works.$inferSelect,
  inputAppearance: string | null,
): PortraitDraftView {
  if (!work.publishedId) throw appError('not_published', 'work is not published');
  const version = deps.db.select().from(workVersions).where(eq(workVersions.id, work.publishedId)).get();
  if (!version) notFound('version not found');
  const protagonist = deps.db
    .select()
    .from(entities)
    .where(and(eq(entities.versionId, version.id), eq(entities.isProtagonist, 1)))
    .get();
  if (!protagonist) notFound('protagonist not found');

  const appearance = inputAppearance ?? '';
  const hash = appearanceHash(appearance);
  const existing = deps.db
    .select()
    .from(portraitSets)
    .where(
      and(
        eq(portraitSets.workId, work.id),
        eq(portraitSets.scope, 'pending'),
        eq(portraitSets.entityId, protagonist.id),
        eq(portraitSets.state, 'draft'),
      ),
    )
    .get();
  if (existing) {
    if (existing.appearance !== appearance) {
      deps.db
        .update(portraitSets)
        .set({
          appearance,
          appearanceHash: hash,
          draftRev: existing.draftRev + 1,
          updatedAt: Date.now(),
        })
        .where(eq(portraitSets.id, existing.id))
        .run();
    }
    return { draft: viewOf(deps.db, existing.id), activeSetId: null };
  }

  const now = Date.now();
  const id = randomUUID();
  deps.db.transaction(
    (tx) => {
      tx.insert(portraitSets)
        .values({
          id,
          workId: work.id,
          scope: 'pending',
          playthroughId: null,
          entityId: protagonist.id,
          appearanceFactId: null,
          appearanceHash: hash,
          appearance,
          style: effectiveStyle(work.illustrationStyle),
          state: 'draft',
          draftRev: 0,
          slots: PortraitSlotsStoredSchema.parse(EMPTY_PORTRAIT_SLOTS),
          task: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    },
    { behavior: 'immediate' },
  );
  return { draft: viewOf(deps.db, id), activeSetId: null };
}

export function portraitGet(deps: PortraitDeps, input: PortraitGetInput): PortraitSetView {
  return viewOf(deps.db, input.setId);
}

export async function portraitUpload(deps: PortraitDeps, input: PortraitUploadInput): Promise<PortraitSetView> {
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const fingerprint = `upload:${input.setId}:${input.slot}:${input.expectedRev}:${contentHash(bytes)}`;
  const cached = cachedPortraitResult<PortraitSetView>(input.requestId, fingerprint);
  if (cached) return cached;
  requireDraftSet(deps.db, input.setId, input.expectedRev);
  const staged = await deps.store
    .stage(bytes, { rejectMetadata: true, maxBytes: PORTRAIT_IMPORT_MAX_BYTES })
    .catch((error: unknown) => {
      if (error instanceof ImageStoreError && error.stage === 'validate') {
        throw appError('image_invalid_upload', error.message);
      }
      throw error;
    });
  if (Math.max(staged.ref.width, staged.ref.height) > PORTRAIT_IMPORT_MAX_EDGE) {
    rmSync(staged.tempPath, { force: true });
    throw appError('image_invalid_upload', 'portrait image edge is too large');
  }

  const workId = await deps.store.commit([staged], () => {
    const now = Date.now();
    const row = requireDraftSet(deps.db, input.setId, input.expectedRev);
    const slots = readSlots(row.slots);
    const next = { ...slots, [input.slot]: { file: staged.ref, source: 'import' as const, needsReview: false } };
    deps.db
      .update(portraitSets)
      .set({
        slots: PortraitSlotsStoredSchema.parse(input.slot === 'front' ? markOtherSlotsForReview(next) : next),
        task: withTask(readTasks(row.task), input.slot, null),
        draftRev: row.draftRev + 1,
        updatedAt: now,
      })
      .where(eq(portraitSets.id, row.id))
      .run();
    return row.workId;
  });

  deps.bus.publish({ type: 'portrait.updated', workId });
  deps.logger.record({
    level: 'info',
    module: 'illustration',
    workId,
    event: 'portrait.done',
    data: { setId: input.setId, slot: input.slot, source: 'import' },
  });
  return rememberPortraitResult(input.requestId, fingerprint, viewOf(deps.db, input.setId));
}

export function portraitGenerate(deps: PortraitDeps, input: PortraitGenerateInput): PortraitSetView {
  const fingerprint = `generate:${input.setId}:${input.slot}:${input.expectedRev}:${
    input.format === null ? 'default' : `${input.format.aspectPreference}:${input.format.resolutionTier}`
  }`;
  const cached = cachedPortraitResult<PortraitSetView>(input.requestId, fingerprint);
  if (cached) return cached;

  const serviceId = deps.image.selectedServiceId();
  if (serviceId === null) throw appError('image_not_configured', 'no image service is selected');

  const row = requireDraftSet(deps.db, input.setId, input.expectedRev);
  const slots = readSlots(row.slots);
  if (input.slot === 'front') {
    if (!row.appearance.trim()) invalid('appearance is required for the front portrait');
  } else if (slots.front.file === null) {
    invalid('front portrait is required first');
  }

  const capabilities = deps.image.capabilities(serviceId);
  let format: IllustrationFormat | null = null;
  if (capabilities !== null) {
    const resolved = resolveFormat(capabilities, input.format, 'best', '1k');
    deps.image.assertFormat(capabilities, { aspect: resolved.aspect, size: resolved.size, quality: 'best' });
    format = resolved.format;
  }

  const attemptId = randomUUID();
  const task: PortraitTask = {
    attemptId,
    status: 'running',
    error: null,
    format,
    quality: 'best',
    inputFiles: input.slot === 'front' ? [] : [slots.front.file!],
    appearanceHash: row.appearanceHash,
  };
  const workId = deps.db.transaction(
    (tx) => {
      const current = requireDraftSet(tx, input.setId, input.expectedRev);
      tx.update(portraitSets)
        .set({
          task: withTask(readTasks(current.task), input.slot, task),
          draftRev: current.draftRev + 1,
          updatedAt: Date.now(),
        })
        .where(eq(portraitSets.id, current.id))
        .run();
      return current.workId;
    },
    { behavior: 'immediate' },
  );

  deps.bus.publish({ type: 'portrait.updated', workId });
  scheduleJob(deps, {
    setId: row.id,
    workId,
    slot: input.slot,
    attemptId,
    serviceId,
    task,
    preference: input.format,
    defaultTier: '1k',
    appearance: row.appearance,
    style: row.style,
    prompt: null,
  });
  return rememberPortraitResult(input.requestId, fingerprint, viewOf(deps.db, input.setId));
}

export function portraitUpdate(deps: PortraitDeps, input: PortraitUpdateInput): PortraitSetView {
  const fingerprint = `update:${input.setId}:${input.expectedRev}:${input.action.kind}:${input.action.slot}`;
  const cached = cachedPortraitResult<PortraitSetView>(input.requestId, fingerprint);
  if (cached) return cached;

  const workId = deps.db.transaction(
    (tx) => {
      const row = requireDraftSet(tx, input.setId, input.expectedRev);
      const slots = readSlots(row.slots);
      let next = slots;
      let tasks: PortraitTasks | null = readTasks(row.task);
      if (input.action.kind === 'remove') {
        next = { ...slots, [input.action.slot]: emptySlot() };
        if (input.action.slot === 'front') next = markOtherSlotsForReview(next);
        tasks = withTask(tasks, input.action.slot, null);
      } else {
        next = { ...slots, [input.action.slot]: { ...slots[input.action.slot], needsReview: false } };
      }
      tx.update(portraitSets)
        .set({
          slots: PortraitSlotsStoredSchema.parse(next),
          task: tasks === null ? null : PortraitTasksSchema.parse(tasks),
          draftRev: row.draftRev + 1,
          updatedAt: Date.now(),
        })
        .where(eq(portraitSets.id, row.id))
        .run();
      return row.workId;
    },
    { behavior: 'immediate' },
  );

  deps.bus.publish({ type: 'portrait.updated', workId });
  return rememberPortraitResult(input.requestId, fingerprint, viewOf(deps.db, input.setId));
}

export function portraitAdopt(deps: PortraitDeps, input: PortraitAdoptInput): PortraitDraftView {
  const fingerprint = `adopt:${input.setId}:${input.expectedRev}:${input.mode}:${input.expectedActiveSetId ?? ''}`;
  const cached = cachedPortraitResult<PortraitDraftView>(input.requestId, fingerprint);
  if (cached) return cached;

  const row = requireDraftSet(deps.db, input.setId, input.expectedRev);
  if (row.scope === 'playthrough') invalid('playthrough portrait sets are adopted by play starts');

  if (row.scope === 'pending') {
    if (input.mode !== 'adopt') invalid('pending portrait sets can only be adopted');
    if (row.entityId === null) invalid('preview portrait sets cannot be adopted');
    return rememberPortraitResult(input.requestId, fingerprint, adoptPending(deps, row));
  }
  return rememberPortraitResult(input.requestId, fingerprint, adoptWork(deps, row, input));
}

function adoptWork(
  deps: PortraitDeps,
  row: typeof portraitSets.$inferSelect,
  input: PortraitAdoptInput,
): PortraitDraftView {
  const entityId = row.entityId!;
  const active = activeSetFor(deps.db, {
    workId: row.workId,
    entityId,
    appearanceHash: row.appearanceHash,
  });
  if ((active?.id ?? null) !== input.expectedActiveSetId) stale('the active portrait set changed');

  if (input.mode === 'retire') {
    const workId = deps.db.transaction(
      (tx) => {
        const current = requireDraftSet(tx, row.id, input.expectedRev);
        const currentActive = activeSetFor(tx, {
          workId: current.workId,
          entityId,
          appearanceHash: current.appearanceHash,
        });
        if ((currentActive?.id ?? null) !== input.expectedActiveSetId) stale('the active portrait set changed');
        if (currentActive) {
          tx.update(portraitSets)
            .set({ state: 'retired', updatedAt: Date.now() })
            .where(eq(portraitSets.id, currentActive.id))
            .run();
        }
        return current.workId;
      },
      { behavior: 'immediate' },
    );
    deps.bus.publish({ type: 'portrait.updated', workId });
    deps.logger.record({
      level: 'info',
      module: 'illustration',
      workId,
      event: 'portrait.adopted',
      data: { setId: row.id, scope: 'work', slots: 0 },
    });
    return { draft: viewOf(deps.db, row.id), activeSetId: null };
  }

  const slots = readSlots(row.slots);
  if (slots.front.file === null || slots.front.needsReview) invalid('a reviewed front portrait is required');

  const now = Date.now();
  const activeId = randomUUID();
  const workId = deps.db.transaction(
    (tx) => {
      const current = requireDraftSet(tx, row.id, input.expectedRev);
      const currentActive = activeSetFor(tx, {
        workId: current.workId,
        entityId,
        appearanceHash: current.appearanceHash,
      });
      if ((currentActive?.id ?? null) !== input.expectedActiveSetId) stale('the active portrait set changed');
      if (currentActive) {
        tx.update(portraitSets)
          .set({ state: 'retired', updatedAt: now })
          .where(eq(portraitSets.id, currentActive.id))
          .run();
      }
      tx.insert(portraitSets)
        .values({
          id: activeId,
          workId: current.workId,
          scope: 'work',
          playthroughId: null,
          entityId,
          appearanceFactId: null,
          appearanceHash: current.appearanceHash,
          appearance: current.appearance,
          style: current.style,
          state: 'active',
          draftRev: 0,
          slots: reviewedSlots(readSlots(current.slots)).slots,
          task: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      tx.update(portraitSets)
        .set({ draftRev: current.draftRev + 1, updatedAt: now })
        .where(eq(portraitSets.id, current.id))
        .run();
      return current.workId;
    },
    { behavior: 'immediate' },
  );

  deps.bus.publish({ type: 'portrait.updated', workId });
  deps.logger.record({
    level: 'info',
    module: 'illustration',
    workId,
    event: 'portrait.adopted',
    data: { setId: row.id, scope: 'work', slots: reviewedSlots(readSlots(row.slots)).count },
  });
  return { draft: viewOf(deps.db, row.id), activeSetId: activeId };
}

function adoptPending(deps: PortraitDeps, row: typeof portraitSets.$inferSelect): PortraitDraftView {
  const slots = readSlots(row.slots);
  if (slots.front.file === null || slots.front.needsReview) invalid('a reviewed front portrait is required');

  const now = Date.now();
  const activeId = randomUUID();
  deps.db.transaction(
    (tx) => {
      const current = requireDraftSet(tx, row.id, row.draftRev);
      tx.insert(portraitSets)
        .values({
          id: activeId,
          workId: current.workId,
          scope: 'pending',
          playthroughId: null,
          entityId: current.entityId,
          appearanceFactId: null,
          appearanceHash: current.appearanceHash,
          appearance: current.appearance,
          style: current.style,
          state: 'active',
          draftRev: 0,
          slots: reviewedSlots(readSlots(current.slots)).slots,
          task: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    },
    { behavior: 'immediate' },
  );

  deps.bus.publish({ type: 'portrait.updated', workId: row.workId });
  deps.logger.record({
    level: 'info',
    module: 'illustration',
    workId: row.workId,
    event: 'portrait.adopted',
    data: { setId: row.id, scope: 'pending', slots: reviewedSlots(slots).count },
  });
  return { draft: viewOf(deps.db, row.id), activeSetId: activeId };
}

export function portraitPreview(deps: PortraitDeps, input: PortraitPreviewInput): PortraitSetView {
  const fingerprint = `preview:${input.workId}:${JSON.stringify(input.style)}`;
  const cached = cachedPortraitResult<PortraitSetView>(input.requestId, fingerprint);
  if (cached) return cached;

  const work = deps.db.select().from(works).where(eq(works.id, input.workId)).get();
  if (!work) notFound('work not found');
  const serviceId = deps.image.selectedServiceId();
  if (serviceId === null) throw appError('image_not_configured', 'no image service is selected');

  const capabilities = deps.image.capabilities(serviceId);
  let format: IllustrationFormat | null = null;
  if (capabilities !== null) {
    format = resolveFormat(capabilities, null, 'fast', 'default').format;
    deps.image.assertFormat(capabilities, {
      aspect: format.aspectPreference,
      size: format.size,
      quality: 'fast',
    });
  }

  const now = Date.now();
  const id = randomUUID();
  const attemptId = randomUUID();
  const task: PortraitTask = {
    attemptId,
    status: 'running',
    error: null,
    format,
    quality: 'fast',
    inputFiles: [],
    appearanceHash: appearanceHash(''),
  };
  deps.db.transaction(
    (tx) => {
      tx.insert(portraitSets)
        .values({
          id,
          workId: work.id,
          scope: 'pending',
          playthroughId: null,
          entityId: null,
          appearanceFactId: null,
          appearanceHash: appearanceHash(''),
          appearance: '',
          style: input.style,
          state: 'draft',
          draftRev: 0,
          slots: PortraitSlotsStoredSchema.parse(EMPTY_PORTRAIT_SLOTS),
          task: PortraitTasksSchema.parse({ ...EMPTY_PORTRAIT_TASKS, front: task }),
          createdAt: now,
          updatedAt: now,
        })
        .run();
    },
    { behavior: 'immediate' },
  );

  deps.bus.publish({ type: 'portrait.updated', workId: work.id });
  scheduleJob(deps, {
    setId: id,
    workId: work.id,
    slot: 'front',
    attemptId,
    serviceId,
    task,
    preference: null,
    defaultTier: 'default',
    appearance: '',
    style: input.style,
    prompt: previewPrompt(input.style),
  });
  return rememberPortraitResult(input.requestId, fingerprint, viewOf(deps.db, id));
}

function playthroughSet(
  db: Reader,
  input: { playthroughId: string; entityId: string; identityFactId: string | null },
): typeof portraitSets.$inferSelect | undefined {
  return db
    .select()
    .from(portraitSets)
    .where(
      and(
        eq(portraitSets.scope, 'playthrough'),
        eq(portraitSets.playthroughId, input.playthroughId),
        eq(portraitSets.entityId, input.entityId),
        input.identityFactId === null
          ? isNull(portraitSets.appearanceFactId)
          : eq(portraitSets.appearanceFactId, input.identityFactId),
      ),
    )
    .get();
}

export function ensurePlaythroughFront(
  deps: PortraitDeps,
  input: {
    playthroughId: string;
    workId: string;
    entityId: string;
    serviceId: string;
    guard: ImageDispatchGuard;
    identityFactId: string | null;
    appearance: string;
    style: IllustrationStyle;
    signal: AbortSignal;
  },
): Promise<{ setId: string; front: ImageFileRef }> {
  const key = `${input.playthroughId}:${input.entityId}:${input.identityFactId ?? ''}`;
  const running = frontFlights.get(key);
  if (running) return running;
  const flight = createPlaythroughFront(deps, input).finally(() => {
    frontFlights.delete(key);
  });
  frontFlights.set(key, flight);
  return flight;
}

async function createPlaythroughFront(
  deps: PortraitDeps,
  input: {
    playthroughId: string;
    workId: string;
    entityId: string;
    serviceId: string;
    guard: ImageDispatchGuard;
    identityFactId: string | null;
    appearance: string;
    style: IllustrationStyle;
    signal: AbortSignal;
  },
): Promise<{ setId: string; front: ImageFileRef }> {
  const owner = deps.db
    .select({ workId: workVersions.workId })
    .from(playthroughs)
    .innerJoin(workVersions, eq(playthroughs.versionId, workVersions.id))
    .where(eq(playthroughs.id, input.playthroughId))
    .get();
  if (!owner) notFound('playthrough not found');
  if (owner.workId !== input.workId) notFound('playthrough not found');

  const lookup = {
    playthroughId: input.playthroughId,
    entityId: input.entityId,
    identityFactId: input.identityFactId,
  };
  let row = playthroughSet(deps.db, lookup);
  if (row?.slots.front.file) return { setId: row.id, front: row.slots.front.file };

  const now = Date.now();
  if (!row) {
    const id = randomUUID();
    try {
      deps.db.transaction(
        (tx) => {
          tx.insert(portraitSets)
            .values({
              id,
              workId: input.workId,
              scope: 'playthrough',
              playthroughId: input.playthroughId,
              entityId: input.entityId,
              appearanceFactId: input.identityFactId,
              appearanceHash: appearanceHash(input.appearance),
              appearance: input.appearance,
              style: input.style,
              state: 'draft',
              draftRev: 0,
              slots: PortraitSlotsStoredSchema.parse(EMPTY_PORTRAIT_SLOTS),
              task: null,
              createdAt: now,
              updatedAt: now,
            })
            .run();
        },
        { behavior: 'immediate' },
      );
    } catch (error) {
      row = playthroughSet(deps.db, lookup);
      if (!row) throw error;
    }
    row = row ?? playthroughSet(deps.db, lookup);
  }
  if (!row) throw appError('internal', 'playthrough portrait set was not created');
  if (row.slots.front.file) return { setId: row.id, front: row.slots.front.file };

  const attemptId = randomUUID();
  const task: PortraitTask = {
    attemptId,
    status: 'running',
    error: null,
    format: null,
    quality: 'best',
    inputFiles: [],
    appearanceHash: row.appearanceHash,
  };
  deps.db.transaction(
    (tx) => {
      const current = tx.select().from(portraitSets).where(eq(portraitSets.id, row.id)).get();
      if (!current) throw appError('not_found', 'portrait set not found');
      tx.update(portraitSets)
        .set({
          task: withTask(readTasks(current.task), 'front', task),
          draftRev: current.draftRev + 1,
          updatedAt: Date.now(),
        })
        .where(eq(portraitSets.id, current.id))
        .run();
    },
    { behavior: 'immediate' },
  );

  try {
    const capabilities = await deps.image.prepareGeneration(input.serviceId, {
      manual: false,
      signal: input.signal,
      guard: input.guard,
    });
    const resolved = resolveFormat(capabilities, null, 'best', '1k');
    deps.image.assertFormat(capabilities, {
      aspect: resolved.aspect,
      size: resolved.size,
      quality: 'best',
    });
    if (capabilities.maxReferences < 1) throw new ImageError('image_invalid_request', 'final');
    const recorded = recordTaskFormat(
      deps,
      {
        setId: row.id,
        workId: input.workId,
        slot: 'front',
        attemptId,
        serviceId: input.serviceId,
        task,
        preference: null,
        defaultTier: '1k',
        appearance: input.appearance,
        style: input.style,
        prompt: null,
      },
      resolved.format,
    );
    if (!recorded) throw new DOMException('portrait front is no longer current', 'AbortError');
    const result = await deps.image.generate({
      serviceId: input.serviceId,
      guard: input.guard,
      prompt: frontPrompt(input.appearance, input.style),
      negativePrompt: null,
      references: [],
      aspect: resolved.aspect,
      size: resolved.size,
      quality: 'best',
      seed: null,
      signal: input.signal,
      ref: { workId: input.workId, kind: 'portrait', id: row.id },
      manual: false,
    });
    if (capabilities.maxReferenceBytes !== null && result.bytes.length > capabilities.maxReferenceBytes) {
      throw new ImageError('image_reference_too_large', 'final');
    }
    const staged = await deps.store.stage(result.bytes, { rejectMetadata: true });
    const committed = await deps.store.commit(
      [staged],
      () => {
        const current = requireSet(deps.db, row.id);
        deps.db
          .update(portraitSets)
          .set({
            slots: PortraitSlotsStoredSchema.parse({
              ...readSlots(current.slots),
              front: { file: staged.ref, source: 'generate' as const, needsReview: false },
            }),
            task: withTask(readTasks(current.task), 'front', null),
            state: 'active',
            draftRev: current.draftRev + 1,
            updatedAt: Date.now(),
          })
          .where(eq(portraitSets.id, current.id))
          .run();
        return current;
      },
      () => {
        input.guard.assertCurrent();
        const current = deps.db.select().from(portraitSets).where(eq(portraitSets.id, row.id)).get();
        const currentTask = readTasks(current?.task ?? null)?.front;
        if (!current || currentTask?.attemptId !== attemptId) throw new StalePortraitJob();
        if (current.appearanceHash !== appearanceHash(input.appearance)) throw new StalePortraitJob();
      },
    );

    deps.bus.publish({ type: 'portrait.updated', workId: committed.workId });
    deps.logger.record({
      level: 'info',
      module: 'illustration',
      workId: committed.workId,
      event: 'portrait.done',
      data: { setId: row.id, slot: 'front', source: 'generate' },
    });
    return { setId: row.id, front: staged.ref };
  } catch (error) {
    if (isAbortError(error)) {
      clearFrontTask(deps, row.id, attemptId);
      throw error;
    }
    if (isStale(error)) {
      clearFrontTask(deps, row.id, attemptId);
      throw new DOMException('portrait front is no longer current', 'AbortError');
    }
    markFrontFailed(deps, row.id, attemptId, errorCodeOf(error));
    throw error;
  }
}

function clearFrontTask(deps: PortraitDeps, setId: string, attemptId: string): void {
  deps.db.transaction(
    (tx) => {
      const row = tx.select().from(portraitSets).where(eq(portraitSets.id, setId)).get();
      const tasks = readTasks(row?.task ?? null);
      if (!row || tasks?.front?.attemptId !== attemptId) return;
      tx.update(portraitSets)
        .set({ task: withTask(tasks, 'front', null), updatedAt: Date.now() })
        .where(eq(portraitSets.id, setId))
        .run();
    },
    { behavior: 'immediate' },
  );
}

function markFrontFailed(deps: PortraitDeps, setId: string, attemptId: string, code: ErrorCode): void {
  deps.db.transaction(
    (tx) => {
      const row = tx.select().from(portraitSets).where(eq(portraitSets.id, setId)).get();
      const tasks = readTasks(row?.task ?? null);
      const task = tasks?.front;
      if (!row || !task || task.attemptId !== attemptId) return;
      tx.update(portraitSets)
        .set({
          task: withTask(tasks, 'front', { ...task, status: 'failed', error: code }),
          updatedAt: Date.now(),
        })
        .where(eq(portraitSets.id, setId))
        .run();
    },
    { behavior: 'immediate' },
  );
}

export function failInterruptedPortraitTasks(db: Database, logger: Logger): number {
  const rows = db.select().from(portraitSets).all();
  const interrupted: Array<{
    setId: string;
    workId: string;
    slot: PortraitSlot;
    attemptId: string;
  }> = [];

  db.transaction(
    (tx) => {
      for (const row of rows) {
        const tasks = readTasks(row.task);
        if (!tasks) continue;
        const next = { ...tasks };
        let changed = false;
        for (const slot of PORTRAIT_SLOTS) {
          const task = next[slot];
          if (!task || task.status !== 'running') continue;
          next[slot] = { ...task, status: 'failed', error: 'image_interrupted' };
          interrupted.push({ setId: row.id, workId: row.workId, slot, attemptId: task.attemptId });
          changed = true;
        }
        if (!changed) continue;
        tx.update(portraitSets)
          .set({ task: PortraitTasksSchema.parse(next), updatedAt: Date.now() })
          .where(eq(portraitSets.id, row.id))
          .run();
      }
    },
    { behavior: 'immediate' },
  );

  for (const item of interrupted) {
    logger.record({
      level: 'warn',
      module: 'illustration',
      workId: item.workId,
      requestId: item.attemptId,
      event: 'portrait.interrupted',
      data: { setId: item.setId, slot: item.slot, code: 'image_interrupted' },
    });
  }
  return interrupted.length;
}
