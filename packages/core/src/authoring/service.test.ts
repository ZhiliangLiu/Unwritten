import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { PlanItem, WorkSettings } from '@unwritten/contracts';
import { createEventBus } from '../events/bus.ts';
import type { LogEvent, Logger, PerformanceSample } from '../log/logger.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { openDatabase } from '../store/db.ts';
import { workVersions } from '../store/schema.ts';
import type { VersionMeta } from '../store/meta.ts';
import { createLibraryService } from '../library/service.ts';
import { createCodeBook } from '../story/codebook.ts';
import { loadProjection } from '../story/projection.ts';
import { createAuthoringService } from './service.ts';

const logger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

const workId = '00000000-0000-4000-8000-000000000001';
const jobId = '00000000-0000-4000-8000-000000000002';

const previewArgs = {
  title: '雨夜修钟铺',
  blurb: '一个雨夜，你在钟铺里等一个人。',
  public_setting: '老城的钟铺，雨下了一整夜。',
  prose: '雨声盖住钟声。你抬头看向门口。\n\n门铃响了。',
  options: '{"text":"去开门"}\n{"text":"继续修钟"}',
  place: '钟铺',
  time: '深夜',
  language: 'zh-CN',
  present: '',
  changes:
    '{"type":"new_entity","kind":"character","name":"沈岚","known_as":"撑伞的女人","profile":"带着黑伞","appearance":"短卷发，深色短外套","para":"2"}',
  state: '',
};

const identity: PlanItem = {
  kind: 'summary',
  id: 'summary-identity',
  source: 'ai',
  key: 'identity',
  text: '刚到灯塔镇的邮差，谁也不认识',
};
const situation: PlanItem = {
  kind: 'summary',
  id: 'summary-situation',
  source: 'ai',
  key: 'situation',
  text: '最后一班船靠岸时，镇上停了电',
};
const protagonist: PlanItem = {
  kind: 'entity',
  id: 'entity-protagonist',
  source: 'author',
  entityKind: 'character',
  role: 'protagonist',
  name: '新来的邮差',
  knownAs: null,
  profile: '二十多岁，记性好',
  appearance: null,
  slot: null,
};
const keeper: PlanItem = {
  kind: 'entity',
  id: 'entity-keeper',
  source: 'author',
  entityKind: 'character',
  role: 'cast',
  name: '林潮',
  knownAs: '守灯人',
  profile: '守灯人，五十岁上下，话少',
  appearance: null,
  slot: null,
};
const slotKeeper: PlanItem = {
  ...keeper,
  name: '码头等的人',
  knownAs: null,
  slot: { role: '在码头等主角的人', encounter: '主角下船时遇见' },
};
const tower: PlanItem = {
  kind: 'entity',
  id: 'entity-tower',
  source: 'author',
  entityKind: 'place',
  role: 'other',
  name: '灯塔',
  knownAs: '灯塔',
  profile: '山顶的灯塔，只在夜里亮着',
  appearance: null,
  slot: null,
};
const tide: PlanItem = {
  kind: 'state',
  id: 'state-tide',
  source: 'author',
  key: '潮位',
  label: '潮位',
  display: 'number',
  config: { min: 0, max: 10, unit: '米', stages: [] },
  hidden: false,
  reveal: '',
  initial: '3',
};
const letters: PlanItem = {
  kind: 'state',
  id: 'state-letters',
  source: 'author',
  key: '旧信',
  label: '旧信',
  display: 'list',
  config: { min: null, max: null, unit: null, stages: [] },
  hidden: false,
  reveal: '',
  initial: '[]',
};
const ending: PlanItem = {
  kind: 'ending',
  id: 'ending-letters',
  source: 'author',
  text: '三封旧信都送到收件人手里',
};

const background = '灯塔镇只在夜里通电。新来的邮差要把一袋没有收件人的旧信送出去。';
const baseSettings: WorkSettings = {
  world: { text: '灯塔镇只在夜里通电。' },
  protagonist: {
    text: '新来的邮差，二十多岁，记性好。',
    fields: [
      { name: '名字', defaultValue: '阿岚', isName: true },
      { name: '职业', defaultValue: '邮差', isName: false },
    ],
  },
  cast: { text: '主要人物固定。', mode: 'fixed' },
  secrets: { text: '' },
  opening: { text: '', mode: 'ai' },
  actions: { text: '', hints: 'known_consequences' },
  scenes: { text: '' },
  status: { text: '' },
};

