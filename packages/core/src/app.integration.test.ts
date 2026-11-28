import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { DEFAULT_APPEARANCE, DEFAULT_ILLUSTRATION_STYLE, contract } from '@unwritten/contracts';
import type { StartIllustrationInput } from '@unwritten/contracts';
import { startFakeOpenAiServer } from './test-support/fake-openai-server.ts';
import type { FakeOpenAiServer } from './test-support/fake-openai-server.ts';
import { startFakeImageServer } from './test-support/fake-image-server.ts';
import {
  changeLines,
  proposePlanStep,
  proposePreviewStep,
  proposeTurnStep,
  rawToolStep,
} from './test-support/llm-steps.ts';
import { pngBytes } from './test-support/image-bytes.ts';
import { makeTempDataDir } from './test-support/temp-dir.ts';
import { seedLighthouseTown, seedNorthCape, seedStory } from './test-support/story-fixtures.ts';
import { openDatabase } from './store/db.ts';
import {
  AttemptDataSchema,
  PlaythroughIllustrationSchema,
  PortraitSlotsStoredSchema,
  PortraitTasksSchema,
  type ImageFileRef,
} from './store/illustration-types.ts';
import { DEFAULT_WORK_SETTINGS, EMPTY_GENERATION_PARAMS } from '@unwritten/contracts';
import { startCore } from './app.ts';
import type { RunningCore } from './app.ts';
import { createLlmService } from './llm/service.ts';
import { createLibraryService } from './library/service.ts';
import { createSettingsService } from './settings/service.ts';
import { createSummaryService } from './summary/queue.ts';
import { createAuthoringService } from './authoring/service.ts';
import { createPlayService } from './play/service.ts';
import { createImageService } from './image/service.ts';
import { createIllustrationService } from './illustration/service.ts';
import { createImageStore } from './illustration/storage.ts';
import { IMAGE_GC_GRACE_MS } from './illustration/constants.ts';
import { attachDesktopChannel } from './desktop/channel.ts';
import type { ParentPortLike } from './desktop/channel.ts';

const workId = '00000000-0000-4000-8000-000000000001';
const jobId = '00000000-0000-4000-8000-000000000002';
const endpointRequestId = '00000000-0000-4000-8000-000000000003';
const actionRequestId = '00000000-0000-4000-8000-000000000004';
const secondRequestId = '00000000-0000-4000-8000-000000000005';
const planJobId = '00000000-0000-4000-8000-000000000006';

function assets(dir: string): string {
  const clientDir = join(dir, 'client');
  mkdirSync(clientDir);
  writeFileSync(join(clientDir, 'index.html'), '<!doctype html><html lang="zh-CN"><head></head><body></body></html>');
  writeFileSync(join(clientDir, 'boot.inline.js'), '');
  return clientDir;
}

const factories = {
  llm: createLlmService,
  image: createImageService,
  illustration: createIllustrationService,
  library: createLibraryService,
  settings: createSettingsService,
  summary: createSummaryService,
  authoring: createAuthoringService,
  play: createPlayService,
};

async function boot(dataDir: string, clientDir: string, logLevel: 'error' | 'info' = 'error'): Promise<RunningCore> {
  return startCore({ dataDir, port: 0, clientDir, clientOrigin: null, logLevel }, factories);
}

async function configureModels(
  core: RunningCore,
  server: FakeOpenAiServer,
  options: { requestId: string; defaultModel: string; authorChatModel?: string },
): Promise<void> {
  const created = await core.services.llm.createEndpoint({
    requestId: options.requestId as never,
    baseRevision: 'absent',
    name: '测试端点',
    baseUrl: server.baseUrl,
    modelId: options.defaultModel,
    apiKey: null,
    makeDefault: true,
  });
  if (!options.authorChatModel) return;
  const added = await core.services.llm.addModel({
    baseRevision: created.config.revision,
    endpointId: created.endpointId,
    modelId: options.authorChatModel,
  });
  await core.services.llm.setPurpose({
    baseRevision: added.revision,
    purpose: 'author_chat',
    model: { endpointId: created.endpointId, modelId: options.authorChatModel },
    params: EMPTY_GENERATION_PARAMS,
  });
}

async function publishDefaultWork(
  core: RunningCore,
  server: FakeOpenAiServer,
  ids: { workId: string; planJobId: string; previewJobId: string; playthroughId: string },
  background: string,
  options: { illustration?: StartIllustrationInput; beforeStart?: () => void } = {},
): Promise<string> {
  core.services.library.create({ workId: ids.workId });
  const saved = core.services.library.saveDraft({
    workId: ids.workId,
    baseContentRev: 0,
    background,
    settings: DEFAULT_WORK_SETTINGS,
  });
  server.enqueue(proposePlanStep());
  core.services.authoring.generatePlan({ workId: ids.workId, jobId: ids.planJobId, contentRev: saved.contentRev });
  await core.services.authoring.whenIdle();
  const confirmed = core.services.authoring.confirmPlan({
    workId: ids.workId,
    baseContentRev: core.services.library.get({ workId: ids.workId }).draft.contentRev,
  });
  server.enqueue(
    proposePreviewStep({
      title: '雨夜修钟铺',
      blurb: '一个雨夜，你在钟铺里等一个人。',
      publicSetting: '老城的钟铺，雨下了一整夜。',
      prose: '雨声盖住钟声。你抬头看向门口。\n\n门铃响了。',
      options: ['去开门', '继续修钟'],
      place: '钟铺',
      time: '深夜',
      language: 'zh-CN',
    }),
  );
  core.services.authoring.generatePreview({
    workId: ids.workId,
    jobId: ids.previewJobId,
    contentRev: confirmed.contentRev,
  });
  await core.services.authoring.whenIdle();
  core.services.authoring.adoptPreview({ workId: ids.workId, jobId: ids.previewJobId });
  options.beforeStart?.();
  const started = core.services.play.start({
    workId: ids.workId,
    playthroughId: ids.playthroughId,
    protagonist: {},
    ...(options.illustration === undefined ? {} : { illustration: options.illustration }),
  });
  return started.routeId!;
}

function fakeParentPort(): ParentPortLike {
  return {
    on() {},
    postMessage() {},
  };
}

function shotText(): string {
  return [
    'PROMPT: A quiet harbour at night, a lamp glowing at the end of the pier.',
    'NEGATIVE: ',
    'CAPTION: 夜色里，码头只剩一盏灯。',
    'REFS: ',
  ].join('\n');
}

function writeProvidersFile(dataDir: string, file: unknown): string {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, 'providers.json');
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  return path;
}

function endpointEntry(server: FakeOpenAiServer, models: string[]) {
  return {
    id: 'endpoint-test',
    name: '测试端点',
    api: 'openai-completions',
    baseUrl: server.baseUrl,
    models: models.map((id) => ({ id })),
  };
}

function versionOneProviders(server: FakeOpenAiServer): unknown {
  const model = { provider: 'endpoint-test', model: 'test-model' };
  return {
    version: 1,
    endpoints: [endpointEntry(server, ['test-model'])],
    purposes: { default: model, narrator: model, background: model, author_chat: model },
  };
}

function versionTwoProviders(server: FakeOpenAiServer, image?: { id: string; url: string; token: string }): unknown {
  return {
    version: 2,
    providers: {},
    endpoints: [endpointEntry(server, ['narrator-model', 'shot-model'])],
    purposes: {
      default: { provider: 'endpoint-test', model: 'narrator-model' },
      narrator: { provider: 'endpoint-test', model: 'narrator-model' },
      background: { provider: 'endpoint-test', model: 'shot-model' },
    },
    imageServices:
      image === undefined
        ? []
        : [{ id: image.id, name: '伪出图', protocol: 'unwritten-image', baseUrl: image.url, apiKey: image.token }],
    image: { service: image?.id ?? null },
  };
}

async function storeImage(dataDir: string, bytes: Uint8Array): Promise<ImageFileRef> {
  const store = createImageStore(dataDir);
  const staged = await store.stage(bytes);
  await store.commit([staged], () => {});
  return staged.ref;
}

