import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { CoreEvent, IllustrationStyle, PortraitSetView } from '@unwritten/contracts';
import { createEventBus, type EventBus } from '../events/bus.ts';
import { createImageService } from '../image/service.ts';
import type { Logger, LogEvent } from '../log/logger.ts';
import { openDatabase } from '../store/db.ts';
import type { VersionMeta } from '../store/meta.ts';
import { portraitSets, workVersions } from '../store/schema.ts';
import { startFakeImageServer, type FakeImageServer } from '../test-support/fake-image-server.ts';
import { jpegHeaderBytes, pngBytes } from '../test-support/image-bytes.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { seedLighthouseTown, type SeededStory } from '../test-support/story-fixtures.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createIllustrationService } from './service.ts';
import { ensurePlaythroughFront, failInterruptedPortraitTasks, type PortraitDeps } from './portraits.ts';
import { createPortraitRunner } from './portrait-runner.ts';
import { createImageStore } from './storage.ts';

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

interface Harness {
  server: FakeImageServer;
  opened: ReturnType<typeof openDatabase>;
  seeded: SeededStory;
  illustration: ReturnType<typeof createIllustrationService>;
  portraitDeps: PortraitDeps;
  serviceId: string;
  published: CoreEvent[];
  logs: LogEvent[];
  publishHook: { current: ((event: CoreEvent) => void) | null };
  cleanup(): Promise<void>;
}

async function setup(): Promise<Harness> {
  const server = await startFakeImageServer({ jobDelayMs: 5 });
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const seeded = seedLighthouseTown(opened.db);
  const realBus = createEventBus();
  const published: CoreEvent[] = [];
  const publishHook: Harness['publishHook'] = { current: null };
  const bus: EventBus = {
    publish(event) {
      published.push(event);
      publishHook.current?.(event);
      realBus.publish(event);
    },
    subscribe(signal) {
      return realBus.subscribe(signal);
    },
  };
  const { logger, events: logs } = recordingLogger();
  const shutdown = new AbortController().signal;
  const deps = {
    dataDir: temp.dir,
    db: opened.db,
    bus,
    logger,
    shutdown,
  };
  const llm = createScriptedLlm();
  const image = createImageService(
    { ...deps, llm },
    { env: {}, pollIntervalMs: 5, jobTimeoutMs: 5_000, wakePollMs: 10 },
  );
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
  await image.prepareGeneration(created.serviceId, { manual: true, signal: shutdown });
  const illustration = createIllustrationService({ ...deps, llm, image });
  const portraitDeps: PortraitDeps = {
    db: opened.db,
    bus,
    logger,
    image,
    store: createImageStore(temp.dir, logger),
    runner: createPortraitRunner(),
    shutdown,
  };

  return {
    server,
    opened,
    seeded,
    illustration,
    portraitDeps,
    serviceId: created.serviceId,
    published,
    logs,
    publishHook,
    async cleanup() {
      opened.close();
      temp.cleanup();
      await server.close();
    },
  };
}

function setAppearance(harness: Harness, key: string, appearance: string): void {
  const { opened, seeded } = harness;
  const entityId = seeded.ids[key];
  if (!entityId) throw new Error(`unknown entity ${key}`);
  const draftId = draftsIdOf(seeded);
  const version = opened.db.select().from(workVersions).where(eq(workVersions.id, draftId)).get();
  if (!version) throw new Error('draft version not found');
  const meta = version.meta as VersionMeta;
  if (!meta.plan) throw new Error('draft plan not found');
  const items = meta.plan.items.map((item) =>
    item.kind === 'entity' && item.id === entityId ? { ...item, appearance } : item,
  );
  opened.db
    .update(workVersions)
    .set({ meta: { ...meta, plan: { ...meta.plan, items } } })
    .where(eq(workVersions.id, draftId))
    .run();
}

function draftsIdOf(seeded: SeededStory): string {
  return seeded.draftVersionId ?? seeded.versionId;
}

function writePlanItem(
  harness: Harness,
  input: { id: string; entityKind: 'character' | 'place'; appearance: string },
): void {
  const { opened, seeded } = harness;
  const draftId = draftsIdOf(seeded);
  const version = opened.db.select().from(workVersions).where(eq(workVersions.id, draftId)).get();
  if (!version) throw new Error('version not found');
  const meta = version.meta as VersionMeta;
  opened.db
    .update(workVersions)
    .set({
      meta: {
        ...meta,
        plan: {
          items: [
            {
              id: input.id,
              kind: 'entity',
              entityKind: input.entityKind,
              role: 'cast',
              name: '撑伞的人',
              knownAs: null,
              profile: '一句话档案',
              appearance: input.appearance,
              slot: null,
              source: 'author',
            },
          ],
          conflicts: [],
          confirmedRev: null,
        },
      },
    })
    .where(eq(workVersions.id, draftId))
    .run();
}

function slotOf(view: PortraitSetView, slot: 'front' | 'three_quarter' | 'full_body') {
  const found = view.slots.find((candidate) => candidate.slot === slot);
  if (!found) throw new Error(`missing slot ${slot}`);
  return found;
}

