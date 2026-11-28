import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WORK_SETTINGS } from '@unwritten/contracts';
import { createEventBus } from '../events/bus.ts';
import type { LogEvent, Logger, PerformanceSample } from '../log/logger.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createScriptedLlm, type ScriptedLlm } from '../test-support/scripted-llm.ts';
import { proposePlanStep } from '../test-support/llm-steps.ts';
import type { FakeStep } from '../test-support/fake-openai-server.ts';
import type { ScriptStep } from '../test-support/scripted-llm.ts';
import { openDatabase } from '../store/db.ts';
import { workVersions } from '../store/schema.ts';
import type { VersionMeta } from '../store/meta.ts';
import { createLibraryService } from '../library/service.ts';
import type { LlmRunInput, LlmRunResult } from '../llm/types.ts';
import type { LibraryService } from '../services.ts';
import { createAuthoringService } from './service.ts';

const logger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

const workId = '00000000-0000-4000-8000-000000000001';
const jobId = '00000000-0000-4000-8000-000000000002';
const secondJobId = '00000000-0000-4000-8000-000000000003';

const placeOnly = { kind: 'place', role: 'other', name: '灯塔', profile: '镇子北面的灯塔', from: 'ai' };

function scripted(step: FakeStep): ScriptStep {
  if (step.kind !== 'tool_call') throw new Error('expected a tool call');
  return { args: JSON.parse(step.arguments) as Record<string, string> };
}

function setup(makeLlm?: (library: LibraryService) => ScriptedLlm) {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const events: LogEvent[] = [];
  const samples: PerformanceSample[] = [];
  const deps = {
    dataDir: temp.dir,
    db: opened.db,
    bus: createEventBus(),
    logger: {
      ...logger,
      record: (event: LogEvent) => events.push(event),
      sample: (sample: PerformanceSample) => samples.push(sample),
    },
    shutdown: new AbortController().signal,
  };
  const library = createLibraryService(deps);
  const llm = makeLlm ? makeLlm(library) : createScriptedLlm();
  const authoring = createAuthoringService({ ...deps, llm });
  return { temp, opened, llm, library, authoring, events, samples };
}

