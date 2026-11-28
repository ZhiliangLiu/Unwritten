import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNotNull, or } from 'drizzle-orm';
import { AttemptDataSchema, PlaythroughIllustrationSchema, type AttemptData } from '../store/illustration-types.ts';
import { illustrations, playthroughs, routes } from '../store/schema.ts';
import { illustrationEnabled } from './enqueue.ts';
import { runAttempt, type PipelineDeps } from './pipeline.ts';
import type { IllustrationRow } from './views.ts';

export interface IllustrationWorker {
  kick(): void;
  whenIdle(): Promise<void>;
  abort(illustrationId: string, attemptId: string | null): void;
}

interface RunningController {
  attemptId: string;
  controller: AbortController;
}

export function createIllustrationWorker(deps: PipelineDeps): IllustrationWorker {
  const controllers = new Map<string, RunningController>();
  let active: Promise<void> | null = null;
  let rerun = false;

  const nextRow = (): IllustrationRow | null => {
    return (
      deps.db
        .select()
        .from(illustrations)
        .where(
          or(
            eq(illustrations.status, 'queued'),
            and(eq(illustrations.status, 'done'), isNotNull(illustrations.activeAttemptId)),
          ),
        )
        .orderBy(asc(illustrations.createdAt), asc(illustrations.id))
        .limit(1)
        .get() ?? null
    );
  };

  const publishRow = (row: IllustrationRow): void => {
    const route = deps.db
      .select({ id: routes.id })
      .from(routes)
      .where(eq(routes.playthroughId, row.playthroughId))
      .get();
    if (!route) return;
    deps.bus.publish({
      type: 'illustration.updated',
      routeId: route.id,
      turnId: row.turnId,
      illustrationId: row.id,
    });
  };

  const cancelRow = (row: IllustrationRow): void => {
    const now = Date.now();
    const updated =
      row.file === null
        ? deps.db
            .update(illustrations)
            .set({
              status: 'cancelled',
              stage: null,
              error: null,
              activeAttemptId: null,
              attemptData: null,
              updatedAt: now,
            })
            .where(eq(illustrations.id, row.id))
            .run()
        : deps.db
            .update(illustrations)
            .set({ activeAttemptId: null, attemptData: null, updatedAt: now })
            .where(eq(illustrations.id, row.id))
            .run();
    if (updated.changes === 0) return;
    publishRow(row);
  };

  const attemptFor = (row: IllustrationRow, serviceId: string): { attemptId: string; attemptData: AttemptData } => {
    const existing =
      row.activeAttemptId === null || row.attemptData === null ? null : AttemptDataSchema.safeParse(row.attemptData);
    const attemptId =
      row.activeAttemptId !== null && existing?.success === true && existing.data.attemptId === row.activeAttemptId
        ? row.activeAttemptId
        : randomUUID();
    const attemptData =
      existing?.success === true && existing.data.attemptId === attemptId
        ? existing.data
        : AttemptDataSchema.parse({
            attemptId,
            kind: 'first',
            formatOverride: null,
            format: row.format,
            shot: null,
            referenceFiles: null,
            seed: null,
            serviceId: null,
            completed: [],
          });
    return { attemptId, attemptData: { ...attemptData, serviceId } };
  };

  const process = async (row: IllustrationRow): Promise<void> => {
    const playthrough = deps.db.select().from(playthroughs).where(eq(playthroughs.id, row.playthroughId)).get();
    const parsed = playthrough ? PlaythroughIllustrationSchema.safeParse(playthrough.illustration) : null;
    const target = deps.image.activeTarget();
    if (!playthrough || !parsed?.success || !illustrationEnabled(parsed.data, target) || target === null) {
      cancelRow(row);
      return;
    }

    const { attemptId, attemptData } = attemptFor(row, target.serviceId);
    deps.db
      .update(illustrations)
      .set({ activeAttemptId: attemptId, attemptData, updatedAt: Date.now() })
      .where(eq(illustrations.id, row.id))
      .run();
    publishRow(row);

    deps.logger.sample({
      metric: 'illustration.queue',
      durationMs: Date.now() - row.createdAt,
      outcome: 'ok',
      requestId: row.id,
      data: { para: row.para },
    });

    const controller = new AbortController();
    controllers.set(row.id, { attemptId, controller });
    const signal = AbortSignal.any([controller.signal, deps.shutdown]);
    try {
      await runAttempt(deps, { ...row, activeAttemptId: attemptId, attemptData }, signal);
    } finally {
      const current = controllers.get(row.id);
      if (current?.controller === controller) controllers.delete(row.id);
    }
  };

  const loop = async (): Promise<void> => {
    do {
      rerun = false;
      while (!deps.shutdown.aborted) {
        const row = nextRow();
        if (!row) break;
        await process(row);
      }
    } while (rerun && !deps.shutdown.aborted);
  };

  const start = (): void => {
    if (active !== null || deps.shutdown.aborted) return;
    active = loop()
      .catch(() => {})
      .finally(() => {
        active = null;
      });
  };

  return {
    kick() {
      if (deps.shutdown.aborted) return;
      if (active !== null) {
        rerun = true;
        return;
      }
      start();
    },
    async whenIdle() {
      while (active !== null) await active;
    },
    abort(illustrationId, attemptId) {
      const current = controllers.get(illustrationId);
      if (!current) return;
      if (attemptId !== null && current.attemptId !== attemptId) return;
      current.controller.abort();
    },
  };
}
