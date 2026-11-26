import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { startFakeOpenAiServer } from './test-support/fake-openai-server.ts';
import { changeLines, proposePreviewStep, proposeTurnStep, rawToolStep } from './test-support/llm-steps.ts';
import { makeTempDataDir } from './test-support/temp-dir.ts';
import { seedStory } from './test-support/story-fixtures.ts';
import { openDatabase } from './store/db.ts';
import { EMPTY_GENERATION_PARAMS } from '@unwritten/contracts';
import { startCore } from './app.ts';
import type { RunningCore } from './app.ts';
import { createLlmService } from './llm/service.ts';
import { createLibraryService } from './library/service.ts';
import { createSettingsService } from './settings/service.ts';
import { createSummaryService } from './summary/queue.ts';
import { createAuthoringService } from './authoring/service.ts';
import { createPlayService } from './play/service.ts';

const workId = '00000000-0000-4000-8000-000000000001';
const jobId = '00000000-0000-4000-8000-000000000002';
const endpointRequestId = '00000000-0000-4000-8000-000000000003';
const actionRequestId = '00000000-0000-4000-8000-000000000004';
const secondRequestId = '00000000-0000-4000-8000-000000000005';

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
      core.services.library.saveBackground({ workId, baseContentRev: 0, background: '雨夜修钟铺' });
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
      core.services.authoring.generatePreview({ workId, jobId, contentRev: 1 });
      await core.services.authoring.whenIdle();
      const adopted = core.services.authoring.adoptPreview({ workId, jobId });
      const route = core.services.play.getRoute({ routeId: adopted.routeId });
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
        routeId: adopted.routeId,
        expectedHeadTurnId: route.headTurnId,
        action: { text: '推门', optionIndex: null },
      });
      await core.services.play.whenIdle();
      expect(core.services.play.getRoute({ routeId: adopted.routeId }).turns).toHaveLength(2);

      await core.close();
      const diagnostics = new DatabaseSync(join(dataDir, 'diagnostics.db'));
      const samples = diagnostics
        .prepare("select metric, duration_ms from performance_samples where metric like 'turn.%'")
        .all() as Array<{ metric: string; duration_ms: number }>;
      diagnostics.close();
      const metrics = new Set(samples.map((row) => row.metric));
      expect(metrics).toEqual(new Set(['turn.queue', 'turn.context', 'turn.validate', 'turn.commit', 'turn.total']));
      core = await boot(dataDir, clientDir);
      const restored = core.services.play.getRoute({ routeId: adopted.routeId });
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
        routeId: adopted.routeId,
        expectedHeadTurnId: restored.headTurnId,
        action: { text: '关上门', optionIndex: null },
      });
      await core.services.play.whenIdle();
      expect(core.services.play.getRoute({ routeId: adopted.routeId }).turns).toHaveLength(3);
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
      core.services.library.create({ workId });
      core.services.library.saveBackground({ workId, baseContentRev: 0, background: '雨夜' });
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
          changes: changeLines(
            {
              type: 'new_entity',
              kind: 'character',
              name: '守夜人',
              known_as: '',
              profile: '',
              para: '1',
              protagonist: 'true',
            },
            {
              type: 'new_entity',
              kind: 'character',
              name: '沈岚',
              known_as: '撑伞的女人',
              profile: '带着黑伞',
              para: '1',
            },
          ),
        }),
      );
      core.services.authoring.generatePreview({ workId, jobId, contentRev: 1 });
      await core.services.authoring.whenIdle();
      const adopted = core.services.authoring.adoptPreview({ workId, jobId });
      const root = core.services.play.getRoute({ routeId: adopted.routeId });

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
        routeId: adopted.routeId,
        expectedHeadTurnId: root.headTurnId,
        action: { text: '看看谁来了', optionIndex: null },
      });
      await core.services.play.whenIdle();
      await core.services.summary.whenIdle();
      const afterFirst = core.services.play.getRoute({ routeId: adopted.routeId });

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
        routeId: adopted.routeId,
        expectedHeadTurnId: afterFirst.headTurnId,
        action: { text: '问她为什么在这里', optionIndex: null },
      });
      await core.services.play.whenIdle();
      await core.services.summary.whenIdle();

      const journal = core.services.play.getJournal({ routeId: adopted.routeId });
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
      const restoredJournal = core.services.play.getJournal({ routeId: adopted.routeId });
      expect(restoredJournal).toEqual(journal);
    } finally {
      await core.close();
      await server.close();
      temp.cleanup();
    }
  });
});
