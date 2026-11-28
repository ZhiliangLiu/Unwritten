import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { IllustrationStyleSchema, type IllustrationView, type OutputPreferences } from '@unwritten/contracts';
import { appError } from '../errors.ts';
import { LlmRunError } from '../llm/types.ts';
import type { CoreDeps, IllustrationService, ImageService, LlmService } from '../services.ts';
import type { Database } from '../store/db.ts';
import {
  AttemptDataSchema,
  PlaythroughIllustrationSchema,
  type PlaythroughIllustration,
} from '../store/illustration-types.ts';
import { illustrations, playthroughs, routes, works } from '../store/schema.ts';
import { subscribeCancellation } from './cancel.ts';
import { illustrationEnabled, enqueueIllustration } from './enqueue.ts';
import { resolveImageFile } from './file-access.ts';
import { collectGarbage, storageSummary } from './gc.ts';
import { journalPortraits as selectJournalPortraits } from './journal-portraits.ts';
import { firstUnfinishedStage, type PipelineDeps } from './pipeline.ts';
import { createPortraitRunner } from './portrait-runner.ts';
import {
  failInterruptedPortraitTasks,
  portraitAdopt,
  portraitDraft,
  portraitGenerate,
  portraitGet,
  portraitPreview,
  portraitUpdate,
  portraitUpload,
  type PortraitDeps,
} from './portraits.ts';
import { suggestAppearance } from './suggest.ts';
import { createImageStore } from './storage.ts';
import { illustrationView, type IllustrationRow } from './views.ts';
import { createIllustrationWorker } from './worker.ts';

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

