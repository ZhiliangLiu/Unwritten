import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ILLUSTRATION_STYLE,
  EMPTY_GENERATION_PARAMS,
  type CoreEvent,
  type IllustrationView,
  type ImageCapabilities,
  type StartIllustrationInput,
} from '@unwritten/contracts';
import { createEventBus } from '../events/bus.ts';
import { referencedFiles } from '../illustration/gc.ts';
import { createIllustrationService } from '../illustration/service.ts';
import { createImageStore } from '../illustration/storage.ts';
import { createImageService } from '../image/service.ts';
import { createLlmService } from '../llm/service.ts';
import type { Logger, LogEvent } from '../log/logger.ts';
import { createPlayService } from '../play/service.ts';
import { createProvidersStore } from '../providers/file.ts';
import { openDatabase, type OpenedDatabase } from '../store/db.ts';
import {
  EMPTY_PORTRAIT_SLOTS,
  PlaythroughIllustrationSchema,
  PortraitSlotsStoredSchema,
  TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION,
  type PlaythroughIllustration,
} from '../store/illustration-types.ts';
import { entities, illustrations, playthroughs, portraitSets, turns } from '../store/schema.ts';
import { startFakeImageServer } from '../test-support/fake-image-server.ts';
import { startFakeLauncher, type FakeLauncher } from '../test-support/fake-launcher.ts';
import { startFakeOpenAiServer, type FakeOpenAiServer } from '../test-support/fake-openai-server.ts';
import { createRecordingSummary } from '../test-support/fake-summary.ts';
import { pngBytes } from '../test-support/image-bytes.ts';
import { proposeTurnStep } from '../test-support/llm-steps.ts';
import { seedLighthouseTown, seedNorthCape, seedStory, type SeededStory } from '../test-support/story-fixtures.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';

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

export function shotText(
  overrides: {
    prompt?: string;
    negative?: string;
    caption?: string;
    refs?: string;
    aspect?: string;
  } = {},
): string {
  const lines = [
    `PROMPT: ${overrides.prompt ?? 'A quiet harbour at night, a lamp glowing at the end of the pier.'}`,
    `NEGATIVE: ${overrides.negative ?? ''}`,
    `CAPTION: ${overrides.caption ?? '夜色里，码头只剩一盏灯。'}`,
    `REFS: ${overrides.refs ?? ''}`,
  ];
  if (overrides.aspect !== undefined) lines.push(`ASPECT: ${overrides.aspect}`);
  return lines.join('\n');
}

function settingsWith(overrides: Partial<PlaythroughIllustration> = {}): PlaythroughIllustration {
  return PlaythroughIllustrationSchema.parse({
    ...TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION,
    enabled: true,
    aspectPreference: '3:2',
    resolutionTier: '1k',
    ...overrides,
  });
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition was not met in time');
    await delay(5);
  }
}

interface HarnessOptions {
  seed?: (db: OpenedDatabase['db']) => SeededStory;
  launcher?: boolean;
  imageCapabilities?: Partial<ImageCapabilities>;
}

interface Harness {
  opened: OpenedDatabase;
  seeded: SeededStory;
  server: FakeOpenAiServer;
  imageServer: Awaited<ReturnType<typeof startFakeImageServer>>;
  launcher: FakeLauncher | null;
  llm: ReturnType<typeof createLlmService>;
  image: ReturnType<typeof createImageService>;
  illustration: ReturnType<typeof createIllustrationService>;
  play: ReturnType<typeof createPlayService>;
  published: CoreEvent[];
  events: LogEvent[];
  dataDir: string;
  onGenerate: { current: (() => Promise<void>) | null };
  enable(): void;
  startIllustrated(
    overrides?: Partial<StartIllustrationInput>,
  ): ReturnType<ReturnType<typeof createPlayService>['start']>;
  queue(turnId: string, para: number, settings?: PlaythroughIllustration): string;
  pointBackgroundTo(server: FakeOpenAiServer): Promise<void>;
  close(): Promise<void>;
}

