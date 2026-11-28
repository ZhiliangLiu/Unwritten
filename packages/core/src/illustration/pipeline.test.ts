import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
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
import { entities, illustrations, playthroughs, portraitSets } from '../store/schema.ts';
import { startFakeImageServer } from '../test-support/fake-image-server.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { seedLighthouseTown, seedNorthCape, type SeededStory } from '../test-support/story-fixtures.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { IMAGE_GC_GRACE_MS } from './constants.ts';
import { enqueueIllustration } from './enqueue.ts';
import { collectGarbage, referencedFiles } from './gc.ts';
import { runAttempt, type PipelineDeps } from './pipeline.ts';
import { createPortraitRunner } from './portrait-runner.ts';
import { createImageStore, type ImageStore } from './storage.ts';

function silentLogger(): Logger {
  return {
    record() {},
    sample() {},
    async flush() {},
    async close() {},
  };
}

function shotText(): string {
  return [
    'PROMPT: A quiet harbour at night, a lamp glowing at the end of the pier.',
    'NEGATIVE: ',
    'CAPTION: 雨里，两个人停在岸边。',
    'REFS: ',
  ].join('\n');
}

function referenceShotText(): string {
  return [
    'PROMPT: A person with short hair and a dark coat waits on a rainy pier, {{ref:1}} raises a lantern.',
    'NEGATIVE: ',
    'CAPTION: 雨里，栈桥尽头亮着一盏灯。',
    'REFS: C1:front',
  ].join('\n');
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition was not met in time');
    await delay(5);
  }
}

interface GuardedRun {
  gate: Promise<void>;
  reached(): boolean;
  release(): void;
}

interface PipelineHarness {
  deps: PipelineDeps;
  image: ImageService;
  seeded: SeededStory;
  opened: ReturnType<typeof openDatabase>;
  rowId: string;
  guarded: GuardedRun;
  gcBeforeNextRead(): void;
  blobs(): string[];
  cleanup(): Promise<void>;
}

interface SetupOptions {
  seed?: (db: ReturnType<typeof openDatabase>['db']) => SeededStory;
  shot?: string;
}