function fileOf(bytes: Uint8Array, name = 'portrait.png'): File {
  return new File([bytes], name, { type: 'image/png' });
}

function authorDraft(harness: Harness, entityId: string) {
  return harness.illustration.portraitDraft({
    workId: harness.seeded.workId,
    scope: 'work',
    target: { kind: 'entity', entityId },
    appearance: null,
  });
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition was not met in time');
    await delay(5);
  }
}

function imagePosts(server: FakeImageServer): Array<Record<string, unknown>> {
  return server.requests
    .filter((request) => request.method === 'POST' && request.path === '/v1/jobs')
    .map((request) => request.body as Record<string, unknown>);
}

describe('portrait draft', () => {
  it('方案里还没确认的人物也能建草稿，非人物的方案项拒绝', async () => {
    const harness = await setup();
    try {
      const planId = randomUUID();
      writePlanItem(harness, { id: planId, entityKind: 'character', appearance: '短卷发，左眉有一道浅缺口' });
      const created = authorDraft(harness, planId);
      expect(created.activeSetId).toBeNull();
      expect(created.draft).toMatchObject({
        scope: 'work',
        entityId: planId,
        state: 'draft',
        appearance: '短卷发，左眉有一道浅缺口',
        draftRev: 0,
      });
      expect(created.draft.slots.every((slot) => slot.image === null)).toBe(true);

      const again = authorDraft(harness, planId);
      expect(again.draft.id).toBe(created.draft.id);

      const placeId = randomUUID();
      writePlanItem(harness, { id: placeId, entityKind: 'place', appearance: '白色塔身' });
      expect(codeOf(() => authorDraft(harness, placeId))).toBe('not_found');
    } finally {
      await harness.cleanup();
    }
  });

  it('已有人物用档案里的形象，主角预览用输入的形象并在变化时加修订号', async () => {
    const harness = await setup();
    try {
      setAppearance(harness, 'linchao', '灰白短发，深色呢外套');
      const created = authorDraft(harness, harness.seeded.ids.linchao!);
      expect(created.draft.appearance).toBe('灰白短发，深色呢外套');

      const protagonist = harness.illustration.portraitDraft({
        workId: harness.seeded.workId,
        scope: 'pending',
        target: { kind: 'protagonist' },
        appearance: '短卷发，深色短外套',
      });
      expect(protagonist.activeSetId).toBeNull();
      expect(protagonist.draft.appearance).toBe('短卷发，深色短外套');
      expect(protagonist.draft.entityId).toBe(harness.seeded.ids.protagonist);

      const updated = harness.illustration.portraitDraft({
        workId: harness.seeded.workId,
        scope: 'pending',
        target: { kind: 'protagonist' },
        appearance: '短发，浅色围巾',
      });
      expect(updated.draft.id).toBe(protagonist.draft.id);
      expect(updated.draft.appearance).toBe('短发，浅色围巾');
      expect(updated.draft.draftRev).toBe(protagonist.draft.draftRev + 1);
    } finally {
      await harness.cleanup();
    }
  });
});

describe('portrait upload', () => {
  it('导入正面写入视图，并只在提交之后发布 portrait.updated', async () => {
    const harness = await setup();
    try {
      setAppearance(harness, 'linchao', '灰白短发');
      const { draft } = authorDraft(harness, harness.seeded.ids.linchao!);
      const seenAtPublish: boolean[] = [];
      harness.publishHook.current = (event) => {
        if (event.type !== 'portrait.updated') return;
        const row = harness.opened.db.select().from(portraitSets).where(eq(portraitSets.id, draft.id)).get();
        seenAtPublish.push(row?.slots.front.file !== null && row?.slots.front.source === 'import');
      };

      const bytes = pngBytes(8, 8);
      const view = await harness.illustration.portraitUpload({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: 0,
        file: fileOf(bytes),
      });

      expect(slotOf(view, 'front')).toMatchObject({
        image: { width: 8, height: 8 },
        source: 'import',
        needsReview: false,
        task: null,
      });
      expect(view.draftRev).toBe(1);
      expect(seenAtPublish).toEqual([true]);
      expect(harness.published.filter((event) => event.type === 'portrait.updated')).toHaveLength(1);
      expect(harness.logs).toContainEqual(
        expect.objectContaining({
          event: 'portrait.done',
          data: { setId: draft.id, slot: 'front', source: 'import' },
        }),
      );
    } finally {
      await harness.cleanup();
    }
  });

  it('带 EXIF 的 JPEG 抛 image_invalid_upload，位置和修订号不变', async () => {
    const harness = await setup();
    try {
      setAppearance(harness, 'linchao', '灰白短发');
      const { draft } = authorDraft(harness, harness.seeded.ids.linchao!);
      await expect(
        harness.illustration.portraitUpload({
          requestId: randomUUID(),
          setId: draft.id,
          slot: 'front',
          expectedRev: 0,
          file: fileOf(jpegHeaderBytes(8, 8, { exif: true }), 'portrait.jpg'),
        }),
      ).rejects.toMatchObject({ code: 'image_invalid_upload' });
      const view = harness.illustration.portraitGet({ setId: draft.id });
      expect(slotOf(view, 'front').image).toBeNull();
      expect(view.draftRev).toBe(0);
    } finally {
      await harness.cleanup();
    }
  });
});

