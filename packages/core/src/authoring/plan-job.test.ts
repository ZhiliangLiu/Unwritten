import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORK_SETTINGS, NOVEL_IMPORT_PART_BYTES } from '@unwritten/contracts';
import { createEventBus } from '../events/bus.ts';
import type { LogEvent, Logger, PerformanceSample } from '../log/logger.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createScriptedLlm, type ScriptedLlm } from '../test-support/scripted-llm.ts';
import { proposePlanStep, proposePreviewStep } from '../test-support/llm-steps.ts';
import type { FakeStep } from '../test-support/fake-openai-server.ts';
import type { ScriptStep } from '../test-support/scripted-llm.ts';
import { openDatabase } from '../store/db.ts';
import { facts, knowledge, workVersions } from '../store/schema.ts';
import type { VersionMeta } from '../store/meta.ts';
import { createLibraryService } from '../library/service.ts';
import type { LlmRunInput, LlmRunResult } from '../llm/types.ts';
import type { AuthoringService, LibraryService } from '../services.ts';
import { novelFilePath } from '../store/novel-file.ts';
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

function submitNovelPart(authoring: AuthoringService, file: File, offset = 0, totalBytes = file.size) {
  return authoring.importNovel({ workId, file, offset, totalBytes });
}

function openingAnalysis(notes: string, queries: Array<{ question: string; terms: string[] }> = []): ScriptStep {
  return { text: JSON.stringify({ notes, queries }) };
}

function novelPreview(prose: string): ScriptStep {
  return scripted(
    proposePreviewStep({
      title: '潮汐邮局',
      blurb: '信使到了码头。',
      publicSetting: '城里有一座灯塔。',
      prose,
      options: ['走向灯塔', '去找船长'],
      place: '码头',
      time: '夜里',
      language: 'zh-CN',
      changes: '',
    }),
  );
}