function setup(options?: {
  settings?: WorkSettings;
  planItems?: PlanItem[];
  anchors?: { narrationDirective: string; contentPolicy: string; improvisationScope: string };
}) {
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
  const llm = createScriptedLlm();
  const library = createLibraryService(deps);
  const authoring = createAuthoringService({ ...deps, llm });
  library.create({ workId });
  library.saveDraft({
    workId,
    baseContentRev: 0,
    background,
    anchors: options?.anchors,
    settings: options?.settings ?? baseSettings,
  });
  const draft = opened.db.select().from(workVersions).where(eq(workVersions.kind, 'draft')).get()!;
  const meta = draft.meta as VersionMeta;
  opened.db
    .update(workVersions)
    .set({
      meta: {
        ...meta,
        plan: {
          items: options?.planItems ?? [identity, situation, protagonist, keeper, tower, tide, letters, ending],
          conflicts: [],
          confirmedRev: null,
        },
      },
    })
    .where(eq(workVersions.id, draft.id))
    .run();
  authoring.confirmPlan({ workId, baseContentRev: 1 });
  return { temp, opened, deps, llm, library, authoring, events, samples, draftId: draft.id };
}

describe('createAuthoringService', () => {
  it('采用只发布，不建开局', async () => {
    const { temp, opened, llm, library, authoring } = setup();
    try {
      llm.enqueue({ args: { ...previewArgs, present: '沈岚' } });
      const view = authoring.generatePreview({ workId, jobId, contentRev: 2 });
      expect(view.status).toBe('running');
      await authoring.whenIdle();
      const after = library.get({ workId });
      expect(after.latestPreviewJob?.status).toBe('done');
      expect(after.latestPreviewJob?.preview?.title).toBe('雨夜修钟铺');
      expect(llm.runs[0]?.sessionId).toBe(workId);

      const adopted = authoring.adoptPreview({ workId, jobId });
      expect(adopted.routeId).toBeNull();
      const work = opened.db.get<{ draft_id: string; published_id: string | null }>(
        sql`select draft_id, published_id from works where id = ${workId}`,
      );
      expect(work?.published_id).toBeTruthy();
      const publishedCount = opened.db.get<{ count: number }>(
        sql`select count(*) as count from work_versions where work_id = ${workId} and kind = 'published'`,
      )?.count;
      expect(publishedCount).toBe(1);
      const draftRows = opened.db.all<{ id: string; name: string; profile: string }>(
        sql`select id, name, profile from entities where version_id = ${work?.draft_id ?? ''}`,
      );
      const publishedRows = opened.db.all<{ id: string; name: string; profile: string }>(
        sql`select id, name, profile from entities where version_id = ${work?.published_id ?? ''}`,
      );
      expect(publishedRows.map((row) => row.id).sort()).toEqual(draftRows.map((row) => row.id).sort());
      expect(publishedRows.map((row) => row.name)).toContain('沈岚');
      expect(publishedRows.find((row) => row.name === '沈岚')?.profile).toBe(
        JSON.stringify({ text: '带着黑伞', appearance: '短卷发，深色短外套' }),
      );
      expect(opened.db.all(sql`select * from playthroughs`)).toEqual([]);
      expect(opened.db.all(sql`select * from turns`)).toEqual([]);
      expect(opened.db.all(sql`select * from routes`)).toEqual([]);
      const draftAfter = opened.db.select().from(workVersions).where(eq(workVersions.id, work!.draft_id)).get()!;
      const adoptedMeta = draftAfter.meta as VersionMeta;
      expect(adoptedMeta.plan?.confirmedRev).toBe(3);
      expect(adoptedMeta.opening?.template).toBe(false);
      expect(adoptedMeta.opening?.initialState).toContainEqual({ stateDefId: 'state-tide', value: '3', visible: true });
      expect(Object.keys(adoptedMeta.opening?.createdIds ?? {})).toHaveLength(1);
      expect(adoptedMeta.opening?.scene.presentIds).toEqual([publishedRows.find((row) => row.name === '沈岚')?.id]);
      expect(adoptedMeta.opening?.scene.present).toEqual(['沈岚']);

      expect(library.get({ workId }).status).toBe('playable');
      expect(library.get({ workId }).hasUnpublishedChanges).toBe(false);
      const playthroughId = '00000000-0000-4000-8000-000000000006';
      opened.db.run(
        sql`insert into playthroughs (id, version_id, kind, created_at)
            values (${playthroughId}, ${work?.published_id ?? ''}, 'play', ${Date.now()})`,
      );
      expect(
        library.saveDraft({ workId, baseContentRev: 3, background: '改稿', settings: baseSettings }).contentRev,
      ).toBe(4);
      expect(library.get({ workId }).hasUnpublishedChanges).toBe(true);
      try {
        authoring.applyDraft({ workId, baseContentRev: 3 });
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ code: 'stale_revision' });
      }
      try {
        authoring.applyDraft({ workId, baseContentRev: 4 });
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ code: 'plan_not_confirmed' });
      }
      authoring.confirmPlan({ workId, baseContentRev: 4 });
      const runningPlanId = '00000000-0000-4000-8000-000000000005';
      const now = Date.now();
      opened.db.run(
        sql`insert into jobs (id, work_id, kind, status, input, created_at, updated_at)
            values (${runningPlanId}, ${workId}, 'plan', 'running', '{"contentRev":5}', ${now}, ${now})`,
      );
      try {
        authoring.applyDraft({ workId, baseContentRev: 5 });
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ code: 'job_running' });
      }
      opened.db.run(sql`update jobs set status = 'failed' where id = ${runningPlanId}`);
      expect(authoring.applyDraft({ workId, baseContentRev: 5 }).contentRev).toBe(5);
      expect(authoring.applyDraft({ workId, baseContentRev: 5 }).contentRev).toBe(5);
      expect(library.get({ workId }).hasUnpublishedChanges).toBe(false);
      const publishedAfter = opened.db.get<{ count: number }>(
        sql`select count(*) as count from work_versions where work_id = ${workId} and kind = 'published'`,
      )?.count;
      expect(publishedAfter).toBe(2);
      const currentPublished = opened.db.get<{ id: string; meta: string }>(
        sql`select id, meta from work_versions where id = (select published_id from works where id = ${workId})`,
      );
      expect(currentPublished?.id).not.toBe(work?.published_id);
      expect(JSON.parse(currentPublished?.meta ?? '{}')).toMatchObject({ background: '改稿' });
      const currentPublishedNames = opened.db
        .all<{ name: string }>(sql`select name from entities where version_id = ${currentPublished?.id ?? ''}`)
        .map((row) => row.name);
      expect(currentPublishedNames).toContain('林潮');
      expect(currentPublishedNames).toContain('沈岚');
      expect(opened.db.all(sql`select id from work_versions where id = ${work?.published_id ?? ''}`)).toHaveLength(1);
      expect(
        opened.db.get<{ version_id: string }>(sql`select version_id from playthroughs where id = ${playthroughId}`)
          ?.version_id,
      ).toBe(work?.published_id);

      expect(
        library.saveDraft({ workId, baseContentRev: 5, background: '再改一版', settings: baseSettings }).contentRev,
      ).toBe(6);
      authoring.updatePlanItem({
        workId,
        baseContentRev: 6,
        item: { ...keeper, name: '林潮改' },
      });
      try {
        authoring.applyDraft({ workId, baseContentRev: 7 });
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ code: 'plan_not_confirmed' });
      }
      authoring.confirmPlan({ workId, baseContentRev: 7 });
      const shenId = publishedRows.find((row) => row.name === '沈岚')?.id;
      opened.db.run(
        sql`delete from entities where version_id = (select draft_id from works where id = ${workId}) and id = ${shenId ?? ''}`,
      );
      try {
        authoring.applyDraft({ workId, baseContentRev: 8 });
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ code: 'opening_outdated' });
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('作者锚点跟着草稿进入开场预览和发布版本', async () => {
    const anchors = {
      narrationDirective: '用第二人称，句子短。',
      contentPolicy: '不写血腥场面。',
      improvisationScope: '路人的名字可以现造。',
    };
    const { temp, opened, llm, authoring } = setup({ anchors });
    try {
      llm.enqueue({ args: previewArgs });
      authoring.generatePreview({ workId, jobId, contentRev: 2 });
      await authoring.whenIdle();
      expect(llm.runs[0]?.prompt).toContain('【叙事要求】\n作品语言：跟随背景所用的语言。\n用第二人称，句子短。');
      expect(llm.runs[0]?.prompt).toContain('【内容边界】\n不写血腥场面。');
      expect(llm.runs[0]?.prompt).toContain('【即兴范围】\n路人的名字可以现造。');

      authoring.adoptPreview({ workId, jobId });
      const published = opened.db.select().from(workVersions).where(eq(workVersions.kind, 'published')).get();
      expect(published && (published.meta as VersionMeta).anchors).toEqual(anchors);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('方案没确认时不能生成预览', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const deps = {
        dataDir: temp.dir,
        db: opened.db,
        bus: createEventBus(),
        logger,
        shutdown: new AbortController().signal,
      };
      const library = createLibraryService(deps);
      const authoring = createAuthoringService({ ...deps, llm: createScriptedLlm() });
      library.create({ workId });
      library.saveDraft({ workId, baseContentRev: 0, background, settings: baseSettings });
      try {
        authoring.generatePreview({ workId, jobId, contentRev: 1 });
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ code: 'plan_not_confirmed' });
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('作者原文为空时不能生成预览', () => {
    const settings: WorkSettings = { ...baseSettings, opening: { text: '', mode: 'author_text' } };
    const { temp, opened, authoring } = setup({ settings });
    try {
      try {
        authoring.generatePreview({ workId, jobId, contentRev: 2 });
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ code: 'invalid_input' });
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('预览带上作者设定的人物编号', async () => {
    const { temp, opened, llm, authoring, draftId } = setup();
    try {
      const projection = loadProjection(opened.db, { versionId: draftId, chain: [] });
      const code = createCodeBook(projection).entityCode('entity-keeper');
      llm.enqueue({ args: { ...previewArgs, present: '守灯人' } });
      authoring.generatePreview({ workId, jobId, contentRev: 2 });
      await authoring.whenIdle();
      const prompt = llm.runs[0]?.prompt ?? '';
      expect(prompt.split('\n').some((line) => line.includes(code) && line.includes('守灯人'))).toBe(true);
      expect(prompt).toContain('【主角填写项】');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('作者原文开场写死主角名时拒绝采用', async () => {
    const settings: WorkSettings = {
      ...baseSettings,
      opening: {
        mode: 'author_text',
        text: '船靠岸的时候，整座镇子黑着。\n\n阿岚拎着邮袋走下跳板，只看见山顶的灯塔还亮着。\n\n一个提着马灯的人站在码头尽头，像是在等谁。',
      },
    };
    const { temp, opened, llm, library, authoring } = setup({ settings });
    try {
      const { prose: _prose, ...withoutProse } = previewArgs;
      llm.enqueue({ args: withoutProse });
      authoring.generatePreview({ workId, jobId, contentRev: 2 });
      await authoring.whenIdle();
      const preview = library.get({ workId }).latestPreviewJob?.preview;
      expect(preview?.needsReview).toEqual([
        expect.objectContaining({ where: 'prose', index: 2, reason: 'hardcoded_name' }),
      ]);
      try {
        authoring.adoptPreview({ workId, jobId });
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ code: 'opening_needs_review' });
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('每局生成的作品采用时不写预览人物', async () => {
    const settings: WorkSettings = { ...baseSettings, cast: { text: '', mode: 'per_run' } };
    const planItems = [identity, situation, protagonist, slotKeeper, tower, tide, letters, ending];
    const { temp, opened, llm, authoring } = setup({ settings, planItems });
    try {
      llm.enqueue({
        args: {
          ...previewArgs,
          present: '顾青',
          changes:
            '{"type":"new_entity","kind":"character","name":"顾青","profile":"在码头等人","para":"2","slot":"1"}\n{"type":"new_entity","kind":"place","name":"旧码头","profile":"镇子东边的旧码头","para":"1"}',
        },
      });
      authoring.generatePreview({ workId, jobId, contentRev: 2 });
      await authoring.whenIdle();
      authoring.adoptPreview({ workId, jobId });
      const work = opened.db.get<{ draft_id: string; published_id: string }>(
        sql`select draft_id, published_id from works where id = ${workId}`,
      );
      const publishedNames = opened.db
        .all<{ name: string }>(sql`select name from entities where version_id = ${work?.published_id ?? ''}`)
        .map((row) => row.name);
      expect(publishedNames).toContain('旧码头');
      expect(publishedNames).not.toContain('顾青');
      const draft = opened.db.select().from(workVersions).where(eq(workVersions.id, work!.draft_id)).get()!;
      const meta = draft.meta as VersionMeta;
      expect(meta.opening?.template).toBe(true);
      expect(meta.opening?.scene.presentIds).toEqual([]);
      expect(Object.keys(meta.opening?.createdIds ?? {})).toHaveLength(1);
      expect(opened.db.all(sql`select * from playthroughs`)).toEqual([]);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('生成中删除作品后，将未写入的预览记录为中断', async () => {
    const { temp, opened, llm, library, authoring, events, samples } = setup();
    try {
      llm.enqueue({ args: previewArgs });
      expect(authoring.generatePreview({ workId, jobId, contentRev: 2 }).status).toBe('running');
      library.delete({ workId });
      await authoring.whenIdle();

      expect(llm.runs).toHaveLength(1);
      expect(
        samples.filter((sample) => sample.metric === 'preview.commit' || sample.metric === 'preview.total'),
      ).toEqual([
        expect.objectContaining({ metric: 'preview.commit', jobId, outcome: 'interrupted' }),
        expect.objectContaining({ metric: 'preview.total', jobId, outcome: 'interrupted' }),
      ]);
      expect(events.filter((event) => event.jobId === jobId).map((event) => event.event)).toEqual([
        'preview.job.started',
        'preview.job.interrupted',
      ]);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('预览结果和失败状态都无法写入时，分别记录失败并保留提交样本', async () => {
    const { temp, opened, llm, authoring, events, samples } = setup();
    try {
      opened.db.run(sql`create trigger reject_preview_status before update of status on jobs
        begin select raise(abort, 'write rejected'); end`);
      llm.enqueue({ args: previewArgs });
      expect(authoring.generatePreview({ workId, jobId, contentRev: 2 }).status).toBe('running');
      await authoring.whenIdle();

      expect(events.filter((event) => event.event === 'preview.job.failed').map((event) => event.data?.stage)).toEqual([
        'commit',
        'failure_state',
      ]);
      expect(samples.filter((sample) => sample.metric === 'preview.commit')).toEqual([
        expect.objectContaining({ jobId, outcome: 'error' }),
      ]);
      expect(samples.filter((sample) => sample.metric === 'preview.total')).toEqual([
        expect.objectContaining({ jobId, outcome: 'error' }),
      ]);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同一 jobId 重发返回同一任务，换修订号冲突', async () => {
    const { temp, opened, llm, authoring } = setup();
    try {
      llm.enqueue({ args: previewArgs });
      authoring.generatePreview({ workId, jobId, contentRev: 2 });
      await authoring.whenIdle();
      expect(authoring.generatePreview({ workId, jobId, contentRev: 2 }).status).toBe('done');
      expect(() => authoring.generatePreview({ workId, jobId, contentRev: 3 })).toThrow();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('改过背景后旧预览不能采用', async () => {
    const { temp, opened, llm, library, authoring } = setup();
    try {
      llm.enqueue({ args: previewArgs });
      authoring.generatePreview({ workId, jobId, contentRev: 2 });
      await authoring.whenIdle();
      library.saveDraft({ workId, baseContentRev: 2, background: '新背景', settings: baseSettings });
      expect(() => authoring.adoptPreview({ workId, jobId })).toThrow();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('旧预览不能采用', async () => {
    const { temp, opened, llm, authoring } = setup();
    try {
      llm.enqueue({ args: previewArgs });
      authoring.generatePreview({ workId, jobId, contentRev: 2 });
      await authoring.whenIdle();
      opened.db.run(sql`update jobs set result = json_remove(result, '$.changes') where id = ${jobId}`);
      try {
        authoring.adoptPreview({ workId, jobId });
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ code: 'stale_preview' });
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('模型不可用时拒绝生成', () => {
    const { temp, opened, llm, authoring } = setup();
    try {
      llm.setResolved(null);
      expect(() => authoring.generatePreview({ workId, jobId, contentRev: 2 })).toThrow();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('恢复时把运行中的任务标为中断', () => {
    const { temp, opened, library, authoring } = setup();
    try {
      const now = Date.now();
      opened.db.run(
        `insert into jobs (id, work_id, kind, status, input, created_at, updated_at)
         values ('${jobId}', '${workId}', 'preview', 'running', '{"contentRev":2,"background":"雨夜"}', ${now}, ${now})`,
      );
      expect(authoring.recoverInterrupted()).toBe(1);
      expect(library.get({ workId }).latestPreviewJob?.status).toBe('failed');
      expect(authoring.recoverInterrupted()).toBe(0);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
