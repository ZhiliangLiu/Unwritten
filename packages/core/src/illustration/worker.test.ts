import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createEventBus } from '../events/bus.ts';
import { createImageService } from '../image/service.ts';
import type { Logger } from '../log/logger.ts';
import type { ImageService } from '../services.ts';
import { openDatabase } from '../store/db.ts';
import { PlaythroughIllustrationSchema, TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION } from '../store/illustration-types.ts';
import { imageCalls, illustrations, playthroughs } from '../store/schema.ts';
import { startFakeImageServer } from '../test-support/fake-image-server.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { seedLighthouseTown, type SeededStory } from '../test-support/story-fixtures.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { enqueueIllustration } from './enqueue.ts';
import type { PipelineDeps } from './pipeline.ts';
import { createPortraitRunner } from './portrait-runner.ts';
import { createImageStore } from './storage.ts';
import { createIllustrationWorker } from './worker.ts';

function silentLogger(): Logger {
  return {
    record() {},
    sample() {},
    async flush() {},
    async close() {},
  };
}

function shotText(caption: string): string {
  return [
    'PROMPT: A quiet harbour at night, a lamp glowing at the end of the pier.',
    'NEGATIVE: ',
    `CAPTION: ${caption}`,
    'REFS: ',
  ].join('\n');
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition was not met in time');
    await delay(5);
  }
}

interface WorkerHarness {
  worker: ReturnType<typeof createIllustrationWorker>;
  llm: ReturnType<typeof createScriptedLlm>;
  opened: ReturnType<typeof openDatabase>;
  seeded: SeededStory;
  image: ImageService;
  server: Awaited<ReturnType<typeof startFakeImageServer>>;
  queue(turnId: string, para: number, createdAt: number): string;
  cleanup(): Promise<void>;
}

async function setup(): Promise<WorkerHarness> {
  const server = await startFakeImageServer({ jobDelayMs: 5 });
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const seeded = seedLighthouseTown(opened.db);
  const logger = silentLogger();
  const bus = createEventBus();
  const llm = createScriptedLlm();
  const shutdown = new AbortController();
  const deps = { dataDir: temp.dir, db: opened.db, bus, logger, shutdown: shutdown.signal };
  const image = createImageService({ ...deps, llm }, { env: {}, pollIntervalMs: 5, jobTimeoutMs: 5_000 });
  const created = await image.createService({
    requestId: '00000000-0000-4000-8000-000000000001',
    baseRevision: image.listServices().revision,
    name: '测试出图',
    protocol: 'unwritten-image',
    baseUrl: server.url,
    apiKey: server.token,
    model: null,
    openai: null,
    launcher: null,
    idleMinutes: null,
  });
  await image.select({ baseRevision: image.listServices().revision, serviceId: created.serviceId });
  image.setAutoIllustration({ enabled: true, confirm: image.getAutoIllustration().current! });
  const settings = PlaythroughIllustrationSchema.parse({
    ...TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION,
    enabled: true,
    aspectPreference: '3:2',
    resolutionTier: '1k',
  });
  opened.db.update(playthroughs).set({ illustration: settings }).where(eq(playthroughs.id, seeded.playthroughId)).run();
  const pipelineDeps: PipelineDeps = {
    db: opened.db,
    bus,
    logger,
    image,
    llm,
    store: createImageStore(temp.dir, logger),
    runner: createPortraitRunner(),
    shutdown: shutdown.signal,
  };
  return {
    worker: createIllustrationWorker(pipelineDeps),
    llm,
    opened,
    seeded,
    image,
    server,
    queue(turnId, para, createdAt) {
      return opened.db.transaction(
        (tx) =>
          enqueueIllustration(tx, { turnId, playthroughId: seeded.playthroughId, para, settings, now: createdAt }),
        { behavior: 'immediate' },
      );
    },
    async cleanup() {
      shutdown.abort();
      opened.close();
      temp.cleanup();
      await server.close();
    },
  };
}

describe('createIllustrationWorker', () => {
  it('一次只处理一行：第二行在第一行结束前保持未开始', async () => {
    const harness = await setup();
    try {
      const first = harness.queue(harness.seeded.turnIds[2]!, 1, Date.now());
      const second = harness.queue(harness.seeded.turnIds[1]!, 1, Date.now() + 1);
      harness.llm.enqueue({ text: shotText('栈桥尽头亮着一盏灯。') }, { text: shotText('雨里，两个人停在岸边。') });
      const release = harness.server.holdNextJob();
      harness.worker.kick();

      const jobPosts = () => harness.server.requests.filter((r) => r.method === 'POST' && r.path === '/v1/jobs');
      await waitFor(() => jobPosts().length === 1);
      const secondRow = harness.opened.db.select().from(illustrations).where(eq(illustrations.id, second)).get()!;
      expect(secondRow.status).toBe('queued');
      expect(secondRow.activeAttemptId).toBeNull();

      release();
      await harness.worker.whenIdle();

      const rows = harness.opened.db.select().from(illustrations).all();
      const byId = (left: [string, string], right: [string, string]) => left[0].localeCompare(right[0]);
      expect((rows.map((row) => [row.id, row.status]) as Array<[string, string]>).sort(byId)).toEqual(
        (
          [
            [first, 'done'],
            [second, 'done'],
          ] as Array<[string, string]>
        ).sort(byId),
      );
      const calls = harness.opened.db.select().from(imageCalls).orderBy(imageCalls.createdAt).all();
      expect(calls.map((call) => call.refId)).toEqual([first, second]);
      expect(jobPosts()).toHaveLength(2);
    } finally {
      await harness.cleanup();
    }
  });
});
