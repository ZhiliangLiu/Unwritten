import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createEventBus } from '../events/bus.ts';
import type { LogEvent, Logger, PerformanceSample } from '../log/logger.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { openDatabase } from '../store/db.ts';
import { createLibraryService } from '../library/service.ts';
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
    '{"type":"new_entity","kind":"character","name":"守夜人","known_as":"","profile":"","para":"1","protagonist":"true"}',
};

function setup() {
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
  return { temp, opened, deps, llm, library, authoring, events, samples };
}

describe('createAuthoringService', () => {
  it('生成预览并采用开场', async () => {
    const { temp, opened, llm, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveBackground({ workId, baseContentRev: 0, background: '雨夜修钟铺' });
      llm.enqueue({ args: previewArgs });
      const view = authoring.generatePreview({ workId, jobId, contentRev: 1 });
      expect(view.status).toBe('running');
      await authoring.whenIdle();
      const after = library.get({ workId });
      expect(after.latestPreviewJob?.status).toBe('done');
      expect(after.latestPreviewJob?.preview?.title).toBe('雨夜修钟铺');
      expect(llm.runs[0]?.sessionId).toBe(workId);

      const adopted = authoring.adoptPreview({ workId, jobId });
      expect(adopted.routeId).toBeTruthy();
      const playable = library.get({ workId });
      expect(playable.status).toBe('playable');
      expect(playable.routeId).toBe(adopted.routeId);
      expect(() => library.saveBackground({ workId, baseContentRev: 2, background: '改稿' })).toThrow();
      expect(authoring.adoptPreview({ workId, jobId }).routeId).toBe(adopted.routeId);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('生成中删除作品后，将未写入的预览记录为中断', async () => {
    const { temp, opened, llm, library, authoring, events, samples } = setup();
    try {
      library.create({ workId });
      library.saveBackground({ workId, baseContentRev: 0, background: '钟楼的信' });
      llm.enqueue({ args: previewArgs });
      expect(authoring.generatePreview({ workId, jobId, contentRev: 1 }).status).toBe('running');
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
    const { temp, opened, llm, library, authoring, events, samples } = setup();
    try {
      library.create({ workId });
      library.saveBackground({ workId, baseContentRev: 0, background: '钟楼的信' });
      opened.db.run(sql`create trigger reject_preview_status before update of status on jobs
        begin select raise(abort, 'write rejected'); end`);
      llm.enqueue({ args: previewArgs });
      expect(authoring.generatePreview({ workId, jobId, contentRev: 1 }).status).toBe('running');
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
      expect(library.get({ workId }).latestPreviewJob?.preview).toBeNull();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同一 jobId 重发返回同一任务，换修订号冲突', async () => {
    const { temp, opened, llm, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveBackground({ workId, baseContentRev: 0, background: '雨夜' });
      llm.enqueue({ args: previewArgs });
      authoring.generatePreview({ workId, jobId, contentRev: 1 });
      await authoring.whenIdle();
      expect(authoring.generatePreview({ workId, jobId, contentRev: 1 }).status).toBe('done');
      expect(() => authoring.generatePreview({ workId, jobId, contentRev: 2 })).toThrow();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('改过背景后旧预览不能采用', async () => {
    const { temp, opened, llm, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveBackground({ workId, baseContentRev: 0, background: '旧背景' });
      llm.enqueue({ args: previewArgs });
      authoring.generatePreview({ workId, jobId, contentRev: 1 });
      await authoring.whenIdle();
      library.saveBackground({ workId, baseContentRev: 1, background: '新背景' });
      expect(() => authoring.adoptPreview({ workId, jobId })).toThrow();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('开场没有主角被拒绝并让模型修正', async () => {
    const { temp, opened, llm, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveBackground({ workId, baseContentRev: 0, background: '雨夜' });
      llm.enqueue(
        {
          args: {
            ...previewArgs,
            changes: '{"type":"new_entity","kind":"character","name":"守夜人","profile":"","para":"1"}',
          },
        },
        { args: previewArgs },
      );
      authoring.generatePreview({ workId, jobId, contentRev: 1 });
      await authoring.whenIdle();
      expect(library.get({ workId }).latestPreviewJob?.status).toBe('done');
      expect(llm.runs).toHaveLength(1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('采用开场写入主角和出场人物', async () => {
    const { temp, opened, llm, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveBackground({ workId, baseContentRev: 0, background: '雨夜' });
      llm.enqueue({
        args: {
          ...previewArgs,
          present: '撑伞的女人',
          changes:
            '{"type":"new_entity","kind":"character","name":"守夜人","known_as":"","profile":"","para":"1","protagonist":"true"}\n{"type":"new_entity","kind":"character","name":"沈岚","known_as":"撑伞的女人","profile":"带着黑伞","para":"1"}',
        },
      });
      authoring.generatePreview({ workId, jobId, contentRev: 1 });
      await authoring.whenIdle();
      const adopted = authoring.adoptPreview({ workId, jobId });
      const work = opened.db.get<{ draft_id: string; published_id: string }>(
        sql`select draft_id, published_id from works where id = ${workId}`,
      );
      expect(work).toBeTruthy();
      const publishedRows = opened.db.all<{ id: string; name: string; is_protagonist: number }>(
        sql`select id, name, is_protagonist from entities where version_id = ${work?.published_id ?? ''}`,
      );
      const draftRows = opened.db.all<{ id: string; name: string }>(
        sql`select id, name from entities where version_id = ${work?.draft_id ?? ''}`,
      );
      expect(publishedRows).toHaveLength(2);
      expect(draftRows.map((row) => row.id).sort()).toEqual(publishedRows.map((row) => row.id).sort());
      const protagonist = publishedRows.find((row) => row.is_protagonist === 1);
      expect(protagonist?.name).toBe('守夜人');
      const nameRows = opened.db.all<{ name: string }>(
        sql`select name from entity_names where version_id = ${work?.published_id ?? ''} and holder_id = ${protagonist?.id ?? ''}`,
      );
      expect(nameRows.map((row) => row.name)).toContain('撑伞的女人');
      const route = opened.db.get<{ head_turn_id: string }>(
        sql`select head_turn_id from routes where id = ${adopted.routeId}`,
      );
      const turn = opened.db.get<{ scene: string }>(
        sql`select scene from turns where id = ${route?.head_turn_id ?? ''}`,
      );
      const scene = turn ? (JSON.parse(turn.scene) as { presentIds: string[] }) : null;
      expect(scene?.presentIds).toHaveLength(1);
      expect(scene?.presentIds[0]).toBe(publishedRows.find((row) => row.name === '沈岚')?.id);
      expect(opened.db.all(sql`select * from prose_fts where prose_fts match '盖住钟'`).length).toBeGreaterThan(0);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('旧预览不能采用', async () => {
    const { temp, opened, llm, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveBackground({ workId, baseContentRev: 0, background: '雨夜' });
      llm.enqueue({ args: previewArgs });
      authoring.generatePreview({ workId, jobId, contentRev: 1 });
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

  it('模型不可用时拒绝生成', async () => {
    const { temp, opened, llm, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveBackground({ workId, baseContentRev: 0, background: '雨夜' });
      llm.setResolved(null);
      expect(() => authoring.generatePreview({ workId, jobId, contentRev: 1 })).toThrow();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('恢复时把运行中的任务标为中断', () => {
    const { temp, opened, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveBackground({ workId, baseContentRev: 0, background: '雨夜' });
      const now = Date.now();
      opened.db.run(
        `insert into jobs (id, work_id, kind, status, input, created_at, updated_at)
         values ('${jobId}', '${workId}', 'preview', 'running', '{"contentRev":1,"background":"雨夜"}', ${now}, ${now})`,
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