describe('createPlanJobs', () => {
  it('生成方案写进草稿并进入方案步骤', async () => {
    const { temp, opened, llm, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveDraft({
        workId,
        baseContentRev: 0,
        background: '灯塔镇只在夜里通电。',
        settings: DEFAULT_WORK_SETTINGS,
      });
      llm.enqueue(scripted(proposePlanStep()));
      const view = authoring.generatePlan({ workId, jobId, contentRev: 1 });
      expect(view.status).toBe('running');
      await authoring.whenIdle();

      const work = library.get({ workId });
      expect(work.draft.contentRev).toBe(2);
      expect(work.draft.wizardStep).toBe('plan');
      expect(work.draft.plan?.items.some((item) => item.kind === 'entity' && item.role === 'protagonist')).toBe(true);
      expect(work.latestPlanJob?.status).toBe('done');
      expect(work.latestPlanJob?.stale).toBe(false);
      expect(llm.runs[0]?.purpose).toBe('author_chat');
      expect(llm.runs[0]?.sessionId).toBe(workId);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('已发布作品仍能重新生成方案', async () => {
    const { temp, opened, llm, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveDraft({
        workId,
        baseContentRev: 0,
        background: '灯塔镇只在夜里通电。',
        settings: DEFAULT_WORK_SETTINGS,
      });
      const publishedId = '00000000-0000-4000-8000-000000000004';
      const now = Date.now();
      opened.db.run(
        sql`insert into work_versions (id, work_id, kind, content_rev, source_rev, meta, created_at, updated_at)
            values (${publishedId}, ${workId}, 'published', 1, 1, '{"background":"灯塔镇只在夜里通电。"}', ${now}, ${now})`,
      );
      opened.db.run(sql`update works set published_id = ${publishedId} where id = ${workId}`);
      llm.enqueue(scripted(proposePlanStep()));
      authoring.generatePlan({ workId, jobId, contentRev: 1 });
      await authoring.whenIdle();

      expect(library.get({ workId }).latestPlanJob?.status).toBe('done');
      expect(library.get({ workId }).draft.plan?.items.some((item) => item.kind === 'entity')).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('生成期间改过草稿时不覆盖', async () => {
    const { temp, opened, library, authoring } = setup((library) => {
      const base = createScriptedLlm();
      base.enqueue(scripted(proposePlanStep()));
      return {
        ...base,
        async run(input: LlmRunInput): Promise<LlmRunResult> {
          library.saveDraft({
            workId,
            baseContentRev: 1,
            background: '灯塔镇改了背景。',
            settings: DEFAULT_WORK_SETTINGS,
          });
          return base.run(input);
        },
      };
    });
    try {
      library.create({ workId });
      library.saveDraft({
        workId,
        baseContentRev: 0,
        background: '灯塔镇只在夜里通电。',
        settings: DEFAULT_WORK_SETTINGS,
      });
      authoring.generatePlan({ workId, jobId, contentRev: 1 });
      await authoring.whenIdle();

      const stale = library.get({ workId });
      expect(stale.draft.plan).toBeNull();
      expect(stale.latestPlanJob?.stale).toBe(true);

      const adopted = authoring.adoptStalePlan({ workId, jobId });
      expect(adopted.contentRev).toBe(3);
      const after = library.get({ workId });
      expect(after.draft.plan?.items.length).toBeGreaterThan(0);
      expect(after.latestPlanJob?.stale).toBe(false);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('重新生成保留作者改过的项', async () => {
    const { temp, opened, llm, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveDraft({
        workId,
        baseContentRev: 0,
        background: '灯塔镇只在夜里通电。',
        settings: DEFAULT_WORK_SETTINGS,
      });
      llm.enqueue(scripted(proposePlanStep()));
      authoring.generatePlan({ workId, jobId, contentRev: 1 });
      await authoring.whenIdle();

      const draft = opened.db.select().from(workVersions).where(eq(workVersions.kind, 'draft')).get();
      expect(draft).toBeTruthy();
      const meta = draft!.meta as VersionMeta;
      const items = meta.plan!.items.map((item) =>
        item.kind === 'summary' && item.key === 'identity'
          ? { ...item, text: '作者写的身份', source: 'author' as const }
          : item,
      );
      opened.db
        .update(workVersions)
        .set({ meta: { ...meta, plan: { ...meta.plan!, items } } })
        .where(eq(workVersions.id, draft!.id))
        .run();

      llm.enqueue(
        scripted(
          proposePlanStep({
            summary: [
              { key: 'identity', text: '模型写的身份', from: 'ai' },
              { key: 'situation', text: '最后一班船靠岸时，镇上停了电', from: 'ai' },
            ],
          }),
        ),
      );
      authoring.generatePlan({ workId, jobId: secondJobId, contentRev: 2 });
      await authoring.whenIdle();

      const identity = library
        .get({ workId })
        .draft.plan?.items.find((item) => item.kind === 'summary' && item.key === 'identity');
      expect(identity).toMatchObject({ text: '作者写的身份', source: 'author' });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('author_chat 没有配置时拒绝', () => {
    const { temp, opened, llm, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveDraft({
        workId,
        baseContentRev: 0,
        background: '灯塔镇只在夜里通电。',
        settings: DEFAULT_WORK_SETTINGS,
      });
      llm.setResolved(null);
      try {
        authoring.generatePlan({ workId, jobId, contentRev: 1 });
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ code: 'llm_not_configured' });
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('重启时运行中的方案任务标为中断', () => {
    const { temp, opened, library, authoring, events } = setup();
    try {
      library.create({ workId });
      library.saveDraft({
        workId,
        baseContentRev: 0,
        background: '灯塔镇只在夜里通电。',
        settings: DEFAULT_WORK_SETTINGS,
      });
      const now = Date.now();
      opened.db.run(sql`insert into jobs (id, work_id, kind, status, input, created_at, updated_at)
        values (${jobId}, ${workId}, 'plan', 'running', ${JSON.stringify({ contentRev: 1, background: '灯塔镇只在夜里通电。' })}, ${now}, ${now})`);
      expect(authoring.recoverInterrupted()).toBe(1);
      expect(library.get({ workId }).latestPlanJob).toMatchObject({ status: 'failed', error: 'interrupted' });
      expect(events.filter((event) => event.event === 'plan.job.failed')).toHaveLength(1);
      expect(authoring.recoverInterrupted()).toBe(0);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('不合格的提案修正两次后失败', async () => {
    const { temp, opened, llm, library, authoring, events } = setup();
    try {
      library.create({ workId });
      library.saveDraft({
        workId,
        baseContentRev: 0,
        background: '灯塔镇只在夜里通电。',
        settings: DEFAULT_WORK_SETTINGS,
      });
      llm.enqueue(
        scripted(proposePlanStep({ entities: [placeOnly] })),
        scripted(proposePlanStep({ entities: [placeOnly] })),
        scripted(proposePlanStep({ entities: [placeOnly] })),
      );
      authoring.generatePlan({ workId, jobId, contentRev: 1 });
      await authoring.whenIdle();

      expect(library.get({ workId }).latestPlanJob).toMatchObject({ status: 'failed', error: 'invalid_output' });
      const failed = events.find((event) => event.event === 'plan.job.failed');
      expect(failed?.data?.fields).toContain('entities');
      expect(llm.runs[0]).toBeTruthy();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