async function setup(options: SetupOptions = {}): Promise<PipelineHarness> {
  const server = await startFakeImageServer({ jobDelayMs: 5 });
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const seeded = (options.seed ?? seedLighthouseTown)(opened.db);
  const logger = silentLogger();
  const bus = createEventBus();
  const llm = createScriptedLlm();
  const shutdown = new AbortController();
  const deps = { dataDir: temp.dir, db: opened.db, bus, logger, shutdown: shutdown.signal };
  const image = createImageService({ ...deps, llm }, { env: {}, pollIntervalMs: 5, jobTimeoutMs: 5_000 });
  const created = await image.createService({
    requestId: randomUUID(),
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

  const realStore = createImageStore(temp.dir, logger);
  let reached = false;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let gcOnRead: (() => Promise<void>) | null = null;
  const store: ImageStore = {
    ...realStore,
    async commit(staged, transaction, assertCurrent) {
      reached = true;
      await gate;
      return realStore.commit(staged, transaction, assertCurrent);
    },
    async read(ref) {
      const hook = gcOnRead;
      if (hook) {
        gcOnRead = null;
        await hook();
      }
      return realStore.read(ref);
    },
  };
  const rowId = opened.db.transaction(
    (tx) =>
      enqueueIllustration(tx, {
        turnId: seeded.turnIds[2]!,
        playthroughId: seeded.playthroughId,
        para: 1,
        settings,
        now: Date.now(),
      }),
    { behavior: 'immediate' },
  );
  const attemptId = randomUUID();
  opened.db
    .update(illustrations)
    .set({
      status: 'running',
      activeAttemptId: attemptId,
      attemptData: {
        attemptId,
        kind: 'first',
        formatOverride: null,
        format: null,
        shot: null,
        referenceFiles: null,
        seed: null,
        serviceId: created.serviceId,
        completed: [],
      },
    })
    .where(eq(illustrations.id, rowId))
    .run();
  llm.enqueue({ text: options.shot ?? shotText() });

  const pipelineDeps: PipelineDeps = {
    db: opened.db,
    bus,
    logger,
    image,
    llm,
    store,
    runner: createPortraitRunner(),
    shutdown: shutdown.signal,
  };
  return {
    deps: pipelineDeps,
    image,
    seeded,
    opened,
    rowId,
    guarded: { gate, reached: () => reached, release: () => release() },
    gcBeforeNextRead() {
      gcOnRead = async () => {
        await collectGarbage({
          db: opened.db,
          store: realStore,
          now: Date.now() + IMAGE_GC_GRACE_MS + 60_000,
          logger,
        });
      };
    },
    blobs: () => readdirSync(join(temp.dir, 'images', 'blobs')),
    async cleanup() {
      shutdown.abort();
      opened.close();
      temp.cleanup();
      await server.close();
    },
  };
}

function rowOf(harness: PipelineHarness) {
  return harness.opened.db.select().from(illustrations).where(eq(illustrations.id, harness.rowId)).get()!;
}

describe('runAttempt 的参考文件登记', () => {
  it('出图前先登记参考文件，清理不会删掉刚生成的参考', async () => {
    const harness = await setup({ seed: seedNorthCape, shot: referenceShotText() });
    try {
      harness.opened.db
        .update(entities)
        .set({ profile: { text: '说话很慢，总带着一把黑伞', appearance: '短发，深色外套' } })
        .where(eq(entities.id, harness.seeded.ids.shen!))
        .run();
      harness.gcBeforeNextRead();
      harness.guarded.release();

      await runAttempt(harness.deps, rowOf(harness), new AbortController().signal);

      const row = rowOf(harness);
      expect(row.status).toBe('done');
      expect(row.file).not.toBeNull();
      expect(row.referenceFiles).toHaveLength(1);
      expect(referencedFiles(harness.opened.db).has(row.referenceFiles![0]!.file.hash)).toBe(true);
      expect(
        harness.opened.db.select().from(portraitSets).where(eq(portraitSets.scope, 'playthrough')).all(),
      ).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });
});

describe('runAttempt 的写入守卫', () => {
  it('暂存后尝试 id 被替换时，守卫拒绝落库，阳性对照仍能写入', async () => {
    const harness = await setup();
    try {
      const running = runAttempt(harness.deps, rowOf(harness), new AbortController().signal);
      await waitFor(() => harness.guarded.reached());
      harness.opened.db
        .update(illustrations)
        .set({ activeAttemptId: randomUUID() })
        .where(eq(illustrations.id, harness.rowId))
        .run();
      harness.guarded.release();
      await running;

      const row = rowOf(harness);
      expect(row.status).not.toBe('done');
      expect(row.file).toBeNull();
      expect(harness.blobs()).toEqual([]);

      const control = await setup();
      try {
        const attempt = runAttempt(control.deps, rowOf(control), new AbortController().signal);
        await waitFor(() => control.guarded.reached());
        control.guarded.release();
        await attempt;
        expect(rowOf(control).status).toBe('done');
        expect(control.blobs()).toHaveLength(1);
      } finally {
        await control.cleanup();
      }
    } finally {
      await harness.cleanup();
    }
  });

  it('暂存后接收方确认失效时，守卫拒绝落库，阳性对照仍能写入', async () => {
    const harness = await setup();
    try {
      const running = runAttempt(harness.deps, rowOf(harness), new AbortController().signal);
      await waitFor(() => harness.guarded.reached());
      harness.image.setAutoIllustration({ enabled: false, confirm: null });
      harness.guarded.release();
      await running;

      const row = rowOf(harness);
      expect(row.status).not.toBe('done');
      expect(row.file).toBeNull();
      expect(harness.blobs()).toEqual([]);

      const control = await setup();
      try {
        const attempt = runAttempt(control.deps, rowOf(control), new AbortController().signal);
        await waitFor(() => control.guarded.reached());
        control.guarded.release();
        await attempt;
        expect(rowOf(control).status).toBe('done');
        expect(control.blobs()).toHaveLength(1);
      } finally {
        await control.cleanup();
      }
    } finally {
      await harness.cleanup();
    }
  });
});