async function setup(options: HarnessOptions = {}): Promise<Harness> {
  const server = await startFakeOpenAiServer();
  const imageServer = await startFakeImageServer({
    jobDelayMs: 5,
    capabilities: options.imageCapabilities,
  });
  const launcher = options.launcher === true ? await startFakeLauncher() : null;
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const seeded = (options.seed ?? seedLighthouseTown)(opened.db);
  const { logger, events } = recordingLogger();
  const realBus = createEventBus();
  const published: CoreEvent[] = [];
  const bus = {
    publish(event: CoreEvent) {
      published.push(event);
      realBus.publish(event);
    },
    subscribe(signal: AbortSignal) {
      return realBus.subscribe(signal);
    },
  };
  const shutdown = new AbortController();
  const providers = createProvidersStore(join(temp.dir, 'providers.json'));
  const deps = { dataDir: temp.dir, db: opened.db, bus, logger, shutdown: shutdown.signal, providers };
  const llm = createLlmService(deps);
  const created = await llm.createEndpoint({
    requestId: randomUUID(),
    baseRevision: 'absent',
    name: '测试端点',
    baseUrl: server.baseUrl,
    modelId: 'narrator-model',
    apiKey: null,
    makeDefault: true,
  });
  const withShotModel = await llm.addModel({
    baseRevision: created.config.revision,
    endpointId: created.endpointId,
    modelId: 'shot-model',
  });
  await llm.setPurpose({
    baseRevision: withShotModel.revision,
    purpose: 'narrator',
    model: { endpointId: created.endpointId, modelId: 'narrator-model' },
    params: EMPTY_GENERATION_PARAMS,
  });
  await llm.setPurpose({
    baseRevision: llm.listProviders().revision,
    purpose: 'background',
    model: { endpointId: created.endpointId, modelId: 'shot-model' },
    params: EMPTY_GENERATION_PARAMS,
  });

  const image = createImageService({ ...deps, llm }, { env: {}, pollIntervalMs: 5, jobTimeoutMs: 5_000 });
  const createdService = await image.createService({
    requestId: randomUUID(),
    baseRevision: image.listServices().revision,
    name: '测试出图',
    protocol: 'unwritten-image',
    baseUrl: launcher === null ? imageServer.url : 'http://127.0.0.1:1',
    apiKey: imageServer.token,
    model: null,
    openai: null,
    launcher: launcher === null ? null : { baseUrl: launcher.url, apiKey: launcher.token },
    idleMinutes: null,
  });
  await image.select({ baseRevision: image.listServices().revision, serviceId: createdService.serviceId });

  const onGenerate: Harness['onGenerate'] = { current: null };
  const imageForIllustration = {
    ...image,
    generate: async (input: Parameters<ReturnType<typeof createImageService>['generate']>[0]) => {
      await onGenerate.current?.();
      return image.generate(input);
    },
  };
  const illustration = createIllustrationService({ ...deps, llm, image: imageForIllustration });
  let lastQueueAt = 0;
  const play = createPlayService({
    ...deps,
    llm,
    summary: createRecordingSummary(),
    image,
    illustration,
    onIllustrationQueued: () => illustration.kick(),
  });

  const harness: Harness = {
    opened,
    seeded,
    server,
    imageServer,
    launcher,
    llm,
    image,
    illustration,
    play,
    published,
    events,
    dataDir: temp.dir,
    onGenerate,
    enable() {
      image.setAutoIllustration({ enabled: true, confirm: image.getAutoIllustration().current! });
    },
    startIllustrated(overrides = {}) {
      return play.start({
        workId: seeded.workId,
        playthroughId: randomUUID(),
        protagonist: { 名字: '阿岚' },
        illustration: {
          enabled: true,
          style: DEFAULT_ILLUSTRATION_STYLE,
          aspectPreference: '3:2',
          resolutionTier: '1k',
          protagonistInFrame: false,
          protagonistAppearance: null,
          protagonistSnapshotId: null,
          ...overrides,
        },
      });
    },
    queue(turnId, para, settings = settingsWith()) {
      opened.db
        .update(playthroughs)
        .set({ illustration: settings })
        .where(eq(playthroughs.id, seeded.playthroughId))
        .run();
      lastQueueAt = Math.max(Date.now(), lastQueueAt + 1);
      return opened.db.transaction(
        (tx) =>
          illustration.enqueue(tx, {
            turnId,
            playthroughId: seeded.playthroughId,
            para,
            settings,
            now: lastQueueAt,
          }),
        { behavior: 'immediate' },
      );
    },
    async pointBackgroundTo(next) {
      const endpoint = await llm.createEndpoint({
        requestId: randomUUID(),
        baseRevision: llm.listProviders().revision,
        name: '备用端点',
        baseUrl: next.baseUrl,
        modelId: 'shot-model',
        apiKey: null,
        makeDefault: false,
      });
      await llm.setPurpose({
        baseRevision: endpoint.config.revision,
        purpose: 'background',
        model: { endpointId: endpoint.endpointId, modelId: 'shot-model' },
        params: EMPTY_GENERATION_PARAMS,
      });
    },
    async close() {
      shutdown.abort();
      await illustration.whenIdle().catch(() => {});
      opened.close();
      temp.cleanup();
      await imageServer.close();
      await server.close();
      await launcher?.close();
    },
  };
  return harness;
}

function setPlaythroughSettings(harness: Harness, playthroughId: string, settings: PlaythroughIllustration): void {
  harness.opened.db
    .update(playthroughs)
    .set({ illustration: settings })
    .where(eq(playthroughs.id, playthroughId))
    .run();
}

function rowOf(harness: Harness, id: string) {
  return harness.opened.db.select().from(illustrations).where(eq(illustrations.id, id)).get()!;
}

function turnOf(harness: Harness, turnId: string) {
  return harness.opened.db.select().from(turns).where(eq(turns.id, turnId)).get()!;
}

