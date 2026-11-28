import { and, eq, isNotNull, or } from 'drizzle-orm';
import type { AutoIllustrationTarget } from '@unwritten/contracts';
import type { EventBus } from '../events/bus.ts';
import type { Logger } from '../log/logger.ts';
import type { ImageService } from '../services.ts';
import type { Database } from '../store/db.ts';
import { illustrations, routes } from '../store/schema.ts';
import type { IllustrationWorker } from './worker.ts';

export interface CancelDeps {
  db: Database;
  bus: EventBus;
  image: Pick<ImageService, 'activeTarget' | 'getAutoIllustration'>;
  logger: Logger;
  shutdown: AbortSignal;
  worker: Pick<IllustrationWorker, 'abort'>;
}

function sameTarget(left: AutoIllustrationTarget | null, right: AutoIllustrationTarget | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.serviceId === right.serviceId &&
    left.model === right.model &&
    left.background.endpointId === right.background.endpointId &&
    left.background.modelId === right.background.modelId
  );
}

function routeIdOf(db: Database, playthroughId: string): string | null {
  return db.select({ id: routes.id }).from(routes).where(eq(routes.playthroughId, playthroughId)).get()?.id ?? null;
}

export function cancelUnconfirmed(deps: CancelDeps, current: AutoIllustrationTarget | null): number {
  const rows = deps.db
    .select()
    .from(illustrations)
    .where(
      or(
        eq(illustrations.status, 'queued'),
        eq(illustrations.status, 'running'),
        and(eq(illustrations.status, 'done'), isNotNull(illustrations.activeAttemptId)),
      ),
    )
    .all();
  if (rows.length === 0) return 0;

  const now = Date.now();
  deps.db.transaction(
    (tx) => {
      for (const row of rows) {
        if (row.file === null) {
          tx.update(illustrations)
            .set({
              status: 'cancelled',
              stage: null,
              error: null,
              activeAttemptId: null,
              attemptData: null,
              updatedAt: now,
            })
            .where(eq(illustrations.id, row.id))
            .run();
        } else {
          tx.update(illustrations)
            .set({ activeAttemptId: null, attemptData: null, updatedAt: now })
            .where(eq(illustrations.id, row.id))
            .run();
        }
      }
    },
    { behavior: 'immediate' },
  );

  for (const row of rows) {
    deps.worker.abort(row.id, row.activeAttemptId);
    const routeId = routeIdOf(deps.db, row.playthroughId);
    if (routeId !== null) {
      deps.bus.publish({ type: 'illustration.updated', routeId, turnId: row.turnId, illustrationId: row.id });
    }
  }

  const confirmed = deps.image.getAutoIllustration().confirmed;
  deps.logger.record({
    level: 'info',
    module: 'illustration',
    event: 'illustration.cancelled',
    data: { count: rows.length, reason: current === null && confirmed === null ? 'disabled' : 'service_changed' },
  });
  return rows.length;
}

export function subscribeCancellation(deps: CancelDeps): void {
  let previous = deps.image.activeTarget();
  const consume = async (): Promise<void> => {
    try {
      for await (const event of deps.bus.subscribe(deps.shutdown)) {
        if (event.type !== 'image.config_changed' && event.type !== 'llm.config_changed') continue;
        const current = deps.image.activeTarget();
        const changed = !sameTarget(previous, current);
        const confirmedBefore = previous !== null;
        previous = current;
        if (!changed || !confirmedBefore) continue;
        cancelUnconfirmed(deps, current);
      }
    } catch {
      return;
    }
  };
  void consume();
}