function blobPath(dataDir: string, ref: ImageFileRef): string {
  return join(dataDir, 'images', 'blobs', `${ref.hash}.png`);
}

function ageBlob(dataDir: string, ref: ImageFileRef, milliseconds: number): void {
  const seconds = (Date.now() - milliseconds) / 1000;
  utimesSync(blobPath(dataDir, ref), seconds, seconds);
}

function rpcClient(core: RunningCore): ContractRouterClient<typeof contract> {
  const link = new RPCLink({
    url: `${core.origin}/api`,
    headers: { authorization: `Bearer ${core.token}` },
  });
  return createORPCClient(link) as ContractRouterClient<typeof contract>;
}

function insertIllustration(
  db: ReturnType<typeof openDatabase>['db'],
  input: {
    id: string;
    turnId: string;
    playthroughId: string;
    para: number;
    status: string;
    ref?: ImageFileRef | null;
    caption?: string | null;
    serviceId?: string | null;
    activeAttemptId?: string | null;
    attemptData?: unknown;
  },
): void {
  const now = Date.now();
  const preference = { aspectPreference: '3:2', resolutionTier: '1k' };
  const format = input.ref ? { ...preference, size: { width: input.ref.width, height: input.ref.height } } : null;
  db.run(sql`insert into illustrations
      (id, turn_id, playthrough_id, para, format_preference, format, status, caption, service_id, file,
       attempts, active_attempt_id, attempt_data, created_at, updated_at)
      values (${input.id}, ${input.turnId}, ${input.playthroughId}, ${input.para},
        ${JSON.stringify(preference)}, ${format === null ? null : JSON.stringify(format)},
        ${input.status}, ${input.caption ?? null}, ${input.serviceId ?? null},
        ${input.ref === undefined || input.ref === null ? null : JSON.stringify(input.ref)}, 1,
        ${input.activeAttemptId ?? null},
        ${input.attemptData === undefined ? null : JSON.stringify(input.attemptData)}, ${now}, ${now})`);
}

async function waitForGcEvents(
  core: RunningCore,
  dataDir: string,
  count: number,
): Promise<{ sets: number; files: number; bytes: number }> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await core.services.logger.flush();
    const diagnostics = new DatabaseSync(join(dataDir, 'diagnostics.db'));
    try {
      const row = diagnostics
        .prepare("select count(*) as count from diagnostic_events where event = 'image.gc'")
        .get() as { count: number };
      if (row.count >= count) {
        const latest = diagnostics
          .prepare("select data from diagnostic_events where event = 'image.gc' order by rowid desc limit 1")
          .get() as { data: string };
        return JSON.parse(latest.data) as { sets: number; files: number; bytes: number };
      }
    } finally {
      diagnostics.close();
    }
    await delay(10);
  }
  throw new Error('image.gc did not finish in time');
}

async function parityList(desktop: boolean) {
  const temp = makeTempDataDir();
  const server = await startFakeOpenAiServer();
  const core = await boot(join(temp.dir, 'data'), assets(temp.dir));
  const detach = desktop
    ? attachDesktopChannel({ port: fakeParentPort(), core, invalidBeforeStart: 0, onStop: () => {} })
    : null;
  try {
    await configureModels(core, server, {
      requestId: '00000000-0000-4000-8000-000000000051',
      defaultModel: 'test-model',
    });
    core.services.library.create({ workId: '00000000-0000-4000-8000-000000000052' });
    core.services.library.saveDraft({
      workId: '00000000-0000-4000-8000-000000000052',
      baseContentRev: 0,
      background: '还没写完的作品。',
      settings: DEFAULT_WORK_SETTINGS,
    });
    const routeId = await publishDefaultWork(
      core,
      server,
      {
        workId: '00000000-0000-4000-8000-000000000053',
        planJobId: '00000000-0000-4000-8000-000000000054',
        previewJobId: '00000000-0000-4000-8000-000000000055',
        playthroughId: '00000000-0000-4000-8000-000000000056',
      },
      '雨夜修钟铺',
    );
    const route = core.services.play.getRoute({ routeId });
    server.enqueue(proposeTurnStep({ prose: '门外没有人。', options: ['回屋', '追问'], changes: '' }));
    server.enqueue({ kind: 'text', text: '主角打开门看了看。' });
    core.services.play.submitAction({
      requestId: '00000000-0000-4000-8000-000000000057' as never,
      routeId,
      expectedHeadTurnId: route.headTurnId,
      action: { text: '开门', optionIndex: null },
    });
    await core.services.play.whenIdle();
    await core.services.summary.whenIdle();
    return core.services.library
      .list()
      .map((work) => ({ id: work.id, status: work.status, hasProgress: work.hasProgress }))
      .sort((left, right) => left.id.localeCompare(right.id));
  } finally {
    detach?.();
    await core.close();
    await server.close();
    temp.cleanup();
  }
}