function shotRequests(server: FakeOpenAiServer) {
  return server.requests.filter((request) => JSON.stringify(request.body).includes('给故事画一个定格镜头'));
}

function jobs(server: Awaited<ReturnType<typeof startFakeImageServer>>) {
  return server.requests.filter((request) => request.method === 'POST' && request.path === '/v1/jobs');
}

function viewOf(harness: Harness, routeId: string, turnId: string): IllustrationView {
  const view = harness.illustration.forRoute(routeId).get(turnId);
  if (!view) throw new Error('missing illustration view');
  return view;
}

function errorCodeOf(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe('插图流程', () => {
  it('开场和 narrator 标记的回合各登记一张，完成后回合视图带上插图', async () => {
    const harness = await setup();
    try {
      harness.enable();
      harness.server.enqueue({ kind: 'text', text: shotText() });
      const started = harness.startIllustrated();
      expect(started.routeId).not.toBeNull();
      await harness.illustration.whenIdle();
      const root = harness.play.getRoute({ routeId: started.routeId! });
      expect(root.turns[0]!.illustration).toMatchObject({ para: 0, status: 'done' });
      expect(root.turns[0]!.illustration?.image).not.toBeNull();

      const route = harness.play.getRoute({ routeId: started.routeId! });
      harness.server.enqueue(
        proposeTurnStep({
          prose: '灯影在墙上晃动。\n\n守灯人把马灯举高。',
          options: ['继续'],
          illustrate: '2',
        }),
        { kind: 'text', text: '主角看着灯。' },
        { kind: 'text', text: shotText({ caption: '灯影在墙上晃动。' }) },
      );
      harness.play.submitAction({
        requestId: randomUUID(),
        routeId: route.id,
        expectedHeadTurnId: route.headTurnId,
        action: { text: '看着灯', optionIndex: null },
      });
      await harness.play.whenIdle();
      await harness.illustration.whenIdle();

      const after = harness.play.getRoute({ routeId: route.id });
      expect(after.turns).toHaveLength(2);
      expect(after.turns[1]!.illustration).toMatchObject({ para: 2, status: 'done' });
      const rows = harness.opened.db.select().from(illustrations).all();
      expect(rows.map((row) => row.para).sort((left, right) => left - right)).toEqual([0, 2]);
      const shot = shotRequests(harness.server)[0]!;
      expect((shot.body as { tools?: unknown }).tools ?? []).toEqual([]);
      const updatedTurns = new Set(
        harness.published.flatMap((event) => (event.type === 'illustration.updated' ? [event.turnId] : [])),
      );
      expect(updatedTurns).toEqual(new Set([root.turns[0]!.id, after.turns[1]!.id]));
      expect(harness.events.find((event) => event.event === 'illustration.flagged')?.data).toMatchObject({
        routeId: route.id,
        depth: 1,
        para: 2,
      });
    } finally {
      await harness.close();
    }
  });

  it('纯文字开局照写标记，不登记插图也不发出图请求', async () => {
    const harness = await setup();
    try {
      harness.enable();
      const started = harness.startIllustrated({ enabled: false });
      const root = harness.play.getRoute({ routeId: started.routeId! });
      harness.server.enqueue(
        proposeTurnStep({ prose: '门外没有人。\n\n雨还在下。', options: ['回屋'], illustrate: '1' }),
        { kind: 'text', text: '主角看了一眼门外。' },
      );
      harness.play.submitAction({
        requestId: randomUUID(),
        routeId: root.id,
        expectedHeadTurnId: root.headTurnId,
        action: { text: '开门', optionIndex: null },
      });
      await harness.play.whenIdle();
      await harness.illustration.whenIdle();

      const after = harness.play.getRoute({ routeId: root.id });
      expect(after.turns).toHaveLength(2);
      expect(after.turns[1]!.illustration).toBeNull();
      expect(turnOf(harness, after.turns[1]!.id).illustratePara).toBe(1);
      expect(harness.opened.db.select().from(illustrations).all()).toHaveLength(0);
      expect(jobs(harness.imageServer)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('自动出图未确认时开局和续写都不登记插图', async () => {
    const harness = await setup();
    try {
      const started = harness.startIllustrated();
      const root = harness.play.getRoute({ routeId: started.routeId! });
      harness.server.enqueue(
        proposeTurnStep({ prose: '门外没有人。\n\n雨还在下。', options: ['回屋'], illustrate: '1' }),
        { kind: 'text', text: '主角看了一眼门外。' },
      );
      harness.play.submitAction({
        requestId: randomUUID(),
        routeId: root.id,
        expectedHeadTurnId: root.headTurnId,
        action: { text: '开门', optionIndex: null },
      });
      await harness.play.whenIdle();
      await harness.illustration.whenIdle();

      expect(harness.play.getRoute({ routeId: root.id }).turns).toHaveLength(2);
      expect(harness.opened.db.select().from(illustrations).all()).toHaveLength(0);
      expect(shotRequests(harness.server)).toHaveLength(0);
      expect(jobs(harness.imageServer)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('自动比例在镜头步骤之后才确定规格，之前视图的 format 为空', async () => {
    const harness = await setup();
    try {
      harness.enable();
      setPlaythroughSettings(harness, harness.seeded.playthroughId, settingsWith({ aspectPreference: 'auto' }));
      const id = harness.queue(harness.seeded.headTurnId, 1, settingsWith({ aspectPreference: 'auto' }));
      const before = viewOf(harness, harness.seeded.routeId, harness.seeded.headTurnId);
      expect(before.id).toBe(id);
      expect(before.format).toBeNull();

      harness.server.enqueue({ kind: 'text', text: shotText({ aspect: '3:2' }) });
      const release = harness.imageServer.holdNextJob();
      harness.illustration.kick();
      await waitFor(
        () =>
          rowOf(harness, id).format !== null &&
          rowOf(harness, id).status === 'running' &&
          jobs(harness.imageServer).length === 1,
      );
      const determined = viewOf(harness, harness.seeded.routeId, harness.seeded.headTurnId);
      expect(determined.format).toEqual({
        aspectPreference: '3:2',
        resolutionTier: '1k',
        size: { width: 1536, height: 1024 },
      });
      const body = jobs(harness.imageServer)[0]!.body as { aspect: string; size: { width: number; height: number } };
      expect(body.aspect).toBe('3:2');
      expect(body.size).toEqual({ width: 1536, height: 1024 });

      release();
      await harness.illustration.whenIdle();
      expect(rowOf(harness, id).status).toBe('done');
    } finally {
      await harness.close();
    }
  });

  it('规格不可用时在镜头步骤失败，不发镜头或出图请求；另选规格重试后画成', async () => {
    const harness = await setup();
    try {
      harness.enable();
      const settings = settingsWith({ resolutionTier: '2k' });
      setPlaythroughSettings(harness, harness.seeded.playthroughId, settings);
      const id = harness.queue(harness.seeded.headTurnId, 1, settings);
      harness.illustration.kick();
      await harness.illustration.whenIdle();

      const failed = rowOf(harness, id);
      expect(failed).toMatchObject({ status: 'failed', stage: 'shot', error: 'image_output_format_unavailable' });
      expect(shotRequests(harness.server)).toHaveLength(0);
      expect(jobs(harness.imageServer)).toHaveLength(0);
      expect(
        harness.imageServer.requests.some((request) => request.method === 'GET' && request.path === '/v1/info'),
      ).toBe(true);

      harness.server.enqueue({ kind: 'text', text: shotText() });
      const retried = harness.illustration.retry({
        requestId: randomUUID(),
        illustrationId: id,
        format: { aspectPreference: '3:2', resolutionTier: '1k' },
      });
      expect(retried.status).toBe('queued');
      harness.illustration.kick();
      await harness.illustration.whenIdle();
      expect(rowOf(harness, id).status).toBe('done');
      expect(jobs(harness.imageServer)).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('重试从失败处继续：复用镜头描述和参考图，只多一次出图', async () => {
    const harness = await setup();
    try {
      harness.enable();
      harness.server.enqueue({ kind: 'text', text: shotText() });
      const id = harness.queue(harness.seeded.headTurnId, 1);
      harness.imageServer.failNextJob('workflow_error');
      harness.illustration.kick();
      await harness.illustration.whenIdle();

      const failed = rowOf(harness, id);
      expect(failed).toMatchObject({ status: 'failed', stage: 'generate', error: 'image_workflow_error' });
      expect(shotRequests(harness.server)).toHaveLength(1);
      expect(jobs(harness.imageServer)).toHaveLength(1);
      expect(failed.attemptData?.referenceFiles).toEqual([]);

      const retried = harness.illustration.retry({ requestId: randomUUID(), illustrationId: id, format: null });
      expect(retried.status).toBe('queued');
      harness.illustration.kick();
      await harness.illustration.whenIdle();

      expect(rowOf(harness, id).status).toBe('done');
      expect(shotRequests(harness.server)).toHaveLength(1);
      expect(jobs(harness.imageServer)).toHaveLength(2);
    } finally {
      await harness.close();
    }
  });

  it('服务的参考上限高于 4 时，镜头最多接受并生成 4 张参考', async () => {
    const harness = await setup({
      imageCapabilities: { maxReferences: 10 },
      seed: (db) =>
        seedStory(db, {
          turns: [
            { prose: '五个人站在栈桥上，雨落在伞面上。', place: '栈桥', presentKeys: ['a', 'b', 'c', 'd', 'e'] },
            { prose: '潮声停了一瞬。', place: '栈桥', presentKeys: ['a', 'b', 'c', 'd', 'e'] },
          ],
          entities: [
            { key: 'protagonist', kind: 'character', name: '赶路的人', protagonist: true },
            { key: 'a', kind: 'character', name: '阿青', profile: '短发，深色外套' },
            { key: 'b', kind: 'character', name: '阿白', profile: '高个子，浅色雨衣' },
            { key: 'c', kind: 'character', name: '阿禾', profile: '扎着辫子，旧布包' },
            { key: 'd', kind: 'character', name: '阿山', profile: '宽肩，皮帽' },
            { key: 'e', kind: 'character', name: '阿川', profile: '瘦削，灰围巾' },
          ],
        }),
    });
    try {
      harness.enable();
      const appearances: Record<string, string> = {
        a: '短发，深色外套',
        b: '高个子，浅色雨衣',
        c: '扎着辫子，旧布包',
        d: '宽肩，皮帽',
        e: '瘦削，灰围巾',
      };
      for (const [key, appearance] of Object.entries(appearances)) {
        harness.opened.db
          .update(entities)
          .set({ profile: { text: appearance, appearance } })
          .where(eq(entities.id, harness.seeded.ids[key]!))
          .run();
      }
      const five = 'C1:front,C2:front,C3:front,C4:front,C5:front';
      harness.server.enqueue(
        {
          kind: 'text',
          text: shotText({
            prompt: 'Five people wait on the pier. {{ref:1}} {{ref:2}} {{ref:3}} {{ref:4}} {{ref:5}}',
            caption: '雨里，五个人站在栈桥尽头。',
            refs: five,
          }),
        },
        {
          kind: 'text',
          text: shotText({
            prompt: 'Four people wait on the pier. {{ref:1}} {{ref:2}} {{ref:3}} {{ref:4}}',
            caption: '雨里，五个人站在栈桥尽头。',
            refs: 'C1:front,C2:front,C3:front,C4:front',
          }),
        },
      );
      const id = harness.queue(harness.seeded.headTurnId, 1);
      harness.illustration.kick();
      await harness.illustration.whenIdle();

      const row = rowOf(harness, id);
      expect(row.status).toBe('done');
      expect(shotRequests(harness.server)).toHaveLength(2);
      expect(row.refs).toHaveLength(4);
      expect(row.referenceFiles).toHaveLength(4);
      const main = jobs(harness.imageServer).at(-1)!.body as { references: unknown[] };
      expect(main.references).toHaveLength(4);
      expect(jobs(harness.imageServer)).toHaveLength(5);
      expect(
        harness.opened.db.select().from(portraitSets).where(eq(portraitSets.scope, 'playthrough')).all(),
      ).toHaveLength(4);
    } finally {
      await harness.close();
    }
  });

  it('两位人物入画时，有参考的一位才发送参考图，另一位改用外貌文字', async () => {
    const harness = await setup({ seed: seedNorthCape });
    try {
      harness.enable();
      const shenId = harness.seeded.ids.shen!;
      const zhouId = harness.seeded.ids.zhou!;
      harness.opened.db
        .update(entities)
        .set({ profile: { text: '说话很慢，总带着一把黑伞', appearance: '短发，深色外套' } })
        .where(eq(entities.id, shenId))
        .run();
      harness.opened.db
        .update(entities)
        .set({ profile: { text: '灯塔看守，话不多', appearance: '高个子，浅色雨衣' } })
        .where(eq(entities.id, zhouId))
        .run();

      const store = createImageStore(harness.dataDir, recordingLogger().logger);
      const bytes = pngBytes(64, 64);
      const staged = await store.stage(bytes);
      const setId = randomUUID();
      await store.commit(
        [staged],
        () => {
          harness.opened.db
            .insert(portraitSets)
            .values({
              id: setId,
              workId: harness.seeded.workId,
              scope: 'work',
              playthroughId: null,
              entityId: zhouId,
              appearanceFactId: null,
              appearanceHash: 'a'.repeat(64),
              appearance: '高个子，浅色雨衣',
              style: DEFAULT_ILLUSTRATION_STYLE,
              state: 'active',
              draftRev: 0,
              slots: PortraitSlotsStoredSchema.parse({
                ...EMPTY_PORTRAIT_SLOTS,
                front: { file: staged.ref, source: 'generate', needsReview: false },
              }),
              task: null,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            })
            .run();
        },
        () => {},
      );

      const settings = settingsWith({ authorPortraitSetIds: { [zhouId]: setId } });
      harness.server.enqueue({
        kind: 'text',
        text: shotText({
          prompt:
            'A person with short hair and a dark coat waits at the end of a rainy pier, {{ref:1}} raises a lantern.',
          caption: '雨里，两个人站在栈桥尽头。',
          refs: 'C2:front',
        }),
      });
      const id = harness.queue(harness.seeded.headTurnId, 1, settings);
      const registered: { hashes: string[]; visible: boolean } = { hashes: [], visible: false };
      harness.onGenerate.current = async () => {
        const live = rowOf(harness, id);
        const hashes = (live.attemptData?.referenceFiles ?? []).map((reference) => reference.file.hash);
        registered.hashes = hashes;
        registered.visible = hashes.length > 0 && hashes.every((hash) => referencedFiles(harness.opened.db).has(hash));
      };
      harness.illustration.kick();
      await harness.illustration.whenIdle();

      expect(rowOf(harness, id).status).toBe('done');
      expect(registered.hashes).toHaveLength(1);
      expect(registered.visible).toBe(true);
      const shot = shotRequests(harness.server)[0]!.body;
      expect(JSON.stringify(shot)).toContain('短发，深色外套');
      const body = jobs(harness.imageServer)[0]!.body as { references: Array<{ data: string }> };
      const references = body.references;
      expect(references).toHaveLength(1);
      expect(Buffer.from(references[0]!.data, 'base64').equals(Buffer.from(bytes))).toBe(true);
      const saved = rowOf(harness, id);
      expect(saved.referenceFiles).toHaveLength(1);
      expect(saved.referenceFiles![0]!.setId).toBe(setId);
      expect(referencedFiles(harness.opened.db).has(saved.referenceFiles![0]!.file.hash)).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it('重画失败时保留旧图的文件、说明和规格', async () => {
    const harness = await setup();
    try {
      harness.enable();
      harness.server.enqueue({ kind: 'text', text: shotText() });
      const id = harness.queue(harness.seeded.headTurnId, 1);
      harness.illustration.kick();
      await harness.illustration.whenIdle();
      const before = viewOf(harness, harness.seeded.routeId, harness.seeded.headTurnId);
      expect(before.status).toBe('done');

      harness.imageServer.failNextJob('refused');
      harness.illustration.reroll({ requestId: randomUUID(), illustrationId: id, format: null });
      harness.illustration.kick();
      await harness.illustration.whenIdle();

      const after = viewOf(harness, harness.seeded.routeId, harness.seeded.headTurnId);
      expect(after.status).toBe('done');
      expect(after.image).toEqual(before.image);
      expect(after.caption).toBe(before.caption);
      expect(after.format).toEqual(before.format);
      expect(after.error).not.toBeNull();
      expect(after.rerolling).toBe(false);
      expect(shotRequests(harness.server)).toHaveLength(1);
      expect(jobs(harness.imageServer)).toHaveLength(2);
    } finally {
      await harness.close();
    }
  });

  it('同一个 requestId 绑定操作、插图和规格', async () => {
    const harness = await setup();
    try {
      harness.enable();
      const id = harness.queue(harness.seeded.headTurnId, 1);
      harness.opened.db
        .update(illustrations)
        .set({ status: 'failed', stage: 'generate', error: 'image_offline', attemptData: null })
        .where(eq(illustrations.id, id))
        .run();
      const requestId = randomUUID();
      const first = harness.illustration.retry({ requestId, illustrationId: id, format: null });
      expect(first.status).toBe('queued');
      expect(harness.illustration.retry({ requestId, illustrationId: id, format: null })).toEqual(first);
      expect(errorCodeOf(() => harness.illustration.dismiss({ requestId, illustrationId: id }))).toBe(
        'idempotency_conflict',
      );
      expect(
        errorCodeOf(() => harness.illustration.retry({ requestId, illustrationId: randomUUID(), format: null })),
      ).toBe('idempotency_conflict');
      expect(
        errorCodeOf(() =>
          harness.illustration.retry({
            requestId,
            illustrationId: id,
            format: { aspectPreference: '1:1', resolutionTier: '1k' },
          }),
        ),
      ).toBe('idempotency_conflict');
    } finally {
      await harness.close();
    }
  });

  it('重画复用已完成的镜头描述，能力变化时才重新描述', async () => {
    const harness = await setup();
    try {
      harness.enable();
      harness.server.enqueue({ kind: 'text', text: shotText() });
      const id = harness.queue(harness.seeded.headTurnId, 1);
      harness.illustration.kick();
      await harness.illustration.whenIdle();
      const before = rowOf(harness, id);
      expect(before.status).toBe('done');
      expect(shotRequests(harness.server)).toHaveLength(1);

      harness.illustration.reroll({ requestId: randomUUID(), illustrationId: id, format: null });
      harness.illustration.kick();
      await harness.illustration.whenIdle();

      const reused = rowOf(harness, id);
      expect(reused.status).toBe('done');
      expect(shotRequests(harness.server)).toHaveLength(1);
      expect(reused.prompt).toBe(before.prompt);
      expect(reused.caption).toBe(before.caption);
      expect(jobs(harness.imageServer)).toHaveLength(2);

      const unchangedFormat = reused.format!;
      harness.illustration.reroll({
        requestId: randomUUID(),
        illustrationId: id,
        format: {
          aspectPreference: unchangedFormat.aspectPreference,
          resolutionTier: unchangedFormat.resolutionTier,
        },
      });
      harness.illustration.kick();
      await harness.illustration.whenIdle();
      expect(rowOf(harness, id).status).toBe('done');
      expect(shotRequests(harness.server)).toHaveLength(1);
      expect(jobs(harness.imageServer)).toHaveLength(3);

      harness.imageServer.setCapabilities({ negativePrompt: true });
      harness.server.enqueue({ kind: 'text', text: shotText() });
      harness.illustration.reroll({ requestId: randomUUID(), illustrationId: id, format: null });
      harness.illustration.kick();
      await harness.illustration.whenIdle();

      const redescribed = rowOf(harness, id);
      expect(redescribed.status).toBe('done');
      expect(shotRequests(harness.server)).toHaveLength(2);
      expect(redescribed.shotCapability?.negativePrompt).toBe(true);
      expect(jobs(harness.imageServer)).toHaveLength(4);
    } finally {
      await harness.close();
    }
  });

  it('迟到的结果被丢弃：在画时不要这张图，停止信号之外的已完成图仍可见', async () => {
    const harness = await setup();
    try {
      harness.enable();
      const first = harness.queue(harness.seeded.turnIds[2]!, 1);
      const second = harness.queue(harness.seeded.turnIds[1]!, 1);
      harness.server.enqueue({ kind: 'text', text: shotText() }, { kind: 'text', text: shotText() });
      const release = harness.imageServer.holdNextJob();
      harness.illustration.kick();
      await waitFor(() => jobs(harness.imageServer).length === 1);

      const dismissed = harness.illustration.dismiss({ requestId: randomUUID(), illustrationId: first });
      expect(dismissed.status).toBe('dismissed');
      release();
      await harness.illustration.whenIdle();

      const late = rowOf(harness, first);
      expect(late.status).toBe('dismissed');
      expect(late.file).toBeNull();
      expect(rowOf(harness, second).status).toBe('done');
      expect(rowOf(harness, second).file).not.toBeNull();
      expect(jobs(harness.imageServer)).toHaveLength(2);
    } finally {
      await harness.close();
    }
  });

  it('关闭自动出图时取消排队和在画的插图，已完成的保持可读', async () => {
    const harness = await setup();
    try {
      harness.enable();
      harness.server.enqueue({ kind: 'text', text: shotText() });
      const completed = harness.queue(harness.seeded.turnIds[2]!, 1);
      harness.illustration.kick();
      await harness.illustration.whenIdle();
      expect(rowOf(harness, completed).status).toBe('done');

      harness.server.enqueue({ kind: 'text', text: shotText() });
      const running = harness.queue(harness.seeded.turnIds[1]!, 1);
      const queued = harness.queue(harness.seeded.turnIds[0]!, 1);
      const release = harness.imageServer.holdNextJob();
      harness.illustration.kick();
      await waitFor(() => jobs(harness.imageServer).length === 2);

      harness.image.setAutoIllustration({ enabled: false, confirm: null });
      await waitFor(
        () => rowOf(harness, running).status === 'cancelled' && rowOf(harness, queued).status === 'cancelled',
      );
      release();
      await harness.illustration.whenIdle();

      expect(rowOf(harness, running)).toMatchObject({ status: 'cancelled', file: null });
      expect(rowOf(harness, queued)).toMatchObject({ status: 'cancelled', file: null });
      expect(rowOf(harness, completed).status).toBe('done');
      expect(jobs(harness.imageServer)).toHaveLength(2);
      const cancelled = harness.events.find((event) => event.event === 'illustration.cancelled');
      expect(cancelled?.data).toEqual({ count: 2, reason: 'disabled' });
    } finally {
      await harness.close();
    }
  });

  it('授权等待期间停用后换一个已就绪的服务，新图照常画成', async () => {
    const harness = await setup({ launcher: true });
    try {
      const launcher = harness.launcher!;
      harness.enable();
      launcher.setState('needs_action', {
        action: { url: 'https://accounts.example.test/consent', expiresAt: Math.floor(Date.now() / 1000) + 600 },
      });
      const waiting = harness.queue(harness.seeded.headTurnId, 1);
      harness.illustration.kick();
      await waitFor(() => launcher.startCalls() === 1);
      await waitFor(() => rowOf(harness, waiting).activeAttemptId !== null);
      harness.image.setAutoIllustration({ enabled: false, confirm: null });
      await waitFor(() => rowOf(harness, waiting).status === 'cancelled');
      expect(launcher.requests.some((request) => request.path === '/v1/stop')).toBe(false);

      const ready = await harness.image.createService({
        requestId: randomUUID(),
        baseRevision: harness.image.listServices().revision,
        name: '就绪服务',
        protocol: 'unwritten-image',
        baseUrl: harness.imageServer.url,
        apiKey: harness.imageServer.token,
        model: null,
        openai: null,
        launcher: null,
        idleMinutes: null,
      });
      await harness.image.select({ baseRevision: harness.image.listServices().revision, serviceId: ready.serviceId });
      harness.enable();
      harness.server.enqueue({ kind: 'text', text: shotText() });
      const fresh = harness.queue(harness.seeded.turnIds[1]!, 1);
      harness.illustration.kick();
      await harness.illustration.whenIdle();

      expect(rowOf(harness, fresh).status).toBe('done');
      expect(rowOf(harness, fresh).file).not.toBeNull();
      expect(rowOf(harness, waiting)).toMatchObject({ status: 'cancelled', file: null });
    } finally {
      await harness.close();
    }
  });

  it('镜头描述等待期间更换背景模型时，原接收方不再收到修正，新接收方也没收到材料', async () => {
    const harness = await setup();
    try {
      harness.enable();
      harness.server.enqueue({
        kind: 'text',
        text: shotText({ prompt: '新来的邮差 stands at the end of the pier.' }),
        chunkDelayMs: 500,
      });
      const id = harness.queue(harness.seeded.headTurnId, 1);
      harness.illustration.kick();
      await waitFor(() => shotRequests(harness.server).length === 1);
      const backup = await startFakeOpenAiServer();
      try {
        await harness.pointBackgroundTo(backup);
        await harness.illustration.whenIdle();
        expect(shotRequests(backup)).toHaveLength(0);
        expect(shotRequests(harness.server)).toHaveLength(1);
        expect(rowOf(harness, id).status).not.toBe('done');
        expect(harness.events.find((event) => event.event === 'illustration.cancelled')?.data).toMatchObject({
          reason: 'service_changed',
        });

        await harness.pointBackgroundTo(harness.server);
        harness.enable();
        await delay(20);
        harness.server.enqueue(
          { kind: 'text', text: shotText({ prompt: '新来的邮差 stands at the end of the pier.' }) },
          { kind: 'text', text: shotText() },
        );
        const control = harness.queue(harness.seeded.turnIds[1]!, 1);
        harness.illustration.kick();
        await harness.illustration.whenIdle();
        expect(rowOf(harness, control).status).toBe('done');
        expect(shotRequests(harness.server)).toHaveLength(3);
      } finally {
        await backup.close();
      }
    } finally {
      await harness.close();
    }
  });

  it('重启恢复把运行中的插图标为中断，未开始的手动重试保持排队', async () => {
    const harness = await setup();
    try {
      harness.enable();
      const running = harness.queue(harness.seeded.turnIds[2]!, 1);
      const waiting = harness.queue(harness.seeded.turnIds[1]!, 1);
      const doneReroll = harness.queue(harness.seeded.turnIds[0]!, 1);
      const attemptId = randomUUID();
      harness.opened.db
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
            serviceId: 'image-a',
            completed: ['appearance', 'shot', 'portrait'],
          },
        })
        .where(eq(illustrations.id, running))
        .run();
      harness.opened.db
        .update(illustrations)
        .set({
          activeAttemptId: randomUUID(),
          attemptData: {
            attemptId: randomUUID(),
            kind: 'retry',
            formatOverride: null,
            format: null,
            shot: null,
            referenceFiles: null,
            seed: null,
            serviceId: null,
            completed: [],
          },
        })
        .where(eq(illustrations.id, waiting))
        .run();
      harness.opened.db
        .update(illustrations)
        .set({
          status: 'done',
          file: { hash: 'b'.repeat(64), mime: 'image/png', width: 4, height: 4, bytes: 4 },
          format: { aspectPreference: '3:2', resolutionTier: '1k', size: null },
          activeAttemptId: randomUUID(),
          attemptData: {
            attemptId: randomUUID(),
            kind: 'reroll',
            formatOverride: null,
            format: null,
            shot: null,
            referenceFiles: null,
            seed: null,
            serviceId: 'image-a',
            completed: [],
          },
        })
        .where(eq(illustrations.id, doneReroll))
        .run();

      const recovered = harness.illustration.recoverInterrupted();

      expect(recovered).toBe(2);
      expect(rowOf(harness, running)).toMatchObject({
        status: 'failed',
        stage: 'generate',
        error: 'image_interrupted',
        activeAttemptId: null,
      });
      expect(rowOf(harness, waiting)).toMatchObject({ status: 'queued' });
      expect(rowOf(harness, doneReroll)).toMatchObject({
        status: 'done',
        error: 'image_interrupted',
        activeAttemptId: null,
      });
      expect(harness.events.filter((event) => event.event === 'illustration.interrupted')).toHaveLength(2);
    } finally {
      await harness.close();
    }
  });

  it('预热只在开局启用插图时唤醒服务', async () => {
    const harness = await setup({ launcher: true });
    try {
      const launcher = harness.launcher!;
      harness.enable();
      launcher.setState('stopped');
      setPlaythroughSettings(harness, harness.seeded.playthroughId, settingsWith());
      harness.illustration.prewarm({ playthroughId: harness.seeded.playthroughId });
      await waitFor(() => launcher.startCalls() === 1);
      const start = launcher.requests.find((request) => request.method === 'POST' && request.path === '/v1/start');
      expect(start?.body).toMatchObject({ idleMinutes: 30 });

      setPlaythroughSettings(
        harness,
        harness.seeded.playthroughId,
        PlaythroughIllustrationSchema.parse({ ...TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION }),
      );
      harness.illustration.prewarm({ playthroughId: harness.seeded.playthroughId });
      await delay(30);
      expect(launcher.startCalls()).toBe(1);
    } finally {
      await harness.close();
    }
  });
});
