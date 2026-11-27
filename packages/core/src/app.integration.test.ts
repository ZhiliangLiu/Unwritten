import { mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startFakeOpenAiServer } from './test-support/fake-openai-server.ts';
import type { FakeOpenAiServer } from './test-support/fake-openai-server.ts';
import {
  changeLines,
  proposePlanStep,
  proposePreviewStep,
  proposeTurnStep,
  rawToolStep,
} from './test-support/llm-steps.ts';
import { makeTempDataDir } from './test-support/temp-dir.ts';
import { seedStory } from './test-support/story-fixtures.ts';
import { openDatabase } from './store/db.ts';
import { DEFAULT_WORK_SETTINGS, EMPTY_GENERATION_PARAMS } from '@unwritten/contracts';
import { startCore } from './app.ts';
import type { RunningCore } from './app.ts';
import { createLlmService } from './llm/service.ts';
import { createLibraryService } from './library/service.ts';
import { createSettingsService } from './settings/service.ts';
import { createSummaryService } from './summary/queue.ts';
import { createAuthoringService } from './authoring/service.ts';
import { createPlayService } from './play/service.ts';
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
  library: createLibraryService,
  settings: createSettingsService,
  summary: createSummaryService,
  authoring: createAuthoringService,
  play: createPlayService,
};

async function boot(dataDir: string, clientDir: string): Promise<RunningCore> {
  return startCore({ dataDir, port: 0, clientDir, clientOrigin: null, logLevel: 'error' }, factories);
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
  const started = core.services.play.start({
    workId: ids.workId,
    playthroughId: ids.playthroughId,
    protagonist: {},
  });
  return started.routeId!;
}

function fakeParentPort(): ParentPortLike {
  return {
    on() {},
    postMessage() {},
  };
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

  it('独立运行和桌面通道下行为一致', async () => {
    const standalone = await parityList(false);
    const desktop = await parityList(true);
    expect(standalone).toHaveLength(2);
    expect(desktop).toEqual(standalone);
  });
});
