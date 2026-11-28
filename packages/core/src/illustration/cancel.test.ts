import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '@unwritten/contracts';
import { createEventBus } from '../events/bus.ts';
import type { Logger, LogEvent } from '../log/logger.ts';
import { openDatabase } from '../store/db.ts';
import { illustrations } from '../store/schema.ts';
import { seedLighthouseTown } from '../test-support/story-fixtures.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { cancelUnconfirmed } from './cancel.ts';

function recordingLogger(): { logger: Logger; events: LogEvent[] } {
  const events: LogEvent[] = [];
  return {
    events,
    logger: {
      record(event) {
        events.push(event);
      },
      sample() {},
      async flush() {},
      async close() {},
    },
  };
}

describe('cancelUnconfirmed', () => {
  it('取消排队和在画的记录，完成的重画只清尝试，并中止各自的控制器', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    const seeded = seedLighthouseTown(opened.db);
    const { logger, events } = recordingLogger();
    const published: CoreEvent[] = [];
    const realBus = createEventBus();
    const aborted: Array<{ id: string; attemptId: string | null }> = [];
    const now = Date.now();

    const queuedAttempt = randomUUID();
    const runningAttempt = randomUUID();
    const doneAttempt = randomUUID();
    const rows = [
      {
        id: randomUUID(),
        turnId: seeded.turnIds[0]!,
        status: 'queued' as const,
        attemptId: queuedAttempt,
        file: null,
      },
      {
        id: randomUUID(),
        turnId: seeded.turnIds[1]!,
        status: 'running' as const,
        attemptId: runningAttempt,
        file: null,
      },
      {
        id: randomUUID(),
        turnId: seeded.turnIds[2]!,
        status: 'done' as const,
        attemptId: doneAttempt,
        file: { hash: 'c'.repeat(64), mime: 'image/png' as const, width: 4, height: 4, bytes: 8 },
      },
    ];
    for (const row of rows) {
      opened.db
        .insert(illustrations)
        .values({
          id: row.id,
          turnId: row.turnId,
          playthroughId: seeded.playthroughId,
          para: 1,
          formatPreference: { aspectPreference: '3:2', resolutionTier: '1k' },
          format: { aspectPreference: '3:2', resolutionTier: '1k', size: null },
          status: row.status,
          file: row.file,
          activeAttemptId: row.attemptId,
          attemptData: {
            attemptId: row.attemptId,
            kind: 'first',
            formatOverride: null,
            format: null,
            shot: null,
            referenceFiles: null,
            seed: null,
            serviceId: 'image-a',
            completed: [],
          },
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    try {
      const count = cancelUnconfirmed(
        {
          db: opened.db,
          bus: {
            publish(event: CoreEvent) {
              published.push(event);
              realBus.publish(event);
            },
            subscribe(signal: AbortSignal) {
              return realBus.subscribe(signal);
            },
          },
          image: {
            activeTarget: () => null,
            getAutoIllustration: () => ({ enabled: false, current: null, confirmed: null }),
          },
          logger,
          shutdown: new AbortController().signal,
          worker: {
            abort(id, attemptId) {
              aborted.push({ id, attemptId });
            },
          },
        },
        null,
      );

      expect(count).toBe(3);
      expect(opened.db.select().from(illustrations).where(eq(illustrations.id, rows[0]!.id)).get()).toMatchObject({
        status: 'cancelled',
        activeAttemptId: null,
      });
      expect(opened.db.select().from(illustrations).where(eq(illustrations.id, rows[1]!.id)).get()).toMatchObject({
        status: 'cancelled',
        activeAttemptId: null,
      });
      expect(opened.db.select().from(illustrations).where(eq(illustrations.id, rows[2]!.id)).get()).toMatchObject({
        status: 'done',
        activeAttemptId: null,
      });
      expect(aborted).toEqual(
        expect.arrayContaining([
          { id: rows[0]!.id, attemptId: queuedAttempt },
          { id: rows[1]!.id, attemptId: runningAttempt },
          { id: rows[2]!.id, attemptId: doneAttempt },
        ]),
      );
      expect(published.filter((event) => event.type === 'illustration.updated')).toHaveLength(3);
      expect(events.find((event) => event.event === 'illustration.cancelled')?.data).toEqual({
        count: 3,
        reason: 'disabled',
      });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