describe('portrait generate', () => {
  it('正面用竖图默认规格，斜侧脸以正面为参考并在完成后写回', async () => {
    const harness = await setup();
    try {
      setAppearance(harness, 'linchao', '灰白短发，深色呢外套');
      const { draft } = authorDraft(harness, harness.seeded.ids.linchao!);
      await harness.illustration.portraitUpload({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: 0,
        file: fileOf(pngBytes(8, 8)),
      });

      const registered = harness.illustration.portraitGenerate({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'three_quarter',
        expectedRev: 1,
        format: null,
      });
      expect(slotOf(registered, 'three_quarter').task).toEqual({ status: 'running', error: null });
      expect(registered.draftRev).toBe(2);
      await harness.illustration.whenIdle();

      const view = harness.illustration.portraitGet({ setId: draft.id });
      expect(slotOf(view, 'three_quarter')).toMatchObject({
        source: 'generate',
        needsReview: false,
        task: null,
      });
      expect(slotOf(view, 'three_quarter').image).not.toBeNull();
      expect(view.draftRev).toBe(3);

      const post = imagePosts(harness.server).at(-1)!;
      expect(post.aspect).toBe('3:4');
      expect(post.size).toEqual({ width: 1024, height: 1360 });
      expect(post.quality).toBe('best');
      expect(post.references).toHaveLength(1);
      expect(harness.logs).toContainEqual(
        expect.objectContaining({
          event: 'portrait.done',
          data: { setId: draft.id, slot: 'three_quarter', source: 'generate' },
        }),
      );
    } finally {
      await harness.cleanup();
    }
  });

  it('迟到的侧脸任务在前更换后清掉任务并保留已有图片', async () => {
    const harness = await setup();
    try {
      setAppearance(harness, 'linchao', '灰白短发');
      const { draft } = authorDraft(harness, harness.seeded.ids.linchao!);
      await harness.illustration.portraitUpload({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: 0,
        file: fileOf(pngBytes(8, 8)),
      });
      harness.illustration.portraitGenerate({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'three_quarter',
        expectedRev: 1,
        format: null,
      });
      await harness.illustration.whenIdle();
      const existing = harness.illustration.portraitGet({ setId: draft.id });
      const existingImage = slotOf(existing, 'three_quarter').image;
      expect(existingImage).not.toBeNull();

      const release = harness.server.holdNextJob();
      harness.illustration.portraitGenerate({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'three_quarter',
        expectedRev: existing.draftRev,
        format: null,
      });
      await waitFor(() => imagePosts(harness.server).length === 2);
      await harness.illustration.portraitUpload({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: existing.draftRev + 1,
        file: fileOf(pngBytes(11, 11)),
      });
      const publishedBeforeRelease = harness.published.filter((event) => event.type === 'portrait.updated').length;
      release();
      await harness.illustration.whenIdle();

      const view = harness.illustration.portraitGet({ setId: draft.id });
      expect(slotOf(view, 'three_quarter')).toMatchObject({
        image: existingImage,
        needsReview: true,
        task: null,
      });
      expect(slotOf(view, 'front').image).toEqual({ width: 11, height: 11 });
      expect(harness.published.filter((event) => event.type === 'portrait.updated')).toHaveLength(
        publishedBeforeRelease + 1,
      );
      expect(harness.logs.filter((entry) => entry.event === 'portrait.failed')).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  it('参考图超过服务上限时不发送，任务记 image_reference_too_large', async () => {
    const harness = await setup();
    try {
      setAppearance(harness, 'linchao', '灰白短发');
      const { draft } = authorDraft(harness, harness.seeded.ids.linchao!);
      await harness.illustration.portraitUpload({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: 0,
        file: fileOf(pngBytes(8, 8)),
      });
      harness.server.setCapabilities({ maxReferenceBytes: 1 });
      harness.illustration.portraitGenerate({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'three_quarter',
        expectedRev: 1,
        format: null,
      });
      await harness.illustration.whenIdle();

      const failed = harness.illustration.portraitGet({ setId: draft.id });
      expect(slotOf(failed, 'three_quarter')).toMatchObject({
        image: null,
        task: { status: 'failed', error: 'image_reference_too_large' },
      });
      expect(imagePosts(harness.server)).toHaveLength(0);

      harness.server.setCapabilities({ maxReferenceBytes: 8 * 1024 * 1024 });
      harness.illustration.portraitGenerate({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'three_quarter',
        expectedRev: failed.draftRev,
        format: null,
      });
      await harness.illustration.whenIdle();
      const fixed = harness.illustration.portraitGet({ setId: draft.id });
      expect(slotOf(fixed, 'three_quarter').image).not.toBeNull();
      expect(imagePosts(harness.server)).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });

  it('替换正面把其他有图的位置标为待复核，采用时排除未复核的视角', async () => {
    const harness = await setup();
    try {
      setAppearance(harness, 'linchao', '灰白短发');
      const { draft } = authorDraft(harness, harness.seeded.ids.linchao!);
      await harness.illustration.portraitUpload({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: 0,
        file: fileOf(pngBytes(8, 8)),
      });
      harness.illustration.portraitGenerate({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'three_quarter',
        expectedRev: 1,
        format: null,
      });
      await harness.illustration.whenIdle();

      const replacement = pngBytes(12, 12);
      const replaced = await harness.illustration.portraitUpload({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: 3,
        file: fileOf(replacement),
      });
      expect(slotOf(replaced, 'three_quarter').needsReview).toBe(true);

      const adopted = harness.illustration.portraitAdopt({
        requestId: randomUUID(),
        setId: draft.id,
        expectedRev: replaced.draftRev,
        mode: 'adopt',
        expectedActiveSetId: null,
      });
      expect(adopted.activeSetId).not.toBeNull();
      const active = harness.opened.db
        .select()
        .from(portraitSets)
        .where(eq(portraitSets.id, adopted.activeSetId!))
        .get()!;
      expect(active.state).toBe('active');
      expect(active.slots.front.file?.hash).not.toBeNull();
      expect(active.slots.three_quarter.file).toBeNull();
      expect(active.slots.full_body.file).toBeNull();
      expect(adopted.draft.state).toBe('draft');
      expect(adopted.draft.draftRev).toBe(replaced.draftRev + 1);
      expect(harness.logs).toContainEqual(
        expect.objectContaining({
          event: 'portrait.adopted',
          data: { setId: draft.id, scope: 'work', slots: 1 },
        }),
      );
    } finally {
      await harness.cleanup();
    }
  });

  it('迟到的生成结果不能覆盖刚导入的正面', async () => {
    const harness = await setup();
    try {
      setAppearance(harness, 'linchao', '灰白短发');
      const { draft } = authorDraft(harness, harness.seeded.ids.linchao!);
      const release = harness.server.holdNextJob();
      harness.illustration.portraitGenerate({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: 0,
        format: null,
      });
      await waitFor(() => imagePosts(harness.server).length === 1);

      const bytes = pngBytes(13, 13);
      await harness.illustration.portraitUpload({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: 1,
        file: fileOf(bytes),
      });
      release();
      await harness.illustration.whenIdle();

      const view = harness.illustration.portraitGet({ setId: draft.id });
      expect(slotOf(view, 'front').image).toEqual({ width: 13, height: 13 });
      expect(slotOf(view, 'front').task).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  it('侧脸基于旧正面时结果作废，换新正面后能正常生成和采用', async () => {
    const harness = await setup();
    try {
      setAppearance(harness, 'linchao', '灰白短发');
      const { draft } = authorDraft(harness, harness.seeded.ids.linchao!);
      await harness.illustration.portraitUpload({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: 0,
        file: fileOf(pngBytes(8, 8)),
      });

      const release = harness.server.holdNextJob();
      harness.illustration.portraitGenerate({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'three_quarter',
        expectedRev: 1,
        format: null,
      });
      await waitFor(() => imagePosts(harness.server).length === 1);
      const replaced = await harness.illustration.portraitUpload({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: 2,
        file: fileOf(pngBytes(11, 11)),
      });
      release();
      await harness.illustration.whenIdle();

      const stale = harness.illustration.portraitGet({ setId: draft.id });
      expect(slotOf(stale, 'three_quarter').image).toBeNull();
      const staleAdopt = harness.illustration.portraitAdopt({
        requestId: randomUUID(),
        setId: draft.id,
        expectedRev: stale.draftRev,
        mode: 'adopt',
        expectedActiveSetId: null,
      });
      const staleActive = harness.opened.db
        .select()
        .from(portraitSets)
        .where(eq(portraitSets.id, staleAdopt.activeSetId!))
        .get()!;
      expect(staleActive.slots.three_quarter.file).toBeNull();

      const regenerated = harness.illustration.portraitGenerate({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'three_quarter',
        expectedRev: stale.draftRev + 1,
        format: null,
      });
      expect(slotOf(regenerated, 'three_quarter').task?.status).toBe('running');
      await harness.illustration.whenIdle();
      const fixed = harness.illustration.portraitGet({ setId: draft.id });
      expect(slotOf(fixed, 'three_quarter').image).not.toBeNull();
      const fixedAdopt = harness.illustration.portraitAdopt({
        requestId: randomUUID(),
        setId: draft.id,
        expectedRev: fixed.draftRev,
        mode: 'adopt',
        expectedActiveSetId: staleAdopt.activeSetId,
      });
      const fixedActive = harness.opened.db
        .select()
        .from(portraitSets)
        .where(eq(portraitSets.id, fixedAdopt.activeSetId!))
        .get()!;
      expect(fixedActive.slots.three_quarter.file).not.toBeNull();
      expect(replaced.draftRev).toBeGreaterThan(0);
    } finally {
      await harness.cleanup();
    }
  });

  it('生成失败把位置任务标成失败并记录 portrait.failed', async () => {
    const harness = await setup();
    try {
      setAppearance(harness, 'linchao', '灰白短发');
      const { draft } = authorDraft(harness, harness.seeded.ids.linchao!);
      harness.server.failNextJob('out_of_memory');
      harness.illustration.portraitGenerate({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: 0,
        format: null,
      });
      await harness.illustration.whenIdle();

      const view = harness.illustration.portraitGet({ setId: draft.id });
      expect(slotOf(view, 'front')).toMatchObject({
        image: null,
        task: { status: 'failed', error: 'image_out_of_memory' },
      });
      expect(harness.logs).toContainEqual(
        expect.objectContaining({
          event: 'portrait.failed',
          data: { setId: draft.id, slot: 'front', source: 'generate', code: 'image_out_of_memory' },
        }),
      );
    } finally {
      await harness.cleanup();
    }
  });

  it('画风预览用 fast、默认尺寸且没有参考图', async () => {
    const harness = await setup();
    try {
      const style: IllustrationStyle = { kind: 'preset', preset: 'watercolor' };
      const view = harness.illustration.portraitPreview({
        requestId: randomUUID(),
        workId: harness.seeded.workId,
        style,
      });
      await harness.illustration.whenIdle();

      const post = imagePosts(harness.server).at(-1)!;
      expect(post).toMatchObject({ quality: 'fast', references: [] });
      expect(post).not.toHaveProperty('size');
      expect(String(post.prompt)).toContain('A small paper lantern and a single white flower on a wooden windowsill');
      expect(String(post.prompt)).toContain('watercolor illustration');
      const stored = harness.illustration.portraitGet({ setId: view.id });
      expect(slotOf(stored, 'front').image).not.toBeNull();
      expect(stored.entityId).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });
});

describe('portrait revision and adoption', () => {
  it('过期的修订号在写操作上抛 stale_revision', async () => {
    const harness = await setup();
    try {
      setAppearance(harness, 'linchao', '灰白短发');
      const { draft } = authorDraft(harness, harness.seeded.ids.linchao!);
      expect(
        codeOf(() =>
          harness.illustration.portraitGenerate({
            requestId: randomUUID(),
            setId: draft.id,
            slot: 'front',
            expectedRev: 9,
            format: null,
          }),
        ),
      ).toBe('stale_revision');
      await expect(
        harness.illustration.portraitUpload({
          requestId: randomUUID(),
          setId: draft.id,
          slot: 'front',
          expectedRev: 9,
          file: fileOf(pngBytes(8, 8)),
        }),
      ).rejects.toMatchObject({ code: 'stale_revision' });
      expect(
        codeOf(() =>
          harness.illustration.portraitUpdate({
            requestId: randomUUID(),
            setId: draft.id,
            expectedRev: 9,
            action: { kind: 'remove', slot: 'front' },
          }),
        ),
      ).toBe('stale_revision');
      expect(
        codeOf(() =>
          harness.illustration.portraitAdopt({
            requestId: randomUUID(),
            setId: draft.id,
            expectedRev: 9,
            mode: 'adopt',
            expectedActiveSetId: null,
          }),
        ),
      ).toBe('stale_revision');
      expect(harness.illustration.portraitGet({ setId: draft.id }).draftRev).toBe(0);
    } finally {
      await harness.cleanup();
    }
  });

  it('两页并发：旧页面撤下时核对当前组 id，采用过的组仍是 active', async () => {
    const harness = await setup();
    try {
      setAppearance(harness, 'linchao', '灰白短发');
      const { draft } = authorDraft(harness, harness.seeded.ids.linchao!);
      await harness.illustration.portraitUpload({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: 0,
        file: fileOf(pngBytes(8, 8)),
      });
      const adopted = harness.illustration.portraitAdopt({
        requestId: randomUUID(),
        setId: draft.id,
        expectedRev: 1,
        mode: 'adopt',
        expectedActiveSetId: null,
      });
      const currentId = adopted.activeSetId!;
      const pageB = harness.illustration.portraitGet({ setId: draft.id });

      expect(
        codeOf(() =>
          harness.illustration.portraitAdopt({
            requestId: randomUUID(),
            setId: draft.id,
            expectedRev: pageB.draftRev,
            mode: 'retire',
            expectedActiveSetId: null,
          }),
        ),
      ).toBe('stale_revision');
      expect(harness.opened.db.select().from(portraitSets).where(eq(portraitSets.id, currentId)).get()!.state).toBe(
        'active',
      );

      const retired = harness.illustration.portraitAdopt({
        requestId: randomUUID(),
        setId: draft.id,
        expectedRev: pageB.draftRev,
        mode: 'retire',
        expectedActiveSetId: currentId,
      });
      expect(retired.activeSetId).toBeNull();
      expect(harness.opened.db.select().from(portraitSets).where(eq(portraitSets.id, currentId)).get()!.state).toBe(
        'retired',
      );
    } finally {
      await harness.cleanup();
    }
  });

  it('玩家快照只含采用时已就绪的位置，之后补完的视角不会写进快照', async () => {
    const harness = await setup();
    try {
      const created = harness.illustration.portraitDraft({
        workId: harness.seeded.workId,
        scope: 'pending',
        target: { kind: 'protagonist' },
        appearance: '短卷发，深色短外套',
      });
      await harness.illustration.portraitUpload({
        requestId: randomUUID(),
        setId: created.draft.id,
        slot: 'front',
        expectedRev: 0,
        file: fileOf(pngBytes(8, 8)),
      });
      const adopted = harness.illustration.portraitAdopt({
        requestId: randomUUID(),
        setId: created.draft.id,
        expectedRev: 1,
        mode: 'adopt',
        expectedActiveSetId: null,
      });
      const snapshotId = adopted.activeSetId!;
      const snapshot = harness.opened.db.select().from(portraitSets).where(eq(portraitSets.id, snapshotId)).get()!;
      expect(snapshot).toMatchObject({ scope: 'pending', state: 'active', entityId: harness.seeded.ids.protagonist });
      expect(snapshot.slots.front.file).not.toBeNull();
      expect(snapshot.slots.three_quarter.file).toBeNull();

      harness.illustration.portraitGenerate({
        requestId: randomUUID(),
        setId: created.draft.id,
        slot: 'three_quarter',
        expectedRev: 1,
        format: null,
      });
      await harness.illustration.whenIdle();
      const draft = harness.illustration.portraitGet({ setId: created.draft.id });
      expect(slotOf(draft, 'three_quarter').image).not.toBeNull();
      const after = harness.opened.db.select().from(portraitSets).where(eq(portraitSets.id, snapshotId)).get()!;
      expect(after.slots.three_quarter.file).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  it('update 确认待复核并移除位置，移除正面时其他位置重新待复核', async () => {
    const harness = await setup();
    try {
      setAppearance(harness, 'linchao', '灰白短发');
      const { draft } = authorDraft(harness, harness.seeded.ids.linchao!);
      await harness.illustration.portraitUpload({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: 0,
        file: fileOf(pngBytes(8, 8)),
      });
      harness.illustration.portraitGenerate({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'three_quarter',
        expectedRev: 1,
        format: null,
      });
      await harness.illustration.whenIdle();
      const replaced = await harness.illustration.portraitUpload({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: 3,
        file: fileOf(pngBytes(12, 12)),
      });
      expect(slotOf(replaced, 'three_quarter').needsReview).toBe(true);

      const confirmRequestId = randomUUID();
      const confirmed = harness.illustration.portraitUpdate({
        requestId: confirmRequestId,
        setId: draft.id,
        expectedRev: replaced.draftRev,
        action: { kind: 'confirm', slot: 'three_quarter' },
      });
      expect(slotOf(confirmed, 'three_quarter').needsReview).toBe(false);
      const replayed = harness.illustration.portraitUpdate({
        requestId: confirmRequestId,
        setId: draft.id,
        expectedRev: replaced.draftRev,
        action: { kind: 'confirm', slot: 'three_quarter' },
      });
      expect(replayed).toEqual(confirmed);
      expect(harness.illustration.portraitGet({ setId: draft.id }).draftRev).toBe(confirmed.draftRev);

      const removed = harness.illustration.portraitUpdate({
        requestId: randomUUID(),
        setId: draft.id,
        expectedRev: confirmed.draftRev,
        action: { kind: 'remove', slot: 'front' },
      });
      expect(slotOf(removed, 'front').image).toBeNull();
      expect(slotOf(removed, 'three_quarter').needsReview).toBe(true);
      expect(removed.draftRev).toBe(confirmed.draftRev + 1);
    } finally {
      await harness.cleanup();
    }
  });
});

describe('portrait request idempotency', () => {
  it('画风预览同一 requestId 只建一组，不同画风冲突', async () => {
    const harness = await setup();
    try {
      const requestId = randomUUID();
      const style: IllustrationStyle = { kind: 'preset', preset: 'watercolor' };
      const first = harness.illustration.portraitPreview({
        requestId,
        workId: harness.seeded.workId,
        style,
      });
      const second = harness.illustration.portraitPreview({
        requestId,
        workId: harness.seeded.workId,
        style,
      });
      expect(second.id).toBe(first.id);
      const previews = () =>
        harness.opened.db
          .select()
          .from(portraitSets)
          .where(and(eq(portraitSets.scope, 'pending'), isNull(portraitSets.entityId)))
          .all();
      expect(previews()).toHaveLength(1);

      await harness.illustration.whenIdle();
      expect(imagePosts(harness.server)).toHaveLength(1);
      expect(
        codeOf(() =>
          harness.illustration.portraitPreview({
            requestId,
            workId: harness.seeded.workId,
            style: { kind: 'preset', preset: 'ink' },
          }),
        ),
      ).toBe('idempotency_conflict');

      const afterSuccess = harness.illustration.portraitPreview({
        requestId,
        workId: harness.seeded.workId,
        style,
      });
      expect(afterSuccess.id).toBe(first.id);
      expect(previews()).toHaveLength(1);
      expect(imagePosts(harness.server)).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });

  it('生成成功后同一 requestId 重放不重新生成，不同输入冲突', async () => {
    const harness = await setup();
    try {
      setAppearance(harness, 'linchao', '灰白短发');
      const { draft } = authorDraft(harness, harness.seeded.ids.linchao!);
      await harness.illustration.portraitUpload({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: 0,
        file: fileOf(pngBytes(8, 8)),
      });
      const requestId = randomUUID();
      const first = harness.illustration.portraitGenerate({
        requestId,
        setId: draft.id,
        slot: 'three_quarter',
        expectedRev: 1,
        format: null,
      });
      await harness.illustration.whenIdle();
      const completed = harness.illustration.portraitGet({ setId: draft.id });
      expect(slotOf(completed, 'three_quarter').image).not.toBeNull();
      expect(imagePosts(harness.server)).toHaveLength(1);

      const replay = harness.illustration.portraitGenerate({
        requestId,
        setId: draft.id,
        slot: 'three_quarter',
        expectedRev: 1,
        format: null,
      });
      expect(replay).toEqual(first);
      expect(harness.illustration.portraitGet({ setId: draft.id }).draftRev).toBe(completed.draftRev);
      expect(imagePosts(harness.server)).toHaveLength(1);

      expect(
        codeOf(() =>
          harness.illustration.portraitGenerate({
            requestId,
            setId: draft.id,
            slot: 'front',
            expectedRev: 1,
            format: null,
          }),
        ),
      ).toBe('idempotency_conflict');
    } finally {
      await harness.cleanup();
    }
  });

  it('导入同一 requestId 重放不重复提交，不同内容冲突', async () => {
    const harness = await setup();
    try {
      setAppearance(harness, 'linchao', '灰白短发');
      const { draft } = authorDraft(harness, harness.seeded.ids.linchao!);
      const requestId = randomUUID();
      const bytes = pngBytes(8, 8);
      const first = await harness.illustration.portraitUpload({
        requestId,
        setId: draft.id,
        slot: 'front',
        expectedRev: 0,
        file: fileOf(bytes),
      });
      const replay = await harness.illustration.portraitUpload({
        requestId,
        setId: draft.id,
        slot: 'front',
        expectedRev: 0,
        file: fileOf(bytes),
      });
      expect(replay).toEqual(first);
      expect(harness.illustration.portraitGet({ setId: draft.id }).draftRev).toBe(1);

      await expect(
        harness.illustration.portraitUpload({
          requestId,
          setId: draft.id,
          slot: 'front',
          expectedRev: 0,
          file: fileOf(pngBytes(9, 9)),
        }),
      ).rejects.toMatchObject({ code: 'idempotency_conflict' });
      expect(harness.illustration.portraitGet({ setId: draft.id }).draftRev).toBe(1);
    } finally {
      await harness.cleanup();
    }
  });

  it('采用同一 requestId 重放返回同一快照，不同命令冲突', async () => {
    const harness = await setup();
    try {
      setAppearance(harness, 'linchao', '灰白短发');
      const { draft } = authorDraft(harness, harness.seeded.ids.linchao!);
      await harness.illustration.portraitUpload({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: 0,
        file: fileOf(pngBytes(8, 8)),
      });
      const requestId = randomUUID();
      const first = harness.illustration.portraitAdopt({
        requestId,
        setId: draft.id,
        expectedRev: 1,
        mode: 'adopt',
        expectedActiveSetId: null,
      });
      const replay = harness.illustration.portraitAdopt({
        requestId,
        setId: draft.id,
        expectedRev: 1,
        mode: 'adopt',
        expectedActiveSetId: null,
      });
      expect(replay).toEqual(first);
      expect(
        harness.opened.db
          .select()
          .from(portraitSets)
          .where(and(eq(portraitSets.scope, 'work'), eq(portraitSets.state, 'active')))
          .all(),
      ).toHaveLength(1);
      expect(
        codeOf(() =>
          harness.illustration.portraitAdopt({
            requestId,
            setId: draft.id,
            expectedRev: 1,
            mode: 'retire',
            expectedActiveSetId: first.activeSetId,
          }),
        ),
      ).toBe('idempotency_conflict');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('playthrough portraits', () => {
  it('ensurePlaythroughFront 并发三次只出一张正面，三个调用拿到同一组', async () => {
    const harness = await setup();
    try {
      const guard = { model: null, assertCurrent() {} };
      const signal = new AbortController().signal;
      const calls = [1, 2, 3].map(() =>
        ensurePlaythroughFront(harness.portraitDeps, {
          playthroughId: harness.seeded.playthroughId,
          workId: harness.seeded.workId,
          entityId: harness.seeded.ids.linchao!,
          serviceId: harness.serviceId,
          guard,
          identityFactId: null,
          appearance: '灰白短发，深色呢外套',
          style: { kind: 'preset', preset: 'painterly' },
          signal,
        }),
      );
      const results = await Promise.all(calls);
      expect(new Set(results.map((result) => result.setId)).size).toBe(1);
      expect(imagePosts(harness.server)).toHaveLength(1);
      const row = harness.opened.db.select().from(portraitSets).where(eq(portraitSets.id, results[0]!.setId)).get()!;
      expect(row).toMatchObject({ scope: 'playthrough', state: 'active', appearance: '灰白短发，深色呢外套' });
      expect(row.slots.front.file).not.toBeNull();
      expect(results[0]!.front.hash).toBe(row.slots.front.file?.hash);

      const again = await ensurePlaythroughFront(harness.portraitDeps, {
        playthroughId: harness.seeded.playthroughId,
        workId: harness.seeded.workId,
        entityId: harness.seeded.ids.linchao!,
        serviceId: harness.serviceId,
        guard,
        identityFactId: null,
        appearance: '灰白短发，深色呢外套',
        style: { kind: 'preset', preset: 'painterly' },
        signal,
      });
      expect(again.setId).toBe(results[0]!.setId);
      expect(imagePosts(harness.server)).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });

  it('ensurePlaythroughFront 生成结果超过参考上限时报 image_reference_too_large', async () => {
    const harness = await setup();
    try {
      harness.server.setCapabilities({ maxReferenceBytes: 1 });
      const guard = { model: null, assertCurrent() {} };
      await expect(
        ensurePlaythroughFront(harness.portraitDeps, {
          playthroughId: harness.seeded.playthroughId,
          workId: harness.seeded.workId,
          entityId: harness.seeded.ids.linchao!,
          serviceId: harness.serviceId,
          guard,
          identityFactId: null,
          appearance: '灰白短发',
          style: { kind: 'preset', preset: 'painterly' },
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code: 'image_reference_too_large' });
      const row = harness.opened.db
        .select()
        .from(portraitSets)
        .where(eq(portraitSets.playthroughId, harness.seeded.playthroughId))
        .get()!;
      expect(row.slots.front.file).toBeNull();
      expect(row.task?.front).toMatchObject({ status: 'failed', error: 'image_reference_too_large' });
      expect(imagePosts(harness.server)).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });

  it('ensurePlaythroughFront 核对开局所属作品，不匹配时不建组', async () => {
    const harness = await setup();
    try {
      const guard = { model: null, assertCurrent() {} };
      await expect(
        ensurePlaythroughFront(harness.portraitDeps, {
          playthroughId: harness.seeded.playthroughId,
          workId: randomUUID(),
          entityId: harness.seeded.ids.linchao!,
          serviceId: harness.serviceId,
          guard,
          identityFactId: null,
          appearance: '灰白短发',
          style: { kind: 'preset', preset: 'painterly' },
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code: 'not_found' });
      expect(imagePosts(harness.server)).toHaveLength(0);
      expect(harness.opened.db.select().from(portraitSets).all()).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  it('failInterruptedPortraitTasks 把 running 任务标成中断并保留草稿里的图', async () => {
    const harness = await setup();
    try {
      setAppearance(harness, 'linchao', '灰白短发');
      const { draft } = authorDraft(harness, harness.seeded.ids.linchao!);
      await harness.illustration.portraitUpload({
        requestId: randomUUID(),
        setId: draft.id,
        slot: 'front',
        expectedRev: 0,
        file: fileOf(pngBytes(8, 8)),
      });
      const attemptId = randomUUID();
      harness.opened.db
        .update(portraitSets)
        .set({
          task: {
            front: null,
            three_quarter: {
              attemptId,
              status: 'running',
              error: null,
              format: null,
              quality: 'best',
              inputFiles: [],
              appearanceHash: 'a'.repeat(64),
            },
            full_body: null,
          },
        })
        .where(eq(portraitSets.id, draft.id))
        .run();

      const count = failInterruptedPortraitTasks(harness.opened.db, harness.portraitDeps.logger);
      expect(count).toBe(1);
      const row = harness.opened.db.select().from(portraitSets).where(eq(portraitSets.id, draft.id)).get()!;
      expect(row.task?.three_quarter).toMatchObject({ status: 'failed', error: 'image_interrupted' });
      expect(row.slots.front.file).not.toBeNull();
      expect(harness.logs).toContainEqual(
        expect.objectContaining({
          level: 'warn',
          event: 'portrait.interrupted',
          requestId: attemptId,
          data: { setId: draft.id, slot: 'three_quarter', code: 'image_interrupted' },
        }),
      );
      expect(failInterruptedPortraitTasks(harness.opened.db, harness.portraitDeps.logger)).toBe(0);
    } finally {
      await harness.cleanup();
    }
  });
});