describe('core integration', () => {
  it('配置模型、生成并采用开场、重启后续玩', async () => {
    const temp = makeTempDataDir();
    const server = await startFakeOpenAiServer();
    const dataDir = join(temp.dir, 'data');
    const clientDir = assets(temp.dir);
    let core = await boot(dataDir, clientDir);
    try {
      const endpoint = await core.services.llm.createEndpoint({
        requestId: endpointRequestId as never,
        baseRevision: 'absent',
        name: '测试端点',
        baseUrl: server.baseUrl,
        modelId: 'test-model',
        apiKey: null,
        makeDefault: true,
      });
      expect(endpoint.config.purposes.find((view) => view.purpose === 'default')?.effectiveModel).toEqual({
        endpointId: endpoint.endpointId,
        modelId: 'test-model',
      });

      core.services.library.create({ workId });
      const saved = core.services.library.saveDraft({
        workId,
        baseContentRev: 0,
        background: '雨夜修钟铺',
        settings: DEFAULT_WORK_SETTINGS,
      });
      server.enqueue(proposePlanStep());
      core.services.authoring.generatePlan({ workId, jobId: planJobId, contentRev: saved.contentRev });
      await core.services.authoring.whenIdle();
      const confirmed = core.services.authoring.confirmPlan({
        workId,
        baseContentRev: saved.contentRev + 1,
      });
      server.enqueue(
        proposePreviewStep({
          title: '雨夜修钟铺',
          blurb: '一个雨夜，你在钟铺里等一个人。',
          publicSetting: '老城的钟铺，雨下了一整夜。',
          prose: '雨声盖住钟声。你抬头看向门口。\n\n门铃响了。',
          options: ['去开门', '继续修钟'],
          place: '钟铺',
          time: '深夜',
          language: 'zh-CN',
        }),
      );
      core.services.authoring.generatePreview({ workId, jobId, contentRev: confirmed.contentRev });
      await core.services.authoring.whenIdle();
      core.services.authoring.adoptPreview({ workId, jobId });
      const started = core.services.play.start({
        workId,
        playthroughId: '00000000-0000-4000-8000-000000000030',
        protagonist: {},
      });
      expect(started.routeId).not.toBeNull();
      const routeId = started.routeId!;
      const route = core.services.play.getRoute({ routeId });
      expect(route.turns).toHaveLength(1);

      server.enqueue(
        proposeTurnStep({
          prose: '你推开门。雨里没有人。',
          options: ['关上门', '走进雨里'],
          scene: { place: '门外', time: '深夜', present: [] },
        }),
      );
      core.services.play.submitAction({
        requestId: actionRequestId as never,
        routeId,
        expectedHeadTurnId: route.headTurnId,
        action: { text: '推门', optionIndex: null },
      });
      await core.services.play.whenIdle();
      expect(core.services.play.getRoute({ routeId }).turns).toHaveLength(2);

      await core.close();
      const diagnostics = new DatabaseSync(join(dataDir, 'diagnostics.db'));
      const samples = diagnostics
        .prepare("select metric, duration_ms from performance_samples where metric like 'turn.%'")
        .all() as Array<{ metric: string; duration_ms: number }>;
      diagnostics.close();
      const metrics = new Set(samples.map((row) => row.metric));
      expect(metrics).toEqual(new Set(['turn.queue', 'turn.context', 'turn.validate', 'turn.commit', 'turn.total']));
      core = await boot(dataDir, clientDir);
      const restored = core.services.play.getRoute({ routeId });
      expect(restored.turns).toHaveLength(2);
      expect(restored.turns[1]?.action?.text).toBe('推门');
      server.enqueue({ kind: 'text', text: '主角推门离开。' });
      await core.services.summary.whenIdle();

      server.enqueue(
        proposeTurnStep({
          prose: '你退回钟铺，门在身后合上。',
          options: ['继续等', '去后屋'],
          scene: { place: '钟铺', time: '深夜', present: [] },
        }),
      );
      core.services.play.submitAction({
        requestId: secondRequestId as never,
        routeId,
        expectedHeadTurnId: restored.headTurnId,
        action: { text: '关上门', optionIndex: null },
      });
      await core.services.play.whenIdle();
      expect(core.services.play.getRoute({ routeId }).turns).toHaveLength(3);
      const lastRequest = server.requests.at(-1)?.body;
      expect(JSON.stringify(lastRequest)).toContain('推门');
      expect(JSON.stringify(lastRequest)).toContain('你推开门');
    } finally {
      await core.close();
      await server.close();
      temp.cleanup();
    }
  });

  it('两部作品互不串', async () => {
    const temp = makeTempDataDir();
    const server = await startFakeOpenAiServer();
    const dataDir = join(temp.dir, 'data');
    const clientDir = assets(temp.dir);
    mkdirSync(dataDir, { recursive: true });
    const seededDb = openDatabase(join(dataDir, 'library.db'));
    const north = seedStory(seededDb.db, {
      turns: [{ prose: '北岬的雨下个不停。' }],
      entities: [
        { key: 'lin', kind: 'character', name: '林远', protagonist: true },
        { key: 'shen', kind: 'character', name: '沈岚' },
      ],
      names: [{ entity: 'shen', name: '沈岚', holder: 'lin', originTurn: 0, para: 1 }],
    });
    const snow = seedStory(seededDb.db, {
      turns: [{ prose: '雪原驿站的灯亮着。' }],
      entities: [
        { key: 'amu', kind: 'character', name: '阿木', protagonist: true },
        { key: 'ge', kind: 'character', name: '葛老板' },
      ],
      names: [{ entity: 'ge', name: '葛老板', holder: 'amu', originTurn: 0, para: 1 }],
    });
    seededDb.close();
    let core = await boot(dataDir, clientDir);
    try {
      const created = await core.services.llm.createEndpoint({
        requestId: '00000000-0000-4000-8000-000000000021' as never,
        baseRevision: 'absent',
        name: '测试端点',
        baseUrl: server.baseUrl,
        modelId: 'test-model',
        apiKey: null,
        makeDefault: true,
      });
      expect(created.config.status).toBe('ok');
      const route = core.services.play.getRoute({ routeId: north.routeId });
      server.enqueue(
        proposeTurnStep({
          prose: '沈岚点了点头。',
          options: ['继续等'],
          changes: '',
        }),
      );
      core.services.play.submitAction({
        requestId: '00000000-0000-4000-8000-000000000022' as never,
        routeId: north.routeId,
        expectedHeadTurnId: route.headTurnId,
        action: { text: '问她是否在等人', optionIndex: null },
      });
      await core.services.play.whenIdle();
      const prompt = JSON.stringify(server.requests.at(-1)?.body);
      expect(prompt).toContain('沈岚');
      expect(prompt).not.toContain('葛老板');
      expect(prompt).not.toContain('阿木');
      expect(snow.routeId).not.toBe(north.routeId);
    } finally {
      await core.close();
      await server.close();
      temp.cleanup();
    }
  });

  it('从配置到续写的事实链路', async () => {
    const temp = makeTempDataDir();
    const server = await startFakeOpenAiServer();
    const dataDir = join(temp.dir, 'data');
    const clientDir = assets(temp.dir);
    let core = await boot(dataDir, clientDir);
    try {
      const created = await core.services.llm.createEndpoint({
        requestId: '00000000-0000-4000-8000-000000000011' as never,
        baseRevision: 'absent',
        name: '测试端点',
        baseUrl: server.baseUrl,
        modelId: 'narrator-model',
        apiKey: null,
        makeDefault: true,
      });
      const withSecond = await core.services.llm.addModel({
        baseRevision: created.config.revision,
        endpointId: created.endpointId,
        modelId: 'summary-model',
      });
      const withCapability = await core.services.llm.updateModel({
        baseRevision: withSecond.revision,
        endpointId: created.endpointId,
        modelId: 'narrator-model',
        reasoning: true,
        thinkingFormat: 'openai',
      });
      const withNarrator = await core.services.llm.setPurpose({
        baseRevision: withCapability.revision,
        purpose: 'narrator',
        model: { endpointId: created.endpointId, modelId: 'narrator-model' },
        params: { ...EMPTY_GENERATION_PARAMS, thinking: 'high', temperature: 0.7 },
      });
      await core.services.llm.setPurpose({
        baseRevision: withNarrator.revision,
        purpose: 'background',
        model: { endpointId: created.endpointId, modelId: 'summary-model' },
        params: EMPTY_GENERATION_PARAMS,
      });

      const workId = '00000000-0000-4000-8000-000000000012';
      const jobId = '00000000-0000-4000-8000-000000000013';
      const firstRequest = '00000000-0000-4000-8000-000000000014';
      const secondRequest = '00000000-0000-4000-8000-000000000015';
      const planJob = '00000000-0000-4000-8000-000000000016';
      core.services.library.create({ workId });
      const saved = core.services.library.saveDraft({
        workId,
        baseContentRev: 0,
        background: '雨夜',
        settings: DEFAULT_WORK_SETTINGS,
      });
      server.enqueue(proposePlanStep());
      core.services.authoring.generatePlan({ workId, jobId: planJob, contentRev: saved.contentRev });
      await core.services.authoring.whenIdle();
      const confirmed = core.services.authoring.confirmPlan({
        workId,
        baseContentRev: saved.contentRev + 1,
      });
      server.enqueue(
        proposePreviewStep({
          title: '雨夜',
          blurb: '一个雨夜。',
          publicSetting: '钟铺。',
          prose: '雨声盖住钟声。\n\n门铃响了。',
          options: ['去开门', '继续修钟'],
          place: '钟铺',
          time: '深夜',
          language: 'zh-CN',
          present: ['撑伞的女人'],
          changes: changeLines({
            type: 'new_entity',
            kind: 'character',
            name: '沈岚',
            known_as: '撑伞的女人',
            profile: '带着黑伞',
            para: '1',
          }),
        }),
      );
      core.services.authoring.generatePreview({ workId, jobId, contentRev: confirmed.contentRev });
      await core.services.authoring.whenIdle();
      const adopted = core.services.authoring.adoptPreview({ workId, jobId });
      expect(adopted.routeId).toBeNull();
      const started = core.services.play.start({
        workId,
        playthroughId: '00000000-0000-4000-8000-000000000032',
        protagonist: {},
      });
      expect(started.routeId).not.toBeNull();
      const routeId = started.routeId!;
      const root = core.services.play.getRoute({ routeId });

      server.enqueue(
        rawToolStep('propose_turn', {
          prose: '一个看守点亮了灯。',
          options: '{"text":"问他是谁"}\n{"text":"继续等"}',
          changes: changeLines({
            type: 'new_entity',
            kind: 'character',
            name: '老周',
            known_as: '看守',
            profile: '话不多',
            para: '1',
          }),
          ending: 'false',
        }),
        { kind: 'text', text: '主角遇见看守。' },
      );
      core.services.play.submitAction({
        requestId: firstRequest as never,
        routeId,
        expectedHeadTurnId: root.headTurnId,
        action: { text: '看看谁来了', optionIndex: null },
      });
      await core.services.play.whenIdle();
      await core.services.summary.whenIdle();
      const afterFirst = core.services.play.getRoute({ routeId });

      server.enqueue(
        rawToolStep('get_character', { target: '@2' }),
        rawToolStep('propose_turn', {
          prose: '她收了伞，坐在窗边。',
          options: '{"text":"问她等谁"}\n{"text":"沉默"}',
          changes: '',
          ending: 'false',
        }),
        { kind: 'text', text: '主角和沈岚交谈。' },
      );
      core.services.play.submitAction({
        requestId: secondRequest as never,
        routeId,
        expectedHeadTurnId: afterFirst.headTurnId,
        action: { text: '问她为什么在这里', optionIndex: null },
      });
      await core.services.play.whenIdle();
      await core.services.summary.whenIdle();

      const journal = core.services.play.getJournal({ routeId });
      expect(journal.subjects.map((subject) => subject.name).sort()).toEqual(['撑伞的女人', '看守'].sort());
      const bodies = server.requests.map(
        (request) => request.body as { model?: string; reasoning_effort?: string; enable_thinking?: boolean },
      );
      expect(bodies.some((body) => body.model === 'narrator-model' && body.reasoning_effort === 'high')).toBe(true);
      expect(
        bodies.some(
          (body) => body.model === 'summary-model' && !('reasoning_effort' in body) && !('enable_thinking' in body),
        ),
      ).toBe(true);
      await core.close();
      const library = new DatabaseSync(join(dataDir, 'library.db'));
      const summaries = library.prepare('select count(*) as count from turn_summaries').get() as { count: number };
      library.close();
      expect(summaries.count).toBe(2);
      core = await boot(dataDir, clientDir);
      const restoredJournal = core.services.play.getJournal({ routeId });
      expect(restoredJournal).toEqual(journal);
    } finally {
      await core.close();
      await server.close();
      temp.cleanup();
    }
  });

  it('只写背景走完全程', async () => {
    const temp = makeTempDataDir();
    const server = await startFakeOpenAiServer();
    const dataDir = join(temp.dir, 'data');
    const clientDir = assets(temp.dir);
    const core = await boot(dataDir, clientDir);
    try {
      await configureModels(core, server, {
        requestId: '00000000-0000-4000-8000-000000000061',
        defaultModel: 'test-model',
        authorChatModel: 'author-chat-model',
      });
      const work = '00000000-0000-4000-8000-000000000062';
      const planJob = '00000000-0000-4000-8000-000000000063';
      const previewJob = '00000000-0000-4000-8000-000000000064';
      const playthrough = '00000000-0000-4000-8000-000000000065';
      const actionRequest = '00000000-0000-4000-8000-000000000066';
      const routeId = await publishDefaultWork(
        core,
        server,
        { workId: work, planJobId: planJob, previewJobId: previewJob, playthroughId: playthrough },
        '雨夜修钟铺',
      );
      expect(server.requests[0]?.body).toMatchObject({ model: 'author-chat-model' });
      expect(JSON.stringify(server.requests[0]?.body)).toContain('propose_plan');
      const root = core.services.play.getRoute({ routeId });
      expect(root.turns).toHaveLength(1);
      server.enqueue(
        proposeTurnStep({
          prose: '你推开门，雨里没有人。',
          options: ['关上门', '走进雨里'],
          scene: { place: '门外', time: '深夜', present: [] },
        }),
        { kind: 'text', text: '主角推门出去了。' },
      );
      core.services.play.submitAction({
        requestId: actionRequest as never,
        routeId,
        expectedHeadTurnId: root.headTurnId,
        action: { text: '推门', optionIndex: null },
      });
      await core.services.play.whenIdle();
      await core.services.summary.whenIdle();
      expect(core.services.play.getRoute({ routeId }).turns).toHaveLength(2);
    } finally {
      await core.close();
      await server.close();
      temp.cleanup();
    }
  });

  it('作者设定的秘密、栏目、场面在游玩中兑现', async () => {
    const temp = makeTempDataDir();
    const server = await startFakeOpenAiServer();
    const dataDir = join(temp.dir, 'data');
    const clientDir = assets(temp.dir);
    const core = await boot(dataDir, clientDir);
    const work = '00000000-0000-4000-8000-000000000071';
    const planJob = '00000000-0000-4000-8000-000000000072';
    const previewJob = '00000000-0000-4000-8000-000000000073';
    const playthrough = '00000000-0000-4000-8000-000000000074';
    const firstRequest = '00000000-0000-4000-8000-000000000075';
    const secondRequest = '00000000-0000-4000-8000-000000000076';
    try {
      await configureModels(core, server, {
        requestId: '00000000-0000-4000-8000-000000000070',
        defaultModel: 'test-model',
      });
      core.services.library.create({ workId: work });
      const saved = core.services.library.saveDraft({
        workId: work,
        baseContentRev: 0,
        background: '灯塔镇只在夜里通电。新来的邮差要把一袋没有收件人的旧信送出去。',
        settings: DEFAULT_WORK_SETTINGS,
      });
      server.enqueue(
        proposePlanStep({
          entities: [
            {
              ref: 'e1',
              kind: 'character',
              role: 'protagonist',
              name: '新来的邮差',
              profile: '二十多岁，记性好',
              from: 'ai',
            },
            {
              ref: 'e2',
              kind: 'character',
              role: 'cast',
              name: '林潮',
              known_as: '守灯人',
              profile: '守灯人，五十岁上下，话少',
              from: 'ai',
            },
          ],
          secrets: [
            {
              title: '上一任邮差的去向',
              statement: '上一任邮差在灯塔里住过一年，后来乘夜船离开',
              subject: 'e2',
              knowers: 'e2',
              reveal: '主角拿到第三封旧信时',
              from: 'ai',
            },
          ],
          state: [
            {
              key: '潮位',
              label: '潮位',
              display: 'number',
              min: '0',
              max: '10',
              unit: '米',
              initial: '3',
              from: 'ai',
            },
            {
              key: '信任',
              label: '信任',
              display: 'stage',
              stages: '陌生|相识|信任|决裂',
              initial: '陌生',
              from: 'ai',
            },
            { key: '旧信', label: '旧信', display: 'list', from: 'ai' },
            { key: '真名', label: '真名', display: 'text', hidden: 'true', from: 'ai' },
          ],
          scenes: [
            {
              condition: '主角第一次独自登上灯塔顶',
              outcome: '林潮讲起上一任邮差',
              once: 'true',
              from: 'ai',
            },
          ],
        }),
      );
      core.services.authoring.generatePlan({ workId: work, jobId: planJob, contentRev: saved.contentRev });
      await core.services.authoring.whenIdle();
      const confirmed = core.services.authoring.confirmPlan({
        workId: work,
        baseContentRev: core.services.library.get({ workId: work }).draft.contentRev,
      });
      server.enqueue(
        proposePreviewStep({
          title: '灯塔镇',
          blurb: '邮差带着一袋旧信走下船。',
          publicSetting: '灯塔镇只在夜里通电。',
          prose: '船靠岸的时候，整座镇子黑着。\n\n守灯人提着马灯站在码头尽头。',
          options: ['向守灯人问路', '先去邮局'],
          place: '码头',
          time: '夜里',
          language: 'zh-CN',
          present: ['@2'],
          changes: '',
          state: changeLines({ key: '旧信', item: '第一封', status: 'open' }),
        }),
      );
      core.services.authoring.generatePreview({ workId: work, jobId: previewJob, contentRev: confirmed.contentRev });
      await core.services.authoring.whenIdle();
      core.services.authoring.adoptPreview({ workId: work, jobId: previewJob });
      const started = core.services.play.start({ workId: work, playthroughId: playthrough, protagonist: {} });
      const routeId = started.routeId!;
      const root = core.services.play.getRoute({ routeId });

      server.enqueue(
        proposeTurnStep({
          prose: '守灯人把马灯举高，说起上一任邮差。\n\n潮声从码头下面传上来。',
          options: ['问守灯人码头在哪里', '往镇上走'],
          changes: changeLines(
            { type: 'state', key: '潮位', value: '5' },
            { type: 'state', key: '信任', value: '相识', visible: 'true' },
            { type: 'scene_hit', scene: 'S1', para: '1' },
            { type: 'knowledge', fact: '#1', holder: '@1', level: 'confirmed', para: '1' },
          ),
        }),
        { kind: 'text', text: '主角问起上一任邮差。' },
      );
      core.services.play.submitAction({
        requestId: firstRequest as never,
        routeId,
        expectedHeadTurnId: root.headTurnId,
        action: { text: '问上一任邮差', optionIndex: null },
      });
      await core.services.play.whenIdle();
      await core.services.summary.whenIdle();

      const status = core.services.play.getStatus({ routeId });
      expect(status.columns.map((column) => column.label).sort()).toEqual(['信任', '潮位', '旧信'].sort());
      expect(status.columns.find((column) => column.label === '潮位')?.value).toEqual({
        display: 'number',
        value: 5,
        min: 0,
        max: 10,
        unit: '米',
        previous: 3,
      });
      const journal = core.services.play.getJournal({ routeId });
      const keeper = journal.subjects.find((subject) => subject.name === '守灯人');
      expect(keeper?.lines.some((line) => line.text.includes('上一任邮差在灯塔里住过一年'))).toBe(true);

      const beforeSecond = core.services.play.getRoute({ routeId });
      server.enqueue(
        rawToolStep('propose_turn', {
          prose: '潮声慢慢退下去。',
          options: '{"text":"继续等"}\n{"text":"转身离开"}',
          changes: changeLines({ type: 'scene_hit', scene: 'S1', para: '1' }),
          ending: 'false',
        }),
        rawToolStep('propose_turn', {
          prose: '潮声慢慢退下去。',
          options: '{"text":"继续等"}\n{"text":"转身离开"}',
          changes: '',
          ending: 'false',
        }),
        { kind: 'text', text: '主角继续站在码头上。' },
      );
      core.services.play.submitAction({
        requestId: secondRequest as never,
        routeId,
        expectedHeadTurnId: beforeSecond.headTurnId,
        action: { text: '继续站着', optionIndex: null },
      });
      await core.services.play.whenIdle();
      await core.services.summary.whenIdle();
      expect(core.services.play.getRoute({ routeId }).turns).toHaveLength(3);

      await core.close();
      const library = new DatabaseSync(join(dataDir, 'library.db'));
      const row = library.prepare('select log from turn_requests where id = ?').get(secondRequest) as
        { log: string } | undefined;
      library.close();
      const log = JSON.parse(String(row?.log)) as Array<{ tool: string; ok: boolean; errors: string[] }>;
      const rejected = log.find((entry) => entry.tool === 'propose_turn' && !entry.ok);
      expect(rejected?.errors.join('\n')).toContain('关键场面');
    } finally {
      await core.close();
      await server.close();
      temp.cleanup();
    }
  });

  it('每局生成人物的作品开两局', async () => {
    const temp = makeTempDataDir();
    const server = await startFakeOpenAiServer();
    const dataDir = join(temp.dir, 'data');
    const clientDir = assets(temp.dir);
    const core = await boot(dataDir, clientDir);
    const work = '00000000-0000-4000-8000-000000000081';
    const planJob = '00000000-0000-4000-8000-000000000082';
    const previewJob = '00000000-0000-4000-8000-000000000083';
    try {
      await configureModels(core, server, {
        requestId: '00000000-0000-4000-8000-000000000080',
        defaultModel: 'test-model',
      });
      core.services.library.create({ workId: work });
      const saved = core.services.library.saveDraft({
        workId: work,
        baseContentRev: 0,
        background: '渡口每天只开一班船。',
        settings: { ...DEFAULT_WORK_SETTINGS, cast: { text: '', mode: 'per_run' } },
      });
      server.enqueue(
        proposePlanStep({
          entities: [
            {
              ref: 'e1',
              kind: 'character',
              role: 'protagonist',
              name: '等船的人',
              profile: '带着一只旧箱子',
              from: 'ai',
            },
            {
              ref: 'e2',
              kind: 'character',
              role: 'cast',
              name: '码头上的旅人',
              slot_role: '在码头等船的人',
              encounter: '在码头打听下一班船',
              from: 'ai',
            },
          ],
        }),
      );
      core.services.authoring.generatePlan({ workId: work, jobId: planJob, contentRev: saved.contentRev });
      await core.services.authoring.whenIdle();
      const confirmed = core.services.authoring.confirmPlan({
        workId: work,
        baseContentRev: core.services.library.get({ workId: work }).draft.contentRev,
      });
      server.enqueue(
        proposePreviewStep({
          title: '渡口',
          blurb: '每天只有一班船。',
          publicSetting: '河边的渡口，夜里只剩一盏灯。',
          prose: '旅人靠在木桩上，等最后一班船。\n\n灯下的水面很静。',
          options: ['走过去搭话', '先看看周围'],
          place: '渡口',
          time: '夜里',
          language: 'zh-CN',
          present: ['旅人'],
          changes: changeLines({
            type: 'new_entity',
            kind: 'character',
            name: '预告旅人',
            known_as: '旅人',
            profile: '带着一只布包',
            slot: '1',
            para: '1',
          }),
        }),
      );
      core.services.authoring.generatePreview({ workId: work, jobId: previewJob, contentRev: confirmed.contentRev });
      await core.services.authoring.whenIdle();
      core.services.authoring.adoptPreview({ workId: work, jobId: previewJob });

      const firstPlaythrough = '00000000-0000-4000-8000-000000000084';
      const first = core.services.play.start({
        workId: work,
        playthroughId: firstPlaythrough,
        protagonist: {},
      });
      expect(first.routeId).toBeNull();
      server.enqueue(
        rawToolStep('propose_cast', {
          cast: JSON.stringify({ slot: '1', name: '阿澄', known_as: '阿澄', profile: '背着旧包' }),
        }),
        { kind: 'http_error', status: 401, message: 'unauthorized' },
      );
      await core.services.play.whenIdle();
      const failed = core.services.play.getPlaythrough({ playthroughId: firstPlaythrough });
      expect(failed.routeId).toBeNull();
      expect(failed.opening?.status).toBe('failed');

      server.enqueue(
        rawToolStep('propose_opening', {
          prose: '阿澄站在码头尽头，手里提着一盏灯。\n\n潮水拍着木桩。',
          options: '{"text":"走过去"}\n{"text":"先看看四周"}',
          place: '渡口',
          time: '夜里',
          present: '阿澄',
          changes: changeLines({
            type: 'new_entity',
            kind: 'character',
            name: '阿澄',
            known_as: '阿澄',
            profile: '背着旧包',
            slot: '1',
            para: '1',
          }),
          state: '',
        }),
      );
      core.services.play.retryOpening({ requestId: failed.opening!.id });
      await core.services.play.whenIdle();
      const retried = core.services.play.getPlaythrough({ playthroughId: firstPlaythrough });
      expect(retried.opening?.status).toBe('done');
      const firstRoute = core.services.play.getRoute({ routeId: retried.routeId! });
      const firstProse = firstRoute.turns[0]!.paragraphs.join('\n');
      expect(firstProse).toContain('阿澄');
      expect(firstProse).not.toContain('白棠');
      expect(server.requests.filter((request) => JSON.stringify(request.body).includes('"propose_cast"'))).toHaveLength(
        1,
      );

      const secondPlaythrough = '00000000-0000-4000-8000-000000000085';
      server.enqueue(
        rawToolStep('propose_cast', {
          cast: JSON.stringify({ slot: '1', name: '白棠', known_as: '白棠', profile: '拎着鱼篓' }),
        }),
        rawToolStep('propose_opening', {
          prose: '白棠蹲在岸边，把鱼篓放进水里。\n\n远处的船灯亮了一下。',
          options: '{"text":"问她船什么时候来"}\n{"text":"帮她提鱼篓"}',
          place: '渡口',
          time: '夜里',
          present: '白棠',
          changes: changeLines({
            type: 'new_entity',
            kind: 'character',
            name: '白棠',
            known_as: '白棠',
            profile: '拎着鱼篓',
            slot: '1',
            para: '1',
          }),
          state: '',
        }),
      );
      const second = core.services.play.start({
        workId: work,
        playthroughId: secondPlaythrough,
        protagonist: {},
      });
      expect(second.routeId).toBeNull();
      await core.services.play.whenIdle();
      const secondView = core.services.play.getPlaythrough({ playthroughId: secondPlaythrough });
      const secondRoute = core.services.play.getRoute({ routeId: secondView.routeId! });
      const secondProse = secondRoute.turns[0]!.paragraphs.join('\n');
      expect(secondProse).toContain('白棠');
      expect(secondProse).not.toContain('阿澄');
    } finally {
      await core.close();
      await server.close();
      temp.cleanup();
    }
  });

  it('有结束条件的作品可以完结', async () => {
    const temp = makeTempDataDir();
    const server = await startFakeOpenAiServer();
    const dataDir = join(temp.dir, 'data');
    const clientDir = assets(temp.dir);
    const core = await boot(dataDir, clientDir);
    const work = '00000000-0000-4000-8000-000000000091';
    const planJob = '00000000-0000-4000-8000-000000000092';
    const previewJob = '00000000-0000-4000-8000-000000000093';
    const playthrough = '00000000-0000-4000-8000-000000000094';
    try {
      await configureModels(core, server, {
        requestId: '00000000-0000-4000-8000-000000000090',
        defaultModel: 'test-model',
      });
      core.services.library.create({ workId: work });
      const saved = core.services.library.saveDraft({
        workId: work,
        baseContentRev: 0,
        background: '灯塔镇只在夜里通电。',
        settings: DEFAULT_WORK_SETTINGS,
      });
      server.enqueue(proposePlanStep({ ending: '三封旧信都送到收件人手里' }));
      core.services.authoring.generatePlan({ workId: work, jobId: planJob, contentRev: saved.contentRev });
      await core.services.authoring.whenIdle();
      const confirmed = core.services.authoring.confirmPlan({
        workId: work,
        baseContentRev: core.services.library.get({ workId: work }).draft.contentRev,
      });
      server.enqueue(
        proposePreviewStep({
          title: '灯塔镇',
          blurb: '邮差带着旧信走下船。',
          publicSetting: '灯塔镇只在夜里通电。',
          prose: '船靠岸的时候，整座镇子黑着。\n\n门铃响了。',
          options: ['去开门', '继续等'],
          place: '码头',
          time: '夜里',
          language: 'zh-CN',
        }),
      );
      core.services.authoring.generatePreview({ workId: work, jobId: previewJob, contentRev: confirmed.contentRev });
      await core.services.authoring.whenIdle();
      core.services.authoring.adoptPreview({ workId: work, jobId: previewJob });
      const started = core.services.play.start({ workId: work, playthroughId: playthrough, protagonist: {} });
      const routeId = started.routeId!;
      const root = core.services.play.getRoute({ routeId });
      server.enqueue(
        proposeTurnStep({
          prose: '最后一封信送进了门缝。',
          options: ['离开'],
          changes: '',
          ending: true,
        }),
        { kind: 'text', text: '主角送出了最后一封信。' },
      );
      core.services.play.submitAction({
        requestId: '00000000-0000-4000-8000-000000000095' as never,
        routeId,
        expectedHeadTurnId: root.headTurnId,
        action: { text: '送出最后一封信', optionIndex: null },
      });
      await core.services.play.whenIdle();
      await core.services.summary.whenIdle();
      const ended = core.services.play.getRoute({ routeId });
      expect(ended.ended).toBe(true);
      expect(ended.turns).toHaveLength(2);
      expect(() =>
        core.services.play.submitAction({
          requestId: '00000000-0000-4000-8000-000000000096' as never,
          routeId,
          expectedHeadTurnId: ended.headTurnId,
          action: { text: '再试一次', optionIndex: null },
        }),
      ).toThrow();
    } finally {
      await core.close();
      await server.close();
      temp.cleanup();
    }
  });

  it('版本 1 配置进入纯文字游玩，不发图片请求', async () => {
    const temp = makeTempDataDir();
    const server = await startFakeOpenAiServer();
    const imageServer = await startFakeImageServer();
    const dataDir = join(temp.dir, 'data');
    const clientDir = assets(temp.dir);
    const providersPath = writeProvidersFile(dataDir, versionOneProviders(server));
    const original = readFileSync(providersPath);
    const core = await boot(dataDir, clientDir);
    try {
      expect(core.services.image.listServices()).toMatchObject({
        status: 'ok',
        services: [],
        selectedServiceId: null,
      });
      const routeId = await publishDefaultWork(
        core,
        server,
        {
          workId: '00000000-0000-4000-8000-0000000000a1',
          planJobId: '00000000-0000-4000-8000-0000000000a2',
          previewJobId: '00000000-0000-4000-8000-0000000000a3',
          playthroughId: '00000000-0000-4000-8000-0000000000a4',
        },
        '雨夜修钟铺',
      );
      const root = core.services.play.getRoute({ routeId });
      server.enqueue(
        proposeTurnStep({
          prose: '门外的雨停了。\n\n你退回屋里。',
          options: ['关灯', '继续等'],
          illustrate: '9',
          changes: '',
        }),
        { kind: 'text', text: '主角退回屋里。' },
      );
      core.services.play.submitAction({
        requestId: '00000000-0000-4000-8000-0000000000a5' as never,
        routeId,
        expectedHeadTurnId: root.headTurnId,
        action: { text: '关灯', optionIndex: null },
      });
      await core.services.play.whenIdle();
      await core.services.summary.whenIdle();

      const after = core.services.play.getRoute({ routeId });
      expect(after.turns).toHaveLength(2);
      expect(after.turns[1]!.illustration).toBeNull();
      expect(after.turns[1]!.options.map((option) => option.text)).toEqual(['关灯', '继续等']);
      expect(imageServer.requests).toHaveLength(0);

      await core.close();
      const library = new DatabaseSync(join(dataDir, 'library.db'));
      try {
        const row = library.prepare('select count(*) as count from illustrations').get() as { count: number };
        expect(row.count).toBe(0);
      } finally {
        library.close();
      }
      expect(readFileSync(providersPath).equals(original)).toBe(true);
    } finally {
      await core.close();
      await server.close();
      await imageServer.close();
      temp.cleanup();
    }
  });

  it('配置出图服务后伪出图服务收到排队插图的请求', async () => {
    const temp = makeTempDataDir();
    const server = await startFakeOpenAiServer();
    const imageServer = await startFakeImageServer({ jobDelayMs: 5 });
    const dataDir = join(temp.dir, 'data');
    const clientDir = assets(temp.dir);
    const core = await boot(dataDir, clientDir);
    try {
      await configureModels(core, server, {
        requestId: '00000000-0000-4000-8000-0000000000b1',
        defaultModel: 'narrator-model',
      });
      const created = await core.services.image.createService({
        requestId: '00000000-0000-4000-8000-0000000000b2' as never,
        baseRevision: core.services.image.listServices().revision,
        name: '测试出图',
        protocol: 'unwritten-image',
        baseUrl: imageServer.url,
        apiKey: imageServer.token,
        model: null,
        openai: null,
        launcher: null,
        idleMinutes: null,
      });
      await core.services.image.select({
        baseRevision: core.services.image.listServices().revision,
        serviceId: created.serviceId,
      });
      core.services.image.setAutoIllustration({
        enabled: true,
        confirm: core.services.image.getAutoIllustration().current!,
      });

      const routeId = await publishDefaultWork(
        core,
        server,
        {
          workId: '00000000-0000-4000-8000-0000000000b3',
          planJobId: '00000000-0000-4000-8000-0000000000b4',
          previewJobId: '00000000-0000-4000-8000-0000000000b5',
          playthroughId: '00000000-0000-4000-8000-0000000000b6',
        },
        '雨夜修钟铺',
        {
          illustration: {
            enabled: true,
            style: DEFAULT_ILLUSTRATION_STYLE,
            aspectPreference: '3:2',
            resolutionTier: '1k',
            protagonistInFrame: false,
            protagonistAppearance: null,
            protagonistSnapshotId: null,
          },
          beforeStart: () => server.enqueue({ kind: 'text', text: shotText() }),
        },
      );
      await core.services.play.whenIdle();
      await core.services.illustration.whenIdle();

      const root = core.services.play.getRoute({ routeId });
      expect(root.turns[0]!.illustration).toMatchObject({ status: 'done', para: 0 });
      expect(root.turns[0]!.illustration?.image).not.toBeNull();
      expect(
        imageServer.requests.filter((request) => request.method === 'POST' && request.path === '/v1/jobs'),
      ).toHaveLength(1);
    } finally {
      await core.close();
      await server.close();
      await imageServer.close();
      temp.cleanup();
    }
  });

  it('重启恢复中断任务、清理存储并接续排队插图', async () => {
    const temp = makeTempDataDir();
    const server = await startFakeOpenAiServer();
    const imageServer = await startFakeImageServer({ jobDelayMs: 5 });
    const dataDir = join(temp.dir, 'data');
    const clientDir = assets(temp.dir);
    mkdirSync(dataDir, { recursive: true });
    writeProvidersFile(
      dataDir,
      versionTwoProviders(server, { id: 'image-fake01', url: imageServer.url, token: imageServer.token }),
    );
    const opened = openDatabase(join(dataDir, 'library.db'));
    const seeded = seedLighthouseTown(opened.db);
    const store = createImageStore(dataDir);
    const oldBytes = pngBytes(48, 32);
    const oldStaged = await store.stage(oldBytes);
    await store.commit([oldStaged], () => {});
    ageBlob(dataDir, oldStaged.ref, IMAGE_GC_GRACE_MS + 60_000);
    const frontBytes = pngBytes(40, 40);
    const frontStaged = await store.stage(frontBytes);
    await store.commit([frontStaged], () => {});
    const orphanStaged = await store.stage(pngBytes(20, 20));
    await store.commit([orphanStaged], () => {});
    ageBlob(dataDir, orphanStaged.ref, IMAGE_GC_GRACE_MS + 60_000);
    const tempFile = join(dataDir, 'images', 'tmp', 'leftover.part');
    writeFileSync(tempFile, 'partial');

    const settings = PlaythroughIllustrationSchema.parse({
      enabled: true,
      style: DEFAULT_ILLUSTRATION_STYLE,
      aspectPreference: '3:2',
      resolutionTier: '1k',
      protagonistInFrame: false,
      protagonistAppearance: null,
      authorPortraitSetIds: {},
      protagonistPortraitSetId: null,
    });
    opened.db.run(
      sql`update playthroughs set illustration = ${JSON.stringify(settings)} where id = ${seeded.playthroughId}`,
    );
    opened.db.run(
      sql`insert into app_settings (id, appearance, illustration, updated_at)
          values (1, ${JSON.stringify(DEFAULT_APPEARANCE)},
                  ${JSON.stringify({
                    autoEnabled: true,
                    confirmed: {
                      serviceId: 'image-fake01',
                      model: null,
                      background: { endpointId: 'endpoint-test', modelId: 'shot-model' },
                    },
                    defaults: { aspectPreference: 'auto', resolutionTier: '1k' },
                  })},
                  ${Date.now()})`,
    );
    for (const turnId of seeded.turnIds.slice(1)) {
      opened.db.run(
        sql`insert into turn_summaries (turn_id, summary, created_at) values (${turnId}, '虚构摘要', ${Date.now()})`,
      );
    }

    const runningId = randomUUID();
    const queuedId = randomUUID();
    const rerollId = randomUUID();
    const rerollAttemptId = randomUUID();
    const runningAttemptId = randomUUID();
    insertIllustration(opened.db, {
      id: runningId,
      turnId: seeded.turnIds[1]!,
      playthroughId: seeded.playthroughId,
      para: 1,
      status: 'running',
      serviceId: 'image-fake01',
      activeAttemptId: runningAttemptId,
      attemptData: AttemptDataSchema.parse({
        attemptId: runningAttemptId,
        kind: 'first',
        formatOverride: null,
        format: null,
        shot: null,
        referenceFiles: null,
        seed: null,
        serviceId: 'image-fake01',
        completed: ['appearance', 'shot', 'portrait'],
      }),
    });
    insertIllustration(opened.db, {
      id: queuedId,
      turnId: seeded.turnIds[0]!,
      playthroughId: seeded.playthroughId,
      para: 1,
      status: 'queued',
    });
    insertIllustration(opened.db, {
      id: rerollId,
      turnId: seeded.turnIds[2]!,
      playthroughId: seeded.playthroughId,
      para: 1,
      status: 'done',
      serviceId: 'image-fake01',
      ref: oldStaged.ref,
      caption: '重画前的旧图',
      activeAttemptId: rerollAttemptId,
      attemptData: AttemptDataSchema.parse({
        attemptId: rerollAttemptId,
        kind: 'reroll',
        formatOverride: null,
        format: { aspectPreference: '3:2', resolutionTier: '1k', size: { width: 48, height: 32 } },
        shot: null,
        referenceFiles: null,
        seed: null,
        serviceId: 'image-fake01',
        completed: [],
      }),
    });

    const portraitSetId = randomUUID();
    const portraitAttemptId = randomUUID();
    opened.db.run(
      sql`insert into portrait_sets
          (id, work_id, scope, playthrough_id, entity_id, appearance_fact_id, appearance_hash, appearance,
           style, state, draft_rev, slots, task, created_at, updated_at)
          values (${portraitSetId}, ${seeded.workId}, 'work', null, ${seeded.ids.linchao!}, null,
                  ${'a'.repeat(64)}, '守灯人的参考', ${JSON.stringify(DEFAULT_ILLUSTRATION_STYLE)}, 'active', 0,
                  ${JSON.stringify(
                    PortraitSlotsStoredSchema.parse({
                      front: { file: frontStaged.ref, source: 'generate', needsReview: false },
                      three_quarter: { file: null, source: null, needsReview: false },
                      full_body: { file: null, source: null, needsReview: false },
                    }),
                  )},
                  ${JSON.stringify(
                    PortraitTasksSchema.parse({
                      front: null,
                      three_quarter: {
                        attemptId: portraitAttemptId,
                        status: 'running',
                        error: null,
                        format: { aspectPreference: '3:4', resolutionTier: '1k', size: { width: 720, height: 960 } },
                        quality: 'fast',
                        inputFiles: [frontStaged.ref],
                        appearanceHash: null,
                      },
                      full_body: null,
                    }),
                  )},
                  ${Date.now()}, ${Date.now()})`,
    );

    const expiredCall = randomUUID();
    const freshCall = randomUUID();
    const day = 86_400_000;
    opened.db.run(
      sql`insert into image_calls
          (id, service_id, protocol, model, work_id, ref_kind, ref_id, quality, reference_count,
           input_tokens, output_tokens, duration_ms, status, error, created_at)
          values (${expiredCall}, 'image-fake01', 'unwritten-image', null, null, 'illustration', null, 'fast', 0,
                  null, null, 10, 'ok', null, ${Date.now() - 91 * day})`,
    );
    opened.db.run(
      sql`insert into image_calls
          (id, service_id, protocol, model, work_id, ref_kind, ref_id, quality, reference_count,
           input_tokens, output_tokens, duration_ms, status, error, created_at)
          values (${freshCall}, 'image-fake01', 'unwritten-image', null, null, 'illustration', null, 'fast', 0,
                  null, null, 10, 'ok', null, ${Date.now()})`,
    );
    opened.close();
    server.enqueue({ kind: 'text', text: shotText() });

    const core = await boot(dataDir, clientDir, 'info');
    try {
      await core.services.illustration.whenIdle();
      const views = core.services.illustration.forRoute(seeded.routeId);
      expect(views.get(seeded.turnIds[1]!)).toMatchObject({
        status: 'failed',
        stage: 'generate',
        error: 'image_interrupted',
      });
      expect(views.get(seeded.turnIds[0]!)).toMatchObject({ status: 'done', error: null });
      expect(views.get(seeded.turnIds[0]!)?.image).not.toBeNull();
      expect(views.get(seeded.turnIds[2]!)).toMatchObject({
        status: 'done',
        error: 'image_interrupted',
        rerolling: false,
        caption: '重画前的旧图',
        image: { width: 48, height: 32 },
      });
      expect(
        imageServer.requests.filter((request) => request.method === 'POST' && request.path === '/v1/jobs'),
      ).toHaveLength(1);

      const saved = await core.services.illustration.file({
        view: { kind: 'route', routeId: seeded.routeId },
        image: { kind: 'illustration', illustrationId: rerollId },
      });
      expect(saved.type).toBe('image/png');
      expect(Buffer.from(await saved.arrayBuffer()).equals(Buffer.from(oldBytes))).toBe(true);

      const portrait = core.services.illustration.portraitGet({ setId: portraitSetId });
      expect(portrait.slots.find((slot) => slot.slot === 'front')?.image).not.toBeNull();
      expect(portrait.slots.find((slot) => slot.slot === 'three_quarter')?.task).toEqual({
        status: 'failed',
        error: 'image_interrupted',
      });

      expect(existsSync(tempFile)).toBe(false);
      expect(existsSync(blobPath(dataDir, orphanStaged.ref))).toBe(false);
      expect(existsSync(blobPath(dataDir, oldStaged.ref))).toBe(true);
      expect(existsSync(blobPath(dataDir, frontStaged.ref))).toBe(true);

      await core.services.logger.flush();
      await core.close();

      const library = new DatabaseSync(join(dataDir, 'library.db'));
      try {
        expect(library.prepare('select id from image_calls where id = ?').get(expiredCall)).toBeUndefined();
        expect(library.prepare('select id from image_calls where id = ?').get(freshCall)).toEqual({ id: freshCall });
      } finally {
        library.close();
      }

      const diagnostics = new DatabaseSync(join(dataDir, 'diagnostics.db'));
      try {
        const interrupted = diagnostics
          .prepare("select data from diagnostic_events where event = 'illustration.interrupted' and request_id = ?")
          .get(runningId) as { data: string } | undefined;
        expect(JSON.parse(String(interrupted?.data))).toMatchObject({ stage: 'generate', code: 'image_interrupted' });
        const portraitEvent = diagnostics
          .prepare("select data from diagnostic_events where event = 'portrait.interrupted' and request_id = ?")
          .get(portraitAttemptId) as { data: string } | undefined;
        expect(JSON.parse(String(portraitEvent?.data))).toMatchObject({
          setId: portraitSetId,
          slot: 'three_quarter',
          code: 'image_interrupted',
        });
        const recovery = diagnostics
          .prepare(
            "select data from diagnostic_events where event = 'recovery.interrupted' order by created_at desc limit 1",
          )
          .get() as { data: string } | undefined;
        expect(JSON.parse(String(recovery?.data))).toMatchObject({ illustrations: 3 });
      } finally {
        diagnostics.close();
      }
    } finally {
      await core.close();
      await server.close();
      await imageServer.close();
      temp.cleanup();
    }
  });

  it('删除一部作品后共享图片仍可读，两部都删后回收', async () => {
    const temp = makeTempDataDir();
    const dataDir = join(temp.dir, 'data');
    const clientDir = assets(temp.dir);
    mkdirSync(dataDir, { recursive: true });
    const opened = openDatabase(join(dataDir, 'library.db'));
    const north = seedNorthCape(opened.db);
    const snow = seedLighthouseTown(opened.db);
    const bytes = pngBytes(36, 24);
    const ref = await storeImage(dataDir, bytes);
    ageBlob(dataDir, ref, IMAGE_GC_GRACE_MS + 60_000);
    const northIllustration = randomUUID();
    const snowIllustration = randomUUID();
    insertIllustration(opened.db, {
      id: northIllustration,
      turnId: north.headTurnId,
      playthroughId: north.playthroughId,
      para: 1,
      status: 'done',
      ref,
      caption: '北岬的栈桥',
    });
    insertIllustration(opened.db, {
      id: snowIllustration,
      turnId: snow.headTurnId,
      playthroughId: snow.playthroughId,
      para: 1,
      status: 'done',
      ref,
      caption: '灯塔镇的码头',
    });
    opened.close();

    const core = await boot(dataDir, clientDir, 'info');
    try {
      const client = rpcClient(core);
      await client.works.delete({ workId: north.workId });
      const firstGc = await waitForGcEvents(core, dataDir, 2);
      expect(firstGc).toMatchObject({ files: 0 });
      expect(existsSync(blobPath(dataDir, ref))).toBe(true);
      const file = await client.image.file({
        view: { kind: 'route', routeId: snow.routeId },
        image: { kind: 'illustration', illustrationId: snowIllustration },
      });
      expect(Buffer.from(await file.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);

      await client.works.delete({ workId: snow.workId });
      const secondGc = await waitForGcEvents(core, dataDir, 3);
      expect(secondGc).toMatchObject({ sets: 0, files: 1, bytes: bytes.length });
      expect(existsSync(blobPath(dataDir, ref))).toBe(false);

      await core.services.logger.flush();
      const diagnostics = new DatabaseSync(join(dataDir, 'diagnostics.db'));
      try {
        const deleted = diagnostics
          .prepare("select work_id from diagnostic_events where event = 'work.deleted'")
          .all() as Array<{ work_id: string }>;
        expect(deleted.map((row) => row.work_id).sort()).toEqual([north.workId, snow.workId].sort());
        const gc = diagnostics.prepare("select data from diagnostic_events where event = 'image.gc'").all();
        expect(gc.length).toBeGreaterThanOrEqual(3);
      } finally {
        diagnostics.close();
      }
    } finally {
      await core.close();
      temp.cleanup();
    }
  });

  it('取图按路线核对归属并经过鉴权', async () => {
    const temp = makeTempDataDir();
    const dataDir = join(temp.dir, 'data');
    const clientDir = assets(temp.dir);
    mkdirSync(dataDir, { recursive: true });
    const opened = openDatabase(join(dataDir, 'library.db'));
    const north = seedNorthCape(opened.db);
    const snow = seedLighthouseTown(opened.db);
    const bytes = pngBytes(28, 18);
    const ref = await storeImage(dataDir, bytes);
    const illustrationId = randomUUID();
    insertIllustration(opened.db, {
      id: illustrationId,
      turnId: north.headTurnId,
      playthroughId: north.playthroughId,
      para: 1,
      status: 'done',
      ref,
      caption: '北岬的栈桥',
    });
    opened.close();

    const core = await boot(dataDir, clientDir);
    try {
      const served: Response[] = [];
      const link = new RPCLink({
        url: `${core.origin}/api`,
        headers: { authorization: `Bearer ${core.token}` },
        fetch: async (request) => {
          const response = await fetch(request);
          served.push(response.clone());
          return response;
        },
      });
      const client = createORPCClient(link) as ContractRouterClient<typeof contract>;
      const request = {
        view: { kind: 'route', routeId: north.routeId },
        image: { kind: 'illustration', illustrationId },
      } as const;
      const file = await client.image.file(request);
      expect(file.type).toBe('image/png');
      expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([...bytes]);
      expect(served.at(-1)?.headers.get('x-content-type-options')).toBe('nosniff');

      await expect(
        client.image.file({
          view: { kind: 'route', routeId: snow.routeId },
          image: { kind: 'illustration', illustrationId },
        }),
      ).rejects.toMatchObject({ code: 'not_found' });

      const unauthorized = await fetch(`${core.origin}/api/image/file`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json: request }),
      });
      expect(unauthorized.status).toBe(401);
    } finally {
      await core.close();
      temp.cleanup();
    }
  });

  it('独立运行和桌面通道下行为一致', async () => {
    const standalone = await parityList(false);
    const desktop = await parityList(true);
    expect(standalone).toHaveLength(2);
    expect(desktop).toEqual(standalone);
  });
});