export function createIllustrationService(
  deps: CoreDeps & { llm: LlmService; image: ImageService },
): IllustrationService {
  const store = createImageStore(deps.dataDir, deps.logger);
  const runner = createPortraitRunner();
  const portraits: PortraitDeps = {
    db: deps.db,
    bus: deps.bus,
    logger: deps.logger,
    image: deps.image,
    store,
    runner,
    shutdown: deps.shutdown,
  };
  const pipelineDeps: PipelineDeps = { ...portraits, image: deps.image, llm: deps.llm };
  const worker = createIllustrationWorker(pipelineDeps);
  subscribeCancellation({
    db: deps.db,
    bus: deps.bus,
    image: deps.image,
    logger: deps.logger,
    shutdown: deps.shutdown,
    worker,
  });

  interface IdempotentEntry {
    at: number;
    view: IllustrationView;
    action: 'retry' | 'reroll' | 'dismiss';
    illustrationId: string;
    format: OutputPreferences | null;
  }
  const idempotent = new Map<string, IdempotentEntry>();
  const cached = (
    requestId: string,
    input: { action: IdempotentEntry['action']; illustrationId: string; format: OutputPreferences | null },
  ): IllustrationView | null => {
    const entry = idempotent.get(requestId);
    if (!entry) return null;
    if (Date.now() - entry.at > IDEMPOTENCY_TTL_MS) {
      idempotent.delete(requestId);
      return null;
    }
    if (
      entry.action !== input.action ||
      entry.illustrationId !== input.illustrationId ||
      JSON.stringify(entry.format) !== JSON.stringify(input.format)
    ) {
      throw appError('idempotency_conflict', 'request id is already used');
    }
    return entry.view;
  };
  const remember = (
    requestId: string,
    input: { action: IdempotentEntry['action']; illustrationId: string; format: OutputPreferences | null },
    view: IllustrationView,
  ): void => {
    const now = Date.now();
    for (const [key, entry] of idempotent) if (now - entry.at > IDEMPOTENCY_TTL_MS) idempotent.delete(key);
    idempotent.set(requestId, { at: now, view, ...input });
  };

  const routeIdOf = (playthroughId: string): string | null =>
    deps.db.select({ id: routes.id }).from(routes).where(eq(routes.playthroughId, playthroughId)).get()?.id ?? null;

  const publishUpdated = (row: IllustrationRow): void => {
    const routeId = routeIdOf(row.playthroughId);
    if (routeId !== null) {
      deps.bus.publish({ type: 'illustration.updated', routeId, turnId: row.turnId, illustrationId: row.id });
    }
  };

  const enabledSettings = (reader: Pick<Database, 'select'>, playthroughId: string): PlaythroughIllustration | null => {
    const playthrough = reader.select().from(playthroughs).where(eq(playthroughs.id, playthroughId)).get();
    if (!playthrough) return null;
    const parsed = PlaythroughIllustrationSchema.safeParse(playthrough.illustration);
    if (!parsed.success) return null;
    return illustrationEnabled(parsed.data, deps.image.activeTarget()) ? parsed.data : null;
  };

  return {
    retry(input) {
      const idempotencyInput = {
        action: 'retry' as const,
        illustrationId: input.illustrationId,
        format: input.format ?? null,
      };
      const previous = cached(input.requestId, idempotencyInput);
      if (previous) return previous;
      const row = deps.db.transaction(
        (tx) => {
          const current = tx.select().from(illustrations).where(eq(illustrations.id, input.illustrationId)).get();
          if (!current) throw appError('not_found', 'illustration not found');
          if (current.status !== 'failed') throw appError('request_not_retryable', 'illustration is not failed');
          if (enabledSettings(tx, current.playthroughId) === null) {
            throw appError('illustration_not_enabled', 'illustration is not enabled');
          }
          const base = current.attemptData === null ? null : AttemptDataSchema.safeParse(current.attemptData);
          const data = base?.success === true ? base.data : null;
          const attemptId = randomUUID();
          const attempt = AttemptDataSchema.parse({
            attemptId,
            kind: 'retry',
            formatOverride: input.format ?? null,
            format: current.format ?? data?.format ?? null,
            shot: data?.shot ?? null,
            referenceFiles: data?.referenceFiles ?? null,
            seed: data?.seed ?? null,
            serviceId: null,
            completed: data?.completed ?? [],
          });
          tx.update(illustrations)
            .set({
              status: 'queued',
              stage: null,
              error: null,
              activeAttemptId: attemptId,
              attemptData: attempt,
              updatedAt: Date.now(),
            })
            .where(eq(illustrations.id, current.id))
            .run();
          return tx.select().from(illustrations).where(eq(illustrations.id, current.id)).get()!;
        },
        { behavior: 'immediate' },
      );
      const view = illustrationView(row);
      remember(input.requestId, idempotencyInput, view);
      publishUpdated(row);
      worker.kick();
      return view;
    },
    reroll(input) {
      const idempotencyInput = {
        action: 'reroll' as const,
        illustrationId: input.illustrationId,
        format: input.format ?? null,
      };
      const previous = cached(input.requestId, idempotencyInput);
      if (previous) return previous;
      const row = deps.db.transaction(
        (tx) => {
          const current = tx.select().from(illustrations).where(eq(illustrations.id, input.illustrationId)).get();
          if (!current) throw appError('not_found', 'illustration not found');
          if (current.status !== 'done') throw appError('request_not_retryable', 'illustration is not done');
          if (enabledSettings(tx, current.playthroughId) === null) {
            throw appError('illustration_not_enabled', 'illustration is not enabled');
          }
          const attemptId = randomUUID();
          const attempt = AttemptDataSchema.parse({
            attemptId,
            kind: 'reroll',
            formatOverride: input.format ?? null,
            format: current.format,
            shot: null,
            referenceFiles: null,
            seed: null,
            serviceId: null,
            completed: [],
          });
          tx.update(illustrations)
            .set({ activeAttemptId: attemptId, attemptData: attempt, error: null, updatedAt: Date.now() })
            .where(eq(illustrations.id, current.id))
            .run();
          return tx.select().from(illustrations).where(eq(illustrations.id, current.id)).get()!;
        },
        { behavior: 'immediate' },
      );
      const view = illustrationView(row);
      remember(input.requestId, idempotencyInput, view);
      publishUpdated(row);
      worker.kick();
      return view;
    },
    dismiss(input) {
      const idempotencyInput = { action: 'dismiss' as const, illustrationId: input.illustrationId, format: null };
      const previous = cached(input.requestId, idempotencyInput);
      if (previous) return previous;
      const outcome = deps.db.transaction(
        (tx) => {
          const current = tx.select().from(illustrations).where(eq(illustrations.id, input.illustrationId)).get();
          if (!current) throw appError('not_found', 'illustration not found');
          const attemptId = current.activeAttemptId;
          const hadImage = current.file !== null;
          tx.update(illustrations)
            .set({
              status: 'dismissed',
              stage: null,
              error: null,
              activeAttemptId: null,
              attemptData: null,
              updatedAt: Date.now(),
            })
            .where(eq(illustrations.id, current.id))
            .run();
          const row = tx.select().from(illustrations).where(eq(illustrations.id, current.id)).get()!;
          return { row, attemptId, hadImage };
        },
        { behavior: 'immediate' },
      );
      worker.abort(outcome.row.id, outcome.attemptId);
      const view = illustrationView(outcome.row);
      remember(input.requestId, idempotencyInput, view);
      publishUpdated(outcome.row);
      deps.logger.record({
        level: 'info',
        module: 'illustration',
        requestId: outcome.row.id,
        event: 'illustration.dismissed',
        data: { illustrationId: outcome.row.id, hadImage: outcome.hadImage },
      });
      return view;
    },
    portraitDraft(input) {
      return portraitDraft(portraits, input);
    },
    portraitGet(input) {
      return portraitGet(portraits, input);
    },
    async portraitUpload(input) {
      return portraitUpload(portraits, input);
    },
    portraitGenerate(input) {
      return portraitGenerate(portraits, input);
    },
    portraitUpdate(input) {
      return portraitUpdate(portraits, input);
    },
    portraitAdopt(input) {
      return portraitAdopt(portraits, input);
    },
    portraitPreview(input) {
      return portraitPreview(portraits, input);
    },
    async file(input) {
      return resolveImageFile(deps.db, store, input);
    },
    storageSummary() {
      return storageSummary(deps.db);
    },
    prewarm(input) {
      const playthrough = deps.db.select().from(playthroughs).where(eq(playthroughs.id, input.playthroughId)).get();
      if (!playthrough) return {};
      const parsed = PlaythroughIllustrationSchema.safeParse(playthrough.illustration);
      const target = deps.image.activeTarget();
      if (parsed.success && illustrationEnabled(parsed.data, target) && target !== null) {
        deps.image.wake(target.serviceId, 'prewarm');
      }
      return {};
    },
    async suggestAppearance(input) {
      try {
        return await suggestAppearance(deps, input);
      } catch (error) {
        if (error instanceof LlmRunError) throw appError(error.code, error.code);
        throw error;
      }
    },
    setWorkStyle(input) {
      deps.db.transaction(
        (tx) => {
          const work = tx.select().from(works).where(eq(works.id, input.workId)).get();
          if (!work) throw appError('not_found', 'work not found');
          const style = IllustrationStyleSchema.nullable().parse(input.style);
          tx.update(works)
            .set({ illustrationStyle: style, updatedAt: Date.now() })
            .where(eq(works.id, input.workId))
            .run();
        },
        { behavior: 'immediate' },
      );
      deps.bus.publish({ type: 'works.changed', workId: input.workId });
      return {};
    },
    enqueue(tx, input) {
      return enqueueIllustration(tx, input);
    },
    forRoute(routeId) {
      const route = deps.db.select().from(routes).where(eq(routes.id, routeId)).get();
      const map = new Map<string, IllustrationView>();
      if (!route) return map;
      for (const row of deps.db
        .select()
        .from(illustrations)
        .where(eq(illustrations.playthroughId, route.playthroughId))
        .all()) {
        map.set(row.turnId, illustrationView(row));
      }
      return map;
    },
    journalPortraits(input) {
      return selectJournalPortraits(deps.db, input);
    },
    recoverInterrupted() {
      const rows = deps.db.select().from(illustrations).all();
      const recovered: IllustrationRow[] = [];
      deps.db.transaction(
        (tx) => {
          for (const row of rows) {
            const parsed = row.attemptData === null ? null : AttemptDataSchema.safeParse(row.attemptData);
            const attempt = parsed?.success === true ? parsed.data : null;
            const now = Date.now();
            const activeAttemptId = row.activeAttemptId;
            if (row.status === 'done' && activeAttemptId !== null) {
              const updated = tx
                .update(illustrations)
                .set({ activeAttemptId: null, attemptData: null, error: 'image_interrupted', updatedAt: now })
                .where(and(eq(illustrations.id, row.id), eq(illustrations.activeAttemptId, activeAttemptId)))
                .run();
              if (updated.changes > 0) recovered.push(row);
              continue;
            }
            if (row.status === 'queued' && activeAttemptId !== null) {
              if (attempt === null || attempt.serviceId === null) continue;
              const updated = tx
                .update(illustrations)
                .set({
                  status: 'failed',
                  stage: 'wake',
                  error: 'image_interrupted',
                  activeAttemptId: null,
                  updatedAt: now,
                })
                .where(and(eq(illustrations.id, row.id), eq(illustrations.activeAttemptId, activeAttemptId)))
                .run();
              if (updated.changes > 0) recovered.push({ ...row, status: 'failed', stage: 'wake' });
              continue;
            }
            if (row.status !== 'running' || activeAttemptId === null) continue;
            const stage = firstUnfinishedStage(attempt);
            const updated = tx
              .update(illustrations)
              .set({
                status: 'failed',
                stage,
                error: 'image_interrupted',
                activeAttemptId: null,
                updatedAt: now,
              })
              .where(and(eq(illustrations.id, row.id), eq(illustrations.activeAttemptId, activeAttemptId)))
              .run();
            if (updated.changes > 0) recovered.push({ ...row, status: 'failed', stage });
          }
        },
        { behavior: 'immediate' },
      );
      for (const row of recovered) {
        deps.logger.record({
          level: 'warn',
          module: 'illustration',
          requestId: row.id,
          event: 'illustration.interrupted',
          data: { stage: row.stage ?? 'generate', code: 'image_interrupted' },
        });
      }
      const portraitsInterrupted = failInterruptedPortraitTasks(deps.db, deps.logger);
      return recovered.length + portraitsInterrupted;
    },
    async prepareStorage() {
      store.clearTemp();
      await collectGarbage({ db: deps.db, store, now: Date.now(), logger: deps.logger });
    },
    async collectGarbage() {
      await collectGarbage({ db: deps.db, store, now: Date.now(), logger: deps.logger });
    },
    kick() {
      worker.kick();
    },
    async whenIdle() {
      await Promise.all([worker.whenIdle(), runner.whenIdle()]);
    },
  };
}