describe('createPlanJobs', () => {
  it('导入失败后复用开场提炼，自动生成开场并保持草稿状态', async () => {
    const { temp, opened, llm, library, authoring } = setup();
    const novel = new File(['第一章 归港\r\n信使抵达码头。\r\n第二章 失灯\r\n灯塔熄灭。'], '港湾.txt');
    const importedPlan = scripted(
      proposePlanStep({
        summary: [
          { key: 'identity', text: '港口的信使', from: 'author' },
          { key: 'situation', text: '信使刚到码头', from: 'ai' },
        ],
      }),
    );
    const preview = scripted(
      proposePreviewStep({
        title: '潮汐邮局',
        blurb: '你带着没写收件人的信抵达港口。',
        publicSetting: '港口的邮局夜间也开门。',
        prose: '钟响的时候，你站在码头上。',
        options: ['找守灯人', '先去邮局'],
        place: '码头',
        time: '夜里',
        language: 'zh-CN',
        changes: '',
      }),
    );
    try {
      await expect(submitNovelPart(authoring, new File([''], '空.txt'))).rejects.toMatchObject({
        code: 'novel_invalid_text',
      });
      expect(library.list()).toEqual([]);
      llm.enqueue(openingAnalysis('信使初到港口。'), { fail: 'invalid_output' });
      await submitNovelPart(authoring, novel);
      await authoring.whenIdle();
      const failed = library.get({ workId });
      expect(failed.novelImport).toEqual({ chapter: 0, chapters: ['第一章 归港', '第二章 失灯'] });
      expect(failed.latestPlanJob?.status).toBe('failed');
      expect(() => authoring.adoptPreview({ workId, jobId: workId })).toThrow(
        expect.objectContaining({ code: 'not_found' }),
      );
      expect(failed.latestPlanJob?.novelProgress?.processed).toBeGreaterThan(0);
      await expect(submitNovelPart(authoring, novel)).resolves.toEqual({ workId });
      await expect(submitNovelPart(authoring, new File(['另一部小说'], novel.name))).rejects.toMatchObject({
        code: 'idempotency_conflict',
      });
      expect(library.list()).toHaveLength(1);

      llm.enqueue(importedPlan, preview);
      authoring.generatePlan({ workId, jobId, contentRev: 0, novelChapter: 0 });
      await authoring.whenIdle();
      const work = library.get({ workId });
      expect(llm.completes).toHaveLength(1);
      expect(llm.completes[0]?.prompt).toContain('第一章 归港');
      expect(llm.runs[1]?.prompt).toContain('【开场提炼笔记】\n信使初到港口。');
      expect(work.status).toBe('draft');
      expect(work.draft.wizardStep).toBe('opening');
      expect(work.draft.plan?.items.find((item) => item.kind === 'summary')).toMatchObject({ source: 'ai' });
      expect(work.latestPreviewJob?.preview?.prose).toBe('钟响的时候，你站在码头上。');

      const identity = work.draft.plan?.items.find((item) => item.kind === 'summary' && item.key === 'identity');
      expect(identity).toBeDefined();
      if (!identity || identity.kind !== 'summary') throw new Error('missing imported identity');
      const edited = authoring.updatePlanItem({
        workId,
        baseContentRev: work.draft.contentRev,
        item: { ...identity, text: '修钟匠兼任信使' },
      });
      llm.enqueue(importedPlan, preview);
      authoring.generatePlan({ workId, jobId: secondJobId, contentRev: edited.contentRev, novelChapter: 0 });
      await authoring.whenIdle();
      const regenerated = library.get({ workId });
      expect(llm.completes).toHaveLength(1);
      expect(regenerated.draft.plan?.items).toContainEqual({ ...identity, text: '修钟匠兼任信使', source: 'author' });
      expect(regenerated.latestPreviewJob?.status).toBe('done');

      llm.enqueue(importedPlan, preview);
      authoring.generatePlan({
        workId,
        jobId: crypto.randomUUID(),
        contentRev: regenerated.draft.contentRev,
        novelChapter: 0,
        novelReferenceChapter: 1,
      });
      await authoring.whenIdle();
      expect(llm.completes).toHaveLength(1);
      const withReference = library.get({ workId });
      expect(withReference.novelImport).toMatchObject({ chapter: 0, referenceChapter: 1 });
      const planPrompt = llm.runs.at(-2)!.prompt;
      expect(planPrompt).toContain('【开场提炼笔记】\n信使初到港口。');
      expect(planPrompt).toContain('作者指定的参考章：第二章 失灯（开场章后）');
      expect(planPrompt).toContain('灯塔熄灭。');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it.each([5, 50])(
    '从 %i MiB 原文按固定模型预算找到后文证据',
    async (mebibytes) => {
      const { temp, opened, llm, library, authoring } = setup();
      const opening = '第一章 归港\r\n信使向守灯人问路。守灯人戴着旧铜徽。\r\n第二章 巡堤\r\n';
      const ending = '第三章 证词\r\n守灯人三年前的旧名是暮灯。信使并不知情。\r\n';
      const filler = '堤岸漫长。'.repeat(500) + '\r\n';
      const text = new File(
        [
          opening,
          ...Array.from({ length: Math.ceil((mebibytes * 1024 * 1024) / Buffer.byteLength(filler)) }, () => filler),
          ending,
        ],
        '灯塔.txt',
      );
      try {
        llm.enqueue(
          openingAnalysis('信使初到港口，眼前是守灯人。', [
            { question: '守灯人此前有旧名吗？', terms: ['守灯人', '旧名'] },
          ]),
          scripted(
            proposePlanStep({
              entities: [
                { ref: 'e1', kind: 'character', role: 'protagonist', name: '信使', profile: '初到港口', from: 'ai' },
                {
                  ref: 'e2',
                  kind: 'character',
                  role: 'cast',
                  name: '暮灯',
                  known_as: '守灯人',
                  profile: '守灯人',
                  from: 'ai',
                },
              ],
              secrets: [
                {
                  title: '守灯人的旧事',
                  statement: '守灯人三年前的旧名是暮灯。',
                  subject: 'e2',
                  knowers: 'e2',
                  reveal: '待守灯人主动说起',
                  from: 'ai',
                },
              ],
            }),
          ),
          scripted(
            proposePreviewStep({
              title: '潮汐邮局',
              blurb: '信使到了码头。',
              publicSetting: '城里有一座灯塔。',
              prose: '你向守灯人问路。',
              options: ['走向灯塔', '去找船长'],
              place: '码头',
              time: '夜里',
              language: 'zh-CN',
              changes: '',
            }),
          ),
        );
        for (let offset = 0; offset < text.size; offset += NOVEL_IMPORT_PART_BYTES) {
          const part = new File([text.slice(offset, offset + NOVEL_IMPORT_PART_BYTES)], text.name);
          await submitNovelPart(authoring, part, offset, text.size);
          if (offset === 0) {
            expect(library.list()).toEqual([]);
            await submitNovelPart(authoring, part, 0, text.size);
          }
        }
        await authoring.whenIdle();
        expect(llm.completes).toHaveLength(1);
        expect(llm.runs).toHaveLength(2);
        const read = llm.completes[0]!.prompt.split('】\n').at(-1)!;
        const evidence = llm.runs[0]!.prompt.split('【补充原文证据】\n').at(-1)!;
        expect(llm.estimateTokens(read)).toBeLessThanOrEqual(8_000);
        expect(llm.estimateTokens(evidence)).toBeLessThanOrEqual(4_000);
        expect(read).not.toContain('暮灯');
        expect(evidence).toContain('第三章 证词（开场章后）');
        expect(evidence).toContain('守灯人三年前的旧名是暮灯。');
        const work = library.get({ workId });
        expect(work.latestPreviewJob?.preview?.prose).toBe('你向守灯人问路。');
        const secret = opened.db.select().from(facts).where(eq(facts.kind, 'secret')).get()!;
        expect(secret.statement).toBe('守灯人三年前的旧名是暮灯。');
        const orphan = new File(['一段未上传完的小说'], '未上传.txt');
        await authoring.importNovel({ workId: secondJobId, file: orphan, offset: 0, totalBytes: orphan.size + 1 });
        expect(existsSync(novelFilePath(temp.dir, secondJobId))).toBe(true);
        expect(authoring.recoverInterrupted()).toBe(0);
        expect(existsSync(novelFilePath(temp.dir, secondJobId))).toBe(false);
        expect(existsSync(novelFilePath(temp.dir, workId))).toBe(true);
        expect(opened.db.select().from(knowledge).where(eq(knowledge.factId, secret.id)).all()).toEqual([
          expect.objectContaining({ holderId: secret.subjectId }),
        ]);
        library.delete({ workId });
        expect(existsSync(novelFilePath(temp.dir, workId))).toBe(false);
      } finally {
        opened.close();
        temp.cleanup();
      }
    },
    30_000,
  );

  it('有参考章时按真实预算划分，检索证据仍进入方案提示', async () => {
    const { temp, opened, llm, library, authoring } = setup(() =>
      createScriptedLlm({
        resolved: {
          endpointId: 'custom-test-000000',
          modelId: 'test-model',
          contextWindow: 10_240,
          maxOutputTokens: 8_192,
        },
      }),
    );
    const novel = new File(
      [
        '第一章 归港\r\n信使向守灯人问路。守灯人戴着旧铜徽。\r\n',
        '第二章 失灯\r\n',
        '潮声盖住脚步。'.repeat(160) + '\r\n',
        '第三章 证词\r\n守灯人三年前的旧名是暮灯。信使并不知情。\r\n',
      ],
      '灯塔.txt',
    );
    const plan = () => scripted(proposePlanStep());
    try {
      llm.enqueue(
        openingAnalysis('信使初到港口，眼前是守灯人。', [
          { question: '守灯人此前有旧名吗？', terms: ['守灯人', '旧名'] },
        ]),
        plan(),
        novelPreview('你向守灯人问路。'),
      );
      await submitNovelPart(authoring, novel);
      await authoring.whenIdle();
      llm.enqueue(plan(), novelPreview('你向守灯人问路。'));
      authoring.generatePlan({
        workId,
        jobId: crypto.randomUUID(),
        contentRev: library.get({ workId }).draft.contentRev,
        novelChapter: 0,
        novelReferenceChapter: 1,
      });
      await authoring.whenIdle();
      const evidence = llm.runs.at(-2)!.prompt.split('【补充原文证据】\n').at(-1)!;
      expect(evidence).toContain('作者指定的参考章：第二章 失灯');
      expect(evidence).toContain('守灯人三年前的旧名是暮灯。');
      expect(llm.estimateTokens(evidence)).toBeLessThanOrEqual(4_000);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('补证可找到开场预算剪掉的行尾和同一行后面的匹配', async () => {
    const { temp, opened, llm, authoring } = setup();
    const text =
      '第一章 归港\n守灯人递给信使一张纸。' +
      '潮声。'.repeat(90) +
      '纸上只写着旧名两个字。' +
      '潮声。'.repeat(2300) +
      '守灯人三年前的旧名是秋篙。\n';
    try {
      llm.enqueue(
        openingAnalysis('信使收到守灯人给的纸。', [{ question: '守灯人此前有旧名吗？', terms: ['守灯人', '旧名'] }]),
        scripted(proposePlanStep()),
        novelPreview('信使接过纸。'),
      );
      await submitNovelPart(authoring, new File([text], '归港.txt'));
      await authoring.whenIdle();
      expect(llm.completes[0]?.prompt).not.toContain('秋篙');
      expect(llm.runs[0]?.prompt).toContain('守灯人三年前的旧名是秋篙。');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('旧开场还在生成时换章，自动生成新草稿的开场', async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let previews = 0;
    const { temp, opened, llm, library, authoring } = setup(() => {
      const base = createScriptedLlm();
      return {
        ...base,
        async run(input) {
          const proposal = await base.run(input);
          if (input.purpose === 'narrator' && previews++ === 0) {
            started.resolve();
            await release.promise;
          }
          return proposal;
        },
      };
    });
    try {
      llm.enqueue(openingAnalysis('信使初到港口。'), scripted(proposePlanStep()), novelPreview('你站在码头上。'));
      await submitNovelPart(authoring, new File(['第一章 归港\n信使到了码头。\n第二章 失灯\n灯塔暗了。'], '归港.txt'));
      await started.promise;
      llm.enqueue(
        openingAnalysis('灯塔忽然暗了。'),
        scripted(proposePlanStep()),
        novelPreview('你抬头时，灯塔刚熄灭。'),
      );
      authoring.generatePlan({ workId, jobId, contentRev: library.get({ workId }).draft.contentRev, novelChapter: 1 });
      await vi.waitFor(() => {
        expect(library.get({ workId }).latestPlanJob).toMatchObject({ id: jobId, status: 'done' });
      });
      release.resolve();
      await authoring.whenIdle();
      const work = library.get({ workId });
      expect(work.latestPreviewJob?.basedOnContentRev).toBe(work.draft.contentRev);
      expect(work.latestPreviewJob?.preview?.prose).toBe('你抬头时，灯塔刚熄灭。');
    } finally {
      release.resolve();
      await authoring.whenIdle();
      opened.close();
      temp.cleanup();
    }
  });

  it('导入方案完成后模型停用时显示开场失败并保留方案', async () => {
    let narratorAvailable = true;
    const { temp, opened, llm, library, authoring } = setup(() => {
      const base = createScriptedLlm();
      return {
        ...base,
        resolve: (purpose) => (purpose === 'narrator' && !narratorAvailable ? null : base.resolve(purpose)),
        async run(input) {
          const result = await base.run(input);
          if (input.purpose === 'author_chat') narratorAvailable = false;
          return result;
        },
      };
    });
    try {
      llm.enqueue(openingAnalysis('信使初到港口。'), scripted(proposePlanStep()));
      await submitNovelPart(authoring, new File(['第一章 归港\n信使到了码头。'], '归港.txt'));
      await authoring.whenIdle();
      const work = library.get({ workId });
      expect(work.draft.plan?.confirmed).toBe(true);
      expect(work.latestPreviewJob).toMatchObject({ status: 'failed', error: 'llm_not_configured' });

      narratorAvailable = true;
      llm.enqueue(novelPreview('你站在码头上。'));
      authoring.generatePreview({ workId, jobId, contentRev: work.draft.contentRev });
      await authoring.whenIdle();
      expect(library.get({ workId }).latestPreviewJob?.preview?.prose).toBe('你站在码头上。');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

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
